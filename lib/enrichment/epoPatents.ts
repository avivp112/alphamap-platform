/**
 * lib/enrichment/epoPatents.ts — a company's patents come from the European
 * Patent Office's register only (owner, 2026-10-26).
 *
 * The 2026-10-26 run read patents off web pages and got them wrong in every
 * way a page allows: 1AHEAD got Snap's "Image based tracking in augmented
 * reality systems", AS0001 got US10169814B2 off a USPTO gazette page listing
 * thousands of patentees, BETA got patents from a PatSnap landscape blog,
 * Azumo got US11442213B2 linked to US20060061008A1. Web extraction of
 * patents is now off (extractMarket.ts asks for none); this is the only way
 * a patent reaches a company.
 *
 * EPO OPS serves DOCDB, its worldwide collection (US, EP, WO, ... — see
 * supabase/functions/ingest-epo-ops). A publication is the company's only when
 * one of its APPLICANTS (the owner / filer, as the register records it) is the
 * company: the same name once legal forms are set aside, and — when the
 * register gives the applicant's country and we know the company's — the same
 * country. The number, title and dates are the register's own, never a
 * page's. A name many companies share ("Apex", "Zero") is not looked up at
 * all: no patents is better than another company's patents.
 *
 * The pure parts (query, parsing, the applicant match) are tested in
 * epoPatents.test.ts; lookupEpoPatents() does the I/O and needs EPO_OPS_KEY /
 * EPO_OPS_SECRET (developers.epo.org — free; the same keys ingest-epo-ops uses).
 */

import { isDistinctiveName } from "./entity";
import { nameKey } from "./patents";

export interface EpoPublication {
  /** "US11442213B2" — country + number + kind, as the register writes it. */
  number: string;
  title: string | null;
  publicationDate: string | null;
  filingDate: string | null;
  familyId: string | null;
  /** Every applicant on the record, with the register's country tag when it gives one ("AZUMO INC [US]"). */
  applicants: Array<{ name: string; country: string | null }>;
}

export interface EpoPatent {
  title: string;
  patent_number: string;
  filing_date: string | null;
  url: string;
  source: "epo";
}

export interface EpoPatentResult {
  patents: EpoPatent[];
  /** Patent families the company is applicant on — the count shown on the profile; null when the register had more than was read. */
  familyCount: number | null;
  /** Publications the register returned for the name that belong to someone else. */
  rejected: Array<{ number: string; reason: EpoRejection }>;
}

export type EpoRejection = "epo_applicant_not_the_company" | "epo_applicant_other_country";

// ── OPS JSON (the same traps ingest-epo-ops documents) ───────────────────────

/** OPS collapses a one-element list into a bare object. */
function asArray<T = Record<string, unknown>>(v: unknown): T[] {
  if (v === null || v === undefined) return [];
  return (Array.isArray(v) ? v : [v]) as T[];
}

/** OPS wraps text as {"$": "value"}. */
function text(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && "$" in (v as Record<string, unknown>)) {
    const s = (v as Record<string, unknown>)["$"];
    return s == null ? null : String(s).trim() || null;
  }
  return null;
}

const opsDate = (d: string | null) => (d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null);

type Obj = Record<string, unknown>;
const docdbId = (ref: unknown) => {
  const ids = asArray<Obj>((ref as Obj)?.["document-id"]);
  return ids.find((d) => d?.["@document-id-type"] === "docdb") ?? ids[0];
};

/** "AZUMO INC [US]" → { name: "AZUMO INC", country: "US" }. */
export function splitApplicant(raw: string): { name: string; country: string | null } {
  const m = raw.match(/^(.*?)\s*\[([A-Z]{2})\]\s*$/);
  return m ? { name: m[1].trim(), country: m[2] } : { name: raw.trim(), country: null };
}

export function parseEpoDocument(doc: Obj): EpoPublication | null {
  const biblio = (doc?.["bibliographic-data"] ?? {}) as Obj;
  const pub = docdbId(biblio["publication-reference"]);
  const country = text(pub?.country) ?? text(doc?.["@country"]);
  const docNumber = text(pub?.["doc-number"]) ?? text(doc?.["@doc-number"]);
  const kind = text(pub?.kind) ?? text(doc?.["@kind"]);
  if (!country || !docNumber) return null;
  const app = docdbId(biblio["application-reference"]);
  const titles = asArray<Obj>(biblio["invention-title"]);
  const applicants: EpoPublication["applicants"] = [];
  for (const a of asArray<Obj>(((biblio.parties as Obj)?.applicants as Obj)?.applicant)) {
    const raw = text(((a?.["applicant-name"] as Obj) ?? {}).name);
    if (!raw) continue;
    const parsed = splitApplicant(raw);
    const same = applicants.find((x) => nameKey(x.name) === nameKey(parsed.name));
    if (same) same.country ??= parsed.country;   // epodoc and original forms of one applicant
    else applicants.push(parsed);
  }
  return {
    number: `${country}${docNumber}${kind ?? ""}`,
    title: text(titles.find((t) => t?.["@lang"] === "en") ?? titles[0]),
    publicationDate: opsDate(text(pub?.date)),
    filingDate: opsDate(text(app?.date)),
    familyId: text(doc?.["@family-id"]),
    applicants,
  };
}

export function parseEpoSearch(payload: unknown): { total: number; publications: EpoPublication[] } {
  const search = (((payload as Obj)?.["ops:world-patent-data"] as Obj)?.["ops:biblio-search"] ?? {}) as Obj;
  const total = Number(text(search["@total-result-count"]) ?? search["@total-result-count"] ?? 0) || 0;
  const docs = asArray<Obj>((search["ops:search-result"] as Obj)?.["exchange-documents"])
    .flatMap((d) => asArray<Obj>(d?.["exchange-document"]));
  return { total, publications: docs.map(parseEpoDocument).filter((p): p is EpoPublication => !!p) };
}

// ── Whose patent it is ───────────────────────────────────────────────────────

/** The CQL that asks the register for a company's publications as applicant. */
export function applicantQuery(companyName: string): string {
  const words = companyName.replace(/,/g, " ").replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|gmbh|plc|co)\b\.?/gi, " ")
    .replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
  return `pa="${words}"`;
}

const regionName = (() => {
  try { const d = new Intl.DisplayNames(["en"], { type: "region" }); return (code: string) => d.of(code) ?? null; } catch { return () => null; }
})();
const sameCountry = (code: string, country: string) => {
  const name = regionName(code);
  const n = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  return n(code) === n(country) || (!!name && n(name) === n(country));
};

export interface CompanyIdentity { name: string; aliases?: string[]; countries?: Array<string | null | undefined> }

/** null when an applicant on the record is this company; otherwise why the publication is someone else's. */
export function applicantMatch(pub: EpoPublication, company: CompanyIdentity): EpoRejection | null {
  const keys = new Set([company.name, ...(company.aliases ?? [])].map(nameKey).filter((k) => k.length >= 3));
  const named = pub.applicants.filter((a) => keys.has(nameKey(a.name)));
  if (named.length === 0) return "epo_applicant_not_the_company";
  const countries = (company.countries ?? []).filter((c): c is string => !!c);
  const tagged = named.filter((a) => a.country);
  if (countries.length && tagged.length && !tagged.some((a) => countries.some((c) => sameCountry(a.country!, c)))) return "epo_applicant_other_country";
  // No country on the applicant: the office it was filed at must fit — the
  // company's own country, or the US / European / international (PCT) route.
  // Zepto (India) got five Japanese publications of a Japanese "ZEPTO" (eval run, 2026-10-29).
  if (countries.length && !tagged.length) {
    const office = pub.number.slice(0, 2).toUpperCase();
    if (!["US", "EP", "WO"].includes(office) && !countries.some((c) => sameCountry(office, c))) return "epo_applicant_other_country";
  }
  return null;
}

export const espacenetUrl = (number: string) => `https://worldwide.espacenet.com/patent/search?q=pn%3D${encodeURIComponent(number)}`;

/** The register's publications reduced to the company's own, one per family (its latest publication). */
export function companyPatents(publications: EpoPublication[], company: CompanyIdentity): EpoPatentResult {
  const rejected: EpoPatentResult["rejected"] = [];
  const byFamily = new Map<string, EpoPublication>();
  for (const p of publications) {
    const why = applicantMatch(p, company);
    if (why) { rejected.push({ number: p.number, reason: why }); continue; }
    const family = p.familyId ?? p.number;
    const prev = byFamily.get(family);
    if (!prev || (p.publicationDate ?? "") > (prev.publicationDate ?? "")) byFamily.set(family, p);
  }
  const patents = [...byFamily.values()]
    .sort((a, b) => (b.publicationDate ?? "").localeCompare(a.publicationDate ?? ""))
    .map((p) => ({ title: p.title ?? p.number, patent_number: p.number, filing_date: p.filingDate, url: espacenetUrl(p.number), source: "epo" as const }));
  return { patents, familyCount: byFamily.size, rejected };
}

// ── Live lookup ──────────────────────────────────────────────────────────────

const AUTH_URL = "https://ops.epo.org/3.2/auth/accesstoken";
const SEARCH_URL = "https://ops.epo.org/3.2/rest-services/published-data/search/biblio";
const PAGE = 100;
const MAX_PUBLICATIONS = 400;

export interface EpoLookupOptions {
  key?: string; secret?: string;
  fetch?: typeof fetch;
}

let token: { value: string; expiresAt: number } | null = null;

async function opsToken(key: string, secret: string, f: typeof fetch): Promise<string> {
  if (token && Date.now() < token.expiresAt) return token.value;
  const res = await f(AUTH_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`EPO OPS auth HTTP ${res.status}`);
  const body = await res.json() as { access_token?: string };
  if (!body.access_token) throw new Error("EPO OPS auth returned no token");
  token = { value: body.access_token, expiresAt: Date.now() + 18 * 60_000 };
  return token.value;
}

/**
 * The company's patents from the register, or null when it was not looked up
 * (no EPO keys, or a name too common to look up safely) — null means
 * "unknown", never "none". Throws on an EPO failure, so a run never writes an
 * empty list because the register was down.
 */
export async function lookupEpoPatents(company: CompanyIdentity, opts: EpoLookupOptions = {}): Promise<EpoPatentResult | null> {
  if (!isDistinctiveName(company.name)) return null;
  const found = await searchEpoPublications(applicantQuery(company.name), opts);
  if (!found) return null;
  const result = companyPatents(found.publications, company);
  // A count from part of the register would be a wrong count.
  return found.complete ? result : { ...result, familyCount: null };
}

/**
 * Every publication the register returns for a CQL query, up to 400 — or null
 * without EPO keys. Also used to build the golden set's patents for a human
 * to judge (eval/patent_register_review.ts), apart from companyPatents()'s match.
 */
export async function searchEpoPublications(cql: string, opts: EpoLookupOptions = {}): Promise<{ publications: EpoPublication[]; total: number; complete: boolean } | null> {
  const key = opts.key ?? process.env.EPO_OPS_KEY?.trim();
  const secret = opts.secret ?? process.env.EPO_OPS_SECRET?.trim();
  if (!key || !secret) return null;
  const f = opts.fetch ?? fetch;
  const auth = await opsToken(key, secret, f);
  const q = new URLSearchParams({ q: cql }).toString();
  const publications: EpoPublication[] = [];
  let total = 0;
  for (let start = 1; start <= MAX_PUBLICATIONS; start += PAGE) {
    const res = await f(`${SEARCH_URL}?${q}&Range=${start}-${start + PAGE - 1}`, {
      headers: { Authorization: `Bearer ${auth}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    // OPS answers a search with no hits with 404.
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`EPO OPS search HTTP ${res.status}`);
    const page = parseEpoSearch(await res.json());
    total = page.total;
    publications.push(...page.publications);
    if (page.publications.length < PAGE || publications.length >= page.total) break;
  }
  return { publications, total, complete: publications.length >= total };
}
