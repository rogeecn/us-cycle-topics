ALTER TABLE seo_articles
  DROP CONSTRAINT IF EXISTS seo_articles_status_check;

ALTER TABLE seo_articles
  ADD CONSTRAINT seo_articles_status_check
  CHECK (status IN ('draft', 'generated', 'needs_review', 'rendered', 'built', 'published', 'failed'));

ALTER TABLE seo_articles
  ADD COLUMN IF NOT EXISTS review_reason TEXT,
  ADD COLUMN IF NOT EXISTS review_notes TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_seo_articles_status_quality_score
  ON seo_articles (status, ((quality_report->>'scoreTotal')::numeric));
