# Enrichment runner image — same image runs any Tier 2/3 script on a VM you
# control. Built for occasional/scheduled invocation, not a long-lived service.
#
# Build (from the repo root):
#   docker build -f infra/enrichment-runner/Dockerfile -t enrichment-runner .
#
# Run one script (env from your VM's .env — see .env.example):
#   docker run --rm --env-file .env enrichment-runner npx tsx scripts/bulk_enrich_all.ts
#
# Any script under scripts/ can be invoked the same way by changing the last
# argument — this image is intentionally generic rather than one-per-script.

FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENTRYPOINT ["npx"]
CMD ["tsx", "--help"]
