/**
 * lib/enrichment/writtenCheck.ts — is every value of the report in the database? (owner, batch 6)
 * The report and the write were compared with each other, never with the database, and seven values the reviewed report held were not in it. This takes the report's rows and the
 * rows of the database and says, for each report row, whether the database holds it. Pure.
 */
export interface ReportRow { company_id: string; company: string; field: string; after: string; source_url?: string }
export interface DbCompany {
  id: string; city?: string | null; country?: string | null; founded_year?: number | null; founding_country?: string | null; employee_range?: string | null; employee_count?: number | null;
  description?: string | null; industry?: string | null; offices?: unknown; founders?: unknown; leadership?: unknown; competitors?: unknown; news?: unknown; patents?: unknown; status?: string | null; acquired_by?: string | null; exit_date?: string | null;
  rounds: Array<{ round_type: string | null; amount_raised: number | null; announcement_date: string | null }>;
  headcount: Array<{ employee_count: number; snapshot_date: string }>;
}
export type Written = "yes" | "no" | "not_checked";

const low = (x: unknown) => JSON.stringify(x ?? "").toLowerCase();
const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function isWritten(r: ReportRow, c: DbCompany | undefined): Written {
  if (!c) return "no";
  const a = r.after.trim();
  switch (r.field) {
    case "hq_city": return fold(c.city ?? "") === fold(a) ? "yes" : "no";
    case "hq_country": return fold(c.country ?? "") === fold(a) ? "yes" : "no";
    case "founded_year": return String(c.founded_year ?? "") === a ? "yes" : "no";
    case "founding_country": return fold(c.founding_country ?? "") === fold(a) ? "yes" : "no";
    case "employee_range": return (c.employee_range ?? "") === a ? "yes" : "no";
    case "employee_count": return String(c.employee_count ?? "").replace(/\+$/, "") === a.replace(/\+$/, "") ? "yes" : "no";
    case "description": case "description_what_only": return fold(c.description ?? "").startsWith(fold(a).slice(0, 60)) ? "yes" : "no";
    case "sector": return fold(c.industry ?? "") === fold(a.replace(/\s*\(industry:[^)]*\)\s*$/, "")) || low(c.industry).includes(fold(a.split("(")[0]).slice(0, 12)) ? "yes" : "no";
    case "office": return low(c.offices).includes(a.split(",")[0].trim().toLowerCase()) ? "yes" : "no";
    case "founder": case "founder_bio": return low(c.founders).includes(a.split(" — ")[0].split(":")[0].trim().toLowerCase()) ? "yes" : "no";
    case "leader": case "board": return low(c.leadership).includes(a.split(" — ")[0].trim().toLowerCase()) ? "yes" : "no";
    case "competitor_declared": case "competitor_market": return low(c.competitors).includes(a.trim().toLowerCase()) ? "yes" : "no";
    case "news": return r.source_url && low(c.news).includes((r.source_url ?? "").toLowerCase().replace(/[?#].*$/, "").slice(0, 60)) ? "yes" : "no";
    case "patent": return low(c.patents).includes(a.split(/\s+/)[0].toLowerCase()) ? "yes" : "no";
    case "round": {
      const m = a.match(/^(.*?)\s+(?:\$([\d.,]+)([KMB])?|amount not disclosed)\s*(?:·\s*(\d{4}(?:-\d{2}(?:-\d{2})?)?))?/i);
      if (!m) return "not_checked";
      const mult = m[3] === "B" ? 1e9 : m[3] === "K" ? 1e3 : 1e6;
      const amount = m[2] ? Number(m[2].replace(/,/g, "")) * mult : null;
      return c.rounds.some((x) => (amount == null ? x.amount_raised == null : Math.abs((x.amount_raised ?? 0) - amount) <= Math.max(1, amount * 0.001)) && (!m[4] || (x.announcement_date ?? "").startsWith(m[4].slice(0, 4)))) ? "yes" : "no";
    }
    case "headcount_history": {
      const m = a.match(/^(\d+)\+?\s+on\s+(\d{4}-\d{2}-\d{2})/);
      return m ? (c.headcount.some((h) => h.snapshot_date === m[2] && h.employee_count === Number(m[1])) ? "yes" : "no") : "not_checked";
    }
    case "acquired": {
      // status, buyer and date, each against its column (owner, 2026-11-19: batch 7's purchases were in the report and the columns still said "active", with nothing to say so).
      const m = a.match(/^status = (\w+)(?: · (?:Acquired by (.+?)|Closed) \(([^)]*)\))?\s*$/);
      if (!m) return "no";
      const sameBuyer = (x: string, y: string) => fold(x) === fold(y);
      return c.status === m[1] && (!m[2] || sameBuyer(c.acquired_by ?? "", m[2])) && (!m[3] || m[3] === "undated" || (c.exit_date ?? "").slice(0, 10) === m[3]) ? "yes" : "no";
    }
    default: return "not_checked";   // tags, founder_background, name/website proposals: not a column of the company
  }
}

export function checkWritten(rows: ReportRow[], db: Map<string, DbCompany>): { missing: ReportRow[]; checked: number; notChecked: number } {
  const missing: ReportRow[] = []; let checked = 0, notChecked = 0;
  for (const r of rows) {
    if (!r.field || r.field === "(nothing)") continue;
    const w = isWritten(r, db.get(r.company_id));
    if (w === "not_checked") { notChecked++; continue; }
    checked++;
    if (w === "no") missing.push(r);
  }
  return { missing, checked, notChecked };
}
