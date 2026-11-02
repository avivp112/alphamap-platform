/**
 * lib/enrichment/registers.ts — the company registers as the preferred source
 * of founded year and founding country (owner, 2026-11-02):
 *
 *   UK      Companies House (search API, COMPANIES_HOUSE_API_KEY)
 *   Israel  the Registrar of Companies, open data on data.gov.il (no key)
 *   US      SEC Form D (EDGAR full-text search, SEC_USER_AGENT)
 *
 * A register counts only on a CERTAIN match between its entity and the
 * company — the name AND one more tie:
 *   - the same name (legal suffixes aside): the company number on the site,
 *     the registered city among the site's offices, a known founder among
 *     the register's people (UK officers, Form D related persons), or —
 *     UK — the registered postcode / — US — the issuer's street or ZIP on the site;
 *   - the name plus ONE generic word ("GUARDZ CYBER LTD" for Guardz — Cyber,
 *     Technologies, Labs, Security, AI…; owner, 2026-11-02): only a strong
 *     tie — a known founder among the people, the company number on the
 *     site, or the registered city among the site's offices.
 * A city alone, without the name, never counts. With a certain match the
 * register beats any article.
 *
 * Form D's year is the US entity's: an Israeli or European startup that set
 * up a Delaware parent later would get the wrong year and country. So Form D
 * counts only when no allowed source says the company was founded outside
 * the US.
 *
 * Network calls are injected (`fetchJson` / `fetchText`) so the matching is
 * tested offline; a lookup that fails is "no register", never an error.
 */

export interface RegisterFinding {
  register: "uk_companies_house" | "il_registrar" | "us_sec_form_d";
  entity: string;
  number: string;
  founded_year: number | null;
  founding_country: string;
  url: string;
  /** The register's own line, quoted as the evidence. */
  quote: string;
  /** Why the match is certain. */
  match: string;
}

export interface RegisterContext {
  name: string;
  /** The text of the company's own site pages (home, about, contact…). */
  siteText: string;
  /** Cities of the addresses / offices the company's own site gives. */
  siteCities: string[];
  /** The legal name its own legal pages give ("ID Ward Limited" for Anonymised): matched as the name too. */
  legalName?: string | null;
  /** Founders this run already knows (grounded): matched against the register's people. */
  founders?: string[];
  /** A founding country an allowed source states, if any (guards Form D). */
  statedFoundingCountry?: string | null;
}

export interface RegisterIo {
  fetchJson: (url: string, headers?: Record<string, string>) => Promise<unknown>;
  fetchText: (url: string, headers?: Record<string, string>) => Promise<string>;
  env?: Record<string, string | undefined>;
}

const SUFFIX = /\b(limited|ltd|plc|llp|inc|incorporated|corp|corporation|co|company|llc|l\.l\.c|gmbh|ag|sa|sas|bv|b\.v|בע"?מ|בעמ)\b\.?/gi;
/** "KETS QUANTUM SECURITY LTD" and "KETS Quantum Security" → "kets quantum security". */
export function legalName(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(SUFFIX, " ").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
}
/** Same name, legal suffixes aside. */
export function sameEntityName(a: string, b: string): boolean {
  const x = legalName(a), y = legalName(b);
  return x.length >= 2 && x === y;
}

/** Words a register name may add to the company's name (or the other way round) — with a strong tie only. */
export const GENERIC_WORDS = new Set(["cyber", "technologies", "technology", "tech", "labs", "lab", "security", "ai", "software", "systems", "solutions", "group", "holdings", "global", "digital", "data", "networks", "io", "hq"]);

/** "exact": the same name; "plus_one": one side adds one generic word ("GUARDZ CYBER LTD" / "Guardz"). */
export function nameMatch(registerName: string, companyName: string): "exact" | "plus_one" | null {
  const x = legalName(registerName), y = legalName(companyName);
  if (x.length < 2 || y.length < 2) return null;
  if (x === y) return "exact";
  const [long, short] = x.split(" ").length > y.split(" ").length ? [x.split(" "), y.split(" ")] : [y.split(" "), x.split(" ")];
  if (long.length !== short.length + 1) return null;
  for (let i = 0; i < long.length; i++) {
    if (GENERIC_WORDS.has(long[i]) && [...long.slice(0, i), ...long.slice(i + 1)].join(" ") === short.join(" ")) return "plus_one";
  }
  return null;
}

const personTokens = (n: string) => n.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").split(/\s+/).filter((t) => t.length > 1);
/** A known founder among the register's people: the founder's first and last names both in one person's name ("SHACHAR, Amiram"). */
export function founderAmong(founders: string[] | undefined, people: string[]): string | null {
  for (const f of founders ?? []) {
    const ft = personTokens(f);
    if (ft.length < 2) continue;
    const [first, last] = [ft[0], ft[ft.length - 1]];
    const hit = people.find((p) => { const pt = new Set(personTokens(p)); return pt.has(first) && pt.has(last); });
    if (hit) return `${f} (${hit})`;
  }
  return null;
}
/** The register's name against the company's name and its legal name; the better match wins. */
export function nameMatchAny(registerName: string, ctx: Pick<RegisterContext, "name" | "legalName">): "exact" | "plus_one" | null {
  const kinds = [ctx.name, ctx.legalName].filter((n): n is string => !!n).map((n) => nameMatch(registerName, n));
  return kinds.includes("exact") ? "exact" : kinds.includes("plus_one") ? "plus_one" : null;
}
const cityAmong = (city: string | null | undefined, cities: string[]) =>
  !!city && cities.some((c) => c.trim().toLowerCase() === city.trim().toLowerCase());

const digits = (s: string) => s.replace(/\D/g, "");
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");

// ── UK: Companies House ─────────────────────────────────────────────────────

interface ChItem { title?: string; company_number?: string; company_status?: string; date_of_creation?: string; address?: { postal_code?: string; locality?: string }; address_snippet?: string }

/** `officers`: company number → its officers' names (fetched for the candidates by name). */
export function matchCompaniesHouse(items: ChItem[], ctx: RegisterContext, officers: Record<string, string[]> = {}): RegisterFinding | null {
  const site = squash(ctx.siteText);
  for (const it of items) {
    const kind = it.title ? nameMatchAny(it.title, ctx) : null;
    if (!kind || !it.company_number || !it.date_of_creation) continue;
    if (it.company_status && /dissolved|converted|closed/i.test(it.company_status)) continue;
    const num = it.company_number.toLowerCase(), bare = num.replace(/^0+/, "");
    const postcode = it.address?.postal_code ? squash(it.address.postal_code) : "";
    const founder = founderAmong(ctx.founders, officers[it.company_number] ?? []);
    const tie = founder ? `a known founder is an officer: ${founder}`
      : site.includes(num) || (bare.length >= 6 && site.includes(bare)) ? `the site gives company number ${it.company_number}`
      : cityAmong(it.address?.locality, ctx.siteCities) ? `registered in ${it.address!.locality}, an office on the site`
      : kind === "exact" && postcode.length >= 5 && site.includes(postcode) ? `the site gives the registered postcode ${it.address!.postal_code}` : null;
    if (!tie) continue;
    return {
      register: "uk_companies_house", entity: it.title!, number: it.company_number,
      founded_year: Number(it.date_of_creation.slice(0, 4)) || null, founding_country: "United Kingdom",
      url: `https://find-and-update.company-information.service.gov.uk/company/${it.company_number}`,
      quote: `${it.title}, company number ${it.company_number}, incorporated on ${it.date_of_creation}${it.address_snippet ? `, registered office ${it.address_snippet}` : ""}`,
      match: `${kind === "exact" ? "same name" : "name plus one generic word"}; ${tie}`,
    };
  }
  return null;
}

async function lookupCompaniesHouse(ctx: RegisterContext, io: RegisterIo): Promise<RegisterFinding | null> {
  const key = io.env?.COMPANIES_HOUSE_API_KEY;
  if (!key) return null;
  const headers = { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
  const items: ChItem[] = [];
  for (const q of [ctx.name, ctx.legalName].filter((n): n is string => !!n)) {
    const res = await io.fetchJson(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(q)}&items_per_page=20`, headers) as { items?: ChItem[] };
    for (const it of res.items ?? []) if (!items.some((x) => x.company_number === it.company_number)) items.push(it);
  }
  // The officers of the candidates by name, when there is a founder to look for (three at most).
  const officers: Record<string, string[]> = {};
  if (ctx.founders?.length) {
    for (const it of items.filter((i) => i.title && i.company_number && nameMatchAny(i.title, ctx)).slice(0, 3)) {
      const o = await io.fetchJson(`https://api.company-information.service.gov.uk/company/${it.company_number}/officers?items_per_page=50`, headers).catch(() => null) as { items?: Array<{ name?: string }> } | null;
      officers[it.company_number!] = (o?.items ?? []).map((x) => x.name ?? "").filter(Boolean);
    }
  }
  return matchCompaniesHouse(items, ctx, officers);
}

// ── Israel: the Registrar of Companies on data.gov.il ───────────────────────

/** The registrar's "list of companies" resource (CKAN datastore). */
export const IL_REGISTRAR_RESOURCE = "f004176c-b85f-4542-8901-7b3176f9a054";

const IL_CITIES: Record<string, string> = {
  "תל אביב": "Tel Aviv", "תל אביב יפו": "Tel Aviv", "תל-אביב": "Tel Aviv", "ירושלים": "Jerusalem", "חיפה": "Haifa",
  "הרצליה": "Herzliya", "רמת גן": "Ramat Gan", "גבעתיים": "Givatayim", "באר שבע": "Beer Sheva", "רעננה": "Raanana",
  "בני ברק": "Bnei Brak", "פתח תקווה": "Petah Tikva", "פתח תקוה": "Petah Tikva", "רחובות": "Rehovot", "כפר סבא": "Kfar Saba",
  "הוד השרון": "Hod Hasharon", "יקנעם": "Yokneam", "יקנעם עילית": "Yokneam", "נתניה": "Netanya", "ראש העין": "Rosh Haayin",
  "קיסריה": "Caesarea", "מודיעין": "Modiin", "מודיעין מכבים רעות": "Modiin", "נצרת": "Nazareth", "חולון": "Holon",
  "ראשון לציון": "Rishon LeZion", "יהוד": "Yehud", "יהוד מונוסון": "Yehud", "אור יהודה": "Or Yehuda", "לוד": "Lod",
  "רמת השרון": "Ramat Hasharon", "כפר שמריהו": "Kfar Shmaryahu", "אשדוד": "Ashdod", "אשקלון": "Ashkelon", "עכו": "Acre",
};
const heCity = (s: string) => IL_CITIES[s.replace(/[-–]/g, " ").replace(/\s+/g, " ").trim()] ?? IL_CITIES[s.trim()] ?? null;
const field = (row: Record<string, unknown>, ...parts: string[]) => {
  const k = Object.keys(row).find((key) => parts.every((p) => key.includes(p)));
  return k == null || row[k] == null ? "" : String(row[k]).trim();
};

export function matchIlRegistrar(rows: Array<Record<string, unknown>>, ctx: RegisterContext): RegisterFinding | null {
  const siteDigits = digits(ctx.siteText);
  for (const row of rows) {
    const english = field(row, "אנגלית");
    const number = field(row, "מספר חברה");
    const incorporated = field(row, "התאגדות");
    const kind = english ? nameMatchAny(english, ctx) : null;
    if (!kind || !number) continue;
    if (/מחוק|פורק|מחוסל|dissolved/i.test(field(row, "סטטוס"))) continue;
    const city = heCity(field(row, "עיר"));
    // (The registrar's open data lists no directors: the people tie is UK / US only.)
    const tie = number.length >= 8 && siteDigits.includes(number) ? `the site gives company number ${number}`
      : cityAmong(city, ctx.siteCities) ? `registered in ${city}, an office on the site` : null;
    if (!tie) continue;
    const year = Number((incorporated.match(/\b(19|20)\d{2}\b/) ?? [])[0]) || null;
    return {
      register: "il_registrar", entity: english, number,
      founded_year: year, founding_country: "Israel",
      url: `https://data.gov.il/dataset/ica_companies/resource/${IL_REGISTRAR_RESOURCE}?q=${number}`,
      quote: `${english} (${field(row, "שם חברה")}), company number ${number}, incorporated ${incorporated}${city ? `, ${city}` : ""}`,
      match: `${kind === "exact" ? "same name" : "name plus one generic word"}; ${tie}`,
    };
  }
  return null;
}

async function lookupIlRegistrar(ctx: RegisterContext, io: RegisterIo): Promise<RegisterFinding | null> {
  const rows: Array<Record<string, unknown>> = [];
  for (const q of [ctx.name, ctx.legalName].filter((n): n is string => !!n)) {
    const res = await io.fetchJson(`https://data.gov.il/api/3/action/datastore_search?resource_id=${IL_REGISTRAR_RESOURCE}&q=${encodeURIComponent(legalName(q))}&limit=50`) as { result?: { records?: Array<Record<string, unknown>> } };
    rows.push(...(res.result?.records ?? []));
  }
  return matchIlRegistrar(rows, ctx);
}

// ── US: SEC Form D ──────────────────────────────────────────────────────────

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? null;

export interface FormDIssuer { entityName: string; cik: string; jurisdiction: string | null; year: number | null; street: string | null; city: string | null; zip: string | null; people: string[] }

export function parseFormDIssuer(xml: string): FormDIssuer | null {
  const issuer = tag(xml, "primaryIssuer");
  if (!issuer) return null;
  const name = tag(issuer, "entityName"), cik = tag(issuer, "cik");
  if (!name || !cik) return null;
  const address = tag(issuer, "issuerAddress") ?? "";
  const yearBlock = tag(issuer, "yearOfInc") ?? "";
  return {
    entityName: name, cik, jurisdiction: tag(issuer, "jurisdictionOfInc"),
    year: Number(tag(yearBlock, "value")) || null,
    street: tag(address, "street1"), city: tag(address, "city"), zip: tag(address, "zipCode"),
    people: [...(tag(xml, "relatedPersonsList") ?? "").matchAll(/<relatedPersonName>([\s\S]*?)<\/relatedPersonName>/g)]
      .map((m) => [tag(m[1], "firstName"), tag(m[1], "middleName"), tag(m[1], "lastName")].filter(Boolean).join(" ")).filter(Boolean),
  };
}

export function matchFormD(issuer: FormDIssuer, ctx: RegisterContext, url: string): RegisterFinding | null {
  const kind = nameMatchAny(issuer.entityName, ctx);
  if (!kind || !issuer.year) return null;
  if (ctx.statedFoundingCountry && !/united states|^us$|^usa$/i.test(ctx.statedFoundingCountry)) return null;
  const site = ctx.siteText.toLowerCase();
  const zip = issuer.zip?.slice(0, 5);
  const founder = founderAmong(ctx.founders, issuer.people);
  const tie = founder ? `a known founder is a related person: ${founder}`
    : cityAmong(issuer.city, ctx.siteCities) ? `the issuer is in ${issuer.city}, an office on the site`
    : kind === "exact" && issuer.street && issuer.street.length >= 6 && site.includes(issuer.street.toLowerCase()) ? `the site gives the issuer's street, ${issuer.street}`
    : kind === "exact" && zip && zip.length === 5 && new RegExp(`\\b${zip}\\b`).test(site) ? `the site gives the issuer's ZIP ${zip}` : null;
  if (!tie) return null;
  return {
    register: "us_sec_form_d", entity: issuer.entityName, number: issuer.cik,
    founded_year: issuer.year, founding_country: "United States", url,
    quote: `${issuer.entityName} (CIK ${issuer.cik}), incorporated ${issuer.year}${issuer.jurisdiction ? ` in ${issuer.jurisdiction}` : ""}, ${[issuer.street, issuer.city, issuer.zip].filter(Boolean).join(", ")}${founder ? `; related person ${founder}` : ""}`,
    match: `${kind === "exact" ? "same name" : "name plus one generic word"}; ${tie}`,
  };
}

async function lookupFormD(ctx: RegisterContext, io: RegisterIo): Promise<RegisterFinding | null> {
  const ua = io.env?.SEC_USER_AGENT;
  if (!ua) return null;
  const res = await io.fetchJson(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${legalName(ctx.name)}"`)}&forms=D`, { "User-Agent": ua }) as { hits?: { hits?: Array<{ _id?: string; _source?: { ciks?: string[]; adsh?: string } }> } };
  for (const h of (res.hits?.hits ?? []).slice(0, 5)) {
    const cik = h._source?.ciks?.[0]?.replace(/^0+/, ""), adsh = h._source?.adsh?.replace(/-/g, "");
    if (!cik || !adsh) continue;
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh}/primary_doc.xml`;
    const issuer = parseFormDIssuer(await io.fetchText(url, { "User-Agent": ua }));
    const found = issuer && matchFormD(issuer, ctx, url);
    if (found) return found;
  }
  return null;
}

/** Every register that knows the company for certain; failures are logged and skipped. */
export async function lookupRegisters(ctx: RegisterContext, io: RegisterIo, log: (m: string) => void = () => {}): Promise<RegisterFinding[]> {
  const out: RegisterFinding[] = [];
  for (const [label, fn] of [["Companies House", lookupCompaniesHouse], ["Israeli registrar", lookupIlRegistrar], ["SEC Form D", lookupFormD]] as const) {
    try { const f = await fn(ctx, io); if (f) out.push(f); }
    catch (e) { log(`${label} lookup failed (${e instanceof Error ? e.message : String(e)}) — skipped`); }
  }
  return out;
}

/** Node fetch wrappers with a timeout. */
export const nodeRegisterIo = (env: Record<string, string | undefined> = process.env): RegisterIo => ({
  env,
  fetchJson: async (url, headers) => {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  fetchText: async (url, headers) => {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  },
});
