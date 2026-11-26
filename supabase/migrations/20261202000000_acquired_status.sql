-- A purchase is a field (owner, round 10): status acquired / majority_acquired, acquired_by, exit_date (the headline's date) and brand_after_acquisition — the name the company
-- trades under after the purchase. status, acquired_by and exit_date already exist (20260717000000); this adds the brand and lets status say "majority_acquired".
ALTER TABLE startups ADD COLUMN IF NOT EXISTS brand_after_acquisition text;
COMMENT ON COLUMN startups.brand_after_acquisition IS 'The name the company trades under after being acquired ("Tyro Health" for Medipass), as its own pages write it. Not a rename of the company.';

ALTER TABLE startups DROP CONSTRAINT IF EXISTS startups_status_check;
ALTER TABLE startups ADD CONSTRAINT startups_status_check CHECK (status IN ('active', 'acquired', 'majority_acquired', 'ipo', 'closed'));
COMMENT ON COLUMN startups.status IS 'active | acquired | majority_acquired | ipo | closed. Exit details in acquired_by / exit_date / exit_value / ticker.';
