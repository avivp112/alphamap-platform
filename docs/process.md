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

### Cost (owner, 2026-11-21)
- The extraction of candidate fields is off: no competitor, team (headcount), LinkedIn or news search, no market extraction, no LinkedIn-people step (founder background), no EPO patents, no register / archive headcount points; the deep dive runs only for a gap in a core field. `TIER3_EXTRACTION=on` brings it all back; `TIER3_KEEP=news` keeps the news search and the market extraction only (round types and acquired read headlines).
- At most 10 pages of a company's own site (about, team, contact, news / press first); no product, customer, privacy or terms pages (`MAX_SITE_PAGES`, `lib/enrichment/sitemap.ts`).
- At `MAX_COST` no new company is started, the running ones finish, the reports are written, and `run_batch` goes on with what was collected; `unprocessed_batch_<N>.json` lists the rest.
- Acceptance: a founder's name is the name of a person (`founder_name_is_person`).

## 4. The audit after the write — `scripts/audit_sample.ts`, `scripts/audit_apply.ts`
50 values of the core fields: 25 completely random (the real accuracy) and 25 aimed at hard cases (rule-made values, rounds with an unknown type, press-only headquarters…; at most two per company).
- A wrong value is taken out of the database (recorded in `field_changes`, `undo_run.ts` puts it back) and written to `pending_fixes.csv`. The batch does not stop.
- A field with errors in more than 5 companies of the targeted sample, or whose cumulative random accuracy (at least 20 values) is under its tier's bar, is undone for the run and held until the maintenance window.
- The random sample accumulates in `eval/field_audit.json` (per field: audited, wrong).

## 5. Exposure in the pilot — `scripts/field_status.ts`, table `field_status`
A field is visible in the pilot only after at least 150 random audited values with accuracy above its tier's bar. Until then the data is in the database and not shown. (The table and the script are in place; the application reads the table as the screens are connected to it.)

## 6. New rules
Only in a maintenance window, about every 2,000 companies (every 4 batches), and only with Aviv's approval. A rule is aimed at a stated condition ("no founding year from a sentence that mentions an acquisition"), never a global tightening of a field. Acceptance: a REPLAY of all earlier batches — zero lost values in Tier 1; in Tier 2 every lost value is shown to Aviv and the rule enters only with his approval. Between windows findings go to `backlog.md` only.
