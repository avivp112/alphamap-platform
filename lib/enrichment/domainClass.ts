/**
 * lib/enrichment/domainClass.ts — an unknown source domain is classified once, by a model, and the answer is kept (owner, 2026-11-14), instead of a
 * hand-kept allowlist alone. The classes:
 *   news_outlet / wire      an outlet or a press-release service that is on no list → tier 4, the weakest (never wins a contradiction)
 *   investor                a fund / investor: the existing rule decides (allowed only when the investor is named in another allowed source)
 *   company_owned           a company's own site about itself: another company's own site is no source for this one → blocked
 *   directory_aggregator    company directories, "alternatives", review and comparison listings → blocked
 *   blog_vendor_other       blogs, vendor marketing / partner / case-study pages, reviews, anything else → blocked
 * The hard lists (roundSources.ts: tiers, denied, hint-only, data platforms) always win; this is consulted only for a domain that is on none.
 * This file is pure data + parsing; the model call is domainClassify.ts.
 */
import { registrable } from "./addCompanies.ts";

export const DOMAIN_CLASSES = ["news_outlet", "wire", "investor", "company_owned", "directory_aggregator", "blog_vendor_other"] as const;
export type DomainClass = (typeof DOMAIN_CLASSES)[number];

/** A first path segment that makes one site several things (a directory under an association's site, partner pages under a vendor's). */
const SECTION = /^(companies|company|startups?|orgs?|organi[sz]ations?|directory|directories|profiles?|partners?|partner|case-?studies|customers?|reviews?|alternatives|compare|comparison|vs|blog|resources|guides?|learn|tools?|software|products?)$/i;

/** host (without www, to its registrable domain) + the first path segment when it is a section word. */
export function domainClassKey(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = registrable(u.hostname.toLowerCase().replace(/^www\./, ""));
    const seg = u.pathname.split("/").filter(Boolean)[0] ?? "";
    return SECTION.test(seg) ? `${host}/${seg.toLowerCase()}` : host;
  } catch { return null; }
}

export interface DomainClassEntry { key: string; class: DomainClass; reason: string; example_url: string; example_title: string; at: string }

export class DomainClassRegistry {
  private map = new Map<string, DomainClassEntry>();
  private fresh = new Set<string>();
  load(entries: DomainClassEntry[]): void { for (const e of entries) this.map.set(e.key, e); }
  get(url: string): DomainClassEntry | undefined {
    const key = domainClassKey(url);
    if (!key) return undefined;
    return this.map.get(key);
  }
  has(url: string): boolean { return !!this.get(url); }
  set(e: DomainClassEntry): void { this.map.set(e.key, e); this.fresh.add(e.key); }
  /** The classes decided in this run (for the owner to check). */
  newThisRun(): DomainClassEntry[] { return [...this.fresh].map((k) => this.map.get(k)!).filter(Boolean); }
  all(): DomainClassEntry[] { return [...this.map.values()]; }
  clear(): void { this.map.clear(); this.fresh.clear(); }
}
export const domainClasses = new DomainClassRegistry();

export function parseDomainClass(input: unknown): { class: DomainClass; reason: string } {
  const c = (input as { class?: unknown })?.class;
  return { class: (DOMAIN_CLASSES as readonly string[]).includes(c as string) ? (c as DomainClass) : "blog_vendor_other", reason: String((input as { reason?: unknown })?.reason ?? "no answer").slice(0, 200) };
}

/** What a class means for the source's standing: allowed (tier 4, low confidence), denied, or "leave it" (the existing investor rule). */
export function standingOfClass(c: DomainClass): { kind: "allowed"; tier: 4; lowConfidence: true; why: string } | { kind: "denied"; why: string } | null {
  if (c === "news_outlet" || c === "wire") return { kind: "allowed", tier: 4, lowConfidence: true, why: `auto_${c}` };
  if (c === "investor") return null;
  return { kind: "denied", why: `auto_${c}` };
}

export function domainClassesCsv(rows: DomainClassEntry[]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const effect = (c: DomainClass) => (c === "news_outlet" || c === "wire" ? "allowed, tier 4 (weakest)" : c === "investor" ? "investor rule (only if named in another allowed source)" : "blocked");
  return "﻿" + ["domain,class,effect,reason,example_title,example_url", ...rows.map((r) => [r.key, r.class, effect(r.class), r.reason, r.example_title, r.example_url].map(cell).join(","))].join("\r\n") + "\r\n";
}
