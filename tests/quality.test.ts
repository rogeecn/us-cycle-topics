import { describe, expect, it } from "vitest";
import { evaluateQuality } from "../apps/common/src/quality.js";
import { buildDeterministicFallbackArticle } from "../apps/producer/src/producer.js";

function buildQualityInput(overrides?: Partial<Parameters<typeof evaluateQuality>[0]>) {
  return {
    title: "Practical recycling workflow in Austin",
    description:
      "A practical guide to plan recycling operations in Austin with source-backed checks and local verification steps.",
    tags: ["recycling", "austin", "operations"],
    content: [
      "## Overview",
      "This guide helps teams prepare operations and avoid execution mistakes while keeping decisions verifiable.",
      "## How to Verify in Austin Today",
      "- Confirm local rules on the official city site",
      "- Verify accepted materials before scheduling pickup",
      "- Reconfirm timing windows before dispatch",
      "## Execution Checklist",
      "- Compare two options with trade-offs",
      "- Validate handling constraints",
      "- Record owner and timeline",
      "- Review after first cycle",
      "## Common Mistakes",
      "- Skipping verification before scheduling",
      "- Choosing by price only",
      "- Missing ownership for follow-up",
      "## FAQ",
      "### What should I verify first?",
      "Check local acceptance and timing.",
      "### How often should I re-check?",
      "Before each run.",
      "## Sources",
      "- https://www.epa.gov/recycle",
      "- https://www.austintexas.gov",
    ].join("\n\n"),
    audience: "Operations managers running city recycling workflows",
    intent: "Choose and execute a reliable recycling workflow with verifiable local checks",
    keyTakeaways: [
      "Validate local acceptance before scheduling",
      "Run a checklist before each execution",
      "Track owner and review cadence",
    ],
    decisionChecklist: [
      "Confirm local rule updates",
      "Compare two process options",
      "Validate capacity and timing",
      "Set post-run review owner",
    ],
    commonMistakes: [
      "Skipping local verification",
      "Relying on stale assumptions",
      "Not assigning accountability",
    ],
    evidenceNotes: [
      "SourceType: municipal guideline | Verification: check official city sanitation portal for latest accepted materials",
      "SourceType: regulator reference | Verification: confirm recycling category guidance from EPA page",
    ],
    sourceLinks: ["https://www.epa.gov/recycle", "https://www.austintexas.gov"],
    minSourceLinks: 2,
    maxDuplicatedStructureCount: 3,
    duplicatedStructureCount: 0,
    reachableSourceLinksCount: 0,
    allowUnreachableSourceLinks: true,
    ...overrides,
  };
}

describe("quality source-link policy", () => {
  it("passes source-links minimum when unreachable links are allowed", () => {
    const report = evaluateQuality(
      buildQualityInput({
        reachableSourceLinksCount: 0,
        allowUnreachableSourceLinks: true,
      }),
    );

    expect(report.failureCodes).not.toContain("source-links-minimum");
  });

  it("fails source-links minimum when unreachable links are required", () => {
    const report = evaluateQuality(
      buildQualityInput({
        reachableSourceLinksCount: 0,
        allowUnreachableSourceLinks: false,
      }),
    );

    expect(report.failureCodes).toContain("source-links-minimum");
  });

  it("fails repeated-bigram only above the new threshold", () => {
    const noisyContent = [
      "## Overview",
      "recycling process ".repeat(40),
      "## How to Verify in Austin Today",
      "- step one",
      "- step two",
      "- step three",
      "## FAQ",
      "### Why verify?",
      "Because rules change.",
      "### What source should I use?",
      "Official sites.",
      "## Sources",
      "- https://www.epa.gov/recycle",
      "- https://www.austintexas.gov",
    ].join("\n\n");

    const report = evaluateQuality(
      buildQualityInput({
        content: noisyContent,
        allowUnreachableSourceLinks: true,
      }),
    );

    expect(report.failureCodes).toContain("repeated-bigrams");
  });
});

describe("deterministic fallback article", () => {
  it("builds a schema-valid fallback with required sections", () => {
    const article = buildDeterministicFallbackArticle(
      {
        city: "Austin",
        topic: "Electronics Recycling",
        keyword: "electronics recycling austin",
      },
      new Date().toISOString(),
      null,
    );

    expect(article.sourceLinks.length).toBeGreaterThanOrEqual(2);
    expect(article.content).toContain("## How to Verify in Austin Today");
    expect(article.content).toContain("## Sources");
    expect(article.description.length).toBeGreaterThanOrEqual(80);
    expect(article.description.length).toBeLessThanOrEqual(180);
  });
});
