import { getDb, withTransaction } from "./db.js";
import { getEnv } from "./env.js";
import {
  GeneratedContentInput,
  PipelineRunRecord,
  RenderMode,
  ReviewStats,
  SidebarData,
  SidebarPost,
  SidebarTermCount,
  StoredContent,
} from "./types.js";

interface ArticleRow {
  id: number;
  source_key: string;
  topic: string;
  city: string;
  keyword: string;
  title: string;
  description: string;
  slug: string;
  tags: string;
  content: string;
  lastmod: string;
  prompt_version: string;
  model_version: string;
  raw_json: string;
  quality_report: string;
  content_hash: string;
  status: StoredContent["status"];
  last_error: string | null;
  review_reason: string | null;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  rendered_at: string | null;
  built_at: string | null;
  published_at: string | null;
}

function parseJsonArray(raw: string): string[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.map((value) => String(value));
}

function mapRow(row: ArticleRow): StoredContent {
  return {
    id: Number(row.id),
    sourceKey: String(row.source_key),
    topic: String(row.topic),
    city: String(row.city),
    keyword: String(row.keyword),
    title: String(row.title),
    description: String(row.description),
    slug: String(row.slug),
    tags: parseJsonArray(row.tags),
    content: String(row.content),
    lastmod: new Date(row.lastmod),
    promptVersion: String(row.prompt_version),
    modelVersion: String(row.model_version),
    rawJson: JSON.parse(row.raw_json),
    qualityReport: JSON.parse(row.quality_report) as StoredContent["qualityReport"],
    contentHash: String(row.content_hash),
    status: row.status,
    lastError: row.last_error,
    reviewReason: row.review_reason,
    reviewNotes: row.review_notes,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    renderedAt: row.rendered_at ? new Date(row.rendered_at) : null,
    builtAt: row.built_at ? new Date(row.built_at) : null,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
  };
}

function placeholders(size: number): string {
  return Array.from({ length: size }, () => "?").join(",");
}

function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

const lockOwnership = new Map<number, string>();

export async function findByContentHash(
  contentHash: string,
): Promise<StoredContent | null> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT *
       FROM seo_articles
       WHERE content_hash = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(contentHash) as ArticleRow | undefined;

  if (!row) {
    return null;
  }

  return mapRow(row);
}

export async function upsertGeneratedContent(
  input: GeneratedContentInput,
): Promise<StoredContent> {
  const db = getDb();

  const query = `
    INSERT INTO seo_articles (
      source_key, topic, city, keyword, title, description, slug, tags, content,
      lastmod, prompt_version, model_version, raw_json, quality_report, content_hash,
      status, last_error, review_reason, review_notes, reviewed_by, reviewed_at,
      rendered_at, built_at, published_at
    ) VALUES (
      ?,?,?,?,?,?,?,?,?,
      ?,?,?,?,?,?,
      ?,?,?,?,?, ?,
      NULL,NULL,NULL
    )
    ON CONFLICT (source_key) DO UPDATE SET
      topic = EXCLUDED.topic,
      city = EXCLUDED.city,
      keyword = EXCLUDED.keyword,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      slug = EXCLUDED.slug,
      tags = EXCLUDED.tags,
      content = EXCLUDED.content,
      lastmod = EXCLUDED.lastmod,
      prompt_version = EXCLUDED.prompt_version,
      model_version = EXCLUDED.model_version,
      raw_json = EXCLUDED.raw_json,
      quality_report = EXCLUDED.quality_report,
      content_hash = EXCLUDED.content_hash,
      status = EXCLUDED.status,
      last_error = EXCLUDED.last_error,
      review_reason = EXCLUDED.review_reason,
      review_notes = EXCLUDED.review_notes,
      reviewed_by = EXCLUDED.reviewed_by,
      reviewed_at = EXCLUDED.reviewed_at,
      rendered_at = NULL,
      built_at = NULL,
      published_at = NULL,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;

  const values = [
    input.sourceKey,
    input.topic,
    input.city,
    input.keyword,
    input.title,
    input.description,
    input.slug,
    JSON.stringify(input.tags),
    input.content,
    input.lastmod.toISOString(),
    input.promptVersion,
    input.modelVersion,
    JSON.stringify(input.rawJson),
    JSON.stringify(input.qualityReport),
    input.contentHash,
    input.statusAfterQuality,
    input.lastError ?? null,
    input.reviewReason ?? null,
    null,
    null,
    null,
  ];

  const row = db.prepare(query).get(...values) as ArticleRow | undefined;
  if (!row) {
    throw new Error("upsertGeneratedContent returned no row");
  }

  return mapRow(row);
}

export async function listReadyForPublication(
  mode: RenderMode,
  minScore: number,
  batchSize: number,
): Promise<StoredContent[]> {
  const db = getDb();
  const whereClause =
    mode === "full"
      ? "status IN ('generated', 'rendered', 'built', 'published')"
      : "status = 'generated'";

  const rows = db
    .prepare(
      `SELECT *
       FROM seo_articles
       WHERE ${whereClause}
         AND json_extract(quality_report, '$.passed') = 1
         AND COALESCE(json_extract(quality_report, '$.scoreTotal'), 0) >= ?
       ORDER BY updated_at ASC, id ASC
       LIMIT ?`,
    )
    .all(minScore, batchSize) as ArticleRow[];

  return rows.map((row) => mapRow(row));
}

export async function markPublished(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const db = getDb();
  db
    .prepare(
      `UPDATE seo_articles
       SET status = 'published',
           published_at = CURRENT_TIMESTAMP,
           last_error = NULL
       WHERE id IN (${placeholders(ids.length)})`,
    )
    .run(...ids);
}

export async function markArticleFailed(
  id: number,
  errorMessage: string,
): Promise<void> {
  const db = getDb();
  db.prepare(
    `UPDATE seo_articles
     SET status = 'failed', last_error = ?
     WHERE id = ?`,
  ).run(errorMessage, id);
}

export async function countNeedsReview(): Promise<number> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM seo_articles
       WHERE status = 'needs_review'`,
    )
    .get() as { count: number };

  return Number(row.count);
}

export async function listNeedsReview(limit: number): Promise<StoredContent[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
       FROM seo_articles
       WHERE status = 'needs_review'
       ORDER BY updated_at ASC
       LIMIT ?`,
    )
    .all(limit) as ArticleRow[];

  return rows.map((row) => mapRow(row));
}

export async function listPublishedArticles(
  limit: number,
  offset: number = 0,
): Promise<StoredContent[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
       FROM seo_articles
       WHERE status = 'published'
       ORDER BY lastmod DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as ArticleRow[];

  return rows.map((row) => mapRow(row));
}

export async function listPublishedArticlesByCategory(
  category: string,
  limit: number,
  offset: number = 0,
): Promise<StoredContent[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
       FROM seo_articles
       WHERE status = 'published'
         AND city = ?
       ORDER BY lastmod DESC
       LIMIT ? OFFSET ?`,
    )
    .all(category, limit, offset) as ArticleRow[];

  return rows.map((row) => mapRow(row));
}

export async function listPublishedArticlesByTag(
  tag: string,
  limit: number,
  offset: number = 0,
): Promise<StoredContent[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
       FROM seo_articles AS a
       WHERE a.status = 'published'
         AND EXISTS (
           SELECT 1
           FROM json_each(a.tags) AS j
           WHERE j.value = ?
         )
       ORDER BY a.lastmod DESC
       LIMIT ? OFFSET ?`,
    )
    .all(tag, limit, offset) as ArticleRow[];

  return rows.map((row) => mapRow(row));
}

export async function getPublishedArticleBySlug(
  slug: string,
): Promise<StoredContent | null> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT *
       FROM seo_articles
       WHERE slug = ?
         AND status = 'published'
       LIMIT 1`,
    )
    .get(slug) as ArticleRow | undefined;

  if (!row) {
    return null;
  }

  return mapRow(row);
}

export async function getSidebarData(
  options?: {
    recentLimit?: number;
    termLimit?: number;
  },
): Promise<SidebarData> {
  const db = getDb();
  const recentLimit = options?.recentLimit ?? 8;
  const termLimit = options?.termLimit ?? 20;

  const recentRows = db
    .prepare(
      `SELECT slug, title, lastmod
       FROM seo_articles
       WHERE status = 'published'
       ORDER BY lastmod DESC
       LIMIT ?`,
    )
    .all(recentLimit) as Array<{ slug: string; title: string; lastmod: string }>;

  const categoryRows = db
    .prepare(
      `SELECT city AS name, COUNT(*) AS count
       FROM seo_articles
       WHERE status = 'published'
       GROUP BY city
       ORDER BY count DESC, city ASC
       LIMIT ?`,
    )
    .all(termLimit) as Array<{ name: string; count: number }>;

  const tagRows = db
    .prepare(
      `SELECT j.value AS name, COUNT(*) AS count
       FROM seo_articles AS a,
            json_each(a.tags) AS j
       WHERE a.status = 'published'
       GROUP BY j.value
       ORDER BY count DESC, j.value ASC
       LIMIT ?`,
    )
    .all(termLimit) as Array<{ name: string; count: number }>;

  const recentPosts: SidebarPost[] = recentRows.map((row) => ({
    slug: row.slug,
    title: row.title,
    lastmod: new Date(row.lastmod),
  }));

  const categories: SidebarTermCount[] = categoryRows.map((row) => ({
    name: row.name,
    count: Number(row.count),
  }));

  const tags: SidebarTermCount[] = tagRows.map((row) => ({
    name: row.name,
    count: Number(row.count),
  }));

  return {
    recentPosts,
    categories,
    tags,
  };
}

export async function getReviewStats(): Promise<ReviewStats> {
  const db = getDb();

  const statusRows = db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM seo_articles
       GROUP BY status`,
    )
    .all() as Array<{ status: string; count: number }>;

  const scoreRow = db
    .prepare(
      `SELECT
         AVG(json_extract(quality_report, '$.scoreTotal')) AS avg_all,
         AVG(CASE WHEN status = 'generated' THEN json_extract(quality_report, '$.scoreTotal') END) AS avg_generated,
         AVG(CASE WHEN status = 'needs_review' THEN json_extract(quality_report, '$.scoreTotal') END) AS avg_needs_review,
         AVG(CASE WHEN status = 'failed' THEN json_extract(quality_report, '$.scoreTotal') END) AS avg_failed
       FROM seo_articles`,
    )
    .get() as {
      avg_all: number | null;
      avg_generated: number | null;
      avg_needs_review: number | null;
      avg_failed: number | null;
    };

  const reviewedTodayRow = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM seo_articles
       WHERE reviewed_at >= date('now')`,
    )
    .get() as { count: number };

  const counts: Record<string, number> = {
    draft: 0,
    generated: 0,
    needs_review: 0,
    rendered: 0,
    built: 0,
    published: 0,
    failed: 0,
  };

  for (const row of statusRows) {
    counts[row.status] = Number(row.count);
  }

  const total = Object.values(counts).reduce((acc, value) => acc + value, 0);

  return {
    total,
    draft: counts.draft,
    generated: counts.generated,
    needsReview: counts.needs_review,
    rendered: counts.rendered,
    built: counts.built,
    published: counts.published,
    failed: counts.failed,
    averageScoreAll: scoreRow?.avg_all ?? null,
    averageScoreGenerated: scoreRow?.avg_generated ?? null,
    averageScoreNeedsReview: scoreRow?.avg_needs_review ?? null,
    averageScoreFailed: scoreRow?.avg_failed ?? null,
    reviewedToday: Number(reviewedTodayRow?.count ?? 0),
  };
}

export async function approveNeedsReview(
  id: number,
  reviewer: string,
  notes: string | null,
): Promise<boolean> {
  const db = getDb();
  const result = db.prepare(
    `UPDATE seo_articles
     SET status = 'generated',
         review_reason = 'approved_by_reviewer',
         review_notes = ?,
         reviewed_by = ?,
         reviewed_at = CURRENT_TIMESTAMP,
         last_error = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status = 'needs_review'`,
  ).run(notes, reviewer, id);

  return result.changes > 0;
}

export async function rejectNeedsReview(
  id: number,
  reviewer: string,
  notes: string | null,
): Promise<boolean> {
  const db = getDb();
  const result = db.prepare(
    `UPDATE seo_articles
     SET status = 'failed',
         review_reason = 'rejected_by_reviewer',
         review_notes = ?,
         reviewed_by = ?,
         reviewed_at = CURRENT_TIMESTAMP,
         last_error = 'manual review rejected',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status = 'needs_review'`,
  ).run(notes, reviewer, id);

  return result.changes > 0;
}

export async function acquirePipelineLock(
  _client: unknown,
  key: number,
): Promise<boolean> {
  return withTransaction((db) => {
    const now = new Date();
    const nowEpoch = epochSeconds(now);
    const ttl = getEnv().MAX_RENDER_LOCK_SECONDS;
    const expiresAt = nowEpoch + ttl;
    const ownerToken = `${process.pid}-${nowEpoch}-${Math.random().toString(36).slice(2, 10)}`;

    db
      .prepare("DELETE FROM pipeline_locks WHERE lock_key = ? AND expires_at_epoch < ?")
      .run(key, nowEpoch);

    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO pipeline_locks(lock_key, owner_token, acquired_at_epoch, expires_at_epoch)
         VALUES (?, ?, ?, ?)`,
      )
      .run(key, ownerToken, nowEpoch, expiresAt);

    if (inserted.changes > 0) {
      lockOwnership.set(key, ownerToken);
      return true;
    }

    return false;
  });
}

export async function releasePipelineLock(
  _client: unknown,
  key: number,
): Promise<void> {
  const db = getDb();
  const ownerToken = lockOwnership.get(key);

  if (!ownerToken) {
    return;
  }

  db
    .prepare("DELETE FROM pipeline_locks WHERE lock_key = ? AND owner_token = ?")
    .run(key, ownerToken);
  lockOwnership.delete(key);
}

export async function startPipelineRun(
  runId: string,
  mode: RenderMode,
): Promise<void> {
  const db = getDb();
  db.prepare(
    `INSERT INTO pipeline_runs (
      run_id, mode, status, started_at
    ) VALUES (?, ?, 'running', CURRENT_TIMESTAMP)`,
  ).run(runId, mode);
}

export async function finishPipelineRun(
  record: PipelineRunRecord,
): Promise<void> {
  const db = getDb();
  db.prepare(
    `UPDATE pipeline_runs
      SET status = ?,
          rendered_count = ?,
          build_count = ?,
          published_count = ?,
          publish_eligible_count = ?,
          blocked_by_quality = ?,
          needs_review_count = ?,
          failed_count = ?,
          error_message = ?,
          ended_at = ?
      WHERE run_id = ?`,
  ).run(
    record.status,
    0,
    0,
    record.publishedCount,
    0,
    0,
    record.needsReviewCount,
    record.failedCount,
    record.errorMessage,
    record.endedAt.toISOString(),
    record.runId,
  );
}

export async function listFailedSince(startedAt: Date): Promise<StoredContent[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
       FROM seo_articles
       WHERE status = 'failed' AND updated_at >= ?
       ORDER BY updated_at ASC`,
    )
    .all(startedAt.toISOString()) as ArticleRow[];

  return rows.map((row) => mapRow(row));
}

export async function hasAlertKey(alertKey: string): Promise<boolean> {
  const db = getDb();
  const row = db
    .prepare(`SELECT 1 FROM alert_logs WHERE alert_key = ?`)
    .get(alertKey) as Record<string, unknown> | undefined;

  return Boolean(row);
}

export async function appendAlertLog(
  alertType: string,
  alertKey: string,
  payload: unknown,
): Promise<void> {
  const db = getDb();
  db
    .prepare(
      `INSERT INTO alert_logs(alert_type, alert_key, payload)
       VALUES (?, ?, ?)
       ON CONFLICT (alert_key) DO NOTHING`,
    )
    .run(alertType, alertKey, JSON.stringify(payload));
}

