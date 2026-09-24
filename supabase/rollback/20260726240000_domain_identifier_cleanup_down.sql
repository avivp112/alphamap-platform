-- Rollback for 20260726240000_domain_identifier_cleanup.sql
-- Drops cleanup_invalid_domain_identifiers(). Does NOT restore any rows the
-- function deleted (they were bare-public-suffix artifacts of a bug, not
-- legitimate data) and does NOT remove the re-backfilled domain identifiers
-- it added (they are correct under the current registrable_domain() and
-- removing them would just reintroduce the gap this migration closed).

DROP FUNCTION IF EXISTS cleanup_invalid_domain_identifiers(boolean);
