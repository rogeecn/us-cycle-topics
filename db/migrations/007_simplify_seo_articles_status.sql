DROP TRIGGER IF EXISTS trg_seo_articles_touch_updated_at;

DROP INDEX IF EXISTS idx_seo_articles_status_updated_at;
DROP INDEX IF EXISTS idx_seo_articles_city_topic;
DROP INDEX IF EXISTS idx_seo_articles_content_hash;
DROP INDEX IF EXISTS idx_seo_articles_slug;

CREATE TABLE seo_articles_new (
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
  status TEXT NOT NULL CHECK (status IN ('generated', 'published', 'failed')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);

INSERT INTO seo_articles_new (
  id,
  source_key,
  topic,
  city,
  keyword,
  title,
  description,
  slug,
  tags,
  content,
  lastmod,
  prompt_version,
  model_version,
  raw_json,
  quality_report,
  content_hash,
  status,
  last_error,
  created_at,
  updated_at,
  published_at
)
SELECT
  id,
  source_key,
  topic,
  city,
  keyword,
  title,
  description,
  slug,
  tags,
  content,
  lastmod,
  prompt_version,
  model_version,
  raw_json,
  quality_report,
  content_hash,
  CASE
    WHEN status = 'published' THEN 'published'
    WHEN status IN ('generated', 'rendered', 'built') THEN 'generated'
    ELSE 'failed'
  END AS status,
  CASE
    WHEN status IN ('draft', 'needs_review')
      AND (last_error IS NULL OR TRIM(last_error) = '')
      THEN 'status migrated from ' || status
    ELSE last_error
  END AS last_error,
  created_at,
  updated_at,
  CASE
    WHEN status = 'published' THEN COALESCE(published_at, updated_at, created_at)
    ELSE NULL
  END AS published_at
FROM seo_articles;

DROP TABLE seo_articles;
ALTER TABLE seo_articles_new RENAME TO seo_articles;

CREATE INDEX IF NOT EXISTS idx_seo_articles_status_updated_at
  ON seo_articles (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_seo_articles_city_topic
  ON seo_articles (city, topic);

CREATE INDEX IF NOT EXISTS idx_seo_articles_content_hash
  ON seo_articles (content_hash);

CREATE INDEX IF NOT EXISTS idx_seo_articles_slug
  ON seo_articles (slug);

CREATE TRIGGER IF NOT EXISTS trg_seo_articles_touch_updated_at
AFTER UPDATE ON seo_articles
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE seo_articles
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;
