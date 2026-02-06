export const CONTENT_STATUSES = [
  "draft",
  "generated",
  "rendered",
  "built",
  "published",
  "failed",
] as const;

export type ContentStatus = (typeof CONTENT_STATUSES)[number];

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
  renderedAt: Date | null;
  builtAt: Date | null;
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
}

export interface PipelineRunStats {
  renderedCount: number;
  buildCount: number;
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
}

export interface QualityReport {
  passed: boolean;
  checkedAt: string;
  failures: QualityRuleFailure[];
  metrics: {
    contentChars: number;
    descriptionChars: number;
    tagsCount: number;
  };
}

export interface ProducerRequest {
  topic: string;
  city: string;
  keyword: string;
  language?: string;
}
