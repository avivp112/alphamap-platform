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
