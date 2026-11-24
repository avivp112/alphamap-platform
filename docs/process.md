# The batch process (owner's change of method, 2026-11-20)

Goal: progress at a pace that finishes the database, with no wrong figure reaching a customer. This replaces the process of 2026-11-19 (sample of 50 *before* the write, tracker of 20 marks and 90%, held fields per sample).

## 1. Two kinds of fields — `lib/enrichment/tiers.ts`
**Core fields**, written to `startups` / `field_provenance` as before:
- Tier 1 (accuracy 98% and above): `round` (amount, type, date, lead), `acquired` (acquired / majority_acquired / closed). Public-company status and domain identification are decided before the fields.
- Tier 2 (95% and above): `description`, `sector`, `hq_city`, `hq_country`, `founded_year`, `founder` (name and role), the registers (`legal_name`, `company_number`, `incorporation_date`, `incorporation_jurisdiction`, `registered_address`).

**Candidate fields (Tier 3)**: `tags`, `news`, `competitor_declared`, `competitor_market`, `employee_count`, `employee_range`, `headcount_history`, `leader` (not a founder), `founder_background`, `office`, `name_proposal`.
Written only to `candidate_values` with full provenance (`scripts/write_candidates.ts`); never to `startups`, never shown. Not in the regression gate, the blocking acceptance checks or the audit. Their logic stays as it is.
A field in neither list (`founding_country`, `board`, `patent`) is not written.

## 2. One hold mechanism
The old tracker (`field_review_tracker`, 20 marks and 90%) no longer opens or closes anything. What remains: `held_fields.csv` and `pending_fixes.csv`, for core fields only.

## 3. A batch: up to 500 companies, written automatically — `scripts/run_batch.ts`
regression gate (core fields only) → one live run → acceptance → write if everything passed → `verify_written` → Tier 3 values to `candidate_values` → the audit sample.
- No manual stop before the write. A gate loss or an acceptance ERROR stops the batch *before* the write and is shown to Aviv; `accept-lost` is his decision alone.
- `MAX_COST` is required; the plan prints a cost estimate first (`BATCH_NO=N npx tsx scripts/run_batch.ts`, then `MAX_COST=… GO=1`).
- Infrastructure failure (rate limit, timeout): `retry_failed.ts` once, for the companies that failed — never the whole batch.
- Recordings carry the date of their day: a replay on another day runs with `PIN_DATE=<the live run's date>` and `NODE_OPTIONS="--require scripts/pin_date.cjs"` (the script does it).

### Cost and cap (owner, 2026-11-21)
- At `MAX_COST` no new company is started, the running ones finish, the reports are written, and `run_batch` goes on with what was collected; `unprocessed_batch_<N>.json` lists the rest.
- A founder name that is not a person's name (`founder_name_is_person`, run by `run_batch` only; one name is a person) does not stop the batch: it is excluded by its content (`pending_fixes.csv`) and the rest is written.
- Cost reduction (fewer pages, no Tier 3 searches / extraction, deep dive for gaps only) was tried and reverted: the gate lost Tier 1 values (batches 5–8 recordings no longer match). It comes back only in a maintenance window, after a `REPLAY_FILL` run that completes the recordings of batches 5–8 and then the comparison in the gate; the news search stays on (round types and acquired come from it).

## 4. The audit after the write — `scripts/audit_sample.ts`, `scripts/audit_apply.ts`
50 values of the core fields: 25 completely random (the real accuracy) and 25 aimed at hard cases (rule-made values, rounds with an unknown type, press-only headquarters…; at most two per company).
- A wrong value is taken out of the database (recorded in `field_changes`, `undo_run.ts` puts it back) and written to `pending_fixes.csv`. The batch does not stop.
- A field with errors in more than 5 companies of the targeted sample, or whose cumulative random accuracy (at least 20 values) is under its tier's bar, is undone for the run and held until the maintenance window.
- The random sample accumulates in `eval/field_audit.json` (per field: audited, wrong).

## 5. Exposure in the pilot — `scripts/field_status.ts`, table `field_status`
A field is visible in the pilot only after at least 150 random audited values with accuracy above its tier's bar. Until then the data is in the database and not shown. (The table and the script are in place; the application reads the table as the screens are connected to it.)

## 6. New rules
Only in a maintenance window, about every 2,000 companies (every 4 batches), and only with Aviv's approval. A rule is aimed at a stated condition ("no founding year from a sentence that mentions an acquisition"), never a global tightening of a field. Acceptance: a REPLAY of all earlier batches — zero lost values in Tier 1; in Tier 2 every lost value is shown to Aviv and the rule enters only with his approval. Between windows findings go to `backlog.md` only.

## The write reads what the live run kept (stage 3, 2026-11-23)
- The live run saves what it collected for every company (`collected/batch_<N>/<company_id>.json`, lib/enrichment/collectedStore.ts; a file that does not come back identical is not saved). The write step (`bulk_enrich_v2.ts` with `FROM_COLLECTED`) loads it and calls `writeCollected` unchanged: no model call, no search, no replay of recordings. Pages the write still reads (the memory of verified sources, a news page's headline and image) come from the recordings (`REPLAY=strict`); a page not recorded means that value is not confirmed and is not written.
- A company with no saved file, or whose rounds in the database changed since the live run, is not written: it is listed as not enriched (`collected_missing` / `collected_stale`).
- Before the write: `scripts/backup_batch.ts` exports the batch's rows of startups, funding_rounds and field_provenance (`backups/batch_<N>_<time>/`); a backup that is not whole stops the batch.
- `FROM_STEP=5` (gate, backup, write, verify, candidates, audit sample) is how a batch is written again from its own `collected/` directory. Batches written before this change (1–9) have no `collected/` directory.
- Grouped writes (one upsert per table, also in verify and undo) are a separate change for the maintenance window, tested in the gate.

## The maintenance window of 2026-11-23 (stage 5)
Tier 3 collectors off (components `competitors`, `competitor_tiers`, `market_compare`, `founder_background`, `epo_patents`, `headcount_archive`): the market call asks for acquisitions, news and technology only; news and acquisition searches, rounds, leadership stay. The deep dive runs only for a missing core field. At most 12 site pages (home, about, team, leadership, contact, news/press, impressum, one legal page), 3,000 characters each with the bottom kept for legal name, company number and address; a dead or unidentified domain is checked on two candidate sites, home and about only. No date in any prompt. The memory carries only founder, founded_year, legal_name, company_number (and values the owner locked). 5 minutes per company attempt, one more try, concurrency 15, one rate-limit pause for every company. Row rules: a grant, contract or award and a plan to raise are not a round; a founder needs a quote that names the person, says the founding and does not give it to another company; the role is as far as the quote gives it; an amount in RMB, KRW and other currencies is kept as written, never read as dollars (acceptance check `round_currency_matches_quote`). The old tracker (20 marks, 90%) is cancelled.
Test after the window: `npx tsx scripts/regression.ts` (the recordings of batches 5–8 no longer match: misses are expected), then `fill-estimate`, the owner approves the cost, `fill`, and the gate again: zero lost in Tier 1, every Tier 2 loss shown to the owner.
- LinkedIn links (2026-11-24, component `linkedin_links`): one Google search per founder and leader with no link on file (at most five of each): `site:linkedin.com/in "Name" "Company"`. A link is kept only when the result's title carries every word of the name and the result names the company (`findLinkedInLink`); nothing of the result is used as a source of any field. A founder's link goes inside the founders column (core field `founder_linkedin`, own report line and provenance row, audited like the others); a leader's is a candidate value (`leader_linkedin`). `linkedin_people` (bios, discovery of founders) stays off.
- The gate and `fill` have a cost cap that is always on (`MAX_COST`, default 5 dollars), print the companies per batch with an estimate at $0.012 a company, show one progress line per company, and stop at the cap keeping what was recorded. `fill` runs only with `GO=1`.
