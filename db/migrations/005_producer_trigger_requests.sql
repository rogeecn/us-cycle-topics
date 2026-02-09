CREATE TABLE IF NOT EXISTS producer_trigger_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'succeeded', 'failed')),
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_producer_trigger_requests_created_at
  ON producer_trigger_requests (created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_producer_trigger_requests_touch_updated_at
AFTER UPDATE ON producer_trigger_requests
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE producer_trigger_requests
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;
