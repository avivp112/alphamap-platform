/**
 * lib/enrichment/domainResolve.ts — the right website for a company whose address on file is wrong or unreadable (owner, round 10).
 * The address shows another business (nipponichi.jp is a calendar shop, netcraft.co.il is Elad Studio) or no page of it could be read after every fallback. A search by the company's
 * name, country and field finds candidate sites; a candidate is taken only when its homepage NAMES the company and a model, shown that homepage and what is known of the company,
 * says with high confidence that it is the same company. The result is a proposal for the owner (the address on file is never changed by the pipeline); with no such site, the
 * company is left out of the run (domain_unresolved) and nothing is written about it.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { requestFor } from "./models.ts";
import { pageNamesCompany } from "./ownDomain.ts";
import { registrable } from "./addCompanies.ts";
import { isDataPlatformUrl } from "./dataPlatforms.ts";
import type { RawSearchResult } from "./searchProviders.ts";

const NOT_A_SITE = /(^|\.)(linkedin|facebook|instagram|twitter|x|youtube|wikipedia|crunchbase|pitchbook|dealroom|tracxn|cbinsights|zoominfo|glassdoor|indeed|apple|google|play\.google|amazon|bloomberg|reuters|forbes|techcrunch|medium|github|yelp|trustpilot|g2|capterra|similarweb|owler|rocketreach|signalhire|f6s|angel|wellfound|opencorporates|dnb|northdata|companieshouse|find-and-update\.company-information\.service\.gov)\./i;

export interface DomainCandidate { website: string; host: string; title: string }

/** Distinct sites among search results, with the ones that cannot be a company's own site left out. */
export function candidateSites(results: Array<Pick<RawSearchResult, "url" | "title">>, currentHost: string | null, max = 4): DomainCandidate[] {
  const out: DomainCandidate[] = [];
  for (const r of results) {
    let u: URL; try { u = new URL(r.url); } catch { continue; }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (NOT_A_SITE.test(`${host}.`) || isDataPlatformUrl(r.url)) continue;
    if (currentHost && registrable(host) === registrable(currentHost)) continue;
    if (out.some((o) => registrable(o.host) === registrable(host))) continue;
    out.push({ website: `${u.protocol}//${u.hostname}/`, host, title: r.title ?? "" });
    if (out.length >= max) break;
  }
  return out;
}

export interface DomainFacts { name: string; country?: string | null; industry?: string | null; description?: string | null }

export function buildDomainJudgeRequest(facts: DomainFacts, homepage: string, url: string) {
  return {
    max_tokens: 300, temperature: 0,
    system: "You decide whether a website is the official site of a given company. Judge by what the homepage says about itself, not by the address. A site of a different business that merely shares a word with the name is not a match.",
    tools: [{
      name: "judge_site", description: "Is this homepage the company's own site?",
      input_schema: {
        type: "object" as const,
        properties: {
          is_the_company: { type: "boolean" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string", description: "One short sentence." },
        },
        required: ["is_the_company", "confidence", "reason"],
      },
    }],
    tool_choice: { type: "tool" as const, name: "judge_site" },
    messages: [{ role: "user" as const, content: `Company: "${facts.name}"${facts.country ? `, country: ${facts.country}` : ""}${facts.industry ? `, field: ${facts.industry}` : ""}${facts.description ? `\nKnown about it: ${facts.description.slice(0, 300)}` : ""}\n\nCandidate site: ${url}\nHomepage text:\n${homepage.slice(0, 3500)}\n\nIs this the official site of that company?` }],
  };
}

export interface DomainResolveDeps {
  client: Anthropic; model: string;
  search: (query: string, label: string) => Promise<Array<Pick<RawSearchResult, "url" | "title">>>;
  homepage: (website: string) => Promise<string | null>;
}

export async function resolveDomain(facts: DomainFacts, currentHost: string | null, deps: DomainResolveDeps): Promise<{ website: string; reason: string; tried: string[] } | { website: null; tried: string[] }> {
  const queries = [`"${facts.name}"${facts.country ? ` ${facts.country}` : ""} official website`, ...(facts.industry ? [`"${facts.name}" ${facts.industry}${facts.country ? ` ${facts.country}` : ""} company`] : [`"${facts.name}" company`])];
  const results: Array<Pick<RawSearchResult, "url" | "title">> = [];
  for (const q of queries) results.push(...await deps.search(q, "domain_resolve").catch(() => []));
  const tried: string[] = [];
  for (const c of candidateSites(results, currentHost)) {
    tried.push(c.host);
    const text = await deps.homepage(c.website).catch(() => null);
    // The page must name the company itself — no model can talk a page into being the company's.
    if (!text || !pageNamesCompany({ content: text }, facts.name)) continue;
    const msg = await deps.client.messages.create(requestFor(buildDomainJudgeRequest(facts, text, c.website), deps.model));
    const tool = msg.content.find((b) => b.type === "tool_use");
    const v = tool && tool.type === "tool_use" ? (tool.input as { is_the_company?: boolean; confidence?: string; reason?: string }) : null;
    if (v?.is_the_company === true && v.confidence === "high") return { website: c.website, reason: v.reason ?? "", tried };
  }
  return { website: null, tried };
}
