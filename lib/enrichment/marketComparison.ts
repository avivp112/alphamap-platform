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
  "You judge whether two companies are market competitors. Two companies compete only when BOTH hold:",
  "(1) the SAME KIND OF PRODUCT: a customer could buy one INSTEAD of the other for the same job;",
  "(2) the SAME KIND OF CUSTOMER (who pays, and the size of company or the person).",
  "Answer false for: complementary products used together (a warehouse system and an inventory platform), partners, suppliers, an acquirer or an",
  "acquired company, a very large conglomerate that merely has a division in the field, companies in the same broad industry doing different jobs",
  "(cloud data security vs identity security), and anything that is not a company with its own product.",
  "Judge ONLY from the two descriptions given. When they do not show the same product and customer, answer false.",
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
                same_product: { type: "boolean", description: "A customer could buy this INSTEAD of the company's product for the same job." },
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
  return peers.map((p) => {
    const v = list.find((x) => String(x?.name ?? "").trim().toLowerCase() === p.name.trim().toLowerCase());
    return { name: p.name, same_product: v?.same_product === true, same_customer: v?.same_customer === true, reason: typeof v?.reason === "string" ? v.reason : "no verdict" };
  });
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
