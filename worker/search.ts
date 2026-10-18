// The worker's Serper call. Unlike lib/enrichment's serperSearch(), which
// returns [] on any failure (right for a bulk run that should keep going), a
// check must tell "nothing found" apart from "the search did not run": an
// empty result turns into a stealth verdict, and a rejected key would turn
// every check into one. So here a rejected key throws ProviderKeyError, a
// rate limit or provider outage throws a transient error, and every billed
// call is counted on the run's meter.

import { parseSerperResponse } from "../lib/enrichment/searchProviders.ts";
import type { RawSearchResult } from "../lib/enrichment/sources.ts";
import { ProviderKeyError } from "./retry.ts";
import type { Meter } from "./runner.ts";

export interface KnowledgeGraph {
  title: string | null;
  website: string | null;
  description: string | null;
  attributes: Record<string, string>;
}

export interface SearchResult {
  organic: RawSearchResult[];
  knowledgeGraph: KnowledgeGraph | null;
}

export type Search = (query: string, label: string) => Promise<SearchResult>;

interface SerperBody {
  organic?: Array<{ title: string; link: string; snippet: string }>;
  knowledgeGraph?: { title?: string; website?: string; description?: string; attributes?: Record<string, string> };
}

const TIMEOUT_MS = 15_000;

/** Pure: the parts of a Serper response a check uses. */
export function parseSearch(body: SerperBody, label: string): SearchResult {
  const kg = body.knowledgeGraph;
  return {
    organic: parseSerperResponse(body, label),
    knowledgeGraph: kg && (kg.title || kg.website)
      ? { title: kg.title ?? null, website: kg.website ?? null, description: kg.description ?? null, attributes: kg.attributes ?? {} }
      : null,
  };
}

export function serperSearch(key: string, meter: Meter): Search {
  return async (query, label) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: 10, autocorrect: false }),
        signal: controller.signal,
      });
    } catch (e) {
      throw new Error(`Serper network error: ${e instanceof Error && e.name === "AbortError" ? "timed out" : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      if (res.status === 401 || res.status === 403) throw new ProviderKeyError("Serper", `HTTP ${res.status}`);
      if ((res.status === 400 || res.status === 402) && /credit/i.test(text)) throw new ProviderKeyError("Serper", "out of credits");
      throw new Error(`Serper HTTP ${res.status}${text ? ` — ${text}` : ""}`);
    }
    meter.searchCalls++;
    return parseSearch(await res.json() as SerperBody, label);
  };
}
