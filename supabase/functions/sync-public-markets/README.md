# sync-public-markets + search-tickers

Two Supabase Edge Functions that power the Public Market Hub's data layer —
deployed and configured together since they share the same `FMP_API_KEY` secret.

**`sync-public-markets`** pulls fresh market metrics from **Financial Modeling
Prep (FMP)** and upserts them into the `public_companies` table on the unique
`ticker` key. The Public Market Hub (`/public-market`) reads straight from that
table, so once this runs on a schedule the hub stays up to date on its own. It
serves two modes:
- **Daily full sync** (empty body) — refreshes the curated 19-ticker universe
  (Cyber/SaaS/Fintech/AI). This is what the cron schedule calls.
- **On-demand sync** (`{"tickers":["ABNB"]}`) — the Public Market Hub's stock
  search bar calls this with exactly the ticker a user picks. A ticker outside
  the curated universe gets its name/sector/exchange resolved from FMP's
  company profile automatically.

Fetched per ticker: **market cap, enterprise value, TTM revenue, TTM EBITDA,
EV/Revenue, EV/EBITDA**, plus YoY revenue growth and ~1-year price momentum.

**`search-tickers`** is a thin read-only proxy in front of FMP's ticker search
(`/v3/search`, filtered to NASDAQ/NYSE) so the browser can look up any ticker
without the FMP key ever reaching the client. Powers the hub's search-as-you-type.

---

## One-time setup

### 0. Prerequisites
- [Supabase CLI](https://supabase.com/docs/guides/cli) installed and logged in
  (`supabase login`), and the project linked (`supabase link --project-ref <PROJECT_REF>`).
- The `public_companies` table exists and is widened for search — run, in order:
  1. `supabase/migrations/20260725000000_public_companies.sql` — creates the
     table, seeds a reference snapshot so the hub works before the first sync.
  2. `supabase/migrations/20260726000000_public_companies_search.sql` — widens
     the `sector` check to allow `'other'` (for ad-hoc search results outside
     the 4 curated sectors) and adds the `exchange` column.
  (via `supabase db push`, or paste each into the Dashboard SQL Editor in order.)

### 1. Set the FMP key as a secret (never commit it)
```bash
supabase secrets set FMP_API_KEY=<YOUR_FMP_KEY>
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are **auto-injected** into Edge
Functions — you do not set those. Both functions read the same `FMP_API_KEY`,
so this one `secrets set` covers both.

### 2. Deploy both functions
```bash
supabase functions deploy sync-public-markets --no-verify-jwt
supabase functions deploy search-tickers --no-verify-jwt
```
`--no-verify-jwt` lets the daily scheduler and the in-app search/sync UI invoke
them without a user token. Neither function exposes anything sensitive — they
only *read* FMP and, for sync, *write* market data with the service role.

### 3. Test them once
```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/sync-public-markets"
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/search-tickers" \
  -H "Content-Type: application/json" -d '{"query":"airbnb"}'
```
Expect JSON like `{ "synced_at": "...", "total": 19, "ok": 19, "failed": 0 }`
from the first, and `{ "results": [{ "symbol": "ABNB", ... }] }` from the second.
Reload `/public-market` — the badge should flip from *Snapshot* to
*Synced · &lt;time&gt;*, and the search bar in the Companies Directory section
should return live results.

---

## Schedule it daily (pick one)

### Option A — pg_cron + pg_net (recommended; runs inside Supabase)
Paste into the Dashboard SQL Editor once:
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'sync-public-markets-daily',
  '0 6 * * *',                       -- every day at 06:00 UTC
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/sync-public-markets',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);
```
Change the cadence any time:
```sql
select cron.unschedule('sync-public-markets-daily');
-- then re-run cron.schedule(...) with a new cron expression
```

### Option B — Supabase Dashboard cron (no SQL)
Dashboard → **Integrations → Cron** (or **Database → Cron Jobs**) → *Create job* →
point an HTTP request at
`https://<PROJECT_REF>.supabase.co/functions/v1/sync-public-markets`, method
`POST`, schedule `0 6 * * *`.

### Option C — GitLab scheduled pipeline (this repo lives on GitLab)
Add a job to `.gitlab-ci.yml`:
```yaml
sync-public-markets:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule"'
  image: curlimages/curl:latest
  script:
    - curl -fsS -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/sync-public-markets"
```
then GitLab → **Build → Pipeline schedules → New schedule** (e.g. daily). Kept
out of the committed CI config on purpose so it doesn't run on every push — add
it only if you want the GitLab route instead of A or B.

---

## Notes
- **Rate limits:** the function makes ~1 batch quote call + ~4 calls per ticker
  (~80/day for 19 tickers), with a small delay between tickers — comfortably
  within FMP's free-tier daily budget for a once-a-day run.
- **Resilience:** any FMP field that's premium-gated or momentarily missing is
  skipped rather than written as `NULL`, so a partial FMP response never wipes a
  previously good value. Metadata (name/sector/private counterpart) is always
  written so a first-run insert is complete.
- **Universe:** edit the `UNIVERSE` array at the top of `index.ts` to add/remove
  tickers; keep the `sector` values in sync with the client
  (`cyber | saas | fintech | ai`).
- **On-demand sector mapping:** tickers added via search don't have a curated
  sector — `mapSector()` guesses from FMP's GICS sector/industry text (e.g.
  "software" → saas, "bank"/"insurance" → fintech). There's no clean GICS→AI
  mapping, so this is approximate; anything unmatched lands in `'other'` and
  still shows in the Companies Directory, just outside the Sector Matrix and
  Sentiment Barometer (which stay scoped to the curated 4 by design).
- **search-tickers** caps results at 10 and query length at 40 chars; it's a
  pure passthrough with no database writes.
