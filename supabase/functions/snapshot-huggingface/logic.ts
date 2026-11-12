// Pure logic of snapshot-huggingface (no Deno globals, so vitest can import it).

export const HF_API = "https://huggingface.co/api";
export const MODELS_PAGE = 100;

/** The org namespace from an HF URL, or null. "https://huggingface.co/BetaOrg/" → "betaorg"; "huggingface.co/models" → null. */
export function hfOrgFromUrl(url: string | null | undefined): string | null {
  const m = String(url ?? "").trim().match(/^(?:https?:\/\/)?(?:www\.)?huggingface\.co\/([^/?#\s]+)/i);
  if (!m) return null;
  const org = m[1].toLowerCase();
  return ["models", "datasets", "spaces", "docs", "blog", "papers", "organizations", "collections", "login", "join", "pricing", "enterprise", "tasks", "chat"].includes(org) ? null : org;
}

export interface HfOrgProfile {
  org: string;
  fullname: string | null;
  orgType: string | null;
  website: string | null;
  github: string | null;
  followers: number | null;
  isEnterprise: boolean | null;
  modelsCount: number | null;
  plan: string | null;
  numUsers: number | null;
  isVerified: boolean | null;
}

/** The organization overview, tolerant of the field names (the endpoint is not versioned). Only a published website counts. */
export function mapOrgProfile(org: string, rec: Record<string, unknown> | null | undefined): HfOrgProfile {
  const r = rec ?? {};
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown): number | null => { const n = Number(v); return v !== null && v !== "" && Number.isFinite(n) ? n : null; };
  const site = str(r.websiteUrl) ?? str(r.website) ?? str(r.homepage) ?? str(r.url);
  return {
    org: org.toLowerCase(),
    fullname: str(r.fullname) ?? str(r.name),
    orgType: str(r.type) ?? str(r.orgType),
    website: site && /^https?:\/\//i.test(site) && !/^https?:\/\/(www\.)?huggingface\.co\b/i.test(site) ? site : (site && !/\s/.test(site) && /\./.test(site) && !/huggingface\.co/i.test(site) ? `https://${site}` : null),
    github: str(r.githubUrl) ?? str(r.github),
    followers: num(r.numFollowers) ?? num(r.followerCount),
    isEnterprise: typeof r.isEnterprise === "boolean" ? r.isEnterprise : null,
    modelsCount: num(r.numModels),
    plan: str(r.plan),
    numUsers: num(r.numUsers),
    isVerified: typeof r.isVerified === "boolean" ? r.isVerified : null,
  };
}

export function orgModelsUrl(org: string, skip: number): string {
  const p = new URLSearchParams({ author: org, sort: "downloads", direction: "-1", limit: String(MODELS_PAGE), skip: String(skip), full: "true" });
  return `${HF_API}/models?${p.toString()}`;
}

export const orgOverviewUrl = (org: string): string => `${HF_API}/organizations/${encodeURIComponent(org)}/overview`;

/** Recently created models, for finding orgs we have never seen (their first model is the discovery signal). */
export function newestModelsUrl(skip: number): string {
  const p = new URLSearchParams({ sort: "createdAt", direction: "-1", limit: String(MODELS_PAGE), skip: String(skip), full: "true" });
  return `${HF_API}/models?${p.toString()}`;
}

/**
 * The links an organization publishes in its profile header, read from the org page (the overview API has no website).
 * Verified on the live pages of mistralai, stabilityai and nomic-ai (2026-11-12): the website is the FIRST external link in the header,
 * with class "leading-snug text-gray-600 hover:underline"; GitHub and Twitter follow in the next block. Only the first 120 KB are read,
 * so a link inside a model card further down is never taken. Returns nulls (never a guess) when the structure is not found.
 */
export function parseOrgPage(html: string): { website: string | null; github: string | null; twitter: string | null } {
  const head = String(html ?? "").slice(0, 120_000);
  const a = head.match(/<a[^>]*class="[^"]*leading-snug text-gray-600 hover:underline[^"]*"[^>]*href="(https?:\/\/[^"]+)"[^>]*rel="[^"]*nofollow/i)
    ?? head.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*leading-snug text-gray-600 hover:underline[^"]*"[^>]*rel="[^"]*nofollow/i);
  const decode = (u: string) => u.replace(/&amp;/g, "&");
  const website = a ? decode(a[1]) : null;
  const after = a ? head.slice((a.index ?? 0) + a[0].length, (a.index ?? 0) + a[0].length + 6000) : "";
  const gh = after.match(/href="(https:\/\/github\.com\/[^"\/]+)"/i);
  const tw = after.match(/href="(https:\/\/(?:twitter|x)\.com\/[^"\/]+)"/i);
  return { website: website && !/^https?:\/\/(www\.)?huggingface\.co\b/i.test(website) ? website : null, github: gh ? gh[1] : null, twitter: tw ? tw[1] : null };
}

export const orgPageUrl = (org: string): string => `https://huggingface.co/${encodeURIComponent(org)}`;
