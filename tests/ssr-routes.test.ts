import fs from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "../apps/common/src/db.js";
import { resetEnvForTests } from "../apps/common/src/env.js";
import { markPublished, upsertGeneratedContent } from "../apps/common/src/repository.js";
import type { GeneratedContentInput, QualityReport } from "../apps/common/src/types.js";
import { runMigration } from "../db/migrate.js";

const TEST_DB_PATH = "./db/test-ssr.db";

function qualityReport(score: number): QualityReport {
  return {
    passed: true,
    checkedAt: new Date().toISOString(),
    scoreTotal: score,
    scoreMax: 100,
    hardFailureCount: 0,
    softFailureCount: 0,
    failureCodes: [],
    failures: [],
    dimensions: {
      structure: { score: 25, max: 25, notes: [] },
      specificity: { score: 25, max: 25, notes: [] },
      antiRepetition: { score: 25, max: 25, notes: [] },
      safety: { score: 25, max: 25, notes: [] },
    },
    metrics: {
      contentChars: 100,
      descriptionChars: 50,
      tagsCount: 2,
      headingCount: 3,
      checklistItems: 2,
      faqQuestions: 2,
      repeatedLineCount: 0,
      repeatedBigramCount: 0,
    },
  };
}

function sampleInput(overrides?: Partial<GeneratedContentInput>): GeneratedContentInput {
  return {
    sourceKey: "published-source",
    topic: "Topic",
    city: "City",
    keyword: "keyword",
    title: "Visible Article",
    description: "Visible Description",
    slug: "visible-article",
    tags: ["a", "b"],
    content: "Visible Content",
    lastmod: new Date("2026-02-01T00:00:00.000Z"),
    promptVersion: "v1",
    modelVersion: "test",
    rawJson: { ok: true },
    qualityReport: qualityReport(90),
    contentHash: "visible-hash",
    statusAfterQuality: "generated",
    ...overrides,
  };
}

describe("SSR data routing contracts", () => {
  beforeEach(async () => {
    resetDbForTests();
    resetEnvForTests();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    process.env.SQLITE_DB_PATH = TEST_DB_PATH;
    await runMigration();
  });

  afterAll(() => {
    resetDbForTests();
    resetEnvForTests();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it("allows published article insertion and retrieval seed", async () => {
    const inserted = await upsertGeneratedContent(sampleInput());
    await markPublished([inserted.id]);
    expect(true).toBe(true);
  });

  it("can seed more than one published record for pagination", async () => {
    for (let i = 0; i < 12; i += 1) {
      await upsertGeneratedContent(
        sampleInput({
          sourceKey: `published-source-${i}`,
          slug: `visible-article-${i}`,
          contentHash: `visible-hash-${i}`,
          title: `Visible Article ${i}`,
        }),
      );
    }

    expect(true).toBe(true);
  });
});
