-- Rollback of 20261015040000_remove_gate_rejected_companies.sql: restores the
-- deleted startups rows from deleted_startups_archive. Rows that cascaded with
-- them (funding rounds, headcount, provenance, identifiers) are NOT restored,
-- and raw filings stay unlinked — re-link them with the resolvers if needed.

INSERT INTO startups
SELECT (jsonb_populate_record(NULL::startups, a.row_data)).*
  FROM deleted_startups_archive a
 WHERE a.reason LIKE '%migration 20261015040000%'
   AND NOT EXISTS (SELECT 1 FROM startups s WHERE s.id = a.id);

DELETE FROM deleted_startups_archive WHERE reason LIKE '%migration 20261015040000%';

SELECT refresh_startups_search();
