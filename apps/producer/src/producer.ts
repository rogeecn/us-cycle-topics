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
import { sha256 } from "../../common/src/hash.js";
import {
  findByContentHash,
  markPublished,
  upsertGeneratedContent,
} from "../../common/src/repository.js";
import { ProducerRequest, QualityReport } from "../../common/src/types.js";

function buildSourceKey(request: ProducerRequest): string {
  return `${request.city}::${request.topic}::${request.keyword}`.toLowerCase();
}

function resolvePostQualityStatus(
  qualityReport: QualityReport,
  minScore: number,
): {
  statusAfterQuality: "generated" | "failed";
  lastError: string | null;
} {
  if (qualityReport.hardFailureCount === 0 && qualityReport.scoreTotal >= minScore) {
    return {
      statusAfterQuality: "generated",
      lastError: null,
    };
  }

  return {
    statusAfterQuality: "failed",
    lastError: "quality validation failed",
  };
}

function evaluateArticle(article: ArticleOutput): QualityReport {
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
  const outlinePrompt = ai.prompt<z.ZodTypeAny, typeof ArticleOutlineSchema, z.ZodTypeAny>(
    env.PRODUCER_OUTLINE_PROMPT_NAME,
  );
  const articlePrompt = ai.prompt<z.ZodTypeAny, typeof ArticleOutputSchema, z.ZodTypeAny>(
    env.PRODUCER_PROMPT_NAME,
  );

  const commonInput = {
    topic: request.topic,
    city: request.city,
    keyword: request.keyword,
    language: request.language ?? "en",
    promptVersion: env.GENKIT_PROMPT_VERSION,
    nowIso: new Date().toISOString(),
  };

  const { output: outlineOutput } = await outlinePrompt(commonInput, {
    output: {
      schema: ArticleOutlineSchema,
    },
  });

  if (!outlineOutput) {
    throw new Error("Genkit returned empty outline output");
  }

  const outline: ArticleOutline = ArticleOutlineSchema.parse(outlineOutput);

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
  let qualityReport = evaluateArticle(article);

  for (let attempt = 1; attempt <= env.PRODUCER_MAX_REVISIONS; attempt += 1) {
    if (qualityReport.hardFailureCount === 0 && qualityReport.scoreTotal >= env.QUALITY_MIN_SCORE) {
      break;
    }

    if (qualityReport.hardFailureCount > 0) {
      break;
    }

    article = await reviseArticleWithFailures(
      article,
      qualityReport,
      commonInput.language,
    );
    qualityReport = evaluateArticle(article);

    logger.info("producer auto-revision attempt completed", {
      attempt,
      scoreTotal: qualityReport.scoreTotal,
      hardFailureCount: qualityReport.hardFailureCount,
      softFailureCount: qualityReport.softFailureCount,
    });
  }

  const qualityDecision = resolvePostQualityStatus(
    qualityReport,
    env.QUALITY_MIN_SCORE,
  );

  const contentHash = sha256(`${article.title}\n${article.description}\n${article.content}`);

  const duplicate = await findByContentHash(contentHash);
  if (duplicate && duplicate.sourceKey !== buildSourceKey(request)) {
    logger.warn("duplicate content hash detected, routed to failed", {
      duplicateId: duplicate.id,
      duplicateSourceKey: duplicate.sourceKey,
      currentSourceKey: buildSourceKey(request),
      hash: contentHash,
    });

    const duplicateRecord = await upsertGeneratedContent({
      sourceKey: buildSourceKey(request),
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
        outline,
        article,
        qualityReport,
      },
      qualityReport,
      contentHash,
      statusAfterQuality: "failed",
      lastError: "duplicate content hash detected",
    });

    logger.info("producer stored article", {
      id: duplicateRecord.id,
      sourceKey: duplicateRecord.sourceKey,
      slug: duplicateRecord.slug,
      status: duplicateRecord.status,
      qualityPassed: duplicateRecord.qualityReport.passed,
      qualityScore: duplicateRecord.qualityReport.scoreTotal,
      hardFailureCount: duplicateRecord.qualityReport.hardFailureCount,
      softFailureCount: duplicateRecord.qualityReport.softFailureCount,
      lastError: duplicateRecord.lastError,
    });

    return;
  }

  const record = await upsertGeneratedContent({
    sourceKey: buildSourceKey(request),
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
      outline,
      article,
      qualityReport,
    },
    qualityReport,
    contentHash,
    statusAfterQuality: qualityDecision.statusAfterQuality,
    lastError: qualityDecision.lastError,
  });

  if (record.status === "generated") {
    await markPublished([record.id]);
  }

  logger.info("producer stored article", {
    id: record.id,
    sourceKey: record.sourceKey,
    slug: record.slug,
    status: record.status === "generated" ? "published" : record.status,
    qualityPassed: record.qualityReport.passed,
    qualityScore: record.qualityReport.scoreTotal,
    hardFailureCount: record.qualityReport.hardFailureCount,
    softFailureCount: record.qualityReport.softFailureCount,
    lastError: record.lastError,
  });
}
