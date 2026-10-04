/**
 * lib/enrichment/websiteValidation.ts — v2's copy of v1's website
 * validation logic (ground rule 3: "keep what works" explicitly names
 * validateWebsiteCandidate() and the website UNIQUE handling).
 *
 * Faithfully ported from scripts/bulk_enrich_all.ts's private
 * websiteDomain/isGenericDirectoryDomain/normalizeWebsiteUrl/
 * validateWebsiteCandidate (same reasoning as sanitize.ts: v1 is frozen to
 * exactly two authorized changes, so this is duplicated rather than
 * imported). The one structural change: v1's validateWebsiteCandidate reads
 * a module-level `startupByDomain` global built once per run; here it's an
 * explicit parameter instead, so this stays a pure, independently-testable
 * function rather than depending on hidden global state.
 */

export function websiteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

const GENERIC_DIRECTORY_DOMAINS = new Set([
  "find-and-update.company-information.service.gov.uk", "gov.uk", "companieshouse.gov.uk",
  "opencorporates.com", "sec.gov", "dnb.com", "bizfile.gov.sg", "companycheck.co.uk",
  "crunchbase.com", "pitchbook.com", "tracxn.com", "dealroom.co", "cbinsights.com",
  "owler.com", "zoominfo.com", "apollo.io", "craft.co", "growjo.com", "theorg.com",
  "sifted.eu", "techcrunch.com",
  "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com", "github.com",
  "huggingface.co", "youtube.com", "medium.com",
  "example.com", "example.org", "example.net", "n-a.com", "none.com", "unknown.com",
  "tbd.com", "placeholder.com", "domain.com", "yourcompany.com", "company.com",
]);

export function isGenericDirectoryDomain(domain: string): boolean {
  for (const generic of GENERIC_DIRECTORY_DOMAINS) {
    if (domain === generic || domain.endsWith(`.${generic}`)) return true;
  }
  return false;
}

export function normalizeWebsiteUrl(raw: string): string | null {
  const stripped = raw.trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
  return stripped ? `https://${stripped}` : null;
}

export interface DomainOwner { id: string; name: string }

export interface WebsiteValidationResult {
  website: string | null;
  rejectedReason?: "generic_directory" | "claimed_by_other_startup";
  rejectedOwnerName?: string;
}

/**
 * Returns the normalized URL if it's safe to write, or a rejection reason
 * if not (generic directory/aggregator link, or already claimed by a
 * DIFFERENT startup — startups.website is UNIQUE, and writing a value
 * another row owns would fail that row's entire profile patch, not just
 * this field).
 */
export function validateWebsiteCandidate(
  raw: string,
  startupId: string,
  startupByDomain: Map<string, DomainOwner>,
): WebsiteValidationResult {
  const normalized = normalizeWebsiteUrl(raw);
  if (!normalized) return { website: null };

  const domain = websiteDomain(normalized);
  if (!domain) return { website: null };

  if (isGenericDirectoryDomain(domain)) {
    return { website: null, rejectedReason: "generic_directory" };
  }

  const existingOwner = startupByDomain.get(domain);
  if (existingOwner && existingOwner.id !== startupId) {
    return { website: null, rejectedReason: "claimed_by_other_startup", rejectedOwnerName: existingOwner.name };
  }

  return { website: normalized };
}
