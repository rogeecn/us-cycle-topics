CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seo_articles (
  id BIGSERIAL PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  city TEXT NOT NULL,
  keyword TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  content TEXT NOT NULL,
  lastmod TIMESTAMPTZ NOT NULL,
  prompt_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  raw_json JSONB NOT NULL,
  quality_report JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'generated', 'rendered', 'built', 'published', 'failed')),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rendered_at TIMESTAMPTZ,
  built_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_seo_articles_status_updated_at
  ON seo_articles (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_seo_articles_city_topic
  ON seo_articles (city, topic);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('incremental', 'full')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  rendered_count INTEGER NOT NULL DEFAULT 0,
  build_count INTEGER NOT NULL DEFAULT 0,
  published_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at
  ON pipeline_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS alert_logs (
  id BIGSERIAL PRIMARY KEY,
  alert_type TEXT NOT NULL,
  alert_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seo_articles_touch_updated_at ON seo_articles;
CREATE TRIGGER trg_seo_articles_touch_updated_at
BEFORE UPDATE ON seo_articles
FOR EACH ROW
EXECUTE FUNCTION touch_updated_at();
