#!/usr/bin/env bash
# Deploys the sourcing-pipeline Edge Functions to Supabase and reports which
# of their secrets are missing. Run on the runner, from the repo:
#
#   ./scripts/deploy_functions.sh            # deploy all 11 + check secrets
#   ./scripts/deploy_functions.sh --check    # only check secrets, deploy nothing
#
# Needs a Supabase personal access token (https://supabase.com/dashboard/account/tokens)
# in SUPABASE_ACCESS_TOKEN — exported in the shell, or as a line in .env.
# The project is read from SUPABASE_URL in .env (https://<project-ref>.supabase.co),
# or from SUPABASE_PROJECT_REF.
#
# Bundling happens on Supabase's side (--use-api), so Docker is not needed.
set -euo pipefail
cd "$(dirname "$0")/.."

env_value() { [ -f .env ] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true; }

SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-$(env_value SUPABASE_ACCESS_TOKEN)}"
SUPABASE_URL="${SUPABASE_URL:-$(env_value SUPABASE_URL)}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-$(printf '%s' "$SUPABASE_URL" | sed -nE 's#^https://([a-z0-9]+)\.supabase\.co.*#\1#p')}"

if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "✗ SUPABASE_ACCESS_TOKEN is not set."
  echo "  Create one at https://supabase.com/dashboard/account/tokens, then either"
  echo "    export SUPABASE_ACCESS_TOKEN=sbp_...   (this shell only)"
  echo "  or add the line SUPABASE_ACCESS_TOKEN=sbp_... to .env"
  exit 1
fi
if [ -z "$PROJECT_REF" ]; then
  echo "✗ Could not find the project: set SUPABASE_URL in .env or export SUPABASE_PROJECT_REF."
  exit 1
fi
export SUPABASE_ACCESS_TOKEN

CLI="npx --yes supabase@2.120.0"
FUNCTIONS=(
  ingest-sec-form-d ingest-uk-companies-house ingest-epo-ops ingest-uspto-patents
  ingest-github-velocity ingest-huggingface
  sourcing-crawl discover-boards extract-job-signals
  backfill-embeddings pipeline-health
)

echo "▶ Project: $PROJECT_REF"

if [ "${1:-}" != "--check" ]; then
  failed=()
  for fn in "${FUNCTIONS[@]}"; do
    echo
    echo "▶ Deploying $fn"
    ok=false
    for attempt in 1 2 3; do
      if $CLI functions deploy "$fn" --project-ref "$PROJECT_REF" --no-verify-jwt --use-api; then ok=true; break; fi
      echo "  attempt $attempt failed — retrying in 5s"
      sleep 5
    done
    $ok || failed+=("$fn")
  done
  echo
  if [ ${#failed[@]} -eq 0 ]; then
    echo "✓ All ${#FUNCTIONS[@]} functions deployed."
  else
    echo "✗ Not deployed: ${failed[*]}"
  fi
fi

# ── Secrets each function needs ───────────────────────────────────────────────
echo
echo "▶ Edge Function secrets on the project:"
SECRETS="$($CLI secrets list --project-ref "$PROJECT_REF" 2>/dev/null || true)"
check() {  # name, purpose, required|optional
  if printf '%s\n' "$SECRETS" | grep -qE "(^|[[:space:]|])$1([[:space:]|]|$)"; then
    echo "  ✓ $1"
  elif [ "$3" = required ]; then
    echo "  ✗ $1 — MISSING ($2)"
  else
    echo "  · $1 — not set, optional ($2)"
  fi
}
check SEC_USER_AGENT          "SEC Form D: 'AlphaMap sourcing you@domain.com'"       required
check COMPANIES_HOUSE_API_KEY "UK Companies House"                                    required
check EPO_OPS_KEY             "EPO patents"                                           required
check EPO_OPS_SECRET          "EPO patents"                                           required
check GITHUB_TOKEN            "GitHub — a classic token with no scopes"               required
check RUNPOD_TEI_URL          "embeddings + the daily health check"                   required
check HUGGINGFACE_TOKEN       "Hugging Face — only raises rate limits"                optional
check RESEND_API_KEY          "email alerts; without it alerts go to the bell only"   optional
check RUNPOD_TEI_KEY          "only if the TEI server has its own auth"               optional
echo
echo "Set a secret:  $CLI secrets set NAME=value --project-ref $PROJECT_REF"
echo "(or Supabase Dashboard → Edge Functions → Secrets)"
