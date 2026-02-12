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
import type { ProducerRequest, QualityReport } from "../../common/src/types.js";

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

function slugifySegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureDescriptionRange(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length >= 80 && trimmed.length <= 180) {
    return trimmed;
  }

  if (trimmed.length > 180) {
    return `${trimmed.slice(0, 176).trimEnd()}.`;
  }

  return `${trimmed} Verify local rules, accepted materials, timing constraints, and accountable execution ownership before each operational run.`;
}

export function buildDeterministicFallbackArticle(
  request: ProducerRequest,
  nowIso: string,
  outline: ArticleOutline | null,
): ArticleOutput {
  const city = request.city.trim();
  const topic = request.topic.trim();
  const keyword = request.keyword.trim();

  const citySlug = slugifySegment(city);
  const topicSlug = slugifySegment(topic);
  const keywordSlug = slugifySegment(keyword);
  const slug = `${citySlug}-${topicSlug}-${keywordSlug}-guide`.slice(0, 120).replace(/-+$/g, "");

  const sourceLinks = ["https://www.epa.gov/recycle", "https://www.usa.gov/local-governments"];
  const tags = Array.from(
    new Set(
      [citySlug, topicSlug, "local-guide", "verification", "operations"].filter(
        (value) => value.length > 0,
      ),
    ),
  ).slice(0, 8);

  const audience =
    outline?.audience ??
    `Residents and operations teams in ${city} who need practical ${topic.toLowerCase()} guidance`;
  const intent =
    outline?.intent ??
    `Execute ${topic.toLowerCase()} decisions in ${city} with verifiable and repeatable steps`;

  const keyTakeaways = (outline?.keyTakeaways ?? [
    `Verify current ${city} policy updates before execution`,
    "Use a fixed checklist before scheduling operations",
    "Track ownership and follow-up checkpoints after each run",
  ]).slice(0, 5);

  const decisionChecklist = (outline?.decisionChecklist ?? [
    `Confirm current ${city} acceptance and handling requirements`,
    "Compare at least two practical execution paths with trade-offs",
    "Validate staffing, container, and timing constraints before launch",
    "Assign owner, deadline, and review cadence before execution",
  ]).slice(0, 8);

  const commonMistakes = (outline?.commonMistakes ?? [
    "Using old assumptions without checking the latest local requirements",
    "Choosing a process by headline price instead of operational fit",
    "Skipping ownership and review checkpoints after the first execution",
  ]).slice(0, 6);

  const evidenceNotes = [
    `SourceType: regulator reference | Verification: review ${sourceLinks[0]} for current recycling category guidance`,
    `SourceType: government directory | Verification: use ${sourceLinks[1]} to identify ${city} public service channels`,
  ];

  const content = [
    `## Quick Answer for ${city}`,
    `${topic} decisions in ${city} should start with current rule verification, operational readiness checks, and explicit ownership of follow-up tasks. This prevents avoidable rework and keeps execution predictable for the keyword intent "${keyword}".`,
    `## Situation Snapshot for ${topic} in ${city}`,
    `Most failures come from stale assumptions, incomplete intake requirements, and missing handoff accountability. A practical baseline is to define accepted scope, timing windows, and escalation ownership before committing resources.`,
    `## Step-by-Step Execution Plan`,
    `1. Define the exact materials or process scope for ${topic.toLowerCase()} in ${city}.\n2. Compare at least two execution options using cost, risk, and turnaround criteria.\n3. Validate tools, staffing, and timing dependencies before confirming the run.\n4. Record owner and review checkpoint for post-run adjustments.`,
    `## How to Verify in ${city} Today`,
    `- Confirm latest local acceptance and handling requirements through official public guidance.\n- Validate required preparation steps with your selected service workflow before scheduling.\n- Re-check timing constraints and escalation channels on the day of execution.\n- Document who signs off and when the next review occurs.`,
    `## Common Mistakes`,
    `- Deciding before verifying current local requirements.\n- Optimizing only for initial cost and ignoring execution risk.\n- Launching without named ownership for post-run corrections.`,
    "## FAQ",
    "### What should I confirm first before execution?\nConfirm current local rules, accepted scope, and required preparation steps before committing any schedule.",
    "### How often should this workflow be reviewed?\nReview before each run and after each completed cycle so process updates can be applied immediately.",
    "## Sources",
    `- ${sourceLinks[0]}\n- ${sourceLinks[1]}`,
    `<!-- source-key: ${buildSourceKey(request)} -->`,
  ].join("\n\n");

  return ArticleOutputSchema.parse({
    title: `${city} ${topic}: Practical Verification and Action Checklist`,
    description: ensureDescriptionRange(
      `Actionable ${topic.toLowerCase()} guidance for ${city}, including verification steps, decision checklist, source-backed references, and common mistakes to avoid.`,
    ),
    slug: slug.length > 0 ? slug : `${citySlug || "local"}-${topicSlug || "topic"}-guide`,
    tags: tags.length >= 3 ? tags : ["local-guide", "verification", "operations"],
    audience,
    intent,
    keyTakeaways,
    decisionChecklist,
    commonMistakes,
    evidenceNotes,
    sourceLinks,
    content,
    lastmod: nowIso,
  });
}

async function probeSourceLinks(
  sourceLinks: string[],
  cache: Map<string, boolean>,
): Promise<string[]> {
  const uniqueUrls = Array.from(
    new Set(sourceLinks.map((link) => normalizeUrl(link)).filter((link) => link.length > 0)),
  );

  const reachable: string[] = [];

  for (const url of uniqueUrls) {
    const cached = cache.get(url);
    if (cached !== undefined) {
      if (cached) {
        reachable.push(url);
      }
      continue;
    }

    try {
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
      });

      const ok = response.ok;
      cache.set(url, ok);
      if (ok) {
        reachable.push(url);
      }
    } catch (error) {
      cache.set(url, false);
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
    allowUnreachableSourceLinks?: boolean;
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
    allowUnreachableSourceLinks: options?.allowUnreachableSourceLinks,
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
    allowUnreachableSourceLinks: env.QUALITY_ALLOW_UNREACHABLE_SOURCE_LINKS,
  });

  const sourceLinkProbeCache = new Map<string, boolean>();

  let lastFailureMessage: string | null = null;
  let lastFailureCodes: string[] = [];
  let lastQualityScore: number | null = null;
  let lastSuccessfulOutline: ArticleOutline | null = null;

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
      lastSuccessfulOutline = outline;

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
      const duplicatedStructureCountCache = new Map<string, number>();
      const getDuplicatedStructureCount = async (signature: string): Promise<number> => {
        const cached = duplicatedStructureCountCache.get(signature);
        if (cached !== undefined) {
          return cached;
        }
        const count = await countPublishedWithStructureSignature(signature);
        duplicatedStructureCountCache.set(signature, count);
        return count;
      };

      let duplicatedStructureCount = await getDuplicatedStructureCount(structureSignature);
      let reachableSourceLinks = await probeSourceLinks(article.sourceLinks, sourceLinkProbeCache);
      let qualityReport = evaluateArticle(article, {
        duplicatedStructureCount,
        maxDuplicatedStructureCount: env.QUALITY_MAX_PUBLISHED_SAME_STRUCTURE,
        reachableSourceLinksCount: reachableSourceLinks.length,
        minSourceLinks: env.QUALITY_MIN_SOURCE_LINKS,
        allowUnreachableSourceLinks: env.QUALITY_ALLOW_UNREACHABLE_SOURCE_LINKS,
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
        allowUnreachableSourceLinks: env.QUALITY_ALLOW_UNREACHABLE_SOURCE_LINKS,
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
        duplicatedStructureCount = await getDuplicatedStructureCount(structureSignature);
        reachableSourceLinks = await probeSourceLinks(article.sourceLinks, sourceLinkProbeCache);
        qualityReport = evaluateArticle(article, {
          duplicatedStructureCount,
          maxDuplicatedStructureCount: env.QUALITY_MAX_PUBLISHED_SAME_STRUCTURE,
          reachableSourceLinksCount: reachableSourceLinks.length,
          minSourceLinks: env.QUALITY_MIN_SOURCE_LINKS,
          allowUnreachableSourceLinks: env.QUALITY_ALLOW_UNREACHABLE_SOURCE_LINKS,
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
        sourceLinkProbeCacheEntries: sourceLinkProbeCache.size,
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

  logger.warn("producer retries exhausted, activating deterministic fallback", {
    runId,
    sourceKey,
    maxAttempts,
    lastFailureMessage,
    lastFailureCodes,
    lastQualityScore,
  });

  try {
    const nowIso = new Date().toISOString();
    const fallbackArticle = buildDeterministicFallbackArticle(request, nowIso, lastSuccessfulOutline);

    const duplicatedStructureCount = await countPublishedWithStructureSignature(
      buildStructureSignature(fallbackArticle.content),
    );
    const reachableSourceLinks = await probeSourceLinks(
      fallbackArticle.sourceLinks,
      sourceLinkProbeCache,
    );
    const fallbackQuality = evaluateArticle(fallbackArticle, {
      duplicatedStructureCount,
      maxDuplicatedStructureCount: env.QUALITY_MAX_PUBLISHED_SAME_STRUCTURE,
      reachableSourceLinksCount: reachableSourceLinks.length,
      minSourceLinks: env.QUALITY_MIN_SOURCE_LINKS,
      allowUnreachableSourceLinks: env.QUALITY_ALLOW_UNREACHABLE_SOURCE_LINKS,
    });

    if (!isQualityPassed(fallbackQuality, env.QUALITY_MIN_SCORE)) {
      throw new Error(
        `fallback quality validation failed: ${fallbackQuality.failureCodes.join(",") || "unknown"}`,
      );
    }

    const contentHash = sha256(
      `${fallbackArticle.title}\n${fallbackArticle.description}\n${fallbackArticle.content}`,
    );
    const duplicate = await findByContentHash(contentHash);
    if (duplicate && duplicate.sourceKey !== sourceKey) {
      const dedupArticle: ArticleOutput = {
        ...fallbackArticle,
        slug: `${fallbackArticle.slug}-${runId.slice(0, 6)}`.slice(0, 140),
        content: `${fallbackArticle.content}\n\n<!-- fallback-variant:${runId.slice(0, 8)} -->`,
        lastmod: nowIso,
      };
      const dedupHash = sha256(
        `${dedupArticle.title}\n${dedupArticle.description}\n${dedupArticle.content}`,
      );
      const dedupQuality = evaluateArticle(dedupArticle, {
        duplicatedStructureCount,
        maxDuplicatedStructureCount: env.QUALITY_MAX_PUBLISHED_SAME_STRUCTURE,
        reachableSourceLinksCount: reachableSourceLinks.length,
        minSourceLinks: env.QUALITY_MIN_SOURCE_LINKS,
        allowUnreachableSourceLinks: env.QUALITY_ALLOW_UNREACHABLE_SOURCE_LINKS,
      });

      if (!isQualityPassed(dedupQuality, env.QUALITY_MIN_SCORE)) {
        throw new Error(
          `fallback dedup quality validation failed: ${dedupQuality.failureCodes.join(",") || "unknown"}`,
        );
      }

      const dedupRecord = await upsertGeneratedContent({
        sourceKey,
        topic: request.topic,
        city: request.city,
        keyword: request.keyword,
        title: dedupArticle.title,
        description: dedupArticle.description,
        slug: dedupArticle.slug,
        tags: dedupArticle.tags,
        content: dedupArticle.content,
        lastmod: new Date(dedupArticle.lastmod),
        promptVersion: env.GENKIT_PROMPT_VERSION,
        modelVersion: "deterministic-fallback",
        rawJson: {
          runId,
          fallback: true,
          fallbackReason: lastFailureMessage,
          attempt: maxAttempts,
          maxAttempts,
          article: dedupArticle,
          qualityReport: dedupQuality,
          reachableSourceLinks,
        },
        qualityReport: dedupQuality,
        contentHash: dedupHash,
        statusAfterQuality: "generated",
        lastError: null,
      });

      await markPublished([dedupRecord.id]);

      logger.info("producer fallback stored article", {
        runId,
        sourceKey,
        id: dedupRecord.id,
        slug: dedupRecord.slug,
        qualityScore: dedupRecord.qualityReport.scoreTotal,
        fallback: true,
      });
      return;
    }

    const fallbackRecord = await upsertGeneratedContent({
      sourceKey,
      topic: request.topic,
      city: request.city,
      keyword: request.keyword,
      title: fallbackArticle.title,
      description: fallbackArticle.description,
      slug: fallbackArticle.slug,
      tags: fallbackArticle.tags,
      content: fallbackArticle.content,
      lastmod: new Date(fallbackArticle.lastmod),
      promptVersion: env.GENKIT_PROMPT_VERSION,
      modelVersion: "deterministic-fallback",
      rawJson: {
        runId,
        fallback: true,
        fallbackReason: lastFailureMessage,
        attempt: maxAttempts,
        maxAttempts,
        article: fallbackArticle,
        qualityReport: fallbackQuality,
        reachableSourceLinks,
      },
      qualityReport: fallbackQuality,
      contentHash,
      statusAfterQuality: "generated",
      lastError: null,
    });

    await markPublished([fallbackRecord.id]);

    logger.info("producer fallback stored article", {
      runId,
      sourceKey,
      id: fallbackRecord.id,
      slug: fallbackRecord.slug,
      qualityScore: fallbackRecord.qualityReport.scoreTotal,
      fallback: true,
    });
    return;
  } catch (error) {
    logger.error("producer fallback failed", {
      runId,
      sourceKey,
      message: normalizeError(error),
    });
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
