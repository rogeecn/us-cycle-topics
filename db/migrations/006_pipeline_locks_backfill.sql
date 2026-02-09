CREATE TABLE IF NOT EXISTS pipeline_locks (
  lock_key INTEGER PRIMARY KEY,
  owner_token TEXT NOT NULL,
  acquired_at_epoch INTEGER NOT NULL,
  expires_at_epoch INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_locks_expires_at_epoch
  ON pipeline_locks (expires_at_epoch);
