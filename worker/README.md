# AlphaMap check worker

Drains the `company_checks` queue for the "check a company" feature. It runs on
a small server of its own — **Railway or Fly.io** — and never on CI runners
(GitHub Actions / GitLab CI terms do not allow using them as a production
backend).

Each check has two phases:

1. **identify** (`worker/identify.ts`) — one search; leaves "is this the
   company you mean?" candidates for the user. Never charged.
2. **check** (`worker/gates.ts`) — after the user confirms: the threshold
   checks (public company, stealth, non-tech). Stage 3 adds the enrichment.

A provider rejecting one of the worker's keys (Serper, Anthropic) puts the
check back in the queue without using an attempt and logs a `CONFIG` line
naming the key — fix the key (`fly secrets import`) and the check resumes.

## Environment (set on the worker server only)

| Variable | Required | What |
|---|---|---|
| `SUPABASE_URL` | yes | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role key. **Only here** — never in the web app or a browser. |
| `ANTHROPIC_API_KEY` | yes | For the technology check (and later the enrichment). |
| `SERP_KEY` | yes | Serper search, same key as enrichment v2. |
| `JINA_API_KEY` | no | Raises the rate limit for reading company websites. |
| `WORKER_ID` | no | Name in the logs and on the lease (default: random). |
| `POLL_MS` | no | Idle wait between queue polls, default 2000 (the user waits on the identify phase). |
| `LEASE_SECONDS` | no | Lease on a claimed check, default 120 (renewed every 40 s). |
| `MAX_RUN_MS` | no | Hard limit for one run, default 900000 (15 min); then it is retried. |
| `GATE_MODEL` | no | Default `claude-haiku-4-5-20251001`, as enrichment v2. |
| `SEARCH_COST_USD` | no | Estimated price of one search, for the cost log, default 0.001. |

## Railway

1. New Project → Deploy from GitHub repo (or GitLab) → this repository.
2. Service → Settings → **Config-as-code path**: `worker/railway.json`.
3. Service → Variables: the variables above.
4. Deploy. The log should show `[worker] … started`.

## Fly.io (from the repository root)

```sh
fly apps create alphamap-check-worker
fly secrets set --config worker/fly.toml SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… ANTHROPIC_API_KEY=… SERP_KEY=…
fly deploy --config worker/fly.toml --dockerfile worker/Dockerfile
```

## How a run is protected

- **Lock**: `claim_company_check` takes one check with `FOR UPDATE SKIP LOCKED`
  and a lease, so two workers never run the same check.
- **Heartbeat**: the lease is renewed while the run is alive; a worker that
  dies lets the lease expire and the check is picked up again.
- **Time limit**: a run past `MAX_RUN_MS` is abandoned and retried.
- **Controlled retry**: transient errors (network, rate limits, provider 5xx,
  timeouts) go back to the queue after 1, 4, 16 … minutes; at most
  `max_attempts` (3) attempts, then the check fails. Bad input fails at once.
- **Stale writes refused**: every write names the worker holding the lease; a
  run that lost its lease cannot overwrite the newer one.
- **Graceful stop**: SIGTERM finishes the current check, then exits.

Every run adds a row to `enrichment_runs` (`run_kind = 'on_demand'`) with its
duration, search calls, tokens and estimated cost.
