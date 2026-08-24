-- Rollback for 20260824000000_social_links_news_score_history.sql

DROP TABLE IF EXISTS alphamap_score_history;

ALTER TABLE startups
  DROP COLUMN IF EXISTS linkedin_url,
  DROP COLUMN IF EXISTS facebook_url,
  DROP COLUMN IF EXISTS instagram_url,
  DROP COLUMN IF EXISTS news;
