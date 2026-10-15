// =============================================================================
// Company quality gate — what a government record is allowed to become.
//
// Before this, every UK incorporation and every EPO patent applicant the
// ingesters saw became a startups row (200/200 UK and 72/87 EPO filings in the
// 60 days to 2026-10-15): one-director contractor companies, holding and
// consultancy shells, Disney, GM, Google DeepMind, private inventors.
//
// Three outcomes, decided per record:
//   reject — never becomes a company or a candidate; the reasons are kept on
//            the raw filing so the rules can be audited and recalibrated.
//   queue  — a candidate for the admin review queue, NO user alert (a source
//            whose records cannot be judged automatically: patent applicants).
//   alert  — a candidate for the review queue AND an immediate user alert.
//            Only where the rules can be trusted without a human: a Form D is
//            a company actually raising money; a UK incorporation with a
//            founding team, product SIC codes and no shell markers.
//
// "Missing is better than wrong": every rule rejects on doubt. A real solo
// founder in the UK is lost here until a second signal (a share allotment,
// a website, a GitHub org) can bring them back.
//
// Pure — no Deno, no network — so the ingesters, vitest and the report
// script (scripts/gate_report.ts) all run the same code.
// =============================================================================

export type GateTier = "reject" | "queue" | "alert";

export interface GateResult {
  tier: GateTier;
  /** Every rule that failed, not just the first — a reject should explain itself fully. */
  reasons: string[];
}

const verdict = (reasons: string[], passTier: Exclude<GateTier, "reject">): GateResult =>
  reasons.length > 0 ? { tier: "reject", reasons } : { tier: passTier, reasons: [] };

// ── UK Companies House ──────────────────────────────────────────────────────

/** Tech SIC codes that describe a product company (software, data, platforms, R&D, hardware, telecoms). */
export const UK_PRODUCT_SIC = new Set([
  "62011", "62012",            // software publishing / development
  "63110", "63120",            // data processing, hosting; web portals
  "72110", "72190",            // R&D: biotech; natural sciences & engineering
  "26110", "26120", "26200", "26301", "26511", // electronics & hardware
  "61100", "61200", "61900",   // telecoms
]);

/** Tech SIC codes that, on their own, describe a services business — usually an IT contractor's company. */
export const UK_SERVICE_SIC = new Set(["62020", "62030", "62090", "63990"]);

/**
 * SIC codes that mark a non-startup whatever else is declared alongside them.
 * Whole sectors, not single codes: the 2026-10-15 run let through a grain
 * wholesaler, a mushroom-food maker, a travel agency and an ad agency that
 * had each added 62012 to their list. First match labels the reason.
 */
const UK_BLOCKED_SIC: Array<[RegExp, string]> = [
  [/^6420[1-9]$/, "holding company"],          // 64201–64209 holding companies
  [/^643\d\d$/, "investment vehicle"],         // trusts, funds, venture & development capital
  [/^64999$/, "financial intermediation"],
  [/^66300$/, "fund management"],
  [/^68\d{3}$/, "real estate"],
  [/^70100$/, "head office"],
  [/^7021\d$/, "public relations"],
  [/^7022\d$/, "management consultancy"],
  [/^78\d{3}$/, "recruitment / staffing"],
  [/^82990$/, "business support services"],
  [/^47910$/, "online retail"],
  [/^0[1-3]\d{3}$/, "agriculture / fishing"],
  [/^1[0-2]\d{3}$/, "food & drink manufacturing"],
  [/^4[1-3]\d{3}$/, "construction"],
  [/^4[5-7]\d{3}$/, "wholesale / retail trade"],
  [/^5[56]\d{3}$/, "hospitality"],
  [/^581\d\d$/, "print publishing"],          // books, newspapers, journals — 582xx software publishing stays
  [/^731\d\d$/, "advertising"],
  [/^77\d{3}$/, "rental & leasing"],
  [/^79\d{3}$/, "travel"],
  [/^81\d{3}$/, "building services"],
  [/^85[56]\d\d$/, "tutoring / training"],
  [/^9[0-3]\d{3}$/, "arts / sport / leisure"],
  [/^9[4-9]\d{3}$/, "personal & household services"],
];

/** Name words that mark a shell, a consultancy or a non-company. Whole words only. */
const UK_BLOCKED_NAME =
  /\b(holdings?|group|ventures?|family|consult\w*|strateg(?:y|ies|ic)|partners(?:hip)?|foundation|charit\w*|trust(?:ees?)?|nominees?|propert(?:y|ies)|investments?|capital|recruit\w*|staffing|contract(?:ing|ors?)|services?|agency|accountan\w*|solicitors?|lettings?|estates?)\b/i;

/** Company types that can be a venture-backable startup. Everything else (LLP, guarantee/no share capital, partnerships, charities) is not. */
const UK_ALLOWED_TYPES = new Set(["ltd", "private-unlimited", "plc", "private-unlimited-nsc"]);

export interface UkCompanyInput {
  name: string;
  sicCodes: string[];
  /** Companies House company_type, e.g. "ltd", "llp", "private-limited-guarant-nsc". */
  companyType: string | null;
  /** Current officers as stored by the ingester: { name, relationships: [officer_role] }. */
  officers: Array<{ name?: string; relationships?: string[] }> | null;
}

/** Natural-person directors: role contains "director", but not a corporate or nominee director. */
export function countDirectors(officers: UkCompanyInput["officers"]): number {
  return (officers ?? []).filter((o) => {
    const roles = (o?.relationships ?? []).join(" ").toLowerCase();
    return /director/.test(roles) && !/corporate|nominee/.test(roles);
  }).length;
}

export function gateUkCompany(c: UkCompanyInput): GateResult {
  const reasons: string[] = [];
  const codes = (c.sicCodes ?? []).map((s) => String(s).trim()).filter(Boolean);

  if (!c.companyType || !UK_ALLOWED_TYPES.has(c.companyType.toLowerCase())) {
    reasons.push(`company_type:${c.companyType ?? "unknown"}`);
  }
  if (!codes.some((s) => UK_PRODUCT_SIC.has(s))) {
    reasons.push(codes.length && codes.every((s) => UK_SERVICE_SIC.has(s)) ? "service_codes_only" : "no_product_code");
  }
  for (const s of codes) {
    const hit = UK_BLOCKED_SIC.find(([re]) => re.test(s));
    if (hit) reasons.push(`blocked_sic:${s} ${hit[1]}`);
  }
  const nameHit = UK_BLOCKED_NAME.exec(c.name ?? "");
  if (nameHit) reasons.push(`name:${nameHit[1].toLowerCase()}`);

  if (c.officers == null || c.officers.length === 0) reasons.push("no_officer_data");
  else if (countDirectors(c.officers) < 2) reasons.push("single_director");

  return verdict(reasons, "alert");
}

// ── SEC Form D ──────────────────────────────────────────────────────────────

/** In-scope industry groups — mirrors ingest-sec-form-d's TECH_INDUSTRY_GROUPS. */
const SEC_TECH_GROUPS = new Set(["technology", "computers", "telecommunications", "other technology", "biotechnology"]);

/** Names of investment vehicles that slip past the industry-group filter (SPVs, series LLCs, co-invest funds). */
const SEC_VEHICLE_NAME =
  /\b(fund|funds|spv|a series of|series\s+[a-z0-9][\w-]*|l\.?p\.?|co-?invest\w*|opportunit(?:y|ies)|investors?|capital partners|holdings?|equit(?:y|ies))\b/i;

export interface FormDInput {
  name: string;
  industryGroup: string | null;
  /** True when the filing carries the investment-fund sub-block. */
  isFund?: boolean;
}

export function gateFormD(f: FormDInput): GateResult {
  const reasons: string[] = [];
  if (f.isFund) reasons.push("investment_fund");
  if (!SEC_TECH_GROUPS.has((f.industryGroup ?? "").toLowerCase())) reasons.push(`industry:${f.industryGroup ?? "none"}`);
  const hit = SEC_VEHICLE_NAME.exec(f.name ?? "");
  if (hit) reasons.push(`vehicle_name:${hit[1].toLowerCase()}`);
  return verdict(reasons, "alert");
}

// ── Patent applicants (EPO) ─────────────────────────────────────────────────

/** A legal-entity suffix at the end of the name. */
const CORPORATE_SUFFIX =
  /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|l\.l\.c|gmbh|ag|s\.?a|s\.?a\.?s|b\.?v|n\.?v|plc|ab|oy|oyj|hf|ehf|k\.?k|pte|pty|s\.?r\.?l|s\.?p\.?a|sarl|se|ltda|lda|a\/?s|asa|aps|kft|zrt|sp\.? z o\.?o|ou|oü|bhd|sdn|kg|flexco|kaisha|e\.?v)\.?$/i;

/** Words that make a name an organisation even without a suffix. */
const ORG_WORD = /\b(technolog\w*|systems?|labs?|robotics|solutions|software|energy|therapeutics|bio\w*|networks?|devices|industries|group|ai)\b/i;

/** Universities, hospitals and public research bodies — patent holders, not startups. */
const INSTITUTION =
  /\b(universit\w*|college|institut\w*|hospital|klinik\w*|research council|academy|academia|cnrs|inserm|fraunhofer|max[- ]planck|tno|csic|kaist|a\*star|commissariat|government|ministry|secretary of)\b/i;

/**
 * The IP-holding and operating subsidiaries incumbents file patents under:
 * "Microsoft Technology Licensing", "Ford Global Technologies", "GM Global
 * Technology Operations", "Intrinsic Innovation" (Alphabet), "Cerner
 * Innovation" (Oracle), "Avago ... International Sales" (Broadcom),
 * "Camelot UK Bidco" (Clarivate), "OpenAI OpCo". No startup names itself so.
 */
const CORPORATE_IP_VEHICLE =
  /\b(licensing|global technolog(?:y|ies)|technology operations|ip holdings?|ipr management|innovations?,? (?:llc|l\.l\.c|inc)|international sales|bidco|opco|operating company|apollo, llc|enterprise management|limited partnership)\b/i;

export interface PatentApplicantInput {
  name: string;
  /** On the patent_excluded_applicants denylist (incumbents, already checked by the database). */
  excluded: boolean;
}

/** "Park Jonghyun", "Perez Michael Arthur": 2–4 plain words, no suffix, no organisation word. */
export function looksLikePerson(name: string): boolean {
  const n = (name ?? "").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!n || CORPORATE_SUFFIX.test(n) || ORG_WORD.test(n) || INSTITUTION.test(n)) return false;
  const words = n.split(" ");
  if (words.length < 2 || words.length > 4 || !words.every((w) => /^[\p{L}'-]+$/u.test(w))) return false;
  // EPO writes people as "Lastname Firstname" or "SURNAME Given": at least one
  // word is not all capitals. Three or four all-caps words is an organisation
  // ("IDEMIA PUBLIC SECURITY FRANCE"), not a person.
  return words.length === 2 || words.some((w) => w !== w.toUpperCase());
}

export function gatePatentApplicant(a: PatentApplicantInput): GateResult {
  const reasons: string[] = [];
  const name = (a.name ?? "").trim();
  if (!name || /\(inventor-held\)$|^unassigned publication$/i.test(name)) reasons.push("no_company_applicant");
  else {
    if (a.excluded) reasons.push("excluded_applicant");
    if (INSTITUTION.test(name)) reasons.push("institution");
    if (CORPORATE_IP_VEHICLE.test(name)) reasons.push("corporate_ip_vehicle");
    if (looksLikePerson(name)) reasons.push("individual_applicant");
  }
  // Never "alert": whether a patent applicant is a startup or an incumbent
  // cannot be decided from the record — the review queue decides.
  return verdict(reasons, "queue");
}
