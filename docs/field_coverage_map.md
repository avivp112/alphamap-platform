# AlphaMap Field Coverage Map

**Purpose:** ground-truth inventory of every startup/investor field shown anywhere in the UI, what DB column it reads, and what process (if anything) fills that column — built *before* the `bulk_enrich_all.ts` → v2 rewrite so the rewrite doesn't silently drop something v1 (or another script) currently fills.

**Method:** read every file in `supabase/migrations/*.sql` in filename order (90 files, 20260526–20261006) to build the current column list for `startups`, `funding_rounds`, `investors`, `headcount_history`, `alphamap_score_history`, `startup_sub_sectors`, `watchlist_items`, `notifications`, `user_preference_vectors`; read `scripts/bulk_enrich_all.ts` in full (`EnrichmentResult`, `patchStartupProfile`, `insertNewRounds`, `recordHeadcountSnapshot`, `recordScoreSnapshot`, `main()`'s update/delete calls); read the header comment of every other script in `scripts/`; then read the actual rendering code for every UI surface listed in the task.

**Caveat:** the v2 spec document was pasted into a chat conversation and was never saved into this repo — `grep -r "bulk_enrich_v2"` and a search for its phase plan both return nothing. Nothing below could be machine-cross-checked against that document; see the note at the end of flagged section 1.

**A schema quirk worth flagging up front:** `20260608000001_headcount_history.sql` created `headcount_history(company_id, headcount, recorded_at)`, but that migration was (per `20260712000001`'s own comment) *never actually applied* to the live DB — `20260712000001_create_headcount_history.sql` created the table fresh with the real shape (`startup_id`, `employee_count`, `recorded_date`, `snapshot_date`). All mappings below use the real (`20260712000001`) shape, since that's what `bulk_enrich_all.ts` and the UI actually read/write.

---

## 1. Company Cards (Startups.tsx list/grid — `StartupCard`, `StartupTableRow`)

| UI Location | Field | DB Table.Column | Filled By |
|---|---|---|---|
| Card header | Company name, logo | `startups.name`, `startups.website` (logo derived client-side from domain) | v1 (`patchStartupProfile`) for website; name is set at row creation (CSV import / Add Startup / discovery scripts) |
| Card header | Industry text | `startups.industry` | v1 (fill-null only) |
| Card header | Funding-stage badge | `startups_search.latest_round_type` (view, derived from `funding_rounds.round_type` of the newest row) | v1 `insertNewRounds`, or `enrich_funding_rounds.ts` / `fetch_sec_deals.ts` / `sync_missing_funding_rows.ts` (stub rows) |
| Card body | Description | `startups.description` | v1 (fill-null only) |
| Card body | Valuation stat | `startups_search.latest_valuation` ← `funding_rounds.valuation` | v1 `insertNewRounds` |
| Card body | "Raised" stat | `startups_search.total_raised` (SUM of `funding_rounds.amount_raised`) | v1 `insertNewRounds` |
| Card body | Location | `startups.city`, `startups.country` | v1 (fill-null only) |
| Card body | Employees | `startups.employee_count` | v1 (always refreshed — time-varying) |
| Card body | Founded year | `startups.founded_year` | v1 (fill-null only) |
| Card body | Founder chips (first 3) | `startups.founders` (jsonb array, `.name`) | v1 `patchStartupProfile` (union-merge, additive) |
| Card footer | Website link text | `startups.website` | v1 |
| Card footer | Match % badge | `match_scores_for_startups()` RPC (reads `startups.embedding` + `user_preference_vectors.embedding`) | computed in app/DB — embeddings filled by `scripts/backfill_embeddings.ts`; the user's preference vector is filled by the `recompute_user_preference_vectors()` DB function (a scheduled job, not a `scripts/` file) from the user's own `watchlist_items` |
| Card footer | AlphaMap Score badge (tier + number) | `calculate_alphamap_score()` RPC — see §3 | computed live in DB; snapshotted daily by v1's `recordScoreSnapshot` into `alphamap_score_history` |
| Card footer | Save (★) / Pass (✕) state | `watchlist_items` (entity_type='startup'), pass reasons likely in `user_interactions` | user action (self-service, not enrichment) |

`StartupTableRow` (list view) renders the identical field set as the card — no additional columns.

---

## 2. Company Profile — Tearsheet Tabs

All seven tabs are rendered inline inside `src/app/pages/Startups.tsx` (opened via `TearsheetModal`, not a separate modal file — `DealModal.tsx` is unrelated, it backs the Deal Flow/`deals` table page). Tab components: `OverviewTab`, `FundingValuationTab`, `CapTableTab`, `TalentGrowthTab`, `CompetitorsMarketTab`, `AcquisitionsIPTab`, `NewsTab`.

### 2.1 Overview

| Field | DB Table.Column | Filled By |
|---|---|---|
| Description | `startups.description` | v1 (fill-null) |
| Value proposition callout | `startups.value_proposition` | v1 (fill-null) |
| Founded / Location / Employees / Sector stat tiles | `startups.founded_year`, `.city`/`.country`, `.employee_count`/`.employee_range`, `.sector_id`→`sectors.name` | v1 (sector via `sector_id_by_name` RPC, fill-null; employee fields always refreshed) |
| Sub-sector tag chips | `startup_sub_sectors` join table → `sectors.name` (array) | v1 `patchStartupProfile` (additive, via `sector_id_by_name`) |
| Company social row (LinkedIn/Facebook/Instagram) | `startups.linkedin_url`, `.facebook_url`, `.instagram_url` | v1 (fill-null) |
| "Your Match" panel (%) | `match_scores_for_startups()` RPC | computed in DB from `startups.embedding` (backfill_embeddings.ts) + user's preference vector |
| AlphaMap Score panel + pillar bars | `calculate_alphamap_score()` RPC — see §3 | computed live in DB |
| Score-over-time chart | `alphamap_score_history.score`/`.tier`/`.snapshot_date` | v1 `recordScoreSnapshot` (one upsert per company per run) |
| Founders cards (name, title, bio, LinkedIn) | `startups.founders` jsonb | v1 (union-merge; `title`/`bio` added 2026-10-03) |
| Leadership cards | `startups.leadership` jsonb | v1 (set only when currently empty) |

### 2.2 Funding & Valuation

| Field | DB Table.Column | Filled By |
|---|---|---|
| "Funding history may be incomplete" banner | `startups.funding_history_complete` | v1 — **always overwritten** each run (not fill-null), unlike almost every other profile field |
| Total Raised / Latest Valuation / Last Round Type stat tiles | SUM/latest of `funding_rounds.amount_raised`/`.valuation`/`.round_type` | v1 `insertNewRounds`; also `enrich_funding_rounds.ts`, `fetch_sec_deals.ts`, `sync_missing_funding_rows.ts` (stub rows) |
| Funding timeline chart + vertical timeline (round type, date, amount, valuation, lead investor) | `funding_rounds.round_type`, `.announcement_date`, `.amount_raised`, `.valuation`, `.is_valuation_estimated`, `.lead_investor`, `.investors[]` | v1 `insertNewRounds` |
| Financial Milestones — revenue estimate range | `startups.revenue_estimate` jsonb | v1 (fill-null-only; single snapshot, not history) |
| Financial Milestones — ARR milestones list | `startups.arr_milestones` jsonb array | v1 (append-and-dedupe by arr+date) |
| Financial Milestones — valuation benchmarks | `startups.valuation_benchmarks` jsonb array | v1 (append-and-dedupe by valuation+date) |

### 2.3 Cap Table & Investors

| Field | DB Table.Column | Filled By |
|---|---|---|
| Total Raised | SUM(`funding_rounds.amount_raised`) | v1 |
| Investor schedule (name, lead flag, round count, total $) | Derived client-side from `funding_rounds.lead_investor`, `.investors[]`, `.investor_amounts` (jsonb) | v1 (`investor_amounts` is rare/best-effort, same migration as acquisitions/patents) |
| Investor tier badge (Tier 1/2/3/Unranked) | `investors.tier` (joined client-side by name via `fetchInvestorTierMap`) | one-time SQL in migration `20260701000001_investors_tier.sql` (NTILE bucket by `portfolio_size`) + ongoing auto-tag updates inside `calculate_alphamap_score()`'s join logic; **no script actively maintains `investors.tier` going forward** — it is a derived, largely static column |

### 2.4 Talent & Growth

| Field | DB Table.Column | Filled By |
|---|---|---|
| Employees stat | `startups.employee_count`/`.employee_range` | v1 |
| Growth Velocity stat (pillar score) | `calculate_alphamap_score()` pillar `growth_velocity` — see §3 | computed in DB from `headcount_history` |
| Growth Trend badge | `startups.growth_trend` | v1 (always refreshed) |
| Headcount history area chart | `headcount_history.employee_count`, `.snapshot_date` (≥2 points needed) | v1 `recordHeadcountSnapshot` (one row per historical point mined from research, plus today's) |
| Team list (name, role, LinkedIn, bio) | `startups.leadership` jsonb | v1 (set only when empty) |

### 2.5 Competitors & Market

| Field | DB Table.Column | Filled By |
|---|---|---|
| Competitor cards (name, website, how it competes, cross-link) | `startups.competitors` jsonb (`{name, website, how_it_competes, startup_id}`) | v1 `patchStartupProfile` (fill-null-when-empty; `startup_id` cross-link resolved client-side in the script against `startupByDomain`) ; also `scripts/discover_competitors.ts` adds *new tracked startups* from untracked competitor entries and back-fills the `startup_id` cross-link on existing entries |

### 2.6 Acquisitions & IP

| Field | DB Table.Column | Filled By |
|---|---|---|
| Tech stack chips | `startups.tech_stack` text[] | v1 (fill-null-when-empty) |
| GitHub / Hugging Face links | `startups.github_url`, `.huggingface_url` | v1 (fill-null) |
| Patents Held stat | `startups.patent_count` | v1 (fill-null; opportunistic, no dedicated search) |
| Patent field tags | `startups.patent_fields` text[] | v1 (fill-null-when-empty) |
| Individual patent cards | `startups.patents` jsonb array (`{title, patent_number, filing_date, url, summary}`) | v1 (fill-null-when-empty; dedicated patent search pass, added 2026-09-07) |
| Acquisitions list (outbound — companies THIS startup bought) | `startups.acquisitions` jsonb (`{company_name, website, acquired_date, amount, description, acquired_startup_id}`) | v1 (fill-null-when-empty) |

### 2.7 News

| Field | DB Table.Column | Filled By |
|---|---|---|
| News cards (title, summary, source, date, image) | `startups.news` jsonb array (`{title, url, source, published_date, summary, image_url}`) | v1 `patchStartupProfile` (fill-null-when-empty); `scripts/backfill_news_images.ts` is a one-off backfill of `image_url` for articles enriched before that field existed |

---

## 3. AlphaMap Score & its sub-components

Computed live by the DB function `calculate_alphamap_score(p_startup_id)` (current version from `20260827000000_update_alphamap_score_formula.sql`) — **not** a column anyone writes directly; the UI calls the RPC every time it's displayed. Rendered in `AlphaMapScorePanel` / `ScoreBadge` (Startups.tsx), the Talent & Growth tab, and `TearsheetPdfDocument.tsx`.

5 pillars, fixed weights:
1. **Investor Quality (25%)** — best `investors.tier` matched across all of a startup's `funding_rounds.lead_investor`/`.investors[]`. Invalid (not zero) if no investor names are on file at all.
2. **Founder & Team Quality (25%)** — cumulative bonuses from `startups.founders[]`/`leadership[].had_prior_exit` (+40), `.elite_background` (+35), `.notable_pedigree` (+25). **This is the mechanism behind the "zeroing out" scenario**: the pillar is marked *invalid* (weight redistributed) only when a company has **zero** founders/leadership on file; the moment at least one person is known but none of them carry a quality flag, the pillar is a **real, valid 0** — which at 25% weight can legitimately drag a company with otherwise-strong pillars down into Tier C. I did not find a literal "44 / Tier C" bug report string anywhere in the repo (grepped `Startups.tsx`, migrations, and scripts for "44", "Tier C", "zeroing") — the scenario described to me matches this structural behavior but is not itself documented verbatim in the codebase.
3. **Growth Velocity (20%)** — % headcount change between the latest `headcount_history` snapshot and the closest one ≥150 days earlier.
4. **Recency & Activity (15%)** — days since the most recent of a `funding_rounds.announcement_date`, a `leadership[].joined_date`, or a `news[].published_date`.
5. **Media Coverage & Mentions (15%)** — count of `news[]` items with `published_date` in the trailing 90 days.

A safety floor (final score ≥70/Tier B) applies when Investor Quality ≥85 AND Founder & Team Quality ≥85.

`archetype`/`archetype_reasons` (shown as a badge) come from a separate DB function, `classify_company_archetype()` (inputs: `startups.founded_year`, `.employee_count`, `funding_rounds.round_type`/`.announcement_date`) — informational only, no longer affects score weighting since the 2026-08-27 formula rewrite (it's also called independently by `PrivateEquity.tsx`'s portfolio split).

**Score-over-time data**: `grep scripts/bulk_enrich_all.ts` for `recordScoreSnapshot` → it calls the `calculate_alphamap_score` RPC once per company per run (after that run's profile/funding/headcount writes land) and upserts `{startup_id, score, tier, snapshot_date}` into `alphamap_score_history` (table added in `20260824000000_social_links_news_score_history.sql`), one row per company per calendar day. This is the only writer of that table.

---

## 4. Investor / VC Pages (`VCs.tsx`, `VCModal.tsx`)

| Field | DB Table.Column | Filled By |
|---|---|---|
| Name, description, tagline | `investors.name`, `.description` (tagline = first sentence, computed client-side) | `agent_vcs.ts` / `agent_vcs_scraper.ts` (initial ingestion), `enrich_investors.ts` (ongoing) |
| Fund AUM | `investors.fund_size` (text, e.g. "$85B+") parsed client-side to `aum_millions` | `agent_vcs.ts` / `enrich_investors.ts` |
| Headquarters, Founded year | `investors.headquarters`, `.founded_year` | `agent_vcs.ts` / `enrich_investors.ts` |
| Check Size | `investors.typical_check_size` | `agent_vcs.ts` / `enrich_investors.ts` |
| Portfolio count | `investors.portfolio_size` | `agent_vcs.ts` / `enrich_investors.ts` |
| Stage Focus chips | `investors.stages` text[] | `agent_vcs.ts` / `enrich_investors.ts` |
| Notable Investments / Exits list | `investors.notable_investments` text[] | `agent_vcs.ts` / `enrich_investors.ts` |
| Sector Allocation (donut + bars, "sectors" filter list) | `investors.sector_allocation` jsonb | `agent_vcs.ts` — curated baseline (70%) blended with a live signal derived from the `deals` table (30%) |
| Website | `investors.website` | `agent_vcs.ts` / `enrich_investors.ts` |
| Leadership (Fund Performance isn't shown, but PE tearsheet reuses it) | `investors.leadership` jsonb | `enrich_investors.ts` |
| Investment thesis | `investors.thesis` | `enrich_investors.ts` |
| "Recent Investments (12mo)" stat | **Not real** — `Math.max(1, round(portfolio_size / 40))`, a formula guess, not a time-windowed query | nothing — formula, not data |
| Geography tag (Europe/Israel/Asia-Pacific/...) | **Not stored** — derived client-side from a keyword match on `headquarters` string | nothing — computed heuristic |
| **Syndicate Intel tab** (co-investors, network density, deal overlap %, collaboration scores) | **None** — `deterministicCoInvestors()` picks names from a hardcoded 15-firm pool using a hash of the firm's own name; density/overlap/partner-strength numbers are likewise `hash % N` | nothing fills this — it is synthetic data generated client-side from a name hash, labeled "algorithmically derived" in the UI but not backed by any real deal-overlap computation |
| **Exits tab** (exit outcome, exit year, MOIC/"return multiple") | **None** for outcome/year/MOIC — `exitOutcome()`/`exitYear()`/`totalReturnX` are all `hash(firm.name) % N` formulas; only the exited company *names* are real (`investors.notable_investments`) | nothing fills the outcome/year/MOIC — fabricated per-render from a name hash |
| **Fund Performance tab** (AlphaScore benchmark, Capital Efficiency / Portfolio Growth / Ecosystem Signal / Exit Track Record dimension bars) | **None** — `portfolioAlphaScore()` and all 4 dimension scores are `hash(firm.id/name) % N` formulas | nothing fills this — entirely synthetic, not derived from `calculate_alphamap_score` or any other real score |
| Dry Powder / Velocity widgets (Overview tab) | Honestly labeled estimates from real inputs (`founded_year`, `portfolio_size`) via a fixed deployment-curve assumption | not "filled" by a script — computed client-side each render; at least transparently labeled "Estimated" in the UI, unlike Syndicate/Exits/Performance above |
| `firm_type` (vc/pe/growth badge elsewhere, e.g. My Area watchlist chips) | `investors.firm_type` | one-time auto-tag SQL in `20260720000000_pe_firms.sql` (any investor named on a PE Buyout/Secondary round) + `enrich_investors.ts` (upgrade-only vc→pe/growth) |

---

## 5. Market Map (`MarketMap.tsx`, `GlobalTechHubMap.tsx`, `HeroMap.tsx`, `MarketIntelligenceHub.tsx`)

`GlobalTechHubMap.tsx`'s hub header explicitly states "derives every metric below from real Startups / Investors / Funding Rounds data — nothing here is mocked," and this held up on reading it.

| Field | DB Table.Column | Filled By |
|---|---|---|
| Hub locations (pins on map) | **Not stored** — a hardcoded `HUBS` array (name/lat/lng); each startup is bucketed into a hub by keyword-matching `startups.city`/`.country` against a fixed `CITY_HUB` map | nothing fills this — fixed in code |
| Companies-per-hub count | `startups.city`/`.country` matched to a hub | v1 (fill-null) |
| Capital (per hub) | SUM(`funding_rounds.amount_raised`) for startups in that hub | v1 / `insertNewRounds` |
| Unicorn count (per hub) | latest `funding_rounds.valuation` ≥ $1B | v1 |
| "Avg Alpha" / hub momentum | **Not the real AlphaMap Score** — a hardcoded lookup table (`G_SCORE`) keyed on `startups.growth_trend` string buckets | v1 fills `growth_trend`; the score-to-number mapping itself is a fixed heuristic, not `calculate_alphamap_score()` |
| Talent (sum of headcount per hub) | SUM(`startups.employee_count`) | v1 |
| Velocity % (rapid/moderate growth share) | `startups.growth_trend` | v1 |
| Market Rating / Capital Concentration / Local Capital % / Cross-Border Index (Market Intelligence Hub insights) | Derived client-side from `funding_rounds.lead_investor`/`.amount_raised` cross-referenced against `investors.headquarters` | v1 for startup-side data; `agent_vcs.ts`/`enrich_investors.ts` for investor HQ |
| Ticker tape of recent rounds | `funding_rounds.announcement_date`, `.amount_raised`, `.lead_investor`/`.investors[0]` | v1 |
| HeroMap (landing page) pins | **Not stored** — 7 hardcoded city coordinates, purely decorative, no data binding at all | nothing — static |

---

## 6. My Area (`MyArea.tsx`)

| Tab | Field | DB Table.Column | Filled By |
|---|---|---|---|
| Curated Watchlist | Watchlisted company/investor list | `watchlist_items` (`entity_type`, `entity_id` → resolved against `startups`/`investors`) | user action (Save button) |
| Curated Watchlist | Personal notes | `watchlist_items.notes` | user action (self-service; no UPDATE policy existed on this table until `20261001010000`) |
| Curated Watchlist | Personal tags | `watchlist_items.tags` | user action (self-service) |
| Thesis Matches | Match % per company | `top_thesis_matches()` RPC (cosine similarity of `startups.embedding` vs. `user_preference_vectors.embedding`) | computed in DB; `embedding` filled by `scripts/backfill_embeddings.ts`; the preference vector by the `recompute_user_preference_vectors()` DB function (not a `scripts/` file — a scheduled SQL job) from the user's own watchlist |
| Thesis Matches | "New" badge | `startups.created_at` within a lookback window | set at row creation |
| Thesis Matches | "Still calibrating" gate | `user_preference_vectors.signal_count` | derived (count of watchlist items with an embedded startup) |
| Live Alerts | Notification title/body/link | `notifications.title`/`.body`/`.link` | **only ever populated for the one-time onboarding welcome message** today (`notify_welcome_on_mandate_created()` trigger on first `user_mandates` insert). `generate_live_alerts()` (added `20261002010000`) is a real, callable DB function that *would* populate watchlist-filing, OSS-velocity, and thesis-match alerts, but nothing in this repo schedules it to run — no cron/pg_cron entry or `scripts/` file invokes it, so in practice this feed is still just the welcome message |
| Live Alerts | Read/unread state | `notifications.read_at` | user action (mark read) |

---

## 7. Filters & Search

**Startups page sidebar** (`SideFilterLayout.tsx` host, wired up in `Startups.tsx`):

| Filter | DB Table.Column | Filled By |
|---|---|---|
| Free-text search | `startups.search_tsv` (generated tsvector over name/industry/description) | derived automatically from `name`/`industry`/`description` (no separate filler) |
| Sectors (hierarchical) | `startups.sector_id` → `sectors.name` (`sector_parent` in `startups_search`) | v1 |
| "Also Tagged" (sub-sectors) | `startup_sub_sectors` → `sectors.name` (`sub_sector_names` array) | v1 |
| Countries | `startups.country` | v1 |
| Funding Stage slider | `startups_search.stage_group_val` (derived from latest `funding_rounds.round_type` via `stage_group()`) | v1 / round-insert scripts |
| Headcount slider | `startups.employee_count` | v1 |
| Financial Momentum ("Raised + growing 6mo") | `startups_search.has_recent_round` (derived from `funding_rounds.announcement_date`) AND `startups.growth_trend` | v1 |
| Competitive Density (Crowded/Blue Ocean) | `startups_search.peer_count`/`.peer_count_valid` (window function over sector+stage) | derived from the same sector/stage columns above |

**AI Search Workspace** (`AISearchWorkspace.tsx`) — a multi-turn chat backed by the `chat-analyst` Edge Function, which calls structured filter tools over sector/stage/headcount/funding-recency/funding rounds/news/patents/investors — i.e. it queries the same columns already listed above plus `startups.embedding` for semantic fallback; it introduces no new fields of its own.

**VCs page filters** (`VCs.tsx`): Check Size (`investors.typical_check_size`), AUM step (`investors.fund_size`, parsed), Stage, Geography (the same unstored, keyword-derived tag as §4), "Most active" sort (the same non-real `recent_investments` formula as §4).

---

## 8. Other components swept

- **`MarketIntelligenceHub.tsx`** — fully covered in §5; explicitly documents itself as deriving everything from real `Startup`/`InvestorRow`/`FundingRound` data, no mocks.
- **`AIMarketInsights.tsx`, `IntelligenceFeed.tsx`, `MarketOverview.tsx`** — **dead code.** Grepped the whole `src/app` tree for every exported component in these three files (`AIMarketStory`, `CrossMarketSignalsBar`, `PortfolioInsight`, `IntelligenceFeed`, `MarketMap` [the exported name inside `MarketOverview.tsx`, which collides with but is distinct from the real `MarketMap` page]) — none are imported anywhere. They are 100% hardcoded placeholder text/numbers (e.g. "Your portfolio is 32% exposed to AI infrastructure") and are not reachable from any route today. Not a v1/v2 concern since they display no real fields at all, but worth flagging since they look production-ready.
- **`DonutFocusChart.tsx`** — a pure chart component, used by both `VCModal.tsx` and `VCs.tsx`; renders `investors.sector_allocation` (already covered in §4), no fields of its own.
- **`TearsheetPdfDocument.tsx`** — confirmed it reuses the same fields as the profile tabs: company header (`name`, `sector`/`industry`, `city`/`country`, `founded_year`), key stats (latest `valuation`, total raised, `employee_count`), Match Score (same RPC as §1/§6), AlphaMap Score + pillars (§3), funding rounds table (`funding_rounds.*`), founders/leadership names+roles. No new fields.

---

## Fields filled by v1 that must be in v2

Every column `scripts/bulk_enrich_all.ts`'s `EnrichmentResult`/`patchStartupProfile`/`insertNewRounds`/`recordHeadcountSnapshot`/`recordScoreSnapshot`/`main()` writes to, cross-checked against §1–§8 above to confirm it is genuinely user-facing (not a dead column):

- `startups.website`, `.description`, `.value_proposition`, `.industry`, `.founded_year`, `.country`, `.city` (Overview)
- `startups.linkedin_url`, `.facebook_url`, `.instagram_url` (Overview social row)
- `startups.sector_id` (via `sector_id_by_name` RPC) and `startup_sub_sectors` rows (Overview sub-sector tags, sidebar "Sectors"/"Also Tagged" filters)
- `startups.founders` jsonb, incl. `had_prior_exit`/`elite_background`/`notable_pedigree`/`title`/`bio` (Overview founder cards; AlphaMap Score Pillar 2)
- `startups.leadership` jsonb, same quality-tag fields plus `joined_date` (Overview/Talent & Growth team cards; AlphaMap Score Pillars 2 & 4)
- `startups.competitors` jsonb (Competitors & Market tab)
- `startups.acquisitions` jsonb (Acquisitions & IP tab)
- `startups.patent_count`, `.patent_fields`, `.patents` jsonb (Acquisitions & IP tab)
- `startups.news` jsonb, incl. `image_url` (News tab; AlphaMap Score Pillars 4 & 5)
- `startups.funding_history_complete` (Funding & Valuation banner)
- `startups.employee_count`, `.employee_range`, `.growth_trend` (Overview/Talent & Growth stats, Market Map talent/velocity aggregates)
- `startups.tech_stack`, `.github_url`, `.huggingface_url` (Acquisitions & IP tab)
- `startups.arr_milestones`, `.revenue_estimate`, `.valuation_benchmarks` (Funding & Valuation financial milestones)
- `startups.last_enriched_at`, `.enrichment_confidence` (queue bookkeeping — not directly displayed, but gates which rows get re-enriched, which indirectly affects every field above)
- `startups` row deletion for `is_public_company` (keeps the list from showing public companies)
- `funding_rounds` inserts: `.round_type`, `.amount_raised`, `.valuation`, `.is_valuation_estimated`, `.announcement_date`, `.source_url`, `.lead_investor`, `.investors[]`, `.investor_amounts` (Funding & Valuation, Cap Table & Investors tabs; sidebar Funding Stage/Momentum filters)
- `headcount_history.employee_count`/`.snapshot_date` (Talent & Growth chart; AlphaMap Score Pillar 3)
- `alphamap_score_history.score`/`.tier`/`.snapshot_date` (Overview score-over-time chart)

**Note:** the original v2 spec document was pasted in chat and was never saved to this repo, so this list could not be machine-cross-checked against its Section 2 — reconcile manually against that document.

## Fields filled by other scripts

Out of scope for the v2 rewrite, which only replaces `bulk_enrich_all.ts`'s job:

- **`agent_vcs.ts`** — curated-baseline + live-deal-signal ingestion for VC profiles. Owns `investors.sector_allocation` (70% curated / 30% derived from the `deals` table).
- **`agent_vcs_scraper.ts`** — modular multi-source VC ingestion (curated directory + Wikipedia adapter). Owns the same `investors` profile columns as `agent_vcs.ts` (name, description, founded_year, headquarters, fund_size, stages, website, etc.) via upsert.
- **`enrich_investors.ts`** — the investors-table counterpart of `bulk_enrich_all.ts` (covers VC *and* PE firms via `firm_type`). Owns `investors.description`, `.thesis`, `.fund_size`, `.typical_check_size`, `.headquarters`, `.founded_year`, `.stages`, `.notable_investments`, `.leadership` (fill-null + name-matched LinkedIn backfill), `.last_enriched_at`, `.enrichment_confidence`, and upgrade-only `.firm_type`.
- **`fetch_sec_deals.ts`** — ingests SEC Form D filings into `deals` (separate table, Deal Flow page) and opportunistically links to `startups` by name; does not write startup profile fields directly.
- **`discover_competitors.ts`** — finds untracked companies named in `startups.competitors[]`, runs them through the same ingest-startup gate as the "Add Startup" button, and cross-links `startups.competitors[].startup_id` on success.
- **`discover_and_enrich_startups.ts`** — web-discovers new early-stage companies and inserts brand-new `startups` rows (name/website + initial profile), separate from enriching existing rows.
- **`import_startups_list.ts`** — syncs `startups.name`/`.website` against the master CSV; with `RESET_FIELDS=true` (default) it can **clear** profile fields back to NULL for re-enrichment, logging each change to `startup_changes`.
- **`sync_startups.ts`** — inserts stub `startups` rows (name only) from `scripts/watchlist.json`.
- **`sync_missing_funding_rows.ts`** / **`enrich_funding_rounds.ts`** — insert stub (`round_type: "Other"`) and then research-backed `funding_rounds` for startups with no rounds, independently of `bulk_enrich_all.ts`'s own round-insert path.
- **`backfill_embeddings.ts`** — owns `startups.embedding`/`investors.embedding` (and their hash/timestamp columns), which power Match Score, Lookalikes, and semantic search everywhere above.
- **`backfill_news_images.ts`** — one-off backfill of `startups.news[].image_url` for pre-existing articles.
- **`patch-incomplete.ts`** — one-time, DB-only derivation of `startups.website` from `funding_rounds.source_url` domains (no web search/LLM).
- **`autopilot.ts`** — a separate, older weekly enrichment job that writes largely the *same* `startups` profile fields as `bulk_enrich_all.ts` (description, employee_count, funding rounds) via its own independent code path (Tavily/DuckDuckGo + Claude). Overlaps with v1 rather than complementing it — worth the team's attention as a possible redundant/legacy script, but it is unambiguously not `bulk_enrich_all.ts` itself, so it's flagged here rather than folded into the v1 list above.
- **`check_website_reachability.ts`**, **`generate_training_schema.ts`**, **`release_app_update.ts`** — tooling/ops scripts (CSV vetting, fine-tuning dataset export, mobile OTA releases) that touch no `startups`/`investors` UI fields at all.
- Investor **`tier`** and **`firm_type`** auto-tagging — one-time/triggered SQL inside migrations (`20260701000001_investors_tier.sql`, `20260720000000_pe_firms.sql`), not an ongoing script at all.

## Fields shown in the UI that nothing fills today

- **VCModal "Syndicate Intel" tab** (co-investor network, density score, deal overlap %, collaboration scores) — entirely synthetic, generated by hashing the firm's own name (`deterministicCoInvestors()`), not backed by any real deal-overlap computation despite the UI's own "algorithmically derived" caption.
- **VCModal "Exits" tab** — exit outcome (IPO/Acquired/Secondary/SPAC) and exit year are hash-derived per render, not real; only the exited company names (`investors.notable_investments`) are real.
- **VCModal "Fund Performance" tab** — the AlphaScore benchmark number and all four performance dimensions (Capital Efficiency, Portfolio Growth, Ecosystem Signal, Exit Track Record) are hash-derived; none of this reuses `calculate_alphamap_score()` or any other real metric.
- **VCs "Recent Investments (12 mo.)" stat** and **VCModal's same figure** — `Math.round(portfolio_size / 40)`, not a real time-windowed query against `deals`/`funding_rounds`.
- **VCs/VCModal "Geography" tag** (Europe / Israel / Asia-Pacific / North America) — derived by keyword-matching `investors.headquarters` client-side; not a stored, authoritative field (misclassifies anything not matching the hardcoded keyword list).
- **Market Map hub pins and hub membership** — hubs themselves are a hardcoded list (`HUBS`/`CITY_HUB`); a company whose `city`/`country` doesn't match a known hub keyword is simply invisible to the map, with no stored "metro area" field to fall back on.
- **Market Map "Avg Alpha" per hub** — a fixed `growth_trend`-string-to-number lookup table, not the real AlphaMap Score; easy to mistake for one in the UI.
- **HeroMap (landing page)** — 7 hardcoded hub coordinates with zero data binding; purely decorative.
- **My Area "Live Alerts"** — the `generate_live_alerts()` DB function exists and is fully implemented (watchlist filing alerts, OSS velocity alerts, thesis-match alerts), but nothing in this repo schedules or invokes it, so the feed shows only the one-time onboarding welcome message in practice.
- **`startups.is_serial_founder`, `.has_follow_on_investors`, `.investor_tier_score`, `.previous_employee_count`** — columns from the original (pre-dual-track) scoring schema; the current 5-pillar `calculate_alphamap_score()` no longer reads them (confirmed in that migration's own "what this function no longer reads" note), and they are not rendered anywhere in the UI either. Dead on both ends.
- **`startups.tags`, `.business_model`, `.state_province`, `.country_code`, `.status`, `.acquired_by`, `.exit_date`, `.exit_value`, `.ticker`** — all exist on the table (added in `20260717000000_startups_schema_expansion.sql`) but a repo-wide search found zero references to any of them in `src/app` — they are not surfaced in any tab, card, or filter. Not a "UI shows it but nothing fills it" gap in the strict sense (the opposite problem — columns with no UI at all) but worth the team's attention since several of them (e.g. `status`/`exit_date`/`exit_value` for acquired/IPO'd companies) sound like they should back something in the Overview or Acquisitions tab.
- **AlphaMap Score "Founder & Team Quality" realistic-zero scenario** — structurally confirmed (see §3): any company with ≥1 founder/leader on file but none flagged `had_prior_exit`/`elite_background`/`notable_pedigree` gets a real, valid 0 on a 25%-weighted pillar. This isn't a missing field so much as a scoring-design edge case the v2 rewrite should be aware of if it touches scoring inputs at all.

---

*Full detail: `docs/field_coverage_map.md` (this file). Relevant source files read: `supabase/migrations/*.sql` (all 90, filename order), `scripts/bulk_enrich_all.ts` (full), header comments of every other file in `scripts/`, `src/app/pages/Startups.tsx`, `src/app/pages/VCs.tsx`, `src/app/components/VCModal.tsx`, `src/app/pages/MyArea.tsx`, `src/app/pages/MarketMap.tsx`, `src/app/components/GlobalTechHubMap.tsx`, `src/app/components/HeroMap.tsx`, `src/app/components/MarketIntelligenceHub.tsx`, `src/app/components/AIMarketInsights.tsx`, `src/app/components/IntelligenceFeed.tsx`, `src/app/components/MarketOverview.tsx`, `src/app/components/DonutFocusChart.tsx`, `src/app/components/TearsheetPdfDocument.tsx`, `src/app/components/AISearchWorkspace.tsx`, `src/lib/supabase.ts` (type definitions).*
