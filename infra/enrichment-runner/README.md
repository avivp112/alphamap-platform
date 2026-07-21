# Enrichment Runner — running the scraping scripts safely

## Why this exists

The `scripts/*.ts` enrichment pipelines used to run as GitHub Actions workflows
(`.github/workflows/*.yml`, now removed). GitHub suspended the account hosting
that repo because several of those workflows used Actions' shared compute
**solely to make bulk automated requests to third-party websites** (search
APIs + direct scraping of arbitrary company domains) — which is what GitHub's
(and GitLab's, and every other CI vendor's) Acceptable Use Policy calls out as
disallowed. The problem was never the scripts' logic; it was running them on
**shared, third-party CI compute**.

The fix: split the scripts by what they actually talk to, and run the ones
that scrape the open web on infrastructure you own — a plain VM — instead of
on anyone's shared CI runners (GitHub or GitLab).

## The three tiers

| Tier | What it talks to | Script(s) | Where it may run |
|---|---|---|---|
| **1 — Internal only** | Supabase only (your own DB) | `import_startups_list.ts`, `patch-incomplete.ts`, `sync_missing_funding_rows.ts`, `sync_startups.ts` | Anywhere — GitLab CI, locally, wherever. No third-party site is ever contacted. |
| **1b — First-party API** | Supabase + one API vendor (Anthropic/OpenAI), no scraping | `backfill_embeddings.ts` | Same as Tier 1 — calling a paid API vendor for your own app feature is normal CI/CD usage, not "interacting with 3rd party websites." |
| **2 — Manual scraping** | Supabase + Tavily/Serper search + arbitrary company websites | `bulk_enrich_all.ts`, `enrich_investors.ts`, `enrich_funding_rounds.ts` | **VM only.** This tier is what triggered the suspension. |
| **3 — Scheduled scraping** | Same as Tier 2, but was auto-triggered by cron (no human in the loop) | `agent_vcs_scraper.ts` (was `vc_ingestion.yml`, weekly), `autopilot.ts` (was `weekly-market-intel.yml`, weekly), `fetch_sec_deals.ts` (was `fetch-sec-deals.yml`, daily) | **VM only**, and keep the schedule on the VM's own cron — never on a shared CI vendor's scheduler. |

Tier 3 is the highest-risk group: it was the only tier running **unattended
and repeatedly** — a recurring, automated, high-volume external-fetch pattern
is exactly what abuse detection is built to catch. `agent_vcs_scraper.ts` in
particular hits a fixed list of named third-party domains (a16z.com,
techcrunch.com, benchmark.com, wikipedia.org, …) every week — treat this as
the one to be most conservative with.

## The runbook

### 1. Provision a small VM you control

Any $5–6/mo VPS works (a DigitalOcean droplet, Hetzner CX, AWS Lightsail, or a
spare machine on your own network) — the only requirement is that it's
infrastructure *you* control, not a shared CI vendor's runner pool, so none of
this is bound by a CI provider's Acceptable Use Policy. Ubuntu 22.04+, 1 vCPU /
1–2GB RAM is plenty; these scripts are network-bound, not compute-bound.

```bash
# On the VM
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
git clone https://gitlab.com/finance-platform-group/finance-platform.git
cd finance-platform
npm ci
cp infra/enrichment-runner/.env.example .env
# fill in .env with real secrets (see below), then:
```

Or use the provided `Dockerfile` instead if you'd rather not install Node
directly on the box — see below.

### 2. Configure secrets

Copy `.env.example` → `.env` on the VM and fill in real values. **Never**
commit `.env` — it's already covered by the repo's `.gitignore` pattern for
`.env*`.

### 3. Run manually (Tier 2) or on the VM's own cron (Tier 3)

Manual, one-off runs (exactly like the old `workflow_dispatch` inputs, now as
env vars):

```bash
DRY_RUN=false BATCH_SIZE=300 npx tsx scripts/bulk_enrich_all.ts
```

Scheduled runs — add lines like the ones in `crontab.example` to the VM's own
`crontab -e`. Because it's your cron on your box, there's no vendor policy
being tested; it's exactly equivalent to running the script by hand, just on a
timer you control.

### 4. Etiquette that reduces both ToS and site-blocking risk

These were already partially built into the scripts (`DELAY_MS` between
companies); worth tightening further given the history:

- Keep `DELAY_MS` realistic (15–45s between companies, as already defaulted)
  rather than removing it for speed.
- Avoid increasing per-company parallelism — `bulk_enrich_all.ts` /
  `enrich_investors.ts` already fire ~5 parallel requests per company; that's
  a reasonable ceiling, not a floor to push higher.
- Set a descriptive `User-Agent` on the direct-website `fetch()` calls (e.g.
  `AlphaMapEnrichmentBot/1.0 (+contact: you@yourdomain.com)`) so any site
  operator who notices traffic can identify and contact you rather than just
  blocking/reporting it.
- Respect `robots.txt` on the direct company-site fetch in
  `bulk_enrich_all.ts` where feasible.
- Run Tier 3 (scheduled) jobs no more than weekly, as they already are — don't
  increase frequency.

None of the above is required by any specific law, but it's the difference
between "a bot that's easy to identify and reach" and "traffic that looks like
an attack" — which is what gets accounts flagged in the first place.

## Files in this directory

- `Dockerfile` — containerized runner; same image runs any script via an
  argument, so you don't need Node installed on the VM directly.
- `crontab.example` — example schedule for the Tier 3 jobs, staggered so they
  don't all fire at once.
- `.env.example` — every secret the scripts collectively need (not all are
  required for every script — see each script's own header comment).
