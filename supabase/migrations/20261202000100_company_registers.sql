-- What the company registers hold, as columns of their own (owner, round 10; docs/registries_plan.md). They never replace what the company's website says: the registered address is not the
-- headquarters, the incorporation date is not the founding year (a company can be re-incorporated), the jurisdiction is not the founding country. Each value has its field_provenance row.
ALTER TABLE startups ADD COLUMN IF NOT EXISTS legal_name                 text;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS registered_address         text;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS incorporation_date         text;   -- YYYY-MM-DD, or YYYY when the register gives only the year
ALTER TABLE startups ADD COLUMN IF NOT EXISTS incorporation_jurisdiction text;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS company_number             text;
COMMENT ON COLUMN startups.legal_name                 IS 'The legal entity''s name from a company register. Not `name`.';
COMMENT ON COLUMN startups.registered_address         IS 'The address the register holds. Not the headquarters (city / country).';
COMMENT ON COLUMN startups.incorporation_date         IS 'The earliest incorporation date among the register entries of the same company. Not founded_year.';
COMMENT ON COLUMN startups.incorporation_jurisdiction IS 'The register''s country (or state). Not founding_country or the headquarters country.';
COMMENT ON COLUMN startups.company_number             IS 'The register''s id of the company (Companies House number, Israeli company number, KRS, CNPJ, CIK).';
