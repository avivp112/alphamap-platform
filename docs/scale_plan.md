# Running enrichment at scale (batches of 50 → 100 → 250 → 500)

Status: a proposal for the owner's decision (2026-11-18). Nothing here is built yet except what is marked ✅.

## Stages and gates
| Stage | Companies | Opens when |
|---|---|---|
| batch 6 | 25 | done |
| batch 7 | 50 (`PILOT_MAX_COMPANIES=50`) | ✅ code ready |
| batch 8 | 100 | batch 7: acceptance 0 ERROR, sample precision ≥95%, written == dry report == database |
| batch 9 | 250 | same, and the sample of 50 has ≥95% on every stratum |
| batch 10 | 500 | same, and the Fly job below is in place |

A stage is opened by the owner by setting `PILOT_MAX_COMPANIES` (never above 500); the pilot gate refuses a larger set.

## What already protects a batch ✅
dry live run → acceptance + lint → stratified sample (`sample_50.csv`, five strata of ten) → owner marks → wet run from the dry recordings (`REPLAY=1`) with: commit check, acceptance before writing, value-level holds (`EXCLUDE`, `EXCLUDE_RULE`), written-vs-dry comparison, report-vs-database check, automatic undo.

## Pace ✅
`CONCURRENCY=10`; requests to one site start `DOMAIN_DELAY_MS` apart (default 1500 ms, reader calls count for the address' site); providers (Serper, Tavily, Jina, Anthropic) are limited to `PROVIDER_CONCURRENCY` calls in flight (default 20). Each company has a 10-minute limit (`COMPANY_TIMEOUT_MS`).

## For 500 companies: a one-shot job on Fly.io (not Cloud Shell)
Why: a 500-company live run is hours; Cloud Shell sessions end, and a laptop closing must not stop it.

1. **Job, not the always-on worker.** The existing `alphamap-check-worker` drains a queue. The batch is a Fly *machine run* of the same image (the Dockerfile already carries `lib/`, `scripts/`, `eval/`), started with `fly machine run --rm …`, that exits when the batch is done.
2. **State on a volume.** `cache/` (search cache, recordings for REPLAY, `known_sources.json`, `known_gaps.json`) lives on a Fly volume mounted at `/app/cache`, so the wet run replays the dry run's recordings. Two jobs never share a volume at once.
3. **Memory of verified sources → a table.** `cache/known_sources.json` is a file; with parallel jobs or a lost volume it is a single point of failure. Move it to a Supabase table before batch 10 (read at start, written at the end of each company).
4. **Phases as separate jobs:** `dry` (live; ends with acceptance, lint, `sample_*.csv`, summary) → *pause for the owner's marks* → `wet` (preflight REPLAY, write, verify, undo on any difference). The owner's marks and the EXCLUDE list are stored in a table (`batch_review`), not typed into a command.
5. **Notification at the end** of each phase: a row in the existing bell-notification table (as the check worker does) with the short summary (`batch_<N>_summary.md`) and the sample file attached through Supabase Storage.
6. **Limits and safety:** a cost ceiling (`MAX_COST_USD`, the job stops cleanly), a consecutive-error stop (exists: `MAX_CONSECUTIVE_ERRORS`), one batch at a time (a lock row in `enrichment_runs`), the image digest recorded in the run (replaces the git-commit check, since there is no git inside the image).
7. **Secrets** as Fly secrets (Supabase service key, Anthropic, Serper, Tavily, Jina), never in the image.

## Decisions needed from the owner
- Notification channel besides the bell (email? WhatsApp?).
- Cost ceiling per batch.
- Whether the marks stay a conversation (as now) or move to a review page in the app.
- Provider limits: Anthropic tier, Serper plan, Jina key tier — they set the real speed at 10 concurrent companies; the first 50-company run measures them.
