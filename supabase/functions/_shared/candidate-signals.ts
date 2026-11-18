// =============================================================================
// Registry signals for a review candidate — pure, no Deno, no network.
//
// The ingesters fetch the raw registry payloads (Companies House officer
// appointments, persons with significant control, filing history; the
// database's own Form D history) and these functions turn each into plain
// signals the reviewer can read. Stored under company_candidates.evidence.signals
// as { checked_at, items: Signal[] }, one entry per fact with its source link.
//
// Rules of the road:
//   * A signal states a fact the source gave. It never says what the company does.
//   * Name-based readings (investor / holding PSC, same-name person) say "by name".
//   * Thresholds are constants at the top, meant to be tuned from review outcomes.
//   * Response shapes follow the Companies House developer documentation; the
//     sandbox these were written in could not reach the live API, so the first
//     live dryRun is the real check.
// =============================================================================

export type SignalLevel = "positive" | "info" | "warning";

export type SignalKind =
  | "serial_founder" | "many_directorships" | "known_company_link" | "dissolved_history"
  | "known_company_psc" | "investor_psc" | "holding_psc" | "psc_summary"
  | "share_allotment" | "shared_address"
  | "previous_raise" | "person_prior_form_d" | "person_fund_manager";

export interface Signal {
  kind: SignalKind;
  level: SignalLevel;
  text: string;
  /** The page at the source where the fact can be checked. */
  url?: string;
}

export interface SignalSet {
  checked_at: string;
  items: Signal[];
}

/** Other active directorships up to this many read as a founder with several ventures. */
export const SERIAL_MAX = 5;
/** From this many other active directorships the person is flagged: a nominee / formation-agent pattern. */
export const MANY_DIRECTORSHIPS = 15;
/** This many candidates already seen at one registered address: a formation-agent address. */
export const SHARED_ADDRESS_MIN = 5;
/** How many share allotments are listed. */
export const MAX_ALLOTMENTS = 3;

const CH_WEB = "https://find-and-update.company-information.service.gov.uk";
type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string => String(v ?? "").trim();

export type KnownCompanies = Map<string, { id: string; name: string }>;

// ── Companies House: a director's other appointments ────────────────────────

/** GET /officers/{id}/appointments → signals about one director. */
export function officerAppointmentsSignals(
  directorName: string, payload: Json | null, currentNumber: string, known: KnownCompanies, appointmentsPath?: string,
): Signal[] {
  if (!payload) return [];
  const url = appointmentsPath ? `${CH_WEB}${appointmentsPath}` : undefined;
  const others = arr(payload.items).filter((i) => str((i.appointed_to as Json)?.company_number) !== currentNumber);
  const active = others.filter((i) => !i.resigned_on);
  const dissolved = others.filter((i) => str((i.appointed_to as Json)?.company_status).toLowerCase() === "dissolved");
  const out: Signal[] = [];
  const label = (i: Json) => str((i.appointed_to as Json)?.company_name) || str((i.appointed_to as Json)?.company_number);

  if (active.length >= MANY_DIRECTORSHIPS) {
    out.push({ kind: "many_directorships", level: "warning", url,
      text: `${directorName}: ${active.length} other active directorships (a nominee or formation-agent pattern is possible)` });
  } else if (active.length > 0) {
    const names = active.slice(0, 3).map(label).join(", ");
    out.push({ kind: "serial_founder", level: active.length <= SERIAL_MAX ? "positive" : "info", url,
      text: `${directorName}: ${active.length} other active directorship${active.length === 1 ? "" : "s"} (${names}${active.length > 3 ? ", …" : ""})` });
  }
  for (const i of others) {
    const num = str((i.appointed_to as Json)?.company_number);
    const hit = known.get(num);
    if (hit) out.push({ kind: "known_company_link", level: "positive", url,
      text: `${directorName} is also ${str(i.officer_role) || "an officer"} of ${hit.name}, which is in AlphaMap` });
  }
  if (dissolved.length > 0) {
    out.push({ kind: "dissolved_history", level: "info", url, text: `${directorName}: ${dissolved.length} earlier compan${dissolved.length === 1 ? "y" : "ies"} dissolved` });
  }
  return out;
}

// ── Companies House: persons with significant control ───────────────────────

const INVESTOR_NAME = /\b(ventures?|capital|fund|funds|partners|investments?|equity|angels?)\b/i;
const HOLDING_NAME = /\b(holdings?|group|nominees?|trustees?|trust)\b/i;

/** GET /company/{n}/persons-with-significant-control → signals about who controls the company. */
export function pscSignals(payload: Json | null, known: KnownCompanies, companyNumber: string): Signal[] {
  if (!payload) return [];
  const url = `${CH_WEB}/company/${encodeURIComponent(companyNumber)}/persons-with-significant-control`;
  const active = arr(payload.items).filter((i) => !i.ceased_on);
  if (active.length === 0) return [];
  const out: Signal[] = [];
  const corporate = active.filter((i) => /corporate-entity|legal-person/.test(str(i.kind)));
  const individuals = active.length - corporate.length;
  if (individuals > 0) {
    out.push({ kind: "psc_summary", level: "info", url, text: `${individuals} individual${individuals === 1 ? "" : "s"} with significant control` });
  }
  for (const c of corporate) {
    const name = str(c.name) || "an unnamed company";
    const reg = str((c.identification as Json)?.registration_number);
    const hit = reg ? known.get(reg) : undefined;
    if (hit) {
      out.push({ kind: "known_company_psc", level: "positive", url, text: `Controlled by ${hit.name}, which is in AlphaMap` });
    } else if (HOLDING_NAME.test(name)) {
      out.push({ kind: "holding_psc", level: "warning", url, text: `Controlled by ${name} (a holding company, by name)` });
    } else if (INVESTOR_NAME.test(name)) {
      out.push({ kind: "investor_psc", level: "positive", url, text: `Controlled by ${name} (possibly an investor, by name)` });
    } else {
      out.push({ kind: "psc_summary", level: "info", url, text: `Controlled by ${name}` });
    }
  }
  return out;
}

// ── Companies House: capital filings ────────────────────────────────────────

export interface FilingEvent { type: string; date: string; capital?: string }

/** GET /company/{n}/filing-history?category=capital → the SH01 (allotment of shares) events, newest first. */
export function parseCapitalEvents(payload: Json | null): FilingEvent[] {
  return arr(payload?.items)
    .filter((i) => str(i.type) === "SH01" && str(i.date))
    .map((i) => {
      const cap = arr((i.description_values as Json)?.capital)[0];
      const figure = str(cap?.figure);
      return { type: "SH01", date: str(i.date), ...(figure ? { capital: `${figure} ${str(cap?.currency)}`.trim() } : {}) };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function capitalSignals(payload: Json | null, companyNumber: string): Signal[] {
  const events = parseCapitalEvents(payload);
  if (events.length === 0) return [];
  const url = `${CH_WEB}/company/${encodeURIComponent(companyNumber)}/filing-history`;
  const shown = events.slice(0, MAX_ALLOTMENTS)
    .map((e) => `${e.date}${e.capital ? ` (capital after: ${e.capital})` : ""}`).join("; ");
  return [{ kind: "share_allotment", level: "positive", url,
    text: `${events.length} share allotment${events.length === 1 ? "" : "s"} filed: ${shown}` }];
}

/** Registered address already seen on `count` other candidates in our data. */
export function sharedAddressSignals(count: number, address: string | null | undefined): Signal[] {
  if (!address || count < SHARED_ADDRESS_MIN) return [];
  return [{ kind: "shared_address", level: "warning", text: `${count} other candidates seen at the same registered address (a formation-agent address is possible)` }];
}

// ── SEC Form D: from the filings we already hold ────────────────────────────

export interface FormDFilingRow { form_type?: string | null; filing_date?: string | null; total_offering?: number | null }

/** Earlier offerings by the same issuer (same CIK). `rows` are every Form D we hold for the CIK, including this one. */
export function previousRaiseSignals(rows: FormDFilingRow[], cik: string): Signal[] {
  const offerings = rows.filter((r) => str(r.form_type).toUpperCase() === "D" && r.filing_date)
    .sort((a, b) => str(a.filing_date).localeCompare(str(b.filing_date)));
  if (offerings.length < 2) return [];
  const first = str(offerings[0].filing_date);
  return [{ kind: "previous_raise", level: "positive",
    url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(cik)}&type=D`,
    text: `${offerings.length} Form D offerings filed since ${first}` }];
}

export interface OtherIssuerRow { entity_name: string; cik?: string | null; filing_date?: string | null }
export interface FundManagerRow { fund_name: string; firm_name?: string | null; fund_type?: string | null }

/** A related person who also appears on other issuers' Form D, or manages a fund. Matched by exact name only. */
export function formDPersonSignals(name: string, others: OtherIssuerRow[], funds: FundManagerRow[]): Signal[] {
  const out: Signal[] = [];
  const entities = [...new Set(others.map((o) => o.entity_name).filter(Boolean))];
  if (entities.length > 0) {
    out.push({ kind: "person_prior_form_d", level: "positive",
      text: `${name} (same name) is also a related person on Form D of ${entities.slice(0, 3).join(", ")}${entities.length > 3 ? ", …" : ""}` });
  }
  if (funds.length > 0) {
    const f = funds[0];
    out.push({ kind: "person_fund_manager", level: "positive",
      text: `${name} (same name) is a manager of ${f.fund_name}${f.firm_name ? ` (${f.firm_name})` : ""}${f.fund_type ? `, ${f.fund_type}` : ""}` });
  }
  return out;
}

export function buildSignalSet(items: Signal[], checkedAt: string): SignalSet {
  return { checked_at: checkedAt, items };
}
