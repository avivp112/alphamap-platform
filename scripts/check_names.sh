#!/usr/bin/env bash
# Undefined names in the enrichment code (the app's tsc does not cover lib/ or scripts/): a ReferenceError there surfaces only in a live run (Mastertrust, batch 6).
set -e
cat > tsconfig.names.tmp.json <<'J'
{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler","allowImportingTsExtensions":true,"noEmit":true,"skipLibCheck":true,"types":["node"],"strict":false},
 "include":["lib/enrichment/*.ts","scripts/bulk_enrich_v2.ts","scripts/report_lint.ts","scripts/verify_written.ts","scripts/retry_failed.ts","scripts/undo_run.ts","scripts/regression.ts","scripts/sample_verdicts.ts","scripts/rejected_review.ts","scripts/show_report.ts","scripts/show_company.ts"],"exclude":["**/*.test.ts"]}
J
out=$(npx tsc -p tsconfig.names.tmp.json 2>&1 | grep -E "TS2304|TS2552|TS2551" || true)
rm -f tsconfig.names.tmp.json
if [ -n "$out" ]; then echo "$out"; echo "⛔ undefined names"; exit 1; fi
echo "✅ no undefined names"
