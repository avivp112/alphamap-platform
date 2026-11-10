/**
 * lib/enrichment/peopleCoverage.ts — how many companies have people (owner, 2026-11-10): at least one founder, a CEO, a
 * biography, a background — today on file, and with the values a review run found. Pure; scripts/people_coverage.ts reads the data.
 */
export interface PersonLite { name?: string; title?: string | null; role?: string | null; bio?: string | null; background?: unknown[] | null; group?: string | null }
export interface CompanyPeople { id: string; name: string; founders: PersonLite[]; leadership: PersonLite[] }

const isCeo = (p: PersonLite) => /\b(ceo|chief executive)\b/i.test(`${p.role ?? ""} ${p.title ?? ""}`);
export interface PeopleFlags { founder: boolean; ceo: boolean; bio: boolean; background: boolean }

export function flagsOf(c: CompanyPeople): PeopleFlags {
  const all = [...(c.founders ?? []), ...(c.leadership ?? []).filter((l) => l.group !== "board")];
  return {
    founder: (c.founders ?? []).some((f) => !!f.name),
    ceo: all.some(isCeo),
    bio: all.some((p) => !!p.bio?.trim()),
    background: (c.founders ?? []).some((f) => (f.background ?? []).length > 0),
  };
}

export function coverage(companies: CompanyPeople[]): { n: number } & Record<keyof PeopleFlags, number> {
  const out = { n: companies.length, founder: 0, ceo: 0, bio: 0, background: 0 };
  for (const c of companies) { const f = flagsOf(c); for (const k of ["founder", "ceo", "bio", "background"] as const) if (f[k]) out[k]++; }
  return out;
}

/** A run's values (field_review/run_N.csv rows: field, company_id, value) added to what is on file. */
export function withRunValues(onFile: CompanyPeople[], rows: Array<{ company_id: string; field: string; value: string }>): CompanyPeople[] {
  return onFile.map((c) => {
    const mine = rows.filter((r) => r.company_id === c.id);
    const founders = [...(c.founders ?? [])];
    const leadership = [...(c.leadership ?? [])];
    for (const r of mine) {
      const [name, rest = ""] = r.value.split(/\s+—\s+|:\s+/, 2);
      if (r.field === "founder" && !founders.some((f) => f.name === name)) founders.push({ name, title: rest });
      if (r.field === "leader" && !leadership.some((l) => l.name === name)) leadership.push({ name, role: rest.split(" · ")[0] });
      if (r.field === "founder_bio") { const f = founders.find((x) => x.name === name) ?? (founders.push({ name }), founders[founders.length - 1]); f.bio = rest; }
      if (r.field === "founder_background") { const f = founders.find((x) => x.name === name) ?? (founders.push({ name }), founders[founders.length - 1]); f.background = [...(f.background ?? []), {}]; }
    }
    return { ...c, founders, leadership };
  });
}
