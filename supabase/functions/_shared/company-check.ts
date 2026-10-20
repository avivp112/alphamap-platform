// =============================================================================
// _shared/company-check.ts — pure logic of the "check a company" service:
// input validation and normalisation, and the allowance decision. No network,
// no Deno APIs, so vitest covers it (company-check.test.ts) and the Edge
// Function and the worker share one definition.
// =============================================================================

import { limitsFor, DEEPEN_FREE_BELOW, DEEPEN_ALWAYS_BELOW, FRESH_ENOUGH_DAYS, type CheckLimits } from "./check-limits.ts";

export interface CheckInputRaw {
  name?: unknown;
  website?: unknown;
  country?: unknown;
  founder?: unknown;
  linkedin?: unknown;
  sector?: unknown;
}

export interface CheckInput {
  name: string;
  /** https://host[/path] or null. */
  website: string | null;
  /** Lower-case host without www., or null. The database derives the registrable domain from `website`. */
  host: string | null;
  country: string | null;
  founder: string | null;
  /** A LinkedIn COMPANY page (linkedin.com/company/<slug>), or null. */
  linkedin: string | null;
  sector: string | null;
}

export type ValidationResult = { ok: true; input: CheckInput } | { ok: false; errors: Record<string, string> };

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

/** "acme.ai", "www.acme.ai/about", "https://acme.ai" -> https URL + host; null when it is not a web address. */
export function normalizeWebsite(raw: string): { website: string; host: string } | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host.endsWith(".")) return null;
  // Profiles on platforms are not the company's own site.
  if (/(^|\.)(linkedin\.com|crunchbase\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|github\.com)$/.test(host)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  return { website: `https://${host}${path}`, host };
}

/** Only a company page: linkedin.com/company/<slug>. A personal profile (/in/) is not a company anchor. */
export function normalizeLinkedIn(raw: string): string | null {
  const m = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/company\/([A-Za-z0-9_\-.%]+)/i.exec(raw.trim());
  return m ? `https://www.linkedin.com/company/${m[1].toLowerCase()}` : null;
}

export function validateCheckInput(raw: CheckInputRaw): ValidationResult {
  const errors: Record<string, string> = {};
  const name = clean(raw.name, 120);
  if (!name || name.length < 2) errors.name = "Company name is required.";

  let website: string | null = null, host: string | null = null;
  const w = clean(raw.website, 300);
  if (w) {
    const n = normalizeWebsite(w);
    if (!n) errors.website = "That does not look like the company's own website.";
    else ({ website, host } = n);
  }

  let linkedin: string | null = null;
  const l = clean(raw.linkedin, 300);
  if (l) {
    linkedin = normalizeLinkedIn(l);
    if (!linkedin) errors.linkedin = "Use the company's LinkedIn page (linkedin.com/company/…).";
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    input: {
      name: name!, website, host, linkedin,
      country: clean(raw.country, 80),
      founder: clean(raw.founder, 120),
      sector: clean(raw.sector, 60),
    },
  };
}

export interface AllowanceInput {
  plan: string | null | undefined;
  /** Checks this month that count against the allowance. */
  chargedThisMonth: number;
  /** All requests in the last hour (rate limit). */
  requestsLastHour: number;
}

export type AllowanceDecision =
  | { ok: true; limits: CheckLimits; remaining: number }
  | { ok: false; reason: "rate_limited" | "monthly_limit"; limits: CheckLimits; remaining: number };

/**
 * Whether a new request may proceed. The rate limit applies to every request
 * (a lookup that matches an existing company included); the monthly
 * allowance only to checks that actually run.
 */
export function decideAllowance(a: AllowanceInput, willRun: boolean): AllowanceDecision {
  const limits = limitsFor(a.plan);
  const remaining = Math.max(0, limits.checksPerMonth - a.chargedThisMonth);
  if (a.requestsLastHour >= limits.requestsPerHour) return { ok: false, reason: "rate_limited", limits, remaining };
  if (willRun && remaining <= 0) return { ok: false, reason: "monthly_limit", limits, remaining };
  return { ok: true, limits, remaining };
}

export type DeepenDecision =
  | { ok: true; free: boolean }
  | { ok: false; reason: "recently_updated"; updatedDaysAgo: number };

/**
 * May this company be deepened, and is it free? A thin profile always may,
 * free of the allowance; a fuller one only if v2 has not updated it lately.
 */
export function decideDeepen(
  f: { completeness: number; enrichedV2At: string | null },
  now: Date,
  limits = { freeBelow: DEEPEN_FREE_BELOW, alwaysBelow: DEEPEN_ALWAYS_BELOW, freshDays: FRESH_ENOUGH_DAYS },
): DeepenDecision {
  const free = f.completeness < limits.freeBelow;
  if (f.completeness < limits.alwaysBelow || !f.enrichedV2At) return { ok: true, free };
  const days = (now.getTime() - Date.parse(f.enrichedV2At)) / 86_400_000;
  if (Number.isFinite(days) && days <= limits.freshDays) return { ok: false, reason: "recently_updated", updatedDaysAgo: Math.floor(days) };
  return { ok: true, free };
}

export type ConfirmResult =
  | { ok: true; identity: Record<string, unknown>; input: CheckInput; startupId: string | null }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The user's answer to "is this the company?": a candidate's index, or
 * "none" (run with what they typed). A chosen candidate's website becomes the
 * check's website; one already in AlphaMap returns its startup id, so the
 * company is shown instead of running anything.
 */
export function applyChoice(input: CheckInput, candidates: unknown, choice: unknown): ConfirmResult {
  if (choice === "none") return { ok: true, identity: {}, input, startupId: null };
  const list = Array.isArray(candidates) ? candidates : [];
  if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice >= list.length) {
    return { ok: false, error: "That company is not one of the options." };
  }
  const c = list[choice] as Record<string, unknown>;
  const site = typeof c.website === "string" ? normalizeWebsite(c.website) : null;
  return {
    ok: true,
    identity: c,
    input: site ? { ...input, website: site.website, host: site.host } : input,
    startupId: typeof c.startup_id === "string" && UUID.test(c.startup_id) ? c.startup_id : null,
  };
}

/** First instant of the current UTC month. */
export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
