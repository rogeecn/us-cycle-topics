import fs from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "../apps/common/src/db.js";
import { resetEnvForTests } from "../apps/common/src/env.js";
import {
  acquirePipelineLock,
  findByContentHash,
  listReadyForPublication,
  markPublished,
  upsertGeneratedContent,
} from "../apps/common/src/repository.js";
import type { GeneratedContentInput, QualityReport } from "../apps/common/src/types.js";
import { runMigration } from "../db/migrate.js";

const TEST_DB_PATH = "./db/test.db";

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
    sourceKey: "test-source",
    topic: "Test Topic",
    city: "Test City",
    keyword: "test keyword",
    title: "Test Title",
    description: "Test Description",
    slug: "test-slug",
    tags: ["test", "sqlite"],
    content: "Test Content",
    lastmod: new Date("2026-02-01T00:00:00.000Z"),
    promptVersion: "v1",
    modelVersion: "test-model",
    rawJson: { sample: true },
    qualityReport: qualityReport(95),
    contentHash: "hash123",
    statusAfterQuality: "generated",
    ...overrides,
  };
}

describe("Repository State Transitions", () => {
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

  it("stores and retrieves content hash records", async () => {
    const created = await upsertGeneratedContent(sampleInput());
    expect(created.sourceKey).toBe("test-source");
    expect(created.status).toBe("generated");

    const found = await findByContentHash("hash123");
    expect(found?.id).toBe(created.id);
  });

  it("selects generated records ready for publication", async () => {
    await upsertGeneratedContent(sampleInput());
    const ready = await listReadyForPublication("incremental", 70, 10);

    expect(ready.length).toBe(1);
    expect(ready[0].status).toBe("generated");
  });

  it("marks published state", async () => {
    const article = await upsertGeneratedContent(sampleInput());
    await markPublished([article.id]);

    const found = await findByContentHash("hash123");
    expect(found?.status).toBe("published");
  });

  it("accepts needs_review state", async () => {
    const record = await upsertGeneratedContent(
      sampleInput({
        sourceKey: "review-source",
        contentHash: "review-hash",
        slug: "review-slug",
        statusAfterQuality: "needs_review",
      }),
    );

    expect(record.status).toBe("needs_review");
  });

  it("enforces lock ownership for one contender", async () => {
    const first = await acquirePipelineLock(null, 424242);
    const second = await acquirePipelineLock(null, 424242);

    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});
