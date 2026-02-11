import { randomUUID } from "node:crypto";
import { ai } from "./genkit.js";
import { z } from "genkit";
import {
  ArticleOutlineSchema,
  ArticleOutputSchema,
  type ArticleOutline,
  type ArticleOutput,
} from "./schema.js";
import { getEnv } from "../../common/src/env.js";
import { logger } from "../../common/src/logger.js";
import { evaluateQuality } from "../../common/src/quality.js";
import { normalizeError } from "../../common/src/errors.js";
import { sha256 } from "../../common/src/hash.js";
import {
  countPublishedWithStructureSignature,
  findByContentHash,
  markPublished,
  upsertGeneratedContent,
} from "../../common/src/repository.js";
import { ProducerRequest, QualityReport } from "../../common/src/types.js";

function buildSourceKey(request: ProducerRequest): string {
  return `${request.city}::${request.topic}::${request.keyword}`.toLowerCase();
}

function isQualityPassed(qualityReport: QualityReport, minScore: number): boolean {
  return qualityReport.hardFailureCount === 0 && qualityReport.scoreTotal >= minScore;
}

function buildStructureSignature(content: string): string {
  const headingLines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^#{2,3}\s+/.test(line))
    .map((line) => line.toLowerCase().replace(/\s+/g, " "));

  return headingLines.join("|");
}

function normalizeUrl(link: string): string {
  try {
    const parsed = new URL(link.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function maybeAppendSourcesSection(content: string, sourceLinks: string[]): string {
  if (sourceLinks.length === 0) {
    return content;
  }

  if (content.includes("## Sources")) {
    return content;
  }

  const references = sourceLinks.map((link) => `- ${link}`).join("\n");
  return `${content.trim()}\n\n## Sources\n${references}`;
}

async function probeSourceLinks(sourceLinks: string[]): Promise<string[]> {
  const uniqueUrls = Array.from(
    new Set(sourceLinks.map((link) => normalizeUrl(link)).filter((link) => link.length > 0)),
  );

  const reachable: string[] = [];

  for (const url of uniqueUrls) {
    try {
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
      });

      if (response.ok) {
        reachable.push(url);
      }
    } catch (error) {
      logger.warn("producer source link probe failed", {
        url,
        message: normalizeError(error),
      });
    }
  }

  return reachable;
}

function evaluateArticle(
  article: ArticleOutput,
  options?: {
    duplicatedStructureCount?: number;
    maxDuplicatedStructureCount?: number;
    reachableSourceLinksCount?: number;
    minSourceLinks?: number;
  },
): QualityReport {
  return evaluateQuality({
    title: article.title,
    description: article.description,
    tags: article.tags,
    content: article.content,
    audience: article.audience,
    intent: article.intent,
    keyTakeaways: article.keyTakeaways,
    decisionChecklist: article.decisionChecklist,
    commonMistakes: article.commonMistakes,
    evidenceNotes: article.evidenceNotes,
    sourceLinks: article.sourceLinks,
    duplicatedStructureCount: options?.duplicatedStructureCount,
    maxDuplicatedStructureCount: options?.maxDuplicatedStructureCount,
    reachableSourceLinksCount: options?.reachableSourceLinksCount,
    minSourceLinks: options?.minSourceLinks,
  });
}

async function reviseArticleWithFailures(
  article: ArticleOutput,
  qualityReport: QualityReport,
  language: string,
): Promise<ArticleOutput> {
  const revisePrompt = ai.prompt<z.ZodTypeAny, typeof ArticleOutputSchema, z.ZodTypeAny>(
    "seo-revise",
  );

  const { output } = await revisePrompt(
    {
      language,
      nowIso: new Date().toISOString(),
      originalArticleJson: JSON.stringify(article),
      failureCodesJson: JSON.stringify(qualityReport.failureCodes),
      failureMessagesJson: JSON.stringify(qualityReport.failures.map((item) => item.message)),
      qualitySummaryJson: JSON.stringify({
        scoreTotal: qualityReport.scoreTotal,
        hardFailureCount: qualityReport.hardFailureCount,
        softFailureCount: qualityReport.softFailureCount,
      }),
    },
    {
      output: {
        schema: ArticleOutputSchema,
      },
    },
  );

  if (!output) {
    throw new Error("Genkit returned empty revised article output");
  }

  return ArticleOutputSchema.parse(output);
}

export async function produceArticle(request: ProducerRequest): Promise<void> {
  const env = getEnv();
  const runId = randomUUID();
  const sourceKey = buildSourceKey(request);
  const maxAttempts = env.PRODUCER_MAX_ATTEMPTS;

  const outlinePrompt = ai.prompt<z.ZodTypeAny, typeof ArticleOutlineSchema, z.ZodTypeAny>(
    env.PRODUCER_OUTLINE_PROMPT_NAME,
  );
  const articlePrompt = ai.prompt<z.ZodTypeAny, typeof ArticleOutputSchema, z.ZodTypeAny>(
    env.PRODUCER_PROMPT_NAME,
  );

  logger.info("producer run started", {
    runId,
    sourceKey,
    topic: request.topic,
    city: request.city,
    keyword: request.keyword,
    language: request.language ?? "en",
    maxAttempts,
    maxRevisionsPerAttempt: env.PRODUCER_MAX_REVISIONS,
    qualityMinScore: env.QUALITY_MIN_SCORE,
    minSourceLinks: env.QUALITY_MIN_SOURCE_LINKS,
    maxPublishedSameStructure: env.QUALITY_MAX_PUBLISHED_SAME_STRUCTURE,
  });

  let lastFailureMessage: string | null = null;
  let lastFailureCodes: string[] = [];
  let lastQualityScore: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    logger.info("producer attempt started", {
      runId,
      sourceKey,
      attempt,
      maxAttempts,
    });

    try {
      const commonInput = {
        topic: request.topic,
        city: request.city,
        keyword: request.keyword,
        language: request.language ?? "en",
        promptVersion: env.GENKIT_PROMPT_VERSION,
        nowIso: new Date().toISOString(),
      };

      logger.info("producer phase start", {
        runId,
        sourceKey,
        attempt,
        phase: "outline_generation",
      });

      const { output: outlineOutput } = await outlinePrompt(commonInput, {
        output: {
          schema: ArticleOutlineSchema,
        },
      });

      if (!outlineOutput) {
        throw new Error("Genkit returned empty outline output");
      }

      const outline: ArticleOutline = ArticleOutlineSchema.parse(outlineOutput);

      logger.info("producer phase completed", {
        runId,
        sourceKey,
        attempt,
        phase: "outline_generation",
        sectionCount: outline.sectionPlan.length,
        takeawaysCount: outline.keyTakeaways.length,
      });

      logger.info("producer phase start", {
        runId,
        sourceKey,
        attempt,
        phase: "article_generation",
      });

      const { output: articleOutput } = await articlePrompt(
        {
          ...commonInput,
          outlineJson: JSON.stringify(outline),
        },
        {
          output: {
            schema: ArticleOutputSchema,
          },
        },
      );

      if (!articleOutput) {
        throw new Error("Genkit returned empty article output");
      }

      let article: ArticleOutput = ArticleOutputSchema.parse(articleOutput);

      logger.info("producer phase completed", {
        runId,
        sourceKey,
        attempt,
        phase: "article_generation",
        slug: article.slug,
        tagsCount: article.tags.length,
      });

      article = {
        ...article,
        sourceLinks: Array.from(
          new Set(
            article.sourceLinks
              .map((link) => normalizeUrl(link))
              .filter((link): link is string => link.length > 0),
          ),
        ),
      };
      article = {
        ...article,
        content: maybeAppendSourcesSection(article.content, article.sourceLinks),
      };

      let structureSignature = buildStructureSignature(article.content);
      let duplicatedStructureCount = await countPublishedWithStructureSignature(structureSignature);
      let reachableSourceLinks = await probeSourceLinks(article.sourceLinks);
      let qualityReport = evaluateArticle(article, {
        duplicatedStructureCount,
        maxDuplicatedStructureCount: env.QUALITY_MAX_PUBLISHED_SAME_STRUCTURE,
        reachableSourceLinksCount: reachableSourceLinks.length,
        minSourceLinks: env.QUALITY_MIN_SOURCE_LINKS,
      });
      logger.info("producer quality evaluated", {
        runId,
        sourceKey,
        attempt,
        revisionAttempt: 0,
        scoreTotal: qualityReport.scoreTotal,
        hardFailureCount: qualityReport.hardFailureCount,
        softFailureCount: qualityReport.softFailureCount,
        failureCodes: qualityReport.failureCodes,
        duplicatedStructureCount,
        reachableSourceLinksCount: reachableSourceLinks.length,
        passed: isQualityPassed(qualityReport, env.QUALITY_MIN_SCORE),
      });

      for (let revisionAttempt = 1; revisionAttempt <= env.PRODUCER_MAX_REVISIONS; revisionAttempt += 1) {
        if (isQualityPassed(qualityReport, env.QUALITY_MIN_SCORE)) {
          break;
        }

        logger.info("producer revision started", {
          runId,
          sourceKey,
          attempt,
          revisionAttempt,
          failureCodes: qualityReport.failureCodes,
        });

        article = await reviseArticleWithFailures(
          article,
          qualityReport,
          commonInput.language,
        );
        article = {
          ...article,
          sourceLinks: Array.from(
            new Set(
              article.sourceLinks
                .map((link) => normalizeUrl(link))
                .filter((link): link is string => link.length > 0),
            ),
          ),
        };
        article = {
          ...article,
          content: maybeAppendSourcesSection(article.content, article.sourceLinks),
        };
        structureSignature = buildStructureSignature(article.content);
        duplicatedStructureCount = await countPublishedWithStructureSignature(structureSignature);
        reachableSourceLinks = await probeSourceLinks(article.sourceLinks);
        qualityReport = evaluateArticle(article, {
          duplicatedStructureCount,
          maxDuplicatedStructureCount: env.QUALITY_MAX_PUBLISHED_SAME_STRUCTURE,
          reachableSourceLinksCount: reachableSourceLinks.length,
          minSourceLinks: env.QUALITY_MIN_SOURCE_LINKS,
        });

        logger.info("producer revision completed", {
          runId,
          sourceKey,
          attempt,
          revisionAttempt,
          scoreTotal: qualityReport.scoreTotal,
          hardFailureCount: qualityReport.hardFailureCount,
          softFailureCount: qualityReport.softFailureCount,
          failureCodes: qualityReport.failureCodes,
          duplicatedStructureCount,
          reachableSourceLinksCount: reachableSourceLinks.length,
          passed: isQualityPassed(qualityReport, env.QUALITY_MIN_SCORE),
        });
      }

      if (!isQualityPassed(qualityReport, env.QUALITY_MIN_SCORE)) {
        lastFailureMessage = "quality validation failed";
        lastFailureCodes = qualityReport.failureCodes;
        lastQualityScore = qualityReport.scoreTotal;

        logger.warn("producer attempt failed quality gate, retrying", {
          runId,
          sourceKey,
          attempt,
          maxAttempts,
          scoreTotal: qualityReport.scoreTotal,
          hardFailureCount: qualityReport.hardFailureCount,
          softFailureCount: qualityReport.softFailureCount,
          failureCodes: qualityReport.failureCodes,
          duplicatedStructureCount,
          reachableSourceLinksCount: reachableSourceLinks.length,
        });
        continue;
      }

      const sanitizedSourceLinks = article.sourceLinks
        .map((link) => normalizeUrl(link))
        .filter((link): link is string => link.length > 0);
      article = {
        ...article,
        sourceLinks: Array.from(new Set(sanitizedSourceLinks)),
      };

      article = {
        ...article,
        content: maybeAppendSourcesSection(article.content, article.sourceLinks),
      };

      structureSignature = buildStructureSignature(article.content);
      duplicatedStructureCount = await countPublishedWithStructureSignature(structureSignature);
      reachableSourceLinks = await probeSourceLinks(article.sourceLinks);
      qualityReport = evaluateArticle(article, {
        duplicatedStructureCount,
        maxDuplicatedStructureCount: env.QUALITY_MAX_PUBLISHED_SAME_STRUCTURE,
        reachableSourceLinksCount: reachableSourceLinks.length,
        minSourceLinks: env.QUALITY_MIN_SOURCE_LINKS,
      });

      if (!isQualityPassed(qualityReport, env.QUALITY_MIN_SCORE)) {
        lastFailureMessage = "quality validation failed";
        lastFailureCodes = qualityReport.failureCodes;
        lastQualityScore = qualityReport.scoreTotal;

        logger.warn("producer attempt failed post-normalization quality gate, retrying", {
          runId,
          sourceKey,
          attempt,
          maxAttempts,
          scoreTotal: qualityReport.scoreTotal,
          hardFailureCount: qualityReport.hardFailureCount,
          softFailureCount: qualityReport.softFailureCount,
          failureCodes: qualityReport.failureCodes,
          duplicatedStructureCount,
          reachableSourceLinksCount: reachableSourceLinks.length,
        });
        continue;
      }

      const contentHash = sha256(`${article.title}\n${article.description}\n${article.content}`);
      const duplicate = await findByContentHash(contentHash);
      if (duplicate && duplicate.sourceKey !== sourceKey) {
        lastFailureMessage = "duplicate content hash detected";
        lastFailureCodes = [];
        lastQualityScore = qualityReport.scoreTotal;

        logger.warn("producer attempt hit duplicate hash, retrying", {
          runId,
          sourceKey,
          attempt,
          maxAttempts,
          duplicateId: duplicate.id,
          duplicateSourceKey: duplicate.sourceKey,
          hash: contentHash,
        });
        continue;
      }

      const record = await upsertGeneratedContent({
        sourceKey,
        topic: request.topic,
        city: request.city,
        keyword: request.keyword,
        title: article.title,
        description: article.description,
        slug: article.slug,
        tags: article.tags,
        content: article.content,
        lastmod: new Date(article.lastmod),
        promptVersion: env.GENKIT_PROMPT_VERSION,
        modelVersion: "prompt-managed",
        rawJson: {
          runId,
          attempt,
          maxAttempts,
          outline,
          article,
          qualityReport,
          structureSignature,
          duplicatedStructureCount,
          reachableSourceLinks,
        },
        qualityReport,
        contentHash,
        statusAfterQuality: "generated",
        lastError: null,
      });

      await markPublished([record.id]);

      logger.info("producer stored article", {
        runId,
        sourceKey: record.sourceKey,
        id: record.id,
        slug: record.slug,
        status: "published",
        qualityPassed: record.qualityReport.passed,
        qualityScore: record.qualityReport.scoreTotal,
        hardFailureCount: record.qualityReport.hardFailureCount,
        softFailureCount: record.qualityReport.softFailureCount,
        failureCodes: record.qualityReport.failureCodes,
        attemptsUsed: attempt,
      });

      logger.info("producer run completed", {
        runId,
        sourceKey,
        attemptsUsed: attempt,
        maxAttempts,
      });

      return;
    } catch (error) {
      lastFailureMessage = normalizeError(error);
      lastFailureCodes = [];

      logger.warn("producer attempt errored, retrying", {
        runId,
        sourceKey,
        attempt,
        maxAttempts,
        message: lastFailureMessage,
      });
    }
  }

  logger.error("producer run exhausted retries", {
    runId,
    sourceKey,
    maxAttempts,
    lastFailureMessage,
    lastFailureCodes,
    lastQualityScore,
  });

  throw new Error(
    `producer failed after ${maxAttempts} attempts: ${lastFailureMessage ?? "unknown reason"}`,
  );
}
