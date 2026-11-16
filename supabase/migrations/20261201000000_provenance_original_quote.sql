-- Round 10 (owner): a translated page's evidence is kept twice — the page's own words and the English it was verified against.
ALTER TABLE field_provenance
  ADD COLUMN IF NOT EXISTS quote_original   text,
  ADD COLUMN IF NOT EXISTS quote_translated text;
COMMENT ON COLUMN field_provenance.quote_original   IS 'The quote word for word from the page, in the page''s language.';
COMMENT ON COLUMN field_provenance.quote_translated IS 'The English translation the value was verified against; null when the page was English.';
