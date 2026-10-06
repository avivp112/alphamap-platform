-- Cleanup for the 50-company v2 run of 2026-10-06 (Gretel.ai .. GXBank).
-- Each statement removes one value that the rules added afterwards would
-- not have written. Run in the Supabase SQL editor; it is one transaction.
BEGIN;

-- People: an organisation, a glued sentence word, a typo duplicate, a nickname duplicate, a hired CEO.
UPDATE startups SET founders = (SELECT jsonb_agg(f) FROM jsonb_array_elements(founders) f WHERE f->>'name' <> 'Virgin Money')
  WHERE id = '6dee995b-595b-4b41-9ffe-74b1e531b9d9'; -- Griffin Bank
UPDATE startups SET founders = (SELECT jsonb_agg(f) FROM jsonb_array_elements(founders) f WHERE f->>'name' NOT LIKE 'Mark Spera.%')
  WHERE id = 'c333a2c9-c817-4c32-9105-e76750b4a498'; -- GrowthBar
UPDATE startups SET founders = (SELECT jsonb_agg(f) FROM jsonb_array_elements(founders) f WHERE f->>'name' <> 'Albert Sebago')
  WHERE id = 'f309d4ab-76e8-4a73-a440-dcf6e2e48415'; -- Guidepoint
UPDATE startups SET founders = (
    SELECT jsonb_agg(CASE WHEN f->>'name' = 'Mitchell Stewart' THEN f || '{"title": "Co-founder & CTO"}'::jsonb ELSE f END)
    FROM jsonb_array_elements(founders) f WHERE f->>'name' <> 'Mitch Stewart')
  WHERE id = '78909f73-d3f2-4549-a357-f6c2a524af68'; -- Guru
UPDATE startups SET founders = (SELECT jsonb_agg(f) FROM jsonb_array_elements(founders) f WHERE f->>'name' <> 'Ash Devata')
  WHERE id = 'c998861a-05ca-4ae4-95a5-996744bb3371'; -- GreyNoise (Ash Devata stays in leadership)

-- Location: a state and a canton are not cities.
UPDATE startups SET city = NULL, country = NULL WHERE id = 'fd3a5b49-cee8-4359-a3b0-998aa30eaa9f'; -- Grey Finance: "Delaware, United States" (incorporation)
UPDATE startups SET city = NULL WHERE id = '3a544066-74f1-47d4-a2e4-98ebe50a28d9'; -- GuestReady: "Canton Appenzell Ausserrhoden"

-- Funding.
UPDATE funding_rounds SET valuation = NULL, is_valuation_estimated = NULL
  WHERE startup_id = '0f1ed723-9d14-4eeb-9f8b-76c760b98948' AND round_type = 'Series B' AND valuation = 65500000; -- Gretel: total funding, not a valuation
UPDATE funding_rounds SET valuation = NULL, is_valuation_estimated = NULL
  WHERE startup_id = 'c333a2c9-c817-4c32-9105-e76750b4a498' AND valuation = 318000; -- GrowthBar: ARR, not a valuation
DELETE FROM funding_rounds
  WHERE startup_id = '6dee995b-595b-4b41-9ffe-74b1e531b9d9' AND round_type = 'Series A' AND amount_raised = 13500000
    AND announcement_date = '2024-03-11'; -- Griffin: duplicate of the Series A already on file
DELETE FROM funding_rounds
  WHERE startup_id = '8590726b-9264-4829-a1c0-cc23ae98eb84' AND source_url LIKE '%hnhiring.com%'; -- Grit: "Series A" from a multi-company job board
UPDATE funding_rounds SET announcement_date = NULL
  WHERE startup_id = '163c497b-e536-4eee-a9ca-facf06837e69' AND announcement_date = '2026-10-06'; -- Grofers: crawl date, not the 2017 round's date
DELETE FROM funding_rounds
  WHERE startup_id = '92d2a5ae-03b2-4477-9c8f-09a9cd10f867' AND source_url LIKE '%cbinsights.com/company/group-ib/financials%'
    AND round_type IN ('Series A', 'Series B', 'Acquired'); -- Group-IB: impossible A/B order; "acquired by Tech Data" (a distribution partner)
DELETE FROM funding_rounds
  WHERE startup_id = 'f309d4ab-76e8-4a73-a440-dcf6e2e48415' AND source_url LIKE '%guidepoint-security%'; -- Guidepoint: GuidePoint Security's round
DELETE FROM funding_rounds
  WHERE startup_id = '0b2cca07-f0ef-42a3-94a6-095a89341605' AND source_url LIKE '%tylertringas.com%'; -- Gumroad: a blog's valuation exercise, not a Series C

-- Patents: a page link and counts no source states.
UPDATE startups SET patents = NULL, patent_count = NULL WHERE id = '0f1ed723-9d14-4eeb-9f8b-76c760b98948'; -- Gretel: "Contact"
UPDATE startups SET patent_count = NULL, patent_fields = NULL WHERE id = '210428c1-d56c-430a-9585-9031942dca0a'; -- Gridline

-- Gridline: the telematics "Gridline" (gridline.com) is a namesake.
UPDATE startups SET
    acquisitions = (SELECT jsonb_agg(a) FROM jsonb_array_elements(acquisitions) a WHERE a->>'company_name' <> 'Shell Telematics'),
    news = (SELECT jsonb_agg(n) FROM jsonb_array_elements(news) n WHERE n->>'url' NOT ILIKE '%telematics%')
  WHERE id = '210428c1-d56c-430a-9585-9031942dca0a';

-- Sub-sector: a digital bank is not Digital Health.
DELETE FROM startup_sub_sectors
  WHERE sector_id = (SELECT id FROM sectors WHERE name = 'Digital Health')
    AND startup_id IN (SELECT id FROM startups WHERE name IN ('GXBank', 'GoTyme'));

-- Public companies the model did not flag: archive like the script does.
INSERT INTO field_changes (startup_id, field, old_value, new_value, source_url)
  SELECT id, 'status', status, 'ipo', NULL FROM startups
  WHERE id IN ('3dc5a00e-9c60-414d-9bf0-7fb7a1bf2738', '350ceeaf-d249-4416-8de1-2aca77411bfd', '37720cea-ee41-416c-8fc6-16d9fbd12f10');
UPDATE startups SET status = 'ipo'
  WHERE id IN ('3dc5a00e-9c60-414d-9bf0-7fb7a1bf2738', '350ceeaf-d249-4416-8de1-2aca77411bfd', '37720cea-ee41-416c-8fc6-16d9fbd12f10'); -- Guardant, Gritstone, Gubra

COMMIT;

REFRESH MATERIALIZED VIEW CONCURRENTLY startups_search;
