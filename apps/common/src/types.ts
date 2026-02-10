export const CONTENT_STATUSES = ["generated", "published", "failed"] as const;

export type ContentStatus = (typeof CONTENT_STATUSES)[number];
export type QualitySeverity = "hard" | "soft";

export interface StoredContent {
  id: number;
  sourceKey: string;
  topic: string;
  city: string;
  keyword: string;
  title: string;
  description: string;
  slug: string;
  tags: string[];
  content: string;
  lastmod: Date;
  promptVersion: string;
  modelVersion: string;
  rawJson: unknown;
  qualityReport: QualityReport;
  contentHash: string;
  status: ContentStatus;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

export interface GeneratedContentInput {
  sourceKey: string;
  topic: string;
  city: string;
  keyword: string;
  title: string;
  description: string;
  slug: string;
  tags: string[];
  content: string;
  lastmod: Date;
  promptVersion: string;
  modelVersion: string;
  rawJson: unknown;
  qualityReport: QualityReport;
  contentHash: string;
  statusAfterQuality: "generated" | "failed";
  lastError?: string | null;
}

export interface PipelineRunStats {
  publishedCount: number;
  failedCount: number;
}

export interface PipelineRunRecord extends PipelineRunStats {
  runId: string;
  mode: RenderMode;
  status: "success" | "failed";
  errorMessage: string | null;
  startedAt: Date;
  endedAt: Date;
}

export type RenderMode = "incremental" | "full";

export interface RenderedResult {
  renderedIds: number[];
  writtenFiles: string[];
  skippedFiles: string[];
}

export interface QualityRuleFailure {
  rule: string;
  message: string;
  weight: number;
  severity: QualitySeverity;
}

export interface QualityDimensionScore {
  score: number;
  max: number;
  notes: string[];
}

export interface QualityReport {
  passed: boolean;
  checkedAt: string;
  scoreTotal: number;
  scoreMax: number;
  hardFailureCount: number;
  softFailureCount: number;
  failureCodes: string[];
  failures: QualityRuleFailure[];
  dimensions: {
    structure: QualityDimensionScore;
    specificity: QualityDimensionScore;
    antiRepetition: QualityDimensionScore;
    safety: QualityDimensionScore;
  };
  metrics: {
    contentChars: number;
    descriptionChars: number;
    tagsCount: number;
    headingCount: number;
    checklistItems: number;
    faqQuestions: number;
    repeatedLineCount: number;
    repeatedBigramCount: number;
  };
}

export interface QualityInput {
  title: string;
  description: string;
  tags: string[];
  content: string;
  audience: string;
  intent: string;
  keyTakeaways: string[];
  decisionChecklist: string[];
  commonMistakes: string[];
  evidenceNotes: string[];
}

export interface ReviewStats {
  total: number;
  generated: number;
  published: number;
  failed: number;
  averageScoreAll: number | null;
  averageScoreGenerated: number | null;
  averageScoreFailed: number | null;
}

export interface ProducerRequest {
  topic: string;
  city: string;
  keyword: string;
  language?: string;
}

export interface SidebarPost {
  slug: string;
  title: string;
  lastmod: Date;
}

export interface SidebarTermCount {
  name: string;
  count: number;
}

export interface SidebarData {
  recentPosts: SidebarPost[];
  categories: SidebarTermCount[];
  tags: SidebarTermCount[];
}
