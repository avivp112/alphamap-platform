/**
 * lib/enrichment/audit.ts — the post-write audit (owner, 2026-11-20): after each batch 50 values of the core fields, 25 completely random (the real accuracy) and 25 aimed at hard cases (the kinds of error).
 * Pure functions: the draw, the field_audit.json counts, the decision per field, the pilot visibility. The scripts do the files and the database.
 */
import { CORE_FIELDS, PILOT_MIN_AUDITED, REQUIRED_ACCURACY, TARGETED_MAX_ERROR_COMPANIES, familyOfField, tierOf } from "./tiers.ts";

export interface AuditRow { company: string; company_id: string; field: string; value: string; source_url: string; quote: string; rule?: string }
export interface Drawn extends AuditRow { n: number; kind: "random" | "targeted" }
export type FieldAudit = Record<string, { audited: number; wrong: number; batches: Record<string, { audited: number; wrong: number }> }>;

/** A small seeded generator, so a draw can be reproduced from the batch number. */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
const OWN = (url: string, company: string) => { try { const h = new URL(url.startsWith("http") ? url : `https://${url}`).hostname; const b = fold(company).slice(0, 5); return b.length >= 3 && fold(h).includes(b); } catch { return false; } };

/** How hard a value looks: what an error would hide behind. */
export function hardness(r: AuditRow): number {
  const f = familyOfField(r.field);
  let s = 0;
  if (r.rule) s += 2;                                                   // a rule changed or made it
  if (f === "acquired") s += 2;
  if (f === "round" && /\bUnknown\b|\bOther\b|month only|amount not disclosed/i.test(r.value)) s += 2;
  if (f === "round" && /\blead\b/i.test(r.value)) s += 1;
  if ((f === "hq_city" || f === "hq_country" || f === "founded_year") && r.source_url && !OWN(r.source_url, r.company)) s += 1;   // a press statement, not the company's own page
  if (f === "founder" && /co-?found/i.test(r.value)) s += 1;
  if (!r.quote || r.quote.trim().length < 40) s += 1;
  if (!r.source_url) s += 2;
  return s;
}

/** 25 random + 25 aimed at hard cases (the hardest first, at most two per company, none already drawn). */
export function draw(rows: AuditRow[], batch: number, perKind = 25): Drawn[] {
  const core = rows.filter((r) => CORE_FIELDS.includes(familyOfField(r.field)) && r.value.trim());
  const rand = rng(batch * 7919 + 13), key = (r: AuditRow) => `${r.company_id}|${r.field}|${r.value}`;
  const shuffled = [...core].map((r) => ({ r, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.r);
  const random = shuffled.slice(0, perKind);
  const taken = new Set(random.map(key));
  // Every acquired value of the batch is in the targeted sample (owner, 2026-11-24: Aperio, Phenom and Rubicon Carbon were wrong purchases that reached a batch); the hardest of the rest fill it up to `perKind`.
  const acquired = core.filter((r) => familyOfField(r.field) === "acquired" && !taken.has(key(r)));
  const accKeys = new Set(acquired.map(key));
  const perCompany = new Map<string, number>();
  const others = core.filter((r) => !taken.has(key(r)) && !accKeys.has(key(r))).map((r, i) => ({ r, h: hardness(r), i })).sort((a, b) => b.h - a.h || a.i - b.i)
    .filter(({ r }) => { const n = perCompany.get(r.company_id) ?? 0; if (n >= 2) return false; perCompany.set(r.company_id, n + 1); return true; }).slice(0, Math.max(0, perKind - acquired.length)).map((x) => x.r);
  const targeted = [...acquired, ...others];
  return [...random.map((r) => ({ ...r, kind: "random" as const })), ...targeted.map((r) => ({ ...r, kind: "targeted" as const }))].map((r, i) => ({ ...r, n: i + 1 }));
}

export interface FieldVerdict { field: string; tier: 1 | 2; randomAudited: number; randomWrong: number; targetedWrongCompanies: number; undo: boolean; why: string }
/** Per field of this batch's audit: undo the field when the targeted sample has errors in more than 5 companies, or when the cumulative random accuracy is under the tier's bar. */
export function decide(drawn: Drawn[], wrong: Set<number>, cumulative: FieldAudit, minToDecide = 20): FieldVerdict[] {
  const fields = [...new Set(drawn.map((d) => familyOfField(d.field)))];
  return fields.map((field) => {
    const tier = tierOf(field) as 1 | 2;
    const mine = drawn.filter((d) => familyOfField(d.field) === field);
    const rA = mine.filter((d) => d.kind === "random"), rW = rA.filter((d) => wrong.has(d.n));
    const tComp = new Set(mine.filter((d) => d.kind === "targeted" && wrong.has(d.n)).map((d) => d.company_id));
    const c = cumulative[field] ?? { audited: 0, wrong: 0, batches: {} };
    const acc = c.audited ? 1 - c.wrong / c.audited : 1;
    const reasons: string[] = [];
    if (tComp.size > TARGETED_MAX_ERROR_COMPANIES) reasons.push(`errors in ${tComp.size} companies of the targeted sample (more than ${TARGETED_MAX_ERROR_COMPANIES})`);
    if (c.audited >= minToDecide && acc < REQUIRED_ACCURACY[tier]) reasons.push(`random accuracy ${(acc * 100).toFixed(1)}% over ${c.audited} values is under ${REQUIRED_ACCURACY[tier] * 100}%`);
    return { field, tier, randomAudited: rA.length, randomWrong: rW.length, targetedWrongCompanies: tComp.size, undo: reasons.length > 0, why: reasons.join("; ") };
  });
}

/** Adds this batch's random audit to the cumulative counts (a batch is counted once: its entry is replaced). */
export function accumulate(cum: FieldAudit, batch: number, drawn: Drawn[], wrong: Set<number>): FieldAudit {
  const out: FieldAudit = JSON.parse(JSON.stringify(cum));
  for (const f of Object.keys(out)) { const b = out[f].batches[String(batch)]; if (b) { out[f].audited -= b.audited; out[f].wrong -= b.wrong; delete out[f].batches[String(batch)]; } }
  for (const d of drawn.filter((x) => x.kind === "random")) {
    const f = familyOfField(d.field), e = out[f] ?? (out[f] = { audited: 0, wrong: 0, batches: {} });
    const b = e.batches[String(batch)] ?? (e.batches[String(batch)] = { audited: 0, wrong: 0 });
    b.audited++; e.audited++;
    if (wrong.has(d.n)) { b.wrong++; e.wrong++; }
  }
  return out;
}

/** A core field is shown in the pilot only after PILOT_MIN_AUDITED random values with accuracy above its tier's bar. */
export function pilotVisible(field: string, cum: FieldAudit): { visible: boolean; audited: number; wrong: number; accuracy: number | null } {
  const tier = tierOf(field); const c = cum[field] ?? { audited: 0, wrong: 0 };
  const accuracy = c.audited ? 1 - c.wrong / c.audited : null;
  return { visible: (tier === 1 || tier === 2) && c.audited >= PILOT_MIN_AUDITED && accuracy !== null && accuracy > REQUIRED_ACCURACY[tier], audited: c.audited, wrong: c.wrong, accuracy };
}
