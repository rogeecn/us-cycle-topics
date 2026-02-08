import {
  QualityInput,
  QualityReport,
  QualityRuleFailure,
  QualitySeverity,
} from "./types.js";

const FORBIDDEN_TERMS = ["赌博", "成人", "诈骗", "仇恨"];
const HARD_FAIL_RULES = new Set([
  "title-required",
  "description-required",
  "content-required",
  "content-min-length",
  "forbidden-term",
]);

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function uniqueCount(values: string[]): number {
  return new Set(values.map((value) => value.trim().toLowerCase())).size;
}

function countMatches(input: string, regex: RegExp): number {
  const matches = input.match(regex);
  return matches ? matches.length : 0;
}

function countRepeatedLines(content: string): number {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 24);

  const seen = new Map<string, number>();
  for (const line of lines) {
    seen.set(line, (seen.get(line) ?? 0) + 1);
  }

  let repeated = 0;
  for (const value of seen.values()) {
    if (value > 1) {
      repeated += value - 1;
    }
  }

  return repeated;
}

function countRepeatedBigrams(content: string): number {
  const tokens = content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);

  const counts = new Map<string, number>();
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }

  let repeated = 0;
  for (const value of counts.values()) {
    if (value > 3) {
      repeated += value - 3;
    }
  }

  return repeated;
}

function pushFailure(
  failures: QualityRuleFailure[],
  rule: string,
  message: string,
  weight: number,
): void {
  const severity: QualitySeverity = HARD_FAIL_RULES.has(rule) ? "hard" : "soft";
  failures.push({ rule, message, weight, severity });
}

export function evaluateQuality(input: QualityInput): QualityReport {
  const failures: QualityRuleFailure[] = [];

  const contentChars = input.content.trim().length;
  const descriptionChars = input.description.trim().length;
  const tagsCount = input.tags.length;
  const headingCount = countMatches(input.content, /^#{2,3}\s+/gm);
  const checklistItems = input.decisionChecklist.length;
  const faqQuestions = countMatches(input.content, /^#{3,4}\s+.*\?\s*$/gm);
  const repeatedLineCount = countRepeatedLines(input.content);
  const repeatedBigramCount = countRepeatedBigrams(input.content);

  const dimensions = {
    structure: {
      score: 0,
      max: 25,
      notes: [] as string[],
    },
    specificity: {
      score: 0,
      max: 25,
      notes: [] as string[],
    },
    antiRepetition: {
      score: 0,
      max: 25,
      notes: [] as string[],
    },
    safety: {
      score: 0,
      max: 25,
      notes: [] as string[],
    },
  };

  if (input.title.trim().length > 0) {
    dimensions.structure.score += 4;
  } else {
    pushFailure(failures, "title-required", "title is required", 4);
  }

  if (input.description.trim().length > 0) {
    dimensions.structure.score += 3;
  } else {
    pushFailure(failures, "description-required", "description is required", 3);
  }

  if (input.content.trim().length > 0) {
    dimensions.structure.score += 3;
  } else {
    pushFailure(failures, "content-required", "content is required", 3);
  }

  if (contentChars >= 800) {
    dimensions.structure.score += 5;
  } else {
    pushFailure(failures, "content-min-length", "content must be at least 800 characters", 5);
  }

  if (descriptionChars >= 80 && descriptionChars <= 180) {
    dimensions.structure.score += 3;
  } else {
    pushFailure(
      failures,
      "description-range",
      "description must be between 80 and 180 characters",
      3,
    );
  }

  if (tagsCount >= 3 && tagsCount <= 8) {
    dimensions.structure.score += 3;
  } else {
    pushFailure(failures, "tags-range", "tags must be between 3 and 8 items", 3);
  }

  if (headingCount >= 4) {
    dimensions.structure.score += 4;
  } else {
    pushFailure(
      failures,
      "heading-count",
      "content should contain at least 4 H2/H3 headings",
      4,
    );
  }

  if (input.audience.trim().length >= 10) {
    dimensions.specificity.score += 5;
  } else {
    pushFailure(failures, "audience-specificity", "audience field is too generic", 5);
  }

  if (input.intent.trim().length >= 10) {
    dimensions.specificity.score += 5;
  } else {
    pushFailure(failures, "intent-specificity", "intent field is too generic", 5);
  }

  if (input.keyTakeaways.length >= 3 && uniqueCount(input.keyTakeaways) === input.keyTakeaways.length) {
    dimensions.specificity.score += 5;
  } else {
    pushFailure(
      failures,
      "key-takeaways-quality",
      "keyTakeaways must have at least 3 unique entries",
      5,
    );
  }

  if (checklistItems >= 4 && uniqueCount(input.decisionChecklist) >= 4) {
    dimensions.specificity.score += 5;
  } else {
    pushFailure(
      failures,
      "decision-checklist-quality",
      "decisionChecklist must include at least 4 actionable unique items",
      5,
    );
  }

  if (input.commonMistakes.length >= 3 && uniqueCount(input.commonMistakes) >= 3) {
    dimensions.specificity.score += 5;
  } else {
    pushFailure(
      failures,
      "common-mistakes-quality",
      "commonMistakes must include at least 3 distinct mistakes",
      5,
    );
  }

  if (repeatedLineCount <= 1) {
    dimensions.antiRepetition.score += 10;
  } else {
    pushFailure(failures, "repeated-lines", "content contains repeated long lines", 10);
  }

  if (repeatedBigramCount <= 6) {
    dimensions.antiRepetition.score += 8;
  } else {
    pushFailure(
      failures,
      "repeated-bigrams",
      "content has excessive repeated bigrams",
      8,
    );
  }

  if (faqQuestions >= 2) {
    dimensions.antiRepetition.score += 4;
  } else {
    pushFailure(
      failures,
      "faq-presence",
      "FAQ section should contain at least 2 explicit questions",
      4,
    );
  }

  if (input.evidenceNotes.length >= 2 && uniqueCount(input.evidenceNotes) >= 2) {
    dimensions.antiRepetition.score += 3;
  } else {
    pushFailure(
      failures,
      "evidence-notes",
      "evidenceNotes should contain at least 2 useful notes",
      3,
    );
  }

  const lowerContent = input.content.toLowerCase();
  const lowerDescription = input.description.toLowerCase();
  let forbiddenHits = 0;
  for (const term of FORBIDDEN_TERMS) {
    const lowered = term.toLowerCase();
    if (lowerContent.includes(lowered) || lowerDescription.includes(lowered)) {
      forbiddenHits += 1;
      pushFailure(failures, "forbidden-term", `forbidden term detected: ${term}`, 25);
    }
  }

  if (forbiddenHits === 0) {
    dimensions.safety.score += 25;
  }

  dimensions.structure.score = round(Math.min(dimensions.structure.score, dimensions.structure.max));
  dimensions.specificity.score = round(
    Math.min(dimensions.specificity.score, dimensions.specificity.max),
  );
  dimensions.antiRepetition.score = round(
    Math.min(dimensions.antiRepetition.score, dimensions.antiRepetition.max),
  );
  dimensions.safety.score = round(Math.min(dimensions.safety.score, dimensions.safety.max));

  const scoreTotal = round(
    dimensions.structure.score +
      dimensions.specificity.score +
      dimensions.antiRepetition.score +
      dimensions.safety.score,
  );

  const hardFailureCount = failures.filter((item) => item.severity === "hard").length;
  const softFailureCount = failures.filter((item) => item.severity === "soft").length;

  return {
    passed: hardFailureCount === 0,
    checkedAt: new Date().toISOString(),
    scoreTotal,
    scoreMax: 100,
    hardFailureCount,
    softFailureCount,
    failureCodes: failures.map((failure) => failure.rule),
    failures,
    dimensions,
    metrics: {
      contentChars,
      descriptionChars,
      tagsCount,
      headingCount,
      checklistItems,
      faqQuestions,
      repeatedLineCount,
      repeatedBigramCount,
    },
  };
}
