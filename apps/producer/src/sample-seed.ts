import { upsertGeneratedContent } from "../../common/src/repository.js";
import { evaluateQuality } from "../../common/src/quality.js";
import { sha256 } from "../../common/src/hash.js";
import { logger } from "../../common/src/logger.js";

function parseCount(): number {
  const arg = process.argv.find((item) => item.startsWith("--count="));
  if (arg) {
    const value = Number(arg.split("=")[1]);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error("--count must be a positive integer");
    }
    return value;
  }

  const envValue = process.env.SMOKE_SEED_COUNT;
  if (!envValue) {
    return 3;
  }

  const parsed = Number(envValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("SMOKE_SEED_COUNT must be a positive integer");
  }

  return parsed;
}

function padded(index: number): string {
  return String(index).padStart(2, "0");
}

function buildContent(city: string, topic: string, keyword: string): string {
  return `## ${topic} Guide for ${city}

If you are comparing ${keyword}, this guide gives you a practical baseline for cost, timing, and execution.

### Market snapshot

Teams in ${city} usually care about response speed, predictable pricing, and transparent scope.
A usable decision starts with simple qualification criteria and clear communication milestones.

### What affects outcome

- Inventory and supplier variability
- Workload and seasonality
- Access windows and labor constraints
- Tooling maturity and rework risk

### Execution checklist

1. Confirm current constraints and required delivery date.
2. Capture baseline metrics and expected target range.
3. Select one conservative option and one aggressive option.
4. Decide with a fixed review checkpoint.

### FAQ

#### How often should this be reviewed?

At least monthly, and immediately after any operational shift.

#### What is the fastest path to reduce risk?

Start with a narrow scope pilot and expand after evidence is stable.

#### Is this only for large teams?

No. Small teams can run this with a lightweight weekly routine.

This article is intentionally practical and field-oriented for day-to-day execution.`;
}

async function main(): Promise<void> {
  const count = parseCount();

  for (let i = 1; i <= count; i += 1) {
    const token = padded(i);
    const city = `Houston-${token}`;
    const topic = `Scrap Forklift Parts ${token}`;
    const keyword = `forklift scrap value ${token}`;
    const title = `${topic} in ${city}: Cost and Practical Checklist`;
    const description = `A practical checklist for ${topic.toLowerCase()} in ${city}, including price factors, execution steps, and risk controls for reliable decisions.`;
    const slug = `smoke-${token}-forklift-scrap-${token}`;
    const tags = ["smoke-test", "recycling", "forklift", `batch-${token}`];
    const content = buildContent(city, topic, keyword);
    const qualityReport = evaluateQuality({
      title,
      description,
      tags,
      content,
      audience: "Small recycling operators evaluating practical process options",
      intent: "Understand practical price and execution factors before choosing a workflow",
      keyTakeaways: [
        "Compare at least two practical execution options",
        "Use a fixed checklist before final decision",
        "Track operational constraints before committing",
      ],
      decisionChecklist: [
        "Confirm delivery timeline and required constraints",
        "Compare two options with cost and risk side-by-side",
        "Validate required tooling and labor availability",
        "Set a review checkpoint after first execution cycle",
      ],
      commonMistakes: [
        "Choosing only on initial price and ignoring execution risk",
        "Skipping baseline metrics before process changes",
        "Not defining responsibility for follow-up review",
      ],
      evidenceNotes: [
        "Local process constraints often drive outcomes more than headline pricing",
        "Pilot-first execution reduces rework risk before scale-up",
      ],
    });

    const rawJson = {
      title,
      description,
      slug,
      tags,
      content,
      lastmod: new Date().toISOString(),
      seed: true,
    };

    const contentHash = sha256(`${title}\n${description}\n${content}`);

    const record = await upsertGeneratedContent({
      sourceKey: `smoke::${token}`,
      topic,
      city,
      keyword,
      title,
      description,
      slug,
      tags,
      content,
      lastmod: new Date(),
      promptVersion: "smoke-seed-v1",
      modelVersion: "seed/manual",
      rawJson,
      qualityReport,
      contentHash,
      statusAfterQuality: qualityReport.passed ? "generated" : "failed",
      lastError: qualityReport.passed ? null : "quality validation failed",
      reviewReason: qualityReport.passed ? null : "seed_quality_fail",
    });

    logger.info("seed record upserted", {
      id: record.id,
      slug: record.slug,
      status: record.status,
      qualityPassed: record.qualityReport.passed,
    });
  }

  logger.info("sample seed completed", { count });
}

main().catch((error) => {
  logger.error("sample seed failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
