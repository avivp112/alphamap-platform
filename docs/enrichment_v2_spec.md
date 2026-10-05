# AlphaMap — Enrichment Pipeline v2: Instructions for Claude Code

*Oct 4, 2026 · @Aviv*

*(Saved to the repo from a pasted document — the user could not upload the file directly. This is the verbatim spec driving the `bulk_enrich_v2.ts` rewrite.)*

## 1. Context, goal and ground rules

**Goal:** create `scripts/bulk_enrich_v2.ts`, an upgraded version of `scripts/bulk_enrich_all.ts` that collects every field the current script collects (Section 2), with much higher accuracy and full source traceability. Keep the current script untouched as a fallback until v2 passes the acceptance criteria in Section 7.

**Why:** production data shows extraction errors that trace back to specific pipeline design choices, not to any single provider or model:
- APEX CREATIONS LTD shows "Los Angeles, United Kingdom" (city and country from different sources).
- APEX shows founded year 2026 while its funding history starts in 2023.
- APEX has a Growth round (Jun 2026) and a Series D (Apr 2026), both $200M at a $2.3B valuation, led by Glade Brook. This is one round stored twice, so Total Raised is inflated.
- APEX headcount chart has every x-axis label "Oct 26", a smoothed curve, and a "Live data" badge.
- Fresha shows 140.0k employees.
- The AlphaMap Score treats missing components as 0 (APEX: Founder & Team Quality = 0, giving score 44 / Tier C).

**Ground rules (non-negotiable):**

1. No data loss. v2 must collect every field in Section 2. If a fix would reduce coverage of any field, flag it and propose an alternative instead of dropping the field.
2. Missing is better than wrong. When evidence is weak or contradictory, leave the field empty and log why. Never guess.
3. Keep what works: resumability via `last_enriched_at`, Tier 1/2/3 queue ordering, `DRY_RUN` default true, `OFFSET`/`BATCH_SIZE`/`DELAY_MS`/`MIN_CONFIDENCE`/`MAX_TIER` env vars, the sector taxonomy constraint, `validateWebsiteCandidate()`, the website UNIQUE handling, `sanitizeModelOutput`, cost and token tracking, the end-of-run summary, and the `startups_search` refresh.
4. Keep the current providers: Serper (primary search), Tavily (fallback search and extract), Jina Reader (company website). Do not add or remove providers without an explicit request.\*\*
5. Models: keep `claude-haiku-4-5-20251001` as the default. Make the model configurable per extraction call (`PROFILE_MODEL`, `FUNDING_MODEL`, both defaulting to `ENRICH_MODEL`). Do not change defaults.
6. Database changes only through Supabase migrations. Additive only: new tables and new columns. Never drop or rename existing columns.
7. Shared logic goes into `lib/enrichment/` so v1, v2, the audit script and the tech-signals script reuse the same validation, dedup and provenance code.
8. Every new rejection rule logs a reason code and is counted in the end-of-run summary.
9. Work in phases (Section 7), one PR per phase, each with unit tests. Do not start a phase before the previous phase's acceptance criteria pass.

## 2. Data parity contract

v2 must keep collecting every field below. Before writing any code, read `bulk_enrich_all.ts` and the `save_enrichment` tool schema, and compare them to this list. If the current script collects anything not listed here, add it to the list and keep it.

| Group | Fields | Notes for v2 |
|---|---|---|
| Company status | `is_public_company`, `is_tech_company` | Public companies are archived, not deleted (issue 7) |
| Profile | `website`, `description` (4–6 sentences), `value_proposition`, `industry`, `founded_year`, `country`, `city`, sector + up to 4 sub-sector tags (taxonomy-constrained), social links (LinkedIn, Facebook, Instagram) | Location and founded year need evidence and validation (issues 1, 4) |
| Founders | `name`, `title`, `bio` (3–4 sentences\*), LinkedIn URL, `had_prior_exit`, `elite_background`, `notable_pedigree` flags | URLs only if verbatim in a source (issue 1) |
| Leadership | up to 15 people: `name`, `role`, `bio` (3–4 sentences\*), LinkedIn, join date | Same URL rule |
| Funding | every round: type, amount, valuation, date, lead investor, other investors, per-investor amounts; `funding_history_complete` | Normalized types, new dedup (issue 5) |
| Metrics | `employee_count`, `employee_range`, `growth_trend`, dated headcount history | Point types and update guard (issue 6) |
| Competitors | 4–5, each with a "how it competes" explanation; cross-linked to tracked startups by domain | Unchanged |
| Acquisitions | outbound acquisitions, cross-linked by domain | Unchanged |
| News | up to 5: title, URL, source, date, summary, image | Unchanged |
| Patents | summary (count + fields) and records: title, number, filing date, URL, summary | Unchanged |
| Financials | ARR milestones (dated, sourced), current revenue range, valuation benchmarks not tied to a round | Reported figures only, with source and date |
| Technology | `tech_stack`, `github_url`, `huggingface_url` | Plus API-based signals (issue 11) |
| Scoring | AlphaMap Score snapshot after each write | Missing components handled as null (issue 12) |
| Run metadata | `confidence_score` + `reasoning`, `last_enriched_at`, status (success / partial / low_confidence / rejected / removed_public / no_data / stealth_suspected / error) | Model confidence kept for logs; field confidence computed in code (issue 9) |

**Parity check (required):** add a script `scripts/enrich_parity_report.ts` that runs v1 and v2 in `DRY_RUN` on the same companies and prints, per field, the share of companies where each version produced a value. v2 may produce fewer values on a field only when the dropped values were rejected by a validation or evidence rule. In that case the report must list the reason codes.

\* **Amendment (agreed in chat, Oct 4 2026, not in the original document):** founder/leadership `bio` grows from v1's 1–2 sentences to 3–4, and must prioritize, whenever a source states it: where they studied, whether they previously founded a company (and whether it exited), whether they previously served as CEO of another company, and any notable elite technical/military background. No new boolean flag is needed for the military-unit signal specifically — v1's existing `elite_background` flag (kept as-is for v2) already defines exactly this ("an elite intelligence or technology military unit (such as Unit 8200, Talpiot, or an equivalent unit in another country)... TRUE only if you find clear evidence"); the amendment is that the bio PROSE should also narrate which unit/background, not just carry the true/false flag. Like `description`, `bio` is a narrative field backed by a `source_ids` array (issue 1), not a per-sentence `evidence_quote` — a 3–4 sentence biography is not a single material fact to cite one quote for. Still never invented: a detail only goes in if a source actually states it, same "omit rather than guess" rule as everything else. UI treatment (not shown on the card itself, suggested as a hover popup on the person's name) is a separate, later frontend decision — this amendment is about what the pipeline collects, not where it's displayed.

\*\* **Amendment (agreed in chat, Oct 5 2026, not in the original document; superseded within the same session, see below):** Jina Reader was briefly removed from the provider list in ground rule 4, per an explicit instruction — real DRY_RUN=false batches had shown Jina returning thin/timeout/503/aborted results often enough to look worth dropping. Stage 2 (company website fetch) was changed to cheerio direct-fetch as sole primary, Tavily Extract as fallback. **Reverted the same session** once a real DRY_RUN=false batch measured the actual effect: cheerio fetched 1.2 real website pages per company on average (several companies got only the homepage; one got zero pages at all) versus Jina's prior 3.9 pages/company — roughly a 3x drop in website content volume, because cheerio is a static-HTML parser with no JS execution and weaker anti-bot handling than a real rendering proxy. Jina is primary for Stage 2 again, per path; cheerio stays in the fallback chain (tried immediately after Jina on the same path, before moving to the next candidate path) as a zero-cost catch for whatever Jina itself fails or times out on; Tavily Extract remains the last resort when neither got anything for any candidate path. Serper stays primary general search, Tavily stays its gap-filling supplement (separately widened, same session, to merge in when Serper's own results for a query are thin, not only when literally empty) — that part of the original instruction was unrelated to Stage 2 and is unaffected by this reversion. Both extraction prompts (profile and funding) were also strengthened in the same instruction and are likewise unaffected: an explicit "actively re-scan every source, not just the ones whose query_label obviously matches" rule for competitors/patents/headcount_history/news/tech_stack (profile) and ARR/revenue/valuation (funding), so an empty category is only ever the answer after that active check — never a default for not having looked.

## 3. Target architecture

New and changed files:

| Path | Purpose |
|---|---|
| `scripts/bulk_enrich_v2.ts` | New orchestrator (queue, loop, write, summary). Same CLI and env vars as v1, plus the new ones below |
| `lib/enrichment/sources.ts` | Builds the labeled source list (S1…Sn, W1…Wn) with URL, provider, query label, source_type |
| `lib/enrichment/entity.ts` | `filterByEntity()` (issue 2) |
| `lib/enrichment/evidence.ts` | `verifyEvidence()` (issue 1) |
| `lib/enrichment/extract.ts` | `extractProfile()` and `extractFunding()` (issue 1) |
| `lib/enrichment/validation.ts` | `validateEnrichment()` and thresholds config (issue 4) |
| `lib/enrichment/rounds.ts` | Round type normalization and dedup (issue 5) |
| `lib/enrichment/confidence.ts` | `computeFieldConfidence()` (issue 9) |
| `lib/enrichment/write.ts` | Provenance-aware write rules (issue 3) |
| `scripts/audit_existing.ts` | One-off audit and cleanup of existing data (issues 3, 5) |
| `scripts/enrich_tech_signals.ts` | GitHub and Hugging Face API signals (issue 11) |
| `scripts/enrich_parity_report.ts` | v1 vs v2 coverage report (Section 2) |
| `eval/golden_set.json`, `eval/run_eval.ts` | Eval set and runner (issue 13) |

New env vars: `PROFILE_MODEL`, `FUNDING_MODEL` (default to `ENRICH_MODEL`), `EVAL` (default false), `REEXTRACT_FROM_RUN` (optional run id), `MIN_PROFILE_CONFIDENCE` (default 50), `MIN_FUNDING_CONFIDENCE` (default 60).

**Per-company pipeline in v2:**

1. Stage 0 — domain verification. Same Serper query as v1. Result is confirmed, mismatch or inconclusive, stored on the run record.
2. Stage 1 — search. The same 9 Serper queries as v1, with Tavily fallback per query. Funding queries are rebalanced toward primary sources (issue 15).
3. Stage 2 — company website via Jina. Only when the domain is confirmed, or inconclusive with an existing `is_manually_verified` website. Fetch the home page plus `/about`, `/team`, `/company`, `/contact` when they exist, and cap content per page (for example 6,000 characters). Tavily Extract and the Cheerio fallback stay as in v1.
4. Stage 3 — entity filter. `filterByEntity()` drops results that are not clearly about this company. All raw results are saved to `enrichment_evidence` with a `kept` flag.
5. Stage 4 — extraction, two calls. `extractProfile()` and `extractFunding()`, each getting only its relevant sources. Both use forced tool calls with evidence fields.
6. Stage 5 — evidence check. `verifyEvidence()` drops every material field whose quote is not found in its cited source.
7. Stage 6 — validation. `validateEnrichment()` applies the logical rules in issue 4.
8. Stage 7 — rounds. Normalize types, dedup against existing rounds and within the new set, recompute Total Raised.
9. Stage 8 — confidence. Compute field confidence and apply the thresholds.
10. Stage 9 — conditional deep dives. Same triggers as v1, with the stricter early-round rules in issue 8. Their output also goes through stages 5–8.
11. Stage 10 — write. Provenance-aware rules (issue 3), then headcount snapshot, score snapshot, sub-sector join table, `last_enriched_at`.
12. Stage 11 — log. One status line per company, plus counts of dropped fields by reason code.

## 4. Critical issues (root causes of the production errors)

### Issue 1 — One extraction call over all sources mixes facts between sources

**Where:** Stage 3. All 9 search results and the website are concatenated into one context and one `save_enrichment` call extracts everything. Nothing records which source each value came from.

**Effect:** city from one source and country from another ("Los Angeles, United Kingdom"); URLs that look plausible but appear in no source.

**Fix:**
1. Label every source. In the context, prefix each result with an id and URL: `[S3] https://...` for search results, `[W1] https://...` for website pages.
2. Evidence fields in the schema. Every material field becomes `{ value, source_id, evidence_quote }`. Material fields: city, country, founded_year, employee_count, website, every funding round (amount, valuation, date, lead investor), every founder and leadership LinkedIn URL, `github_url`, `huggingface_url`, ARR milestones, valuation benchmarks. Other fields (description, value proposition, competitors' explanations, news summaries) keep a single `source_ids` array.
3. Prompt rules to add to both extraction prompts:
   - Only extract facts stated explicitly in the sources. If a field is not stated, omit it.
   - `evidence_quote` must be copied verbatim from the cited source, 5–40 words.
   - Never construct or guess URLs. Only output URLs that appear verbatim in a source.
   - City and country must come from the same source and the same sentence or address.
   - Do not infer founded year from article dates or round dates.
   - Do not estimate headcount or revenue. Report only stated figures, with their date.
4. `verifyEvidence()` in code (`lib/enrichment/evidence.ts`): normalize whitespace, case and punctuation; require the quote to match the cited source's text (exact substring after normalization, or fuzzy similarity ≥ 0.9); require the value itself (number, city, year, investor name, URL) to appear inside the quote. URLs must also appear verbatim in the cited source. Failures are dropped with reason `evidence_mismatch` or `url_not_in_source`.
5. Split extraction into two calls:
   - `extractProfile()`: website pages + profile, competitors, news, patents and tech queries. Outputs company status, profile, founders, leadership, metrics, competitors, acquisitions, news, patents, technology.
   - `extractFunding()`: funding, investors, earliest-rounds and ARR/valuation queries. Outputs rounds, `funding_history_complete`, ARR milestones, revenue range, valuation benchmarks.
   - Same forced-tool pattern, `sanitizeModelOutput` on both, models from `PROFILE_MODEL`/`FUNDING_MODEL`. The union of both schemas must equal the v1 schema (Section 2).

### Issue 2 — Weak entity resolution lets other companies into the context

**Where:** Stage 0 and Stage 1. `inconclusive` is the most common verification result and the pipeline then proceeds with every snippet. When no domain survives, the fallback anchor is `"<name>" <country> (startup OR tech company)`, which is exactly when same-name companies leak in.

**Fix:** `filterByEntity(results, anchors)` in `lib/enrichment/entity.ts`, run before extraction.
1. Anchors: verified domain, founder and leadership names already in the DB, verified LinkedIn or Crunchbase URL, and country (only if `is_manually_verified` or from a registry source).
2. Keep a result if any of these holds: its URL is on the company domain; its text mentions the domain; its text mentions a known founder; its URL is the verified LinkedIn or Crunchbase profile.
3. Name-only results are kept only when the name is distinctive. Not distinctive: a single dictionary word, a name on a common-names list (Apex, Nova, Atlas, Orbit, Pulse, and so on), or a name under 5 characters after removing suffixes like Ltd, Inc, AI, Labs, Technologies.
4. Contradiction filter: drop results that explicitly place the company in a different country than a trusted country anchor.
5. Store every result in `enrichment_evidence` with `kept` and `drop_reason`. If fewer than 2 results remain, set status `low_evidence` and skip the Claude calls (saves cost).

### Issue 3 — Fill-null-only also locks in wrong values forever

**Where:** write rules for scalars. A wrong city or `founded_year` written once can never be corrected by a later run.

**Fix:**
1. New table `field_provenance`: `startup_id`, `field`, `value` (jsonb), `source_url`, `source_type`, `evidence_quote`, `confidence`, `run_id`, `created_at`. One row per accepted material value.
2. Source type ranking, highest first: `manual` > `registry` (Companies House, SEC EDGAR) > `company_site` > `press_release` > `news` > `aggregator_snippet` > `model_inferred`. Classify by domain in `sources.ts`.
3. New write rule for scalars: fill if null (as today). Overwrite an existing value only if the new value passes validation and either comes from a higher-ranked source type, or is supported by 2 independent sources with verified quotes while the existing value has no provenance row.
4. Fields with `is_manually_verified = true` are never overwritten.
5. New table `field_changes`: old value, new value, source, `run_id`, timestamp. Every overwrite is logged and reversible.
6. Array, time-series and time-varying field rules stay as in v1, except where issues 5 and 6 change them.

### Issue 4 — No logical validation after extraction

**Where:** after `sanitizeModelOutput`, which fixes format only.

**Fix:** `validateEnrichment(existing, extracted)` in `lib/enrichment/validation.ts`, run before any write. Thresholds live in a config object so they can be tuned against the eval set.

| Rule code | Check | Action on failure |
|---|---|---|
| `city_country_mismatch` | City exists in that country (local GeoNames cities15000 JSON, with alternate names) | Write neither city nor country; flag `needs_review` |
| `founded_after_first_round` | `founded_year` ≤ year of earliest round | Do not write `founded_year` |
| `founded_out_of_range` | 1900 ≤ `founded_year` ≤ current year | Do not write |
| `headcount_outlier` | Starting thresholds: employees ≤ 1 per $20K of total raised (when raised > $1M), and ≤ 20,000 for a private company | Do not update `employee_count`; flag `needs_review` |
| `valuation_below_round` | Round amount < post-money valuation | Do not store the valuation |
| `round_date_invalid` | Round date not in the future and not before founded year | Do not store the round |
| `stage_order` | A later stage dated more than 6 months before an earlier stage | Flag rounds `needs_review` |
| `profile_country_conflict` | New country contradicts an existing registry or manual country | Do not write |

### Issue 5 — Round dedup by type and date misses duplicates

**Where:** funding round insert, dedup on (round type, date ±6 months). The APEX round labeled once Series D and once Growth was stored twice.

**Fix (`lib/enrichment/rounds.ts`):**
1. Normalize round types to a closed list: Pre-Seed, Seed, Series A, Series B, Series C, Series D, Series E, Series F+, Growth, Venture Debt, Grant, Secondary, Unknown.
2. Duplicate if either holds, regardless of type:
   - Same normalized lead investor, amount within ±10%, dates within ±9 months.
   - Amount within ±5% and valuation within ±5%, dates within ±9 months.
3. Merge into one record: earliest date, most specific type (Series D over Growth), union of investors, keep all source rows in `field_provenance`.
4. Recompute Total Raised from deduped rounds, never from a model-returned total.
5. Cleanup: `audit_existing.ts` applies the same dedup to the existing `funding_rounds` table, in `DRY_RUN` by default, with a CSV of every proposed merge.
6. IPO rounds stay excluded, as in v1.

### Issue 6 — Headcount history mixes real and mined points

**Where:** headcount snapshots. Points mined from old press are written as daily snapshots next to real measurements, and the UI labels the chart "Live data". `employee_count` is refreshed every pass, even from weak snippets.

**Fix:**
1. New column `point_type` on the headcount snapshot table: `observed` (measured in this run from a verified source), `press_reported` (stated in an article, dated by the article, not by the run), `model_estimate`. Backfill existing rows as `model_estimate`.
2. Update guard: a change of more than 50% from the current `employee_count` requires 2 sources or one source of type `company_site` or higher. Otherwise keep the old value and store the new one only as `model_estimate`.
3. Snapshot cadence: at most one observed snapshot per company per month.
4. UI changes (separate small PR in the frontend):
   - Show the "Live data" badge only with ≥ 3 observed points.
   - Render `press_reported` points as separate markers, not joined by a smoothed line.
   - X-axis shows real dates.
   - With fewer than 2 points, show the single number instead of a chart.

## 5. Important issues

### Issue 7 — Public companies are hard-deleted on a model flag

**Where:** `is_public_company: true` deletes the row (unless manually verified). This is the only destructive action in a pipeline designed to be non-destructive, and it relies on a single model judgment. Public parents, similar names and IPO or SPAC rumors can all trigger it.

**Fix:**
1. Replace the delete with `status = 'public'` and `archived_at = now()`. Archived rows are excluded from `startups_search` and the UI.
2. Require a verified evidence quote containing a ticker or exchange (for example "NASDAQ: XXX", "NYSE", "LSE", "TASE").
3. Log the change in `field_changes` so it can be reversed.
4. Keep the `removed_public` status label in the summary for continuity.

### Issue 8 — Early-rounds deep dive encourages invented Seed rounds

**Where:** the deep dive fires when a Series A+ exists without an earlier round, on the assumption that companies almost never skip Seed. Many companies raise undisclosed Seed rounds or start at Series A. Searching for a round the pipeline expects to exist pushes the model to find one.

**Fix:**
1. Keep the trigger and the extra searches.
2. Remove any wording in the deep-dive prompt implying that an earlier round should exist. Add: "If no source explicitly states an earlier round, return an empty list."
3. Accept an early round only with a verified quote containing the round name or amount, and field confidence ≥ 70.
4. When nothing is found, set `funding_history_complete = false` and leave rounds as they are.

### Issue 9 — One model-reported confidence score for the whole company

**Where:** `confidence_score` (0–100) is the model's self-assessment and gates only dollar figures, at a threshold of 40. Profile fields are written regardless of confidence.

**Fix:** `computeFieldConfidence(field)` in `lib/enrichment/confidence.ts`, computed in code from evidence:

| Evidence | Confidence |
|---|---|
| registry source | 90 |
| `company_site` or `press_release` | 75 |
| 2+ independent news sources agreeing | 75 |
| single news source | 55 |
| `aggregator_snippet` only | 40 |

These are starting values, to be tuned against the eval set. Write thresholds: profile fields ≥ `MIN_PROFILE_CONFIDENCE` (50), round amounts and valuations ≥ `MIN_FUNDING_CONFIDENCE` (60). Store field confidence in `field_provenance`. Keep the model's `confidence_score` and `reasoning` in logs only. The company-level statuses (`partial`, `low_confidence`) are derived from field results.

### Issue 10 — Model choice is not configurable per task

**Where:** one `ENRICH_MODEL` for all extraction.

**Fix:** keep Haiku as the default everywhere. Add `PROFILE_MODEL` and `FUNDING_MODEL`, both defaulting to `ENRICH_MODEL`, so models can be compared on the eval set without code changes. Report token usage and cost per model in the summary. Do not change defaults.

### Issue 11 — GitHub and Hugging Face are collected through search, not their APIs

**Where:** one of the 9 Serper queries covers tech stack, GitHub and Hugging Face, and the result is a URL only. This is the product's main differentiating data layer.

**Fix:** new script `scripts/enrich_tech_signals.ts`. The search query in the main pipeline stays, but only to discover the org.
1. Org verification: accept a GitHub or Hugging Face org only if its profile links to the company domain (GitHub blog field, Hugging Face website field), or the company website links to the org.
2. GitHub REST/GraphQL API: repos, stars, forks, contributors, commit frequency over the last 90 days, releases, languages.
3. Hugging Face Hub API: org models, datasets and Spaces, downloads, likes, last-modified dates, pipeline tags.
4. New table `tech_signal_snapshots`: dated metrics per org, collected weekly, so velocity can be computed.
5. Fake-star screen (first version): for repos with a star spike, sample stargazers and flag a high share of new accounts with no repos and no followers. Also track stars relative to forks and contributors.
6. Rate limits: GitHub token, ETags / conditional requests, and the same resumable design as the main script.

### Issue 12 — AlphaMap Score counts missing data as zero

**Where:** score computation. APEX gets Founder & Team Quality = 0 and an empty Growth Velocity, so a company with $816M raised and a16z on the cap table scores 44 / Tier C. The displayed weights (31%, 31%, 0%) are confusing.

**Fix:**
1. A component with no data is null, not 0.
2. Score = weighted sum of available components divided by the sum of their weights.
3. Confidence from covered weight share: > 80% High, 50–80% Medium, < 50% Low, and no Tier shown when Low.
4. UI: show "Not enough data" for null components, with the weight and a short tooltip explaining it.
5. After the change, recompute scores for the whole database and write a new score snapshot.

## 6. Infrastructure

### Issue 13 — No eval set, so regressions reach production unnoticed

**Where:** there is no way to measure whether a change improved or hurt accuracy. The location bug shipped without anyone noticing.

**Fix (build first, in Phase 0):**
1. `eval/golden_set.json`: start with 50 companies and grow to 150–200. For each company, store manually verified values for city, country, founded_year, website, founders, funding rounds (type, amount, month and year, lead investor), employee range, `github_url`, `huggingface_url`.
2. Deliberate hard cases:
   - Common names, including APEX and Fresha.
   - Non-US companies (Israel, UK, Germany, India).
   - Rebrands and domain changes.
   - Companies that started at Series A.
   - Stealth companies with no data, where the correct answer is "no data".
   - Companies that went public.
3. `eval/run_eval.ts` and `EVAL=true`: run the full v2 pipeline on the golden set without writing to the DB, then compare with the verified values.
4. Report per field:
   - Precision: of the values written, how many are correct.
   - Coverage: of the existing true values, how many were found.
   - Wrong-write rate: how often a wrong value was written instead of leaving the field empty.
   - Average cost per company.
   - Diff against the previous eval run, highlighting fields whose precision dropped.
5. Production gate: a change to the script, prompts, models or thresholds ships only if precision on location, founded year and funding rounds does not drop. Wire it into CI later.
6. Cost control: eval runs replay stored evidence (issue 14) by default, so prompt and model changes can be tested without paying again for Serper, Tavily and Jina.

### Issue 14 — Raw evidence is not stored

**Where:** after a run there is no record of what the model saw when it chose a value, and re-extraction requires paying for searches again.

**Fix:**
1. New table `enrichment_evidence`: `run_id`, `startup_id`, `source_id`, `query_label`, `provider` (serper / tavily / jina / tavily_extract / cheerio), `url`, `title`, `content`, `fetched_at`, `kept`, `drop_reason`.
2. New table `enrichment_runs`: `run_id`, `started_at`, `git_sha`, models used, prompt version, thresholds, total cost.
3. `REEXTRACT_FROM_RUN=<run_id>`: re-run extraction, validation and writes from stored evidence, with no new searches.
4. Retention: keep full content 90 days. After that keep only URLs and the quotes referenced by `field_provenance`.

### Issue 15 — Heavy reliance on snippets from paid aggregators

**Where:** funding and profile queries are biased toward Crunchbase, PitchBook and LinkedIn. Selling data extracted from paid services' snippets may conflict with their terms of use. These snippets are also often partial or stale.

**Fix in code:**
1. Classify `source_type = aggregator_snippet` by domain (crunchbase.com, pitchbook.com, linkedin.com, tracxn.com, cbinsights.com, dealroom.co).
2. Rebalance the funding queries toward primary sources: press releases (PRNewswire, BusinessWire, GlobeNewswire), company blogs and newsrooms, news articles, SEC EDGAR Form D, and Companies House filings. Keep the aggregator queries as secondary, without removing them, so coverage does not drop.
3. Optional registry lookups: Companies House API for UK companies (incorporation date, registered address, officers), and SEC EDGAR Form D for US raises (amount sold, filing date). These map to `source_type = registry` and the highest confidence.
4. Flag at DB level every field whose only source is `aggregator_snippet`. Show the share of such fields in the run summary.

Outside code: review data licensing with a lawyer before selling to paying customers.

## 7. Rollout plan and acceptance criteria

One PR per phase. A phase is done only when all its criteria pass. v1 stays runnable until Phase 3 is accepted.

**Phase 0 — Measurement baseline (issues 13, 14)**
- [ ] `eval/golden_set.json` with at least 50 verified companies, including APEX and Fresha.
- [ ] `EVAL=true` runs and prints precision, coverage and wrong-write rate per field.
- [ ] Evidence is stored in `enrichment_evidence`, and `REEXTRACT_FROM_RUN` works.
- [ ] Baseline metrics for the current v1 script are recorded in `eval/baseline.json`.

**Phase 1 — Accuracy core (issues 1–6)**
- [ ] `bulk_enrich_v2.ts` exists, with shared logic in `lib/enrichment/`.
- [ ] Golden set: zero city/country mismatches.
- [ ] Golden set: zero duplicate rounds. APEX has a single $200M round, and Total Raised is recomputed.
- [ ] Golden set: zero cases of `founded_year` after the first round.
- [ ] Golden set: precision ≥ 95% on location and founded year, ≥ 90% on written round amounts. If a target is missed, prefer lower coverage over wrong values.
- [ ] Every accepted material value has a `field_provenance` row with URL and verified quote.
- [ ] Parity report: every Section 2 field is produced by v2, and any coverage drop vs v1 is fully explained by reason codes.
- [ ] `audit_existing.ts` runs on the full database in `DRY_RUN`, and its CSV is reviewed manually before a real run.
- [ ] Headcount chart: real x-axis dates, and "Live data" only with observed points.

**Phase 2 — Safety and differentiation (issues 7–12)**
- [ ] The script never deletes rows from `startups`.
- [ ] Per-model cost and accuracy are reported in the summary and the eval report.
- [ ] `enrich_tech_signals.ts` runs on every company with a verified org and writes weekly snapshots.
- [ ] APEX's AlphaMap Score is recomputed without zero components from missing data, and confidence reflects coverage.

**Phase 3 — Sources (issue 15) and cutover**
- [ ] The summary shows the share of fields whose only source is `aggregator_snippet`.
- [ ] Funding queries prefer primary sources, with no coverage drop on the parity report.
- [ ] v2 replaces v1 in CI. v1 is kept in the repo, renamed `bulk_enrich_v1_legacy.ts`.

**Applies to every phase**
- [ ] Unit tests for `verifyEvidence`, `filterByEntity`, `validateEnrichment`, round dedup and score normalization, covering the APEX and Fresha cases.
- [ ] `DRY_RUN` remains the default, and resumability works exactly as in v1.
- [ ] The end-of-run summary shows dropped fields by reason code.
- [ ] All DB changes are additive Supabase migrations.
