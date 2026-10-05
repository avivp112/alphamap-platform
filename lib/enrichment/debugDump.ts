/**
 * lib/enrichment/debugDump.ts — diagnostic-only, no-op unless
 * DEBUG_DUMP_RAW=true. v2's equivalent of v1's own private debugDumpJson
 * (scripts/bulk_enrich_all.ts), which v2 never had despite needing it more:
 * a real DRY_RUN=false run on GetYourGuide (a heavily publicly-funded,
 * well-documented company) came back with zero funding rounds despite the
 * funding extraction call generating substantial output -- meaning either
 * the search genuinely never surfaced its funding history this run, or the
 * model found something and evidence.ts correctly rejected an unverifiable
 * citation. VERBOSE's run-summary view can't distinguish those two cases;
 * this can, by writing out exactly what each extraction call actually SAW
 * (the labeled sources) and SAID (the raw tool_use input, before
 * verification strips anything).
 *
 * Writes to the same eval/debug/ directory v1 uses, same naming
 * convention (slugified company name + a label), so both pipelines' dumps
 * sit side by side and are trivially diffable.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

export function debugDumpJson(companyName: string, label: string, data: unknown): void {
  if (process.env.DEBUG_DUMP_RAW !== "true") return;
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const dir = join(__dir, "..", "..", "eval", "debug");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slug}_${label}.json`), JSON.stringify(data, null, 2));
}
