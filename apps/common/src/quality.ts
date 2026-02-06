import { QualityReport, QualityRuleFailure } from "./types.js";

const FORBIDDEN_TERMS = ["赌博", "成人", "诈骗", "仇恨"];

export interface QualityInput {
  title: string;
  description: string;
  tags: string[];
  content: string;
}

export function evaluateQuality(input: QualityInput): QualityReport {
  const failures: QualityRuleFailure[] = [];
  const contentChars = input.content.trim().length;
  const descriptionChars = input.description.trim().length;
  const tagsCount = input.tags.length;

  if (!input.title.trim()) {
    failures.push({ rule: "title-required", message: "title is required" });
  }

  if (!input.description.trim()) {
    failures.push({
      rule: "description-required",
      message: "description is required",
    });
  }

  if (!input.content.trim()) {
    failures.push({ rule: "content-required", message: "content is required" });
  }

  if (contentChars < 800) {
    failures.push({
      rule: "content-min-length",
      message: "content must be at least 800 characters",
    });
  }

  if (descriptionChars < 80 || descriptionChars > 180) {
    failures.push({
      rule: "description-range",
      message: "description must be between 80 and 180 characters",
    });
  }

  if (tagsCount < 3 || tagsCount > 8) {
    failures.push({
      rule: "tags-range",
      message: "tags must be between 3 and 8 items",
    });
  }

  const lowerContent = input.content.toLowerCase();
  const lowerDescription = input.description.toLowerCase();
  for (const term of FORBIDDEN_TERMS) {
    const lowered = term.toLowerCase();
    if (lowerContent.includes(lowered) || lowerDescription.includes(lowered)) {
      failures.push({
        rule: "forbidden-term",
        message: `forbidden term detected: ${term}`,
      });
    }
  }

  return {
    passed: failures.length === 0,
    checkedAt: new Date().toISOString(),
    failures,
    metrics: {
      contentChars,
      descriptionChars,
      tagsCount,
    },
  };
}
