import { PoolClient } from "pg";
import { getPool, withTransaction } from "./db.js";
import {
  GeneratedContentInput,
  PipelineRunRecord,
  RenderMode,
  ReviewStats,
  StoredContent,
} from "./types.js";

function mapRow(row: Record<string, unknown>): StoredContent {
  return {
    id: Number(row.id),
    sourceKey: String(row.source_key),
    topic: String(row.topic),
    city: String(row.city),
    keyword: String(row.keyword),
    title: String(row.title),
    description: String(row.description),
    slug: String(row.slug),
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    content: String(row.content),
    lastmod: new Date(String(row.lastmod)),
    promptVersion: String(row.prompt_version),
    modelVersion: String(row.model_version),
    rawJson: row.raw_json,
    qualityReport: row.quality_report as StoredContent["qualityReport"],
    contentHash: String(row.content_hash),
    status: row.status as StoredContent["status"],
    lastError: row.last_error ? String(row.last_error) : null,
    reviewReason: row.review_reason ? String(row.review_reason) : null,
    reviewNotes: row.review_notes ? String(row.review_notes) : null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at ? new Date(String(row.reviewed_at)) : null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
    renderedAt: row.rendered_at ? new Date(String(row.rendered_at)) : null,
    builtAt: row.built_at ? new Date(String(row.built_at)) : null,
    publishedAt: row.published_at ? new Date(String(row.published_at)) : null,
  };
}

export async function upsertGeneratedContent(
  input: GeneratedContentInput,
): Promise<StoredContent> {
  const pool = getPool();

  const query = `
    INSERT INTO seo_articles (
      source_key, topic, city, keyword, title, description, slug, tags, content,
      lastmod, prompt_version, model_version, raw_json, quality_report, content_hash,
      status, last_error, review_reason, review_notes, reviewed_by, reviewed_at,
      rendered_at, built_at, published_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,
      $10,$11,$12,$13::jsonb,$14::jsonb,$15,
      $16,$17,$18,$19,$20,$21,
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
      updated_at = NOW()
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

  const result = await pool.query(query, values);
  return mapRow(result.rows[0]);
}

export async function claimArticlesForRender(
  mode: RenderMode,
  batchSize: number,
): Promise<StoredContent[]> {
  return withTransaction(async (client) => {
    const whereClause =
      mode === "full"
        ? "status IN ('generated','rendered','built','published')"
        : "status = 'generated'";

    const query = `
      SELECT *
      FROM seo_articles
      WHERE ${whereClause}
      ORDER BY updated_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    `;

    const claimed = await client.query(query, [batchSize]);
    if ((claimed.rowCount ?? 0) === 0) {
      return [];
    }

    const ids = claimed.rows.map((row) => Number(row.id));
    await client.query(
      `UPDATE seo_articles
       SET status = 'rendered', rendered_at = NOW(), last_error = NULL
       WHERE id = ANY($1::bigint[])`,
      [ids],
    );

    return claimed.rows.map((row) => mapRow(row));
  });
}

export async function markBuildSuccess(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const pool = getPool();
  await pool.query(
    `UPDATE seo_articles
     SET status = 'built', built_at = NOW(), last_error = NULL
     WHERE id = ANY($1::bigint[])`,
    [ids],
  );
}

export async function listPublishEligibleBuiltIds(
  minScore: number,
  candidateIds: number[],
): Promise<number[]> {
  if (candidateIds.length === 0) {
    return [];
  }

  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM seo_articles
     WHERE id = ANY($2::bigint[])
       AND status = 'built'
       AND (quality_report->>'passed')::boolean = TRUE
       AND COALESCE((quality_report->>'scoreTotal')::numeric, 0) >= $1
     ORDER BY updated_at ASC, id ASC`,
    [minScore, candidateIds],
  );

  return result.rows.map((row) => Number(row.id));
}

export async function markPublished(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const pool = getPool();
  await pool.query(
    `UPDATE seo_articles
     SET status = 'published', published_at = NOW(), last_error = NULL
     WHERE id = ANY($1::bigint[])`,
    [ids],
  );
}

export async function markArticleFailed(
  id: number,
  errorMessage: string,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE seo_articles
     SET status = 'failed', last_error = $2
     WHERE id = $1`,
    [id, errorMessage],
  );
}

export async function countNeedsReview(): Promise<number> {
  const pool = getPool();
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM seo_articles
     WHERE status = 'needs_review'`,
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function listNeedsReview(limit: number): Promise<StoredContent[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT *
     FROM seo_articles
     WHERE status = 'needs_review'
     ORDER BY updated_at ASC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => mapRow(row));
}

export async function getReviewStats(): Promise<ReviewStats> {
  const pool = getPool();

  const statusResult = await pool.query<{
    status: string;
    count: string;
  }>(
    `SELECT status, COUNT(*)::text AS count
     FROM seo_articles
     GROUP BY status`,
  );

  const scoreResult = await pool.query<{
    avg_all: string | null;
    avg_generated: string | null;
    avg_needs_review: string | null;
    avg_failed: string | null;
  }>(
    `SELECT
       AVG((quality_report->>'scoreTotal')::numeric)::text AS avg_all,
       AVG(CASE WHEN status = 'generated' THEN (quality_report->>'scoreTotal')::numeric END)::text AS avg_generated,
       AVG(CASE WHEN status = 'needs_review' THEN (quality_report->>'scoreTotal')::numeric END)::text AS avg_needs_review,
       AVG(CASE WHEN status = 'failed' THEN (quality_report->>'scoreTotal')::numeric END)::text AS avg_failed
     FROM seo_articles`,
  );

  const reviewedTodayResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM seo_articles
     WHERE reviewed_at >= DATE_TRUNC('day', NOW())`,
  );

  const counts: Record<string, number> = {
    draft: 0,
    generated: 0,
    needs_review: 0,
    rendered: 0,
    built: 0,
    published: 0,
    failed: 0,
  };

  for (const row of statusResult.rows) {
    counts[row.status] = Number(row.count);
  }

  const scoreRow = scoreResult.rows[0];
  const toNumber = (value: string | null): number | null => (value ? Number(value) : null);

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
    averageScoreAll: toNumber(scoreRow?.avg_all ?? null),
    averageScoreGenerated: toNumber(scoreRow?.avg_generated ?? null),
    averageScoreNeedsReview: toNumber(scoreRow?.avg_needs_review ?? null),
    averageScoreFailed: toNumber(scoreRow?.avg_failed ?? null),
    reviewedToday: Number(reviewedTodayResult.rows[0]?.count ?? 0),
  };
}

export async function approveNeedsReview(
  id: number,
  reviewer: string,
  notes: string | null,
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE seo_articles
     SET status = 'generated',
         review_reason = 'approved_by_reviewer',
         review_notes = $3,
         reviewed_by = $2,
         reviewed_at = NOW(),
         last_error = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'needs_review'`,
    [id, reviewer, notes],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function rejectNeedsReview(
  id: number,
  reviewer: string,
  notes: string | null,
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE seo_articles
     SET status = 'failed',
         review_reason = 'rejected_by_reviewer',
         review_notes = $3,
         reviewed_by = $2,
         reviewed_at = NOW(),
         last_error = 'manual review rejected',
         updated_at = NOW()
     WHERE id = $1
       AND status = 'needs_review'`,
    [id, reviewer, notes],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function acquirePipelineLock(
  client: PoolClient,
  key: number,
): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1) AS locked",
    [key],
  );
  return Boolean(result.rows[0]?.locked);
}

export async function releasePipelineLock(
  client: PoolClient,
  key: number,
): Promise<void> {
  await client.query("SELECT pg_advisory_unlock($1)", [key]);
}

export async function startPipelineRun(
  runId: string,
  mode: RenderMode,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO pipeline_runs (
      run_id, mode, status, started_at
    ) VALUES ($1, $2, 'running', NOW())`,
    [runId, mode],
  );
}

export async function finishPipelineRun(
  record: PipelineRunRecord,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE pipeline_runs
      SET status = $2,
          rendered_count = $3,
          build_count = $4,
          publish_eligible_count = $5,
          blocked_by_quality = $6,
          needs_review_count = $7,
          published_count = $8,
          failed_count = $9,
          error_message = $10,
          ended_at = $11
      WHERE run_id = $1`,
    [
      record.runId,
      record.status,
      record.renderedCount,
      record.buildCount,
      record.publishEligibleCount,
      record.blockedByQuality,
      record.needsReviewCount,
      record.publishedCount,
      record.failedCount,
      record.errorMessage,
      record.endedAt.toISOString(),
    ],
  );
}

export async function listFailedSince(startedAt: Date): Promise<StoredContent[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT *
     FROM seo_articles
     WHERE status = 'failed' AND updated_at >= $1
     ORDER BY updated_at ASC`,
    [startedAt.toISOString()],
  );
  return result.rows.map((row) => mapRow(row));
}

export async function hasAlertKey(alertKey: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT 1 FROM alert_logs WHERE alert_key = $1`,
    [alertKey],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function appendAlertLog(
  alertType: string,
  alertKey: string,
  payload: unknown,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO alert_logs(alert_type, alert_key, payload)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (alert_key) DO NOTHING`,
    [alertType, alertKey, JSON.stringify(payload)],
  );
}
