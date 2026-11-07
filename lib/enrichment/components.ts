/**
 * lib/enrichment/components.ts — one switch per v2 component that adds data
 * on top of the core run (owner, 2026-10-29). The core is always on: the
 * company's site, the first-pass searches, the entity filter, the three
 * extraction calls and every rule. Each component below can be turned off
 * to measure what it adds or breaks on the golden set (eval/run_eval.ts).
 *
 *   V2_COMPONENTS=baseline        every component off (the core alone)
 *   V2_COMPONENTS=all             every component on
 *   V2_COMPONENTS=hints=off       the defaults below, one changed
 *   V2_COMPONENTS=baseline,hints=on   the core plus one component
 *
 * `on` is the default for every run (bulk, worker, eval) when nothing is set.
 */

export const V2_COMPONENTS = {
  full_articles: {
    on: true, since: "2026-10-08",
    what: "Stage 3b — reads the 4 most useful articles in full instead of their search snippets",
  },
  deep_dive: {
    on: true, since: "2026-10-08",
    what: "Stage 9 — targeted searches and extra extraction calls for sections that came back thin",
  },
  linkedin_people: {
    on: false, since: "2026-10-08", // off by the owner, 2026-11-02: LinkedIn is never a source for any field
    what: "Stage 9b — founders' and leaders' LinkedIn profiles, bios from the public snippet, founder discovery",
  },
  founders_from_sentences: {
    on: true, since: "2026-10-08",
    what: "adds a founder a \"founded by\" sentence names — only on the company's site or in the press of tiers 1–3 (owner, 2026-11-01; off 2026-10-29 – 11-01)",
  },
  epo_patents: {
    on: true, since: "2026-10-26",
    what: "Stage 8b — patents from the EPO register, the company as applicant",
  },
  hints: {
    on: true, since: "2026-10-29",
    what: "Stage 5b — searches a primary source for a round only a data platform states",
  },
  hq_search: {
    on: true, since: "2026-11-01",
    what: "one more search for the press's own headquarters phrase (\"Tel Aviv-based Hailo\"), without the domain anchor",
  },
  registers: {
    on: true, since: "2026-11-02",
    what: "founded year and founding country from Companies House, the Israeli registrar and SEC Form D, on a certain match only — beats any article (registers.ts)",
  },
  press_about: {
    on: true, since: "2026-11-02",
    what: "the \"About <Company>\" paragraph of its own press releases (wires, its press page): HQ and founding year as the company's own declaration — two searches, two pages read",
  },
  legal_pages: {
    on: true, since: "2026-11-02",
    what: "its Terms / Privacy / Legal / Imprint pages: legal name (anchors the registers), company number, registered office (an office, not the HQ)",
  },
  competitor_tiers: {
    on: true, since: "2026-11-07",
    what: "competitors by tier (competitorTiers.ts): declared — rival sentences of the pages read, \"X vs Y\" pages of the company's and the competitor's own site; market — the model's hints, each kept only when an allowed source puts both in one market. Searches come from the extra budget (EXTRA_SEARCHES, default 4)",
  },
  founder_background: {
    on: true, since: "2026-11-07",
    what: "structured facts per founder (previous company and role, exit, education, military unit), each with a quote from an allowed source (founderBackground.ts); one targeted search for the founders, from the extra budget",
  },
  headcount_sources: {
    on: true, since: "2026-11-08",
    what: "headcount points with date, source, quote and type: Companies House accounts (average employees), Brreg, and team-size sentences of archived About / Careers pages on the Wayback Machine (headcountCollect.ts); robots.txt honoured, one request a second",
  },
  profile_hints: {
    on: false, since: "2026-11-02", // off by the owner, 2026-11-02: 0 of 7 confirmed on the 10-company check
    what: "an HQ / founding year / founding country only a data platform states is not written, but searched for once in an allowed source that confirms it",
  },
  search_backup: {
    on: true, since: "2026-10-29",
    what: "Jina Search answers a search Serper could not; Serper scrape reads a page Jina could not",
  },
} as const;

export type V2Component = keyof typeof V2_COMPONENTS;
export const V2_COMPONENT_NAMES = Object.keys(V2_COMPONENTS) as V2Component[];

/** Every component's state under a V2_COMPONENTS setting (see the header). */
export function componentStates(setting: string | undefined = process.env.V2_COMPONENTS): Record<V2Component, boolean> {
  const states = Object.fromEntries(V2_COMPONENT_NAMES.map((n) => [n, V2_COMPONENTS[n].on as boolean])) as Record<V2Component, boolean>;
  for (const part of (setting ?? "").split(",").map((p) => p.trim().toLowerCase()).filter(Boolean)) {
    if (part === "baseline" || part === "all") {
      for (const n of V2_COMPONENT_NAMES) states[n] = part === "all";
      continue;
    }
    const [name, value] = part.split("=");
    if (!(name in V2_COMPONENTS) || (value !== "on" && value !== "off")) throw new Error(`V2_COMPONENTS: "${part}" is not baseline, all, or <component>=on|off (components: ${V2_COMPONENT_NAMES.join(", ")})`);
    states[name as V2Component] = value === "on";
  }
  return states;
}

export function componentOn(name: V2Component, setting: string | undefined = process.env.V2_COMPONENTS): boolean {
  return componentStates(setting)[name];
}
