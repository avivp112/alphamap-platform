# AlphaMap check worker — build from the REPOSITORY ROOT:
#   docker build -f worker/Dockerfile .
# Fly.io:  fly deploy --config worker/fly.toml
# Railway: service → Settings → Config-as-code path = worker/railway.json
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Dependencies first, so code changes reuse this layer.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

# Only what the worker runs: the enrichment libraries and the worker itself.
COPY lib ./lib
COPY worker ./worker
COPY supabase/functions/_shared/check-limits.ts supabase/functions/_shared/company-check.ts ./supabase/functions/_shared/
COPY supabase/functions/sourcing-crawl/parse.ts ./supabase/functions/sourcing-crawl/
COPY tsconfig.json ./

# Not root.
RUN useradd --create-home --uid 10001 worker && chown -R worker /app
USER worker

CMD ["npx", "tsx", "worker/index.ts"]
