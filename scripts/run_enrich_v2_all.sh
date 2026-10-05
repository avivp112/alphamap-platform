#!/usr/bin/env bash
# Runs scripts/bulk_enrich_v2.ts over EVERY company, writing for real,
# with the full per-company output on screen AND saved to logs/.
#
#   ./scripts/run_enrich_v2_all.sh                 # all companies, real writes
#   DRY_RUN=true ./scripts/run_enrich_v2_all.sh    # same, nothing written
#   BATCH_SIZE=200 ./scripts/run_enrich_v2_all.sh  # stop after 200
#
# Stopping: Ctrl+C once finishes the company in progress (never leaves its
# writes half-done), prints the run summary and exits. Ctrl+C twice exits
# immediately. Running it again continues with the companies not yet
# processed — the queue is ordered by last_enriched_at, never-enriched first.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p logs
LOG="logs/enrich_v2_$(date +%Y%m%d_%H%M%S).log"

export DRY_RUN="${DRY_RUN:-false}"
export VERBOSE="${VERBOSE:-true}"
export BATCH_SIZE="${BATCH_SIZE:-9999}"
export DELAY_MS="${DELAY_MS:-20000}"
export REFRESH_EVERY="${REFRESH_EVERY:-25}"

echo "▶ Enrichment v2 over all companies — DRY_RUN=$DRY_RUN VERBOSE=$VERBOSE BATCH_SIZE=$BATCH_SIZE DELAY_MS=$DELAY_MS"
echo "▶ Full log: $LOG"
echo "▶ Ctrl+C once = finish the current company and stop; twice = stop now."
echo

# tsx directly (not npx) so Ctrl+C reaches the script exactly once; tee -i
# keeps logging while the script finishes its current company.
./node_modules/.bin/tsx scripts/bulk_enrich_v2.ts 2>&1 | tee -i "$LOG"
