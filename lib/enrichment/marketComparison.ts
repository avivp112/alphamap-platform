/**
 * Market peers judged by what the two companies SELL, not by being named together (owner, 2026-11-12, run 12: 3 of 9 market competitors were right —
 * Linnworks / Extensiv are used together, Figment / Fireblocks are partners, Opus / Laminar / Dig are startups in a broad field, AirStrip / Philips
 * is a market-report list with a conglomerate, "Shoppable" is a word).
 *
 * 1. The model proposes candidates, as before (competitorTiers.ts: each one is in an allowed source's sentence with the company).
 * 2. Each candidate must be a company with a website: its description from the database, or from its own homepage.
 * 3. One model call compares the company's description with each candidate's: the same kind of product, for the same kind of customer?
 * 4. The source that names the two stays as the evidence; a sentence that makes them partners, acquirer / acquired, or "in contrast to"
 *    does not count (competitorTiers.marketRelationProblem).
 */
import { marketRelationProblem } from "./competitorTiers.ts";

export interface PeerClaim { name: string; source_id: string; evidence_quote: string; how_it_competes: string; tier: "declared" | "market" }
export interface PeerFacts { name: string; description: string; website: string | null; where: "database" | "own_site" }
export interface PeerVerdict { name: string; same_product: boolean; same_customer: boolean; reason: string }

const SYSTEM = [
  "You judge whether two companies are market competitors (owner's definition: both sell a product in the same CATEGORY to the same kind of CUSTOMER).",
  "Same category means a customer would look for both in the same place for the same need, even when the form differs: an insurer and an online insurance",
  "marketplace both sell insurance to consumers; a bed that regulates temperature and a ring that tracks sleep both address sleep; an app-based lender and a",
  "payments wallet both serve consumers' money needs. Same kind of customer: consumers or businesses, and for businesses the same kind of buyer.",
  "Answer false for: complementary products used together (a warehouse system and an inventory platform), partners, suppliers, an acquirer or an acquired",
  "company, a very large conglomerate that merely has a division in the field, companies in the same broad industry doing different jobs for different",
  "buyers (cloud data discovery vs security orchestration), and anything that is not a company with its own product.",
  "Judge ONLY from the two descriptions given. When a description is not about a company's own product (a tracking pixel, an error page, a",
  "page about something else), answer false and say so in the reason. When they do not show the same category and customer, answer false.",
].join(" ");

export function buildPeerComparisonRequest(company: { name: string; description: string }, peers: PeerFacts[]) {
  const list = peers.map((p, i) => `${i + 1}. ${p.name}: ${p.description.slice(0, 600)}`).join("\n");
  return {
    model: "",
    max_tokens: 150 + 90 * peers.length,
    temperature: 0,
    system: SYSTEM,
    tools: [{
      name: "judge_peers",
      description: "For each candidate: same product and same customer as the company?",
      input_schema: {
        type: "object" as const,
        properties: {
          verdicts: {
            type: "array",
            items: {
              type: "object" as const,
              properties: {
                name: { type: "string" },
                same_product: { type: "boolean", description: "The same category of product: the same customer need, even when the form differs." },
                same_customer: { type: "boolean", description: "Sold to the same kind of customer." },
                reason: { type: "string", description: "One short sentence." },
              },
              required: ["name", "same_product", "same_customer", "reason"],
            },
          },
        },
        required: ["verdicts"],
      },
    }],
    tool_choice: { type: "tool" as const, name: "judge_peers" },
    messages: [{ role: "user" as const, content: `Company: ${company.name}: ${company.description.slice(0, 800)}\n\nCandidates:\n${list}` }],
  };
}

export function parsePeerVerdicts(input: unknown, peers: PeerFacts[]): PeerVerdict[] {
  const raw = (input as { verdicts?: unknown })?.verdicts;
  const list = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : [];
  return peers.map((p, i) => {
    // By name; when the model wrote the name another way and there is one verdict per candidate, by position.
    const v = list.find((x) => String(x?.name ?? "").trim().toLowerCase() === p.name.trim().toLowerCase()) ?? (list.length === peers.length ? list[i] : undefined);
    return { name: p.name, same_product: v?.same_product === true, same_customer: v?.same_customer === true, reason: typeof v?.reason === "string" ? v.reason : "no verdict" };
  });
}

/**
 * The candidate's name is written as a name in the sentence: a capital letter where it appears ("Fireblocks", "Opus Security"), not the lower-case
 * word of "a shoppable video storefront" (run 12: "Shoppable" was a word, and a company of that name exists, so the comparison alone kept it).
 */
export function nameIsWrittenAsAName(quote: string, name: string): boolean {
  const esc = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  if (!esc) return false;
  const m = [...quote.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(${esc})(?![\\p{L}\\p{N}])`, "giu"))];
  return m.some((x) => /[\p{Lu}\d]/u.test(x[1][0]) || /[\p{Lu}]/u.test(x[1].slice(1)));   // a leading capital, or a capital inside ("eToro", "PhonePe")
}

export interface PeerDeps {
  /** The candidate's description and website: the database, else its own homepage; null when it is not a company with a website. */
  resolve: (name: string) => Promise<PeerFacts | null>;
  /** The model call: the request built here, the tool input back. */
  ask: (request: ReturnType<typeof buildPeerComparisonRequest>) => Promise<unknown>;
}

/** The market claims that stand, and why each of the others does not. */
export async function judgeMarketPeers(deps: PeerDeps, company: { name: string; description: string }, claims: PeerClaim[], url: (c: PeerClaim) => string = () => ""): Promise<{ kept: PeerClaim[]; dropped: Array<{ name: string; why: string }> }> {
  const dropped: Array<{ name: string; why: string }> = [];
  const candidates: Array<{ claim: PeerClaim; facts: PeerFacts }> = [];
  for (const c of claims) {
    const relation = marketRelationProblem(`${c.evidence_quote} ${url(c)}`);
    if (relation) { dropped.push({ name: c.name, why: relation }); continue; }
    if (!nameIsWrittenAsAName(c.evidence_quote, c.name)) { dropped.push({ name: c.name, why: "peer_name_is_a_word_in_the_sentence" }); continue; }
    const facts = await deps.resolve(c.name);
    if (!facts || !facts.description.trim()) { dropped.push({ name: c.name, why: "peer_not_a_company_with_a_site" }); continue; }
    candidates.push({ claim: c, facts });
  }
  if (!candidates.length) return { kept: [], dropped };
  const verdicts = parsePeerVerdicts(await deps.ask(buildPeerComparisonRequest(company, candidates.map((x) => x.facts))), candidates.map((x) => x.facts));
  const kept: PeerClaim[] = [];
  candidates.forEach((x, i) => {
    const v = verdicts[i];
    if (v.same_product && v.same_customer) kept.push(x.claim);
    else dropped.push({ name: x.claim.name, why: `peer_not_comparable: ${v.same_product ? "" : "not the same product"}${!v.same_product && !v.same_customer ? "; " : ""}${v.same_customer ? "" : "not the same customer"} — ${v.reason}` });
  });
  return { kept, dropped };
}
