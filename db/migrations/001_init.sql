CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS seo_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  city TEXT NOT NULL,
  keyword TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tags TEXT NOT NULL DEFAULT '[]',
  content TEXT NOT NULL,
  lastmod TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  quality_report TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'generated', 'needs_review', 'rendered', 'built', 'published', 'failed')),
  last_error TEXT,
  review_reason TEXT,
  review_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rendered_at TEXT,
  built_at TEXT,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_seo_articles_status_updated_at
  ON seo_articles (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_seo_articles_city_topic
  ON seo_articles (city, topic);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('incremental', 'full')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  rendered_count INTEGER NOT NULL DEFAULT 0,
  build_count INTEGER NOT NULL DEFAULT 0,
  publish_eligible_count INTEGER NOT NULL DEFAULT 0,
  blocked_by_quality INTEGER NOT NULL DEFAULT 0,
  needs_review_count INTEGER NOT NULL DEFAULT 0,
  published_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at
  ON pipeline_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS alert_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_type TEXT NOT NULL,
  alert_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pipeline_locks (
  lock_key INTEGER PRIMARY KEY,
  owner_token TEXT NOT NULL,
  acquired_at_epoch INTEGER NOT NULL,
  expires_at_epoch INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_locks_expires_at_epoch
  ON pipeline_locks (expires_at_epoch);

CREATE TRIGGER IF NOT EXISTS trg_seo_articles_touch_updated_at
AFTER UPDATE ON seo_articles
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE seo_articles
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;
