-- A wet run's headcount points carry the run that wrote them, so scripts/undo_run.ts can take them back (owner, batch 6: wet 1 left its points behind).
ALTER TABLE headcount_history ADD COLUMN IF NOT EXISTS run_id uuid;
CREATE INDEX IF NOT EXISTS idx_headcount_history_run ON headcount_history(run_id) WHERE run_id IS NOT NULL;
COMMENT ON COLUMN headcount_history.run_id IS 'enrichment_runs.run_id of the run that wrote the point (null: written before runs were recorded).';
