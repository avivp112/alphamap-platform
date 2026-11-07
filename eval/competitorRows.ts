/**
 * eval/competitorRows.ts — competitor rows for the review sheet from a stored run (owner, 2026-11-06):
 * the names v2 found for a company the golden set holds no competitor list for (Synthesia: HeyGen,
 * Colossyan, Veed), with their source and quote, for the owner to mark. Pure.
 */
import { competitorKey, type SheetRow } from "./reviewSheet.ts";

export function competitorRowsFromRun(companyId: string, companyName: string, sources: Array<{ name: string; source_url: string | null; quote: string | null }> | undefined, existing: SheetRow[]): SheetRow[] {
  const have = new Set(existing.map(competitorKey));
  const out: SheetRow[] = [];
  for (const c of sources ?? []) {
    const row: SheetRow = { company_id: companyId, company: companyName, competitor: c.name, source_url: c.source_url ?? "", quote: c.quote ?? "", mark: "" };
    if (have.has(competitorKey(row))) continue;
    have.add(competitorKey(row));
    out.push(row);
  }
  return out;
}
