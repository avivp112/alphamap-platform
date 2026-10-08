-- Cleanup for the 50-company v2 run of 2026-10-08 (Highland Electric Fleets .. Hubstaff).
-- Each statement removes or fixes one value that the rules added afterwards
-- (lib/enrichment/lessons_run3.test.ts) would not have written.
-- Run in the Supabase SQL editor; it is one transaction.
BEGIN;

-- People: a title or symbol glued to the name, another company's founders, an accelerator as a school.
UPDATE startups SET founders = (SELECT jsonb_agg(f) FROM jsonb_array_elements(founders) f WHERE f->>'name' <> 'CEO Adi Tatarko')
  WHERE id = 'f50fb111-3af1-46e8-a042-bd5a4c1947d6'; -- Houzz (Adi Tatarko is already listed)
UPDATE startups SET founders = (SELECT jsonb_agg(CASE WHEN f->>'name' = 'CEO Kevin Kilty' THEN f || '{"name": "Kevin Kilty"}'::jsonb ELSE f END) FROM jsonb_array_elements(founders) f)
  WHERE id = 'e4ebe25f-a486-4403-a400-817e464b3fc6'; -- Hubpay
UPDATE startups SET founders = (SELECT jsonb_agg(CASE WHEN f->>'name' LIKE '%Roland Ligtenberg' THEN f || '{"name": "Roland Ligtenberg"}'::jsonb ELSE f END) FROM jsonb_array_elements(founders) f)
  WHERE id = '572a8693-38a9-44fd-978b-97e923371049'; -- Housecall Pro
UPDATE startups SET founders = (SELECT jsonb_agg(f) FROM jsonb_array_elements(founders) f WHERE f->>'name' NOT IN ('Drew Houston', 'Arash Ferdowsi'))
  WHERE id = 'f2434dc6-a6d4-4ff7-8584-b654c3b1f2c2'; -- Honeycomb Credit: Dropbox's founders
UPDATE startups SET founders = (SELECT jsonb_agg(f) FROM jsonb_array_elements(founders) f WHERE f->>'name' <> 'Max Meyer')
  WHERE id = '17c52d1c-f318-48d7-a859-da145167026d'; -- Hokodo: not named as a founder by any Hokodo source
UPDATE startups SET founders = (SELECT jsonb_agg(CASE WHEN f->>'name' = 'Marc von Brockdorff' THEN f || '{"title": "Co-founder"}'::jsonb ELSE f END) FROM jsonb_array_elements(founders) f)
  WHERE id = '5a80e020-5a8d-4d9f-b5d1-efc91d2f8a2e'; -- Hotjar: "Founder of BellQR" is another company
UPDATE startups SET founders = (SELECT jsonb_agg(CASE WHEN f->>'name' = 'Richard Butland' THEN f || '{"title": "Founder"}'::jsonb ELSE f END) FROM jsonb_array_elements(founders) f)
  WHERE id = '8ae76253-46a3-42a3-8ac3-12ebeade6341'; -- Highview Power: "Founder Artu Capital"
UPDATE startups SET founders = (SELECT jsonb_agg(CASE WHEN f->>'name' = 'Nuno Pereira' THEN f || '{"bio": "Previously at Orange Collective."}'::jsonb ELSE f END) FROM jsonb_array_elements(founders) f)
  WHERE id = '00e46e28-3893-4bce-b9e9-9134839117ac'; -- Holy Grail: "Studied at Y Combinator"

-- Location: the country was in the city's own quote.
UPDATE startups SET country = 'United States' WHERE id = 'ceab7a7f-3427-4a40-bb86-bd2a9f339a8c' AND country IS NULL; -- Highland Electric Fleets: "Beverly, MA-based"
UPDATE startups SET country = 'Australia' WHERE id = 'd921512d-3d73-42ec-8dc6-1e3ca8d3b5ab' AND country IS NULL;     -- HR3: "Docklands, Victoria 3008, AU"

-- Hightower (hightoweradvisors.com): rounds, valuation, patents and tech came from gethightower.com, a namesake.
DELETE FROM funding_rounds
  WHERE startup_id = '4c36f46d-d0d9-48a7-acc1-06eb259a7d21' AND source_url LIKE '%startupintros.com/orgs/hightower%';
UPDATE startups SET valuation_benchmarks = NULL, patent_count = NULL, tech_stack = NULL
  WHERE id = '4c36f46d-d0d9-48a7-acc1-06eb259a7d21';

-- Funding.
DELETE FROM funding_rounds
  WHERE startup_id = 'bc214345-b804-46ed-b3f6-e1cbe783e7d8' AND source_url LIKE '%hirist.tech/j/%'; -- Hirist: another company's job ad
DELETE FROM funding_rounds
  WHERE startup_id = 'd59f49a6-6b3d-4339-bda4-1c65458c7ace' AND source_url LIKE '%bloomberglinea.com%'; -- Hitch Works: a LatAm "Hitch"
DELETE FROM funding_rounds
  WHERE startup_id = '6de71402-6d34-4a0c-9382-9ece1131f8d5' AND amount_raised IS NULL AND valuation IS NULL
    AND lead_investor IS NULL AND round_type IN ('Seed', 'Series F+'); -- HomeLane: a label with nothing behind it
DELETE FROM funding_rounds
  WHERE startup_id = 'd921512d-3d73-42ec-8dc6-1e3ca8d3b5ab' AND round_type = 'Other' AND amount_raised IS NULL; -- HR3
DELETE FROM funding_rounds
  WHERE startup_id = '592da8d0-3c9a-45ed-bb8b-db5181c37892' AND round_type = 'Pre-Seed' AND announcement_date = '2026-06-18'; -- HoneyBricks: a review's date and Form D total
DELETE FROM funding_rounds
  WHERE startup_id = '87fc7544-5046-4066-b784-57684a347bb6' AND round_type = 'Venture Debt' AND amount_raised IS NULL; -- HReasily: "worth $100 million" is not a round
DELETE FROM funding_rounds
  WHERE startup_id = '5a80e020-5a8d-4d9f-b5d1-efc91d2f8a2e'
    AND (source_url LIKE '%mycodelesswebsite.com%' OR source_url LIKE '%hub.stellantis.com%'); -- Hotjar: Contentsquare's $500M; an unreliable page

-- Hotjar: Contentsquare bought it in 2021, not on 2026-10-01; Hitch Works: Encube is not in any source about it.
UPDATE startups SET news = (SELECT jsonb_agg(CASE WHEN n->>'url' LIKE '%cxtoday.com/contentsquare-acquires-hotjar%' THEN n || '{"published_date": null}'::jsonb ELSE n END) FROM jsonb_array_elements(news) n)
  WHERE id = '5a80e020-5a8d-4d9f-b5d1-efc91d2f8a2e';
UPDATE startups SET acquisitions = (SELECT jsonb_agg(a) FROM jsonb_array_elements(acquisitions) a WHERE a->>'company_name' <> 'Encube')
  WHERE id = 'd59f49a6-6b3d-4339-bda4-1c65458c7ace';

COMMIT;

REFRESH MATERIALIZED VIEW CONCURRENTLY startups_search;
