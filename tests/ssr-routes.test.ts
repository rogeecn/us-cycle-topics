import fs from "node:fs";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "../apps/common/src/db.js";
import { resetEnvForTests } from "../apps/common/src/env.js";
import { markPublished, upsertGeneratedContent } from "../apps/common/src/repository.js";
import { createSsrApp } from "../apps/ssr/src/server.js";
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
    process.env.SITE_BASE_URL = "http://localhost:3000";
    await runMigration();
  });

  afterAll(() => {
    resetDbForTests();
    resetEnvForTests();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it("renders markdown as HTML and strips unsafe tags on detail page", async () => {
    const inserted = await upsertGeneratedContent(
      sampleInput({
        slug: "markdown-article",
        sourceKey: "markdown-source",
        contentHash: "markdown-hash",
        city: "Sidebar City",
        tags: ["sidebar-tag", "safety"],
        content: "# Visible Article\n\nParagraph with [link](https://example.com).\n\n<script>alert('xss')</script>",
      }),
    );
    await markPublished([inserted.id]);

    const app = createSsrApp();
    const response = await request(app).get("/posts/markdown-article");

    expect(response.status).toBe(200);
    expect(response.text).toContain('<h1 class="post__title">Visible Article</h1>');
    expect(response.text).not.toContain('<div class="content post__content clearfix">\n\t\t\t<h1>Visible Article</h1>');
    expect(response.text).toContain('href="https://example.com"');
    expect(response.text).toContain("&lt;script&gt;alert");
    expect(response.text).not.toContain("<p><script>");
    expect(response.text).toContain("Recent Posts");
    expect(response.text).toContain("Sidebar City");
    expect(response.text).toContain("(1)");
    expect(response.text).toContain("sidebar-tag");
  });

  it("renders published articles on list page", async () => {
    const publishedIds: number[] = [];

    for (let i = 0; i < 12; i += 1) {
      const inserted = await upsertGeneratedContent(
        sampleInput({
          sourceKey: `published-source-${i}`,
          slug: `visible-article-${i}`,
          contentHash: `visible-hash-${i}`,
          title: `Visible Article ${i}`,
        }),
      );
      publishedIds.push(inserted.id);
    }

    await markPublished(publishedIds);

    const app = createSsrApp();
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Visible Article 0");
    expect(response.text).toContain("Recent Posts");
    expect(response.text).toContain("Categories");
    expect(response.text).toContain("Tags");
    expect(response.text).toContain("City");
    expect(response.text).toContain("a");
    expect(response.text).toContain("(12)");
  });
});
