# AlphaMap check worker — build from the REPOSITORY ROOT:
#   docker build -f worker/Dockerfile .
# Fly.io:  fly deploy --config worker/fly.toml
# Railway: service → Settings → Config-as-code path = worker/railway.json
FROM node:22-slim

# Not root. The user exists before anything is copied, so the code is copied
# as its own (--chown) instead of a `chown -R /app` over node_modules on every
# deploy — that step took 16 minutes and timed the builder out on 2026-11-01.
RUN useradd --create-home --uid 10001 worker
WORKDIR /app
ENV NODE_ENV=production

# Dependencies first, so code changes reuse this layer.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

# Only what the worker runs: the enrichment libraries and the worker itself.
COPY --chown=worker lib ./lib
COPY --chown=worker worker ./worker
COPY supabase/functions/_shared/check-limits.ts supabase/functions/_shared/company-check.ts ./supabase/functions/_shared/
COPY supabase/functions/sourcing-crawl/parse.ts ./supabase/functions/sourcing-crawl/
COPY supabase/functions/_shared/crawl-policy.ts ./supabase/functions/_shared/
COPY --chown=worker tsconfig.json ./
# The golden-set evaluation can run here too, writing nothing to the database:
#   fly ssh console -a alphamap-check-worker -C "sh -c 'cd /app && PIPELINE=v2 npx tsx eval/run_eval.ts'"
COPY --chown=worker eval ./eval
COPY --chown=worker scripts ./scripts

# /app itself is writable (the eval's cache/ and results); node_modules stays root's, read-only.
RUN chown worker /app
USER worker

CMD ["npx", "tsx", "worker/index.ts"]
