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
