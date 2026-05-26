-- =============================================================================
-- Migration: add_founders_to_startups
-- Created:   2026-05-26
-- Description: Adds a founders text[] column to store the full names of all
--              company founders. Uses a native PostgreSQL array so each name
--              is a discrete element, enabling future indexing and querying.
-- =============================================================================

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS founders text[];

COMMENT ON COLUMN startups.founders
  IS 'Full names of all company founders, e.g. ARRAY[''Patrick Collison'', ''John Collison'']';
