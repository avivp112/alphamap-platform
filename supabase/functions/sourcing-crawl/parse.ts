// =============================================================================
// sourcing-crawl/parse.ts — each ATS's job list, normalised. Pure (no network,
// no Deno imports), so it is unit-tested under vitest (parse.test.ts).
//
// department and location feed the hiring section of a company's profile
// (migration 20261029000000). Every provider gives them in the same payload
// the crawler already fetches, except Greenhouse, whose departments come from
// /v1/boards/{token}/departments (departmentsByJobId). Missing is null — never
// guessed from the title.
// =============================================================================

/** A job as we care about it, normalised across providers. */
export interface NormalisedJob {
  external_job_id: string;
  title: string;
  url: string;
  department?: string | null;
  location?: string | null;
}

export const str = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && isFinite(v)) return String(v);
  return null;
};

/** Fits the varchar(255) columns; whitespace collapsed. */
const label = (v: unknown): string | null => {
  const s = str(v);
  return s ? s.replace(/\s+/g, " ").slice(0, 255) : null;
};

/** "London, United Kingdom" from whichever of city/region/country a provider gives. */
const place = (...parts: unknown[]): string | null =>
  label([...new Set(parts.map(str).filter((p): p is string => !!p))].join(", "));

/**
 * Greenhouse: { jobs: [ { id, title, absolute_url, location: { name } } ] }
 * `id` is numeric in the payload — coerced to string because external_job_id
 * is varchar (Lever uses UUIDs, so the column cannot be numeric). Departments
 * are not in this payload: see departmentsByJobId.
 */
export function parseGreenhouse(payload: unknown): NormalisedJob[] {
  const jobs = (payload as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) return [];
  const out: NormalisedJob[] = [];
  for (const j of jobs) {
    const o = j as Record<string, unknown>;
    const id = str(o?.id);
    const title = str(o?.title);
    const url = str(o?.absolute_url);
    // A job with no id cannot be tracked idempotently; skip rather than invent
    // a surrogate that would duplicate on the next crawl.
    if (!id || !title || !url) continue;
    out.push({ external_job_id: id, title, url, location: label((o?.location as Record<string, unknown> | undefined)?.name) });
  }
  return out;
}

/**
 * Greenhouse /departments: { departments: [ { name, parent_id, jobs: [ { id } ] } ] }
 * A job listed under a sub-department is also listed under its parent; the
 * most specific one (a department with no child holding the job) wins.
 * "No Department" is Greenhouse's placeholder, not a department.
 */
export function departmentsByJobId(payload: unknown): Map<string, string> {
  const depts = (payload as { departments?: unknown })?.departments;
  const out = new Map<string, string>();
  if (!Array.isArray(depts)) return out;
  const parents = new Set(depts.map((d) => str((d as Record<string, unknown>)?.parent_id)).filter(Boolean));
  // Leaves first, so a child's name is set before its parent's could be.
  const ordered = [...depts].sort((a, b) =>
    Number(parents.has(str((a as Record<string, unknown>)?.id))) - Number(parents.has(str((b as Record<string, unknown>)?.id))));
  for (const d of ordered) {
    const o = d as Record<string, unknown>;
    const name = label(o?.name);
    if (!name || /^no department$/i.test(name) || !Array.isArray(o?.jobs)) continue;
    for (const j of o.jobs as unknown[]) {
      const id = str((j as Record<string, unknown>)?.id);
      if (id && !out.has(id)) out.set(id, name);
    }
  }
  return out;
}

/**
 * Lever: a bare array of postings, title under `text`, link under `hostedUrl`
 * (falling back to `applyUrl`, which some older boards return instead);
 * categories.department (or .team) and categories.location.
 */
export function parseLever(payload: unknown): NormalisedJob[] {
  if (!Array.isArray(payload)) return [];
  const out: NormalisedJob[] = [];
  for (const p of payload) {
    const o = p as Record<string, unknown>;
    const id = str(o?.id);
    const title = str(o?.text);
    const url = str(o?.hostedUrl) ?? str(o?.applyUrl);
    if (!id || !title || !url) continue;
    const c = (o?.categories ?? {}) as Record<string, unknown>;
    out.push({ external_job_id: id, title, url, department: label(c.department) ?? label(c.team), location: label(c.location) });
  }
  return out;
}

/**
 * Ashby: { jobs: [ { id, title, jobUrl, applyUrl, isListed, department, team, location } ] }
 *
 * isListed is respected when present: Ashby uses it to mark a posting that
 * exists but is not shown on the public board. Treating an unlisted posting as
 * live would report roles the company is not actually advertising. Absent
 * field = listed, since older payloads omit it entirely.
 */
export function parseAshby(payload: unknown): NormalisedJob[] {
  const jobs = (payload as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) return [];
  const out: NormalisedJob[] = [];
  for (const j of jobs) {
    const o = j as Record<string, unknown>;
    if (o?.isListed === false) continue;
    const id = str(o?.id);
    const title = str(o?.title);
    const url = str(o?.jobUrl) ?? str(o?.applyUrl);
    if (!id || !title || !url) continue;
    out.push({ external_job_id: id, title, url, department: label(o?.department) ?? label(o?.team), location: label(o?.location) });
  }
  return out;
}

/**
 * Workable: { name, jobs: [ { id, shortcode, title, url, application_url, department, city, state, country } ] }
 *
 * Identity prefers `shortcode` over `id`: the shortcode is the stable public
 * handle that appears in the posting URL, while `id` has been observed to be
 * an internal numeric that is not guaranteed stable across payload versions.
 * Getting this wrong would break idempotency and duplicate every posting on
 * the next crawl, so the more durable key wins.
 *
 * Some payloads omit `url` and give only a shortcode, so the canonical link is
 * reconstructed from the board token when needed.
 */
export function parseWorkable(payload: unknown, token = ""): NormalisedJob[] {
  const jobs = (payload as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs)) return [];
  const out: NormalisedJob[] = [];
  for (const j of jobs) {
    const o = j as Record<string, unknown>;
    const shortcode = str(o?.shortcode);
    const id = shortcode ?? str(o?.id);
    const title = str(o?.title);
    const url =
      str(o?.url) ??
      str(o?.application_url) ??
      (shortcode && token ? `https://apply.workable.com/${token}/j/${shortcode}/` : null);
    if (!id || !title || !url) continue;
    const loc = (Array.isArray(o?.locations) ? (o.locations as Array<Record<string, unknown>>)[0] : null) ?? {};
    out.push({
      external_job_id: id, title, url,
      department: label(Array.isArray(o?.department) ? (o.department as unknown[])[0] : o?.department),
      location: place(o?.city ?? loc.city, o?.state ?? loc.region, o?.country ?? loc.country),
    });
  }
  return out;
}

// ── Comeet ────────────────────────────────────────────────────────────────────
// No public JSON API without a per-company token, but the hosted careers page
// (https://www.comeet.com/jobs/{slug}/{company_uid}) carries everything in two
// script assignments, seen 2026-10-23 on comeet.com/jobs/sett/4A.00B:
//   COMPANY_DATA = { name, website, company_uid, url_comeet_hosted_page, ... }
//   COMPANY_POSITIONS_DATA = [ { uid, name, department, location: { name, city, country },
//                                url_comeet_hosted_page, url_active_page, time_updated, ... } ]
// A board is (slug, company_uid); the uid cannot be guessed, so Comeet boards
// come only from links on company websites (worker/boards.ts).

/**
 * The JSON literal assigned to `NAME =` in a page's scripts: the object or
 * array is bracket-matched (strings and escapes respected), then JSON.parse'd.
 * null when absent or not JSON.
 */
export function scriptJson(html: string, name: string): unknown {
  const m = new RegExp(`\\b${name}\\s*=\\s*([\\[{])`).exec(html);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      if (--depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export interface ComeetPage {
  company: { name: string | null; website: string | null; uid: string | null; hosted: string | null };
  positions: unknown[];
}

/**
 * A Comeet careers page, or null when it does not carry the positions data —
 * which the crawler treats as a FAILED read (closes nothing), never as an
 * empty board.
 */
export function comeetPage(html: string): ComeetPage | null {
  const positions = scriptJson(html, "COMPANY_POSITIONS_DATA");
  if (!Array.isArray(positions)) return null;
  const c = (scriptJson(html, "COMPANY_DATA") ?? {}) as Record<string, unknown>;
  return {
    company: { name: str(c.name), website: str(c.website), uid: str(c.company_uid), hosted: str(c.url_comeet_hosted_page) },
    positions,
  };
}

export function parseComeet(payload: unknown): NormalisedJob[] {
  const positions = (payload as ComeetPage | null)?.positions;
  if (!Array.isArray(positions)) return [];
  const out: NormalisedJob[] = [];
  for (const p of positions) {
    const o = p as Record<string, unknown>;
    const id = str(o?.uid);
    const title = str(o?.name);
    const url = str(o?.url_comeet_hosted_page) ?? str(o?.url_active_page) ?? str(o?.url_detected_page);
    if (!id || !title || !url) continue;
    const loc = (o?.location ?? {}) as Record<string, unknown>;
    out.push({ external_job_id: id, title, url, department: label(o?.department), location: place(loc.city, loc.country) ?? label(loc.name) });
  }
  return out;
}

// ── SmartRecruiters, Teamtailor, Personio, Recruitee (added 2026-10-23) ──────
// Each payload's shape as seen that day on a real board:
//   SmartRecruiters  api.smartrecruiters.com/v1/companies/{id}/postings?limit=100&offset=N
//                    { offset, limit, totalFound, content: [ { id, name, location: { city, region,
//                      country, remote }, department: { label }, company: { identifier, name } } ] }
//                    public page: jobs.smartrecruiters.com/{id}/{posting id} (200)
//   Teamtailor       {slug}.teamtailor.com/jobs.json — a JSON Feed: { home_page_url, items: [ { id,
//                    title, url, _jobposting: schema.org JobPosting } ], next_url? }
//   Personio         {slug}.jobs.personio.de/xml — <workzag-jobs><position><id/><name/><office/>
//                    <department/><subcompany/>… ; /job/{id} answered 404, so a role links to the board
//   Recruitee        {slug}.recruitee.com/api/offers/ — { offers: [ { id, title, careers_url,
//                    department, city, country, location, company_name, description } ] }

export function parseSmartRecruiters(payload: unknown, token = ""): NormalisedJob[] {
  const content = (payload as { content?: unknown })?.content;
  if (!Array.isArray(content)) return [];
  const out: NormalisedJob[] = [];
  for (const p of content) {
    const o = p as Record<string, unknown>;
    const id = str(o?.id);
    const title = str(o?.name);
    const company = str((o?.company as Record<string, unknown> | undefined)?.identifier) ?? token;
    if (!id || !title || !company) continue;
    const loc = (o?.location ?? {}) as Record<string, unknown>;
    out.push({
      external_job_id: id, title, url: `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${encodeURIComponent(id)}`,
      department: label((o?.department as Record<string, unknown> | undefined)?.label),
      location: place(loc.city, loc.region !== "Remote" ? loc.region : null, typeof loc.country === "string" ? loc.country.toUpperCase() : null),
    });
  }
  return out;
}

/** The next page of a SmartRecruiters list, or null on the last one. */
export function smartRecruitersNext(payload: unknown, token: string): string | null {
  const o = payload as { offset?: number; limit?: number; totalFound?: number } | null;
  if (typeof o?.offset !== "number" || typeof o?.limit !== "number" || typeof o?.totalFound !== "number") return null;
  const next = o.offset + o.limit;
  return next < o.totalFound && next < 2000
    ? `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100&offset=${next}` : null;
}

export function parseTeamtailor(payload: unknown): NormalisedJob[] {
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: NormalisedJob[] = [];
  for (const it of items) {
    const o = it as Record<string, unknown>;
    const id = str(o?.id);
    const title = str(o?.title);
    const url = str(o?.url);
    if (!id || !title || !url) continue;
    const jp = (o?._jobposting ?? {}) as Record<string, unknown>;
    const jl = Array.isArray(jp.jobLocation) ? (jp.jobLocation as unknown[])[0] : jp.jobLocation;
    const addr = ((jl as Record<string, unknown> | undefined)?.address ?? {}) as Record<string, unknown>;
    out.push({ external_job_id: id, title, url, department: null, location: place(addr.addressLocality, addr.addressCountry) });
  }
  return out;
}

/** The company's own website, as the board's postings declare it (schema.org hiringOrganization.sameAs). */
export function teamtailorWebsite(payload: unknown): string | null {
  for (const it of ((payload as { items?: unknown })?.items as unknown[] | undefined) ?? []) {
    const org = ((it as Record<string, unknown>)?._jobposting as Record<string, unknown> | undefined)?.hiringOrganization as Record<string, unknown> | undefined;
    const site = str(org?.sameAs) ?? str(org?.url);
    if (site && /^https?:\/\//.test(site)) return site;
  }
  return null;
}

const xmlText = (block: string, tag: string): string | null => {
  const m = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return m ? m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").trim() || null : null;
};

export interface PersonioFeed { positions: Array<Record<string, string | null>> }

/** Personio's XML feed, or null when the body is not one — a FAILED read, never an empty board. */
export function personioXml(xml: string): PersonioFeed | null {
  if (!/<workzag-jobs\b/.test(xml)) return null;
  const positions = [...xml.matchAll(/<position>([\s\S]*?)<\/position>/g)].map(([, b]) => {
    const descriptions = [...b.matchAll(/<value>([\s\S]*?)<\/value>/g)].map(([, v]) => v.replace(/<!\[CDATA\[|\]\]>/g, "")).join(" ");
    return {
      id: xmlText(b, "id"), name: xmlText(b, "name"), office: xmlText(b, "office"), department: xmlText(b, "department"),
      subcompany: xmlText(b, "subcompany"), description: descriptions ? xmlText(`<d>${descriptions}</d>`, "d") : null,
    };
  });
  return { positions };
}

export function parsePersonio(payload: unknown, token = ""): NormalisedJob[] {
  const positions = (payload as PersonioFeed | null)?.positions;
  if (!Array.isArray(positions)) return [];
  const board = `https://${token}.jobs.personio.de/`;
  return positions.flatMap((p) => (p.id && p.name
    ? [{ external_job_id: p.id, title: p.name, url: board, department: label(p.department), location: label(p.office) }] : []));
}

export function parseRecruitee(payload: unknown): NormalisedJob[] {
  const offers = (payload as { offers?: unknown })?.offers;
  if (!Array.isArray(offers)) return [];
  const out: NormalisedJob[] = [];
  for (const of of offers) {
    const o = of as Record<string, unknown>;
    if (typeof o?.status === "string" && o.status !== "published") continue;
    const id = str(o?.id);
    const title = str(o?.title);
    const url = str(o?.careers_url);
    if (!id || !title || !url) continue;
    out.push({ external_job_id: id, title, url, department: label(o?.department), location: place(o?.city, o?.country) ?? label(o?.location) });
  }
  return out;
}
