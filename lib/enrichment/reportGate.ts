/**
 * lib/enrichment/reportGate.ts — what the report would drop or change, the write drops or changes too (owner, batch 6).
 * The wet run of batch 6 wrote Brighte "Other $40M", Ripio "Series A $1.9M", a patent of another company and a news item that does not name the company — all values the dry report had
 * already fixed or removed, because the row rules (rowRules.ts) ran on the report only. The report lines of a company are now run through the same rules BEFORE anything is written, and
 * the patch / the round plan follow: a dropped line is not written, a changed line (type → Unknown, lead investor taken out) is written as the report shows it.
 */
import { applyRowRules, type RowLike } from "./rowRules.ts";

export interface GateLine { field: string; after: unknown; source_url?: string | null; quote?: string | null; payload?: unknown }
export interface GateResult { drop: Set<number>; after: Map<number, string>; /** why each dropped or changed line was (the rules' own words) */ reasons: string[]; /** lines whose quote / source the rules replaced (a round's type taken from another source of the same event) */ cited: Map<number, { quote: string; source_url: string }> }

/** The indexes of the lines the rules drop, and the new text of the ones they change. */
export function gateLines(lines: GateLine[], companyName: string, today: string, o: { domain?: string | null } = {}): GateResult {
  const rows = lines.map((l, i) => ({ field: l.field, after: typeof l.after === "string" ? l.after : JSON.stringify(l.after), source_url: l.source_url ?? "", quote: l.quote ?? "", company: companyName, payload: l.payload ? JSON.stringify(l.payload) : undefined, _i: i }));
  // applyRowRules edits rows in place (type, lead): keep the first text of each to see the change.
  const before = new Map(rows.map((r) => [r._i, r.after]));
  const cites = new Map(rows.map((r) => [r._i, `${r.quote}|${r.source_url}`]));
  const { rows: kept, dropped } = applyRowRules(rows as unknown as Array<RowLike & { _i: number }>, companyName, today, o);
  const keptIdx = new Set(kept.map((r) => r._i));
  const drop = new Set<number>(); const after = new Map<number, string>();
  rows.forEach((r) => { if (!keptIdx.has(r._i)) drop.add(r._i); });
  for (const r of kept) if (r.after !== before.get(r._i)) after.set(r._i, r.after);
  const cited = new Map<number, { quote: string; source_url: string }>();
  for (const r of kept) if (`${r.quote ?? ""}|${r.source_url ?? ""}` !== cites.get(r._i)) cited.set(r._i, { quote: r.quote ?? "", source_url: r.source_url ?? "" });
  return { drop, after, reasons: dropped, cited };
}

/** "Series A $4M · 2017-09-05 · lead X" → the parts the plan keeps. */
export function parseRoundLine(after: string): { type: string; lead: string | null } {
  const type = after.match(/^\s*(.*?)\s+(?:\$[\d.,]+[KMB]?|amount not disclosed)\b/i)?.[1]?.trim() ?? "";
  const lead = after.match(/·\s*lead\s+(.+?)\s*$/i)?.[1]?.trim() ?? null;
  return { type, lead };
}

/**
 * A report line "city, country" that the rules dropped takes that office out of the patch, and only that office (owner, batch 7: Hibank — the dropped "Jakarta Selatan" took the whole offices column,
 * "Jakarta" with it, while the report kept "Jakarta" and the database check found it missing).
 */
export function pruneOfficeFromPatch(patch: Record<string, unknown>, lineText: string): void {
  const key = (o: { city?: string; country?: string | null }) => [o.city, o.country].filter(Boolean).join(", ").toLowerCase();
  if (!Array.isArray(patch.offices)) return;
  const left = (patch.offices as Array<{ city?: string; country?: string | null }>).filter((o) => key(o) !== lineText.trim().toLowerCase());
  if (!left.length) { delete patch.offices; delete patch.office_countries; return; }
  patch.offices = left;
  patch.office_countries = [...new Set(left.map((o) => o.country).filter((c): c is string => !!c))];
}
