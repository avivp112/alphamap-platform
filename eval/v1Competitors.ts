/**
 * eval/v1Competitors.ts — a sample of the competitors v1 wrote to the database, for the owner to mark
 * (owner, 2026-11-06): how precise v1's competitors are. Pure; eval/v1_competitors_sheet.ts reads the
 * database (a read, nothing run, no cost).
 *
 * The sample is uniform: every company with competitors has the same chance, so it is not the famous
 * ones; up to three competitors of a company, drawn at random, not the first three v1 listed.
 */
import type { SheetRow } from "./reviewSheet.ts";

export interface V1Company { id: string; name: string; website: string | null; competitors: Array<{ name?: string; website?: string | null; how_it_competes?: string | null }> | null }

export const V1_COMPETITOR_COLUMNS = ["company_id", "company", "website", "competitor", "how_it_competes", "competitor_website", "mark"] as const;

function shuffle<T>(xs: T[], seed: number): T[] {
  const out = [...xs]; let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function sampleV1Competitors(companies: V1Company[], opts: { size: number; perCompany: number; seed: number; skipIds?: Set<string> }): SheetRow[] {
  const eligible = companies.filter((c) => !opts.skipIds?.has(c.id) && (c.competitors ?? []).some((x) => x?.name?.trim()));
  const rows: SheetRow[] = [];
  for (const c of shuffle(eligible, opts.seed).slice(0, opts.size)) {
    const named = (c.competitors ?? []).filter((x) => x?.name?.trim());
    for (const x of shuffle(named, opts.seed + 7).slice(0, opts.perCompany)) {
      rows.push({ company_id: c.id, company: c.name, website: c.website ?? "", competitor: x.name!.trim(), how_it_competes: (x.how_it_competes ?? "").trim(), competitor_website: x.website ?? "", mark: "" });
    }
  }
  return rows;
}

/** Marked rows: how many y / n, and v1's precision on them. */
export function v1Precision(rows: SheetRow[]): { marked: number; right: number; wrong: number; share: number | null } {
  const yes = new Set(["y", "נכון", "yes", "כן"]), no = new Set(["n", "לא נכון", "no", "לא"]);
  const right = rows.filter((r) => yes.has((r.mark ?? "").trim().toLowerCase())).length;
  const wrong = rows.filter((r) => no.has((r.mark ?? "").trim().toLowerCase())).length;
  return { marked: right + wrong, right, wrong, share: right + wrong ? right / (right + wrong) : null };
}
