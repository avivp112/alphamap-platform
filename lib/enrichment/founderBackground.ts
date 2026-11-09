/**
 * lib/enrichment/founderBackground.ts — structured background per founder
 * (owner, 2026-11-07), instead of a free-text bio: previous company and role,
 * an exit, education, a military unit. Each fact carries a verbatim quote from
 * an allowed source and is verified like any other field ("missing is better
 * than wrong"):
 *   - the quote is in the source's text (quoteMatchesSource),
 *   - the source is an allowed one (injected: profileSourceAllowed),
 *   - the quote names the founder (last name) and the organization,
 *   - the quote says what the kind claims (acquired / sold / IPO for an exit,
 *     a university or degree word for education, a unit or army word for
 *     military service) — a plain mention of two names is not a background.
 * Pure: the model call and the search are injected.
 */
import { quoteMatchesSource, normalizeForMatch } from "./evidence.ts";
import { formatSourcesForPrompt, type LabeledSource } from "./sources.ts";

export type BackgroundKind = "previous_role" | "exit" | "education" | "military";
export const BACKGROUND_KINDS: BackgroundKind[] = ["previous_role", "exit", "education", "military"];

export interface BackgroundFact {
  kind: BackgroundKind;
  organization: string;
  role?: string;
  year?: number;
  source_id: string;
  evidence_quote: string;
}
export interface FounderFacts { founder: string; facts: BackgroundFact[] }

const EXIT = /\b(acquired|acquisition|sold|sale of|bought|purchased|merged|ipo|went public|exit|exited)\b/i;
const EDUCATION = /\b(university|college|institute|school|polytechnic|academy|technion|mit\b|ph\.?d|doctorate|master'?s|bachelor'?s|b\.?sc|m\.?sc|mba|degree|graduat\w*|studied|alumn\w*)\b/i;
const MILITARY = /\b(unit|army|idf|israel defen[cs]e forces|navy|air force|military|intelligence corps|8200|unit 8200|talpiot|mamram|special forces|served|officer|corps)\b/i;
const ROLE = /\b(ceo|cto|coo|cfo|founder|co-?founder|president|vp|vice president|head of|director|engineer|scientist|researcher|manager|lead|chief|partner|executive|worked|previously|formerly|before|joined|led)\b/i;

const KIND_PATTERN: Record<BackgroundKind, RegExp> = { exit: EXIT, education: EDUCATION, military: MILITARY, previous_role: ROLE };

function lastName(name: string): string {
  const parts = words(name).split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
const words = (s: string) => normalizeForMatch(s).replace(/\.(?=\s|$)/g, "").trim();
function has(text: string, term: string): boolean {
  const t = words(term);
  return !!t && ` ${words(text)} `.includes(` ${t} `);
}

/**
 * When a sentence names two founders, a fact belongs to the one it is said about (owner, 2026-11-09, review 7: Cado's
 * AlienVault went to James Campbell; the quote was about his co-founder). The organization belongs to the nearest founder
 * named before it in its sentence, or to the one named in parentheses right after it; two founders named together
 * ("Gil Dabah and Ariel Shiftan, whose firm NorthBit was acquired") share it, unless the sentence says "respectively".
 */
export function factBelongsToFounder(quote: string, founder: string, organization: string, coFounders: string[]): boolean {
  const others = coFounders.filter((n) => lastName(n) && lastName(n) !== lastName(founder));
  const q = quote.replace(/\s+/g, " ");
  const low = q.toLowerCase();
  const names = [founder, ...others].map((n) => ({ n, key: lastName(n).toLowerCase() })).filter((x) => x.key);
  if (!others.some((o) => low.includes(lastName(o).toLowerCase()))) return true;      // only this founder is named
  const at = low.indexOf(words(organization).split(" ")[0]);
  if (at < 0) return true;
  const mentions = names.flatMap((x) => [...low.matchAll(new RegExp(`\\b${x.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"))].map((m) => ({ ...x, i: m.index ?? 0 })));
  // Named in parentheses right after the organization: "AlienVault (Doman)".
  const after = low.slice(at).match(/^[^()]{0,40}?\(\s*([^)]{2,40})\)/);
  if (after) {
    const hit = names.find((x) => after[1].includes(x.key));
    if (hit) return hit.key === lastName(founder).toLowerCase();
  }
  // The sentence of the organization, up to it.
  const start = Math.max(0, low.lastIndexOf(". ", at) + 1);
  const before = mentions.filter((m) => m.i >= start && m.i < at).sort((a, b) => b.i - a.i);
  if (!before.length) return true;
  const nearest = before[0];
  if (nearest.key === lastName(founder).toLowerCase()) return true;
  // A pair named together shares what is said of both ("whose firm …"), unless it says "respectively".
  if (/respective/.test(low)) return false;
  const pair = before.some((m) => m.key === lastName(founder).toLowerCase() && nearest.i - m.i < 45) && /\b(?:whose|both|their|together)\b/.test(low.slice(nearest.i, at));
  return pair;
}

export type FactProblem = "unknown_kind" | "no_organization" | "source_not_found" | "source_not_allowed" | "quote_not_in_source"
  | "founder_not_in_quote" | "fact_of_another_founder" | "organization_not_in_quote" | "quote_does_not_say_it" | "is_the_company_itself";

/** Why a fact is rejected, or null when it holds. */
export function factProblem(
  founder: string, companyName: string, f: BackgroundFact,
  sources: Record<string, { content: string }>, allowed: (sourceId: string) => boolean, coFounders: string[] = [],
): FactProblem | null {
  if (!BACKGROUND_KINDS.includes(f.kind)) return "unknown_kind";
  if (!f.organization?.trim()) return "no_organization";
  const src = sources[f.source_id];
  if (!src) return "source_not_found";
  if (!allowed(f.source_id)) return "source_not_allowed";
  if (typeof f.evidence_quote !== "string" || !f.evidence_quote.trim() || !quoteMatchesSource(f.evidence_quote, src.content).matched) return "quote_not_in_source";
  if (!has(f.evidence_quote, lastName(founder))) return "founder_not_in_quote";
  if (!has(f.evidence_quote, f.organization)) return "organization_not_in_quote";
  if (!factBelongsToFounder(f.evidence_quote, founder, f.organization, coFounders)) return "fact_of_another_founder";
  // The company's own founding is not a "previous" background.
  if (normalizeForMatch(f.organization) === normalizeForMatch(companyName) && f.kind !== "education") return "is_the_company_itself";
  if (!KIND_PATTERN[f.kind].test(f.evidence_quote)) return "quote_does_not_say_it";
  return null;
}

/** The verified facts of every founder; the rest is returned with the reason it was dropped. */
export function processBackgroundResponse(
  input: unknown, founders: string[], companyName: string,
  sources: Record<string, { content: string }>, allowed: (sourceId: string) => boolean,
): { kept: FounderFacts[]; dropped: Array<{ founder: string; fact: BackgroundFact; why: FactProblem }> } {
  const kept: FounderFacts[] = [];
  const dropped: Array<{ founder: string; fact: BackgroundFact; why: FactProblem }> = [];
  const list = Array.isArray((input as { founders?: unknown })?.founders) ? (input as { founders: unknown[] }).founders : [];
  for (const raw of list) {
    const r = raw as { name?: string; facts?: BackgroundFact[] };
    const founder = founders.find((n) => normalizeForMatch(n) === normalizeForMatch(r?.name ?? ""));
    if (!founder || !Array.isArray(r.facts)) continue;
    const facts: BackgroundFact[] = [];
    for (const f of r.facts) {
      const why = factProblem(founder, companyName, f, sources, allowed, founders);
      if (why) { dropped.push({ founder, fact: f, why }); continue; }
      const dup = facts.some((x) => x.kind === f.kind && normalizeForMatch(x.organization) === normalizeForMatch(f.organization));
      if (!dup) facts.push({ kind: f.kind, organization: f.organization.trim(), role: f.role?.trim() || undefined, year: Number.isFinite(f.year) ? f.year : undefined, source_id: f.source_id, evidence_quote: f.evidence_quote.trim() });
    }
    if (facts.length) kept.push({ founder, facts });
  }
  return { kept, dropped };
}

export function backgroundTool() {
  return {
    name: "save_founder_background",
    description: "Save the verified background facts of each founder.",
    input_schema: {
      type: "object" as const,
      properties: {
        founders: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              facts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    kind: { type: "string", enum: BACKGROUND_KINDS },
                    organization: { type: "string", description: "Company, university or unit" },
                    role: { type: "string" },
                    year: { type: "integer" },
                    source_id: { type: "string" },
                    evidence_quote: { type: "string", description: "Verbatim sentence naming the founder and the organization" },
                  },
                  required: ["kind", "organization", "source_id", "evidence_quote"],
                },
              },
            },
            required: ["name", "facts"],
          },
        },
      },
      required: ["founders"],
    },
  };
}

export function buildBackgroundRequest(companyName: string, founders: string[], sources: LabeledSource[]) {
  const prompt = `From the research below, extract the BACKGROUND of the founders of "${companyName}": ${founders.join("; ")}.

RULES:
1. Only structured facts, no biography: previous_role (a company the founder worked at before, with the role), exit (a company the founder started or ran that was acquired, sold or went public), education (a university or degree), military (a unit or army).
2. Each fact needs the source_id and a verbatim evidence_quote — one sentence that names the founder AND the organization and says the fact. A sentence about the company without the founder's name is not evidence.
3. Never use ${companyName} itself as a previous company. Never infer, never use your own knowledge. A founder with nothing stated gets an empty list. Fewer facts is correct.

Labeled research:
${formatSourcesForPrompt(sources)}`;
  return {
    model: "", max_tokens: 4096, temperature: 0,
    tools: [backgroundTool()], tool_choice: { type: "tool" as const, name: "save_founder_background" },
    messages: [{ role: "user" as const, content: prompt }],
  };
}

export function backgroundSearchQuery(companyName: string, founders: string[]): string {
  const names = founders.slice(0, 2).map((n) => `"${n}"`).join(" OR ");
  return `${names} "${companyName}" founder previously OR formerly OR "before founding" OR graduated OR served`;
}
