import { PoolClient } from "pg";
import { getPool, withTransaction } from "./db.js";
import {
  GeneratedContentInput,
  PipelineRunRecord,
  RenderMode,
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
      status, last_error, rendered_at, built_at, published_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,
      $10,$11,$12,$13::jsonb,$14::jsonb,$15,
      CASE WHEN ($14::jsonb->>'passed')::boolean THEN 'generated' ELSE 'failed' END,
      CASE WHEN ($14::jsonb->>'passed')::boolean THEN NULL ELSE 'quality validation failed' END,
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
      status = CASE
        WHEN (EXCLUDED.quality_report->>'passed')::boolean THEN 'generated'
        ELSE 'failed'
      END,
      last_error = CASE
        WHEN (EXCLUDED.quality_report->>'passed')::boolean THEN NULL
        ELSE 'quality validation failed'
      END,
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
    if (claimed.rowCount === 0) {
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
          published_count = $5,
          failed_count = $6,
          error_message = $7,
          ended_at = $8
      WHERE run_id = $1`,
    [
      record.runId,
      record.status,
      record.renderedCount,
      record.buildCount,
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
