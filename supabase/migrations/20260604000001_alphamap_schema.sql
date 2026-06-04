-- AlphaMap Score: schema additions for scoring pillars
-- Pillar B & C inputs on startups; macro multiples reference table

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS is_serial_founder       boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_follow_on_investors boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS investor_tier_score     numeric(5,2),   -- 0-100; null = unknown
  ADD COLUMN IF NOT EXISTS sector_id               text,            -- matches macro_sector_multiples.sector_id
  ADD COLUMN IF NOT EXISTS previous_employee_count integer;        -- YoY headcount snapshot

-- Macro sector revenue/valuation multiples for market adjustment
CREATE TABLE IF NOT EXISTS macro_sector_multiples (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sector_id           text        NOT NULL,
  sector_name         text,
  current_multiple    numeric(10,4) NOT NULL DEFAULT 1.0,
  historical_multiple numeric(10,4) NOT NULL DEFAULT 1.0,
  effective_date      date        NOT NULL DEFAULT CURRENT_DATE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_macro_sector_date UNIQUE (sector_id, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_macro_sector_lookup
  ON macro_sector_multiples (sector_id, effective_date DESC);

-- Seed with representative EV/Revenue multiples (current vs. 3yr historical avg)
-- current_multiple  = today's median EV/NTM-Revenue for that sector
-- historical_multiple = 3-year average used as the baseline denominator
INSERT INTO macro_sector_multiples
  (sector_id, sector_name, current_multiple, historical_multiple, effective_date)
VALUES
  ('ai-ml',            'AI & ML',                12.5,  8.0,  CURRENT_DATE),
  ('fintech',          'Fintech',                 8.0,  9.5,  CURRENT_DATE),
  ('cybersecurity',    'Cybersecurity',           10.5,  7.5,  CURRENT_DATE),
  ('saas-devtools',    'SaaS & Dev Tools',         9.0,  8.5,  CURRENT_DATE),
  ('ecommerce-retail', 'E-commerce & Retail',      6.5,  7.0,  CURRENT_DATE),
  ('health-lifesci',   'Health & Life Sciences',  11.0,  9.0,  CURRENT_DATE),
  ('climate-energy',   'Climate & Energy',        13.0,  7.5,  CURRENT_DATE),
  ('enterprise-sw',    'Enterprise Software',      8.5,  8.0,  CURRENT_DATE),
  ('consumer-media',   'Consumer & Media',         5.5,  6.5,  CURRENT_DATE),
  ('deeptech',         'DeepTech',                15.0, 10.0,  CURRENT_DATE)
ON CONFLICT (sector_id, effective_date) DO NOTHING;
