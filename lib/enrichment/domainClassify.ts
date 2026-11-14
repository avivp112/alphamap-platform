/**
 * lib/enrichment/domainClassify.ts — the model call behind domainClass.ts: one short request per unknown domain, once (the answer is kept in
 * cache/domain_class.json and in the registry). Haiku-sized; about $0.0005 a domain.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { DOMAIN_CLASSES, domainClassKey, domainClasses, parseDomainClass, type DomainClassEntry } from "./domainClass.ts";
import { roundSourceStanding } from "./roundSources.ts";

const SYSTEM = [
  "You classify a web domain that a company-research tool found, so the tool knows whether it may be used as a source for facts about a company.",
  "You get the address, the page's headline and the start of its text. Classes:",
  "news_outlet — a publication with editors that reports news or analysis (general, business, regional, or a trade / sector publication).",
  "wire — a press-release distribution service where organisations publish their own releases (like PR Newswire, Business Wire, newswire.ca).",
  "investor — a venture capital firm, fund, accelerator or corporate investor, writing about its portfolio.",
  "company_owned — the official site of a single company, writing about itself (its product, about, newsroom or blog pages).",
  "directory_aggregator — a company directory, database, ecosystem map, 'alternatives' or 'similar companies' listing, ranking, or review / comparison listing.",
  "blog_vendor_other — blogs and newsletters, vendor marketing pages (partner pages, case studies, integrations), product reviews, forums, personal sites, and anything that is none of the above.",
  "Judge the kind of site (and the section of it, when the address is a section such as /partners, /case-studies, /companies, /reviews), not whether the page's claim is true. When unsure, blog_vendor_other.",
].join(" ");

export function buildDomainClassRequest(url: string, title: string, text: string) {
  return {
    model: "", max_tokens: 150, temperature: 0,
    system: SYSTEM,
    tools: [{
      name: "classify_domain", description: "Classify the domain.",
      input_schema: { type: "object" as const, properties: { class: { type: "string", enum: [...DOMAIN_CLASSES] }, reason: { type: "string", description: "One short sentence." } }, required: ["class", "reason"] },
    }],
    tool_choice: { type: "tool" as const, name: "classify_domain" },
    messages: [{ role: "user" as const, content: `Address: ${url}\nHeadline: ${title || "(none)"}\nText: ${text.replace(/\s+/g, " ").slice(0, 700) || "(not available)"}` }],
  };
}

const FILE = "cache/domain_class.json";
let loaded = false;
/** Reads the kept classes once per process (not under tests). */
export function loadDomainClasses(file = FILE): void {
  if (loaded) return; loaded = true;
  if (process.env.VITEST || !existsSync(file)) return;
  try { domainClasses.load(JSON.parse(readFileSync(file, "utf8")) as DomainClassEntry[]); } catch { /* an unreadable cache is a fresh one */ }
}
export function saveDomainClasses(file = FILE): void {
  if (process.env.VITEST) return;
  try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(domainClasses.all(), null, 1)); } catch { /* the cache is a convenience */ }
}

export interface ClassifyDeps { ask: (request: ReturnType<typeof buildDomainClassRequest>) => Promise<unknown>; isCompanySite: (url: string) => boolean; max?: number }

/**
 * Classifies the unknown domains among these sources (those on no list, and not the company's own site, and not yet classified). Returns how many
 * were classified now. A failed call leaves the domain unclassified (it stays unlisted: not read), so a later run tries again.
 */
export async function classifyUnknownDomains(sources: Array<{ url: string; title?: string | null; content?: string | null }>, deps: ClassifyDeps): Promise<number> {
  loadDomainClasses();
  const todo = new Map<string, { url: string; title: string; text: string }>();
  for (const s of sources) {
    const key = domainClassKey(s.url);
    if (!key || todo.has(key) || domainClasses.has(s.url)) continue;
    if (deps.isCompanySite(s.url) || roundSourceStanding(s.url).kind !== "unlisted") continue;
    todo.set(key, { url: s.url, title: s.title ?? "", text: s.content ?? "" });
  }
  let n = 0;
  for (const [key, s] of [...todo].slice(0, deps.max ?? 20)) {
    try {
      const r = parseDomainClass(await deps.ask(buildDomainClassRequest(s.url, s.title, s.text)));
      domainClasses.set({ key, class: r.class, reason: r.reason, example_url: s.url, example_title: s.title.slice(0, 140), at: new Date().toISOString().slice(0, 10) });
      n++;
    } catch { /* stays unclassified */ }
  }
  if (n) saveDomainClasses();
  return n;
}
