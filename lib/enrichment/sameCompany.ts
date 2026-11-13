/**
 * A name in the list that matches a company already in the database (owner, 2026-11-13): before a person is asked, two checks.
 *   1. Do the two addresses lead to each other? (one redirects to the other's domain: the same company under a new address)
 *   2. Do the country and the business match the record in the database? One model call compares the record with the list's homepage:
 *      same (the same company: not added, the address is proposed as a fix), different (another company with the same name: added), or unclear.
 * Only what stays unclear is shown to the owner.
 */
import { registrable } from "./addCompanies.ts";

export interface DbRecord { id: string; name: string; website: string | null; country: string | null; city: string | null; industry: string | null; description: string | null }
export type SameVerdict = "same" | "different" | "unclear";
export interface SameResult { verdict: SameVerdict; how: "redirect" | "model" | "none"; reason: string }

/** The two final addresses are one site: the same host, or the same registrable domain. */
export function sameSite(hostA: string | null, hostB: string | null): boolean {
  if (!hostA || !hostB) return false;
  const a = hostA.toLowerCase().replace(/^www\./, ""), b = hostB.toLowerCase().replace(/^www\./, "");
  return a === b || registrable(a) === registrable(b);
}

const SYSTEM = [
  "You decide whether two records are the SAME COMPANY. Record A is a company in a database (name, website, country, industry, description).",
  "Record B is a company from a list, with its website and the text of its homepage.",
  "Answer 'same' ONLY when the country (or market) AND the business clearly match, so that one company has two addresses (a new domain, a country domain).",
  "Answer 'different' when the businesses or the countries clearly differ (a Brazilian ERP is not an American meeting tool with the same name).",
  "Answer 'unclear' when the homepage could not be read, says too little, or the evidence is thin. Never guess.",
].join(" ");

export function buildSameCompanyRequest(a: DbRecord, listName: string, listSite: string, homepage: string, countryHint: string | null) {
  return {
    model: "",
    max_tokens: 200,
    temperature: 0,
    system: SYSTEM,
    tools: [{
      name: "judge_same_company",
      description: "Same company, different company, or unclear.",
      input_schema: { type: "object" as const, properties: { verdict: { type: "string", enum: ["same", "different", "unclear"] }, reason: { type: "string", description: "One short sentence: the country and business of each." } }, required: ["verdict", "reason"] },
    }],
    tool_choice: { type: "tool" as const, name: "judge_same_company" },
    messages: [{ role: "user" as const, content: [
      `A (database): ${a.name} · ${a.website ?? "no website"} · country: ${a.country ?? "unknown"}${a.city ? `, ${a.city}` : ""} · industry: ${a.industry ?? "unknown"}`,
      `A description: ${(a.description ?? "none").slice(0, 400)}`,
      `B (list): ${listName} · ${listSite}${countryHint ? ` · country hint from its domain: ${countryHint}` : ""}`,
      `B homepage: ${homepage ? homepage.slice(0, 900) : "(could not be read)"}`,
    ].join("\n") }],
  };
}

export function parseSameCompany(input: unknown): { verdict: SameVerdict; reason: string } {
  const v = (input as { verdict?: unknown })?.verdict;
  return { verdict: v === "same" || v === "different" ? v : "unclear", reason: String((input as { reason?: unknown })?.reason ?? "no answer").slice(0, 200) };
}

export interface SameDeps {
  /** The final host an address leads to (after redirects); null when it cannot be reached. */
  finalHost: (url: string) => Promise<string | null>;
  /** The visible text of a homepage; empty when it cannot be read. */
  homepageText: (url: string) => Promise<string>;
  ask: (request: ReturnType<typeof buildSameCompanyRequest>) => Promise<unknown>;
  countryHint: (host: string) => string | null;
}

export async function resolveCollision(deps: SameDeps, db: DbRecord, listName: string, listSite: string): Promise<SameResult> {
  const [finalList, finalDb] = await Promise.all([deps.finalHost(listSite), db.website ? deps.finalHost(db.website) : Promise.resolve(null)]);
  const listHost = new URL(listSite).hostname, dbHost = db.website ? new URL(db.website).hostname : null;
  // One address leads to the other's site: the same company under a new address.
  if (sameSite(finalList, dbHost) || sameSite(finalDb, listHost) || (finalList && finalDb && sameSite(finalList, finalDb))) {
    return { verdict: "same", how: "redirect", reason: `${listHost} and ${dbHost} lead to one site (${finalList ?? finalDb})` };
  }
  const homepage = await deps.homepageText(listSite);
  const r = parseSameCompany(await deps.ask(buildSameCompanyRequest(db, listName, listSite, homepage, deps.countryHint(listHost))));
  return { verdict: homepage.length < 200 && r.verdict === "different" ? "unclear" : r.verdict, how: "model", reason: r.reason };
}
