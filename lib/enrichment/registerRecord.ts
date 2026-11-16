/**
 * lib/enrichment/registerRecord.ts — what the registers add to a company's card (owner, round 10; docs/registries_plan.md): legal_name, company_number, incorporation_date,
 * incorporation_jurisdiction and registered_address — their own columns, never the headquarters and never the founding year.
 *
 *   - The record is that of the entity in the headquarters country; a register of another country does not decide alone. A local subsidiary ("… UK LTD") is no record of the company.
 *   - incorporation_date is the earliest date among the entries of the same company (a re-incorporation is later than the company); a bare year is never earlier than a full date of that year.
 *   - Without a headquarters country nothing is chosen.
 */
import { isLocalSubsidiary, type RegisterFinding } from "./registers.ts";

export interface RegistryRecord {
  legal_name: string;
  company_number: string;
  incorporation_date: string | null;
  incorporation_jurisdiction: string;
  registered_address: string | null;
  /** The finding the legal name, number, jurisdiction and address come from (its url and quote are the provenance). */
  primary: RegisterFinding;
  /** The finding the incorporation date comes from. */
  dateFrom: RegisterFinding | null;
}

const COUNTRY_ALIASES: Record<string, string> = { uk: "united kingdom", "great britain": "united kingdom", england: "united kingdom", usa: "united states", us: "united states", "united states of america": "united states" };
const key = (c: string | null | undefined) => { const k = (c ?? "").trim().toLowerCase(); return COUNTRY_ALIASES[k] ?? k; };
const rank = (d: string) => (d.length === 4 ? `${d}-12-31` : d);

export function chooseRegistryRecord(findings: RegisterFinding[], companyName: string, hqCountry: string | null | undefined): RegistryRecord | null {
  if (!hqCountry?.trim()) return null;
  const own = findings.filter((f) => !isLocalSubsidiary(f.entity, companyName));
  const primary = own.find((f) => key(f.founding_country) === key(hqCountry));
  if (!primary) return null;
  const dated = own.filter((f) => f.incorporation_date).sort((a, b) => rank(a.incorporation_date!).localeCompare(rank(b.incorporation_date!)));
  const dateFrom = dated[0] ?? null;
  return {
    legal_name: primary.entity, company_number: primary.number, incorporation_date: dateFrom?.incorporation_date ?? null,
    incorporation_jurisdiction: primary.founding_country, registered_address: primary.registered_address ?? null, primary, dateFrom,
  };
}
