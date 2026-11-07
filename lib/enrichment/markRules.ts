/**
 * lib/enrichment/markRules.ts — a marked value judged by the CURRENT rules alone (owner,
 * 2026-11-04): the stored value and its source, no search, no model. A mark stays in the count
 * unless a current rule demonstrably rejects its value; when no rule can tell from what is
 * stored, it stays.
 *
 * (The first replay, 2026-11-05, re-ran the whole collection: 76 of 141 marks "disappeared" —
 * every EPO patent, run 4's leaders of the day before — because a second run does not return
 * the same things. That measures the run's luck, not the rules.)
 */
import { classifySourceType } from "./sources";
import { profileSourceAllowed, roundSourceStanding } from "./roundSources";
import { roleAtCompany, isOrganisationName } from "./people";
import { RAISE_RE, statesAmount } from "./assemble";
import { dateFromUrl } from "./evidence";
import { isLinkList, quoteIsAboutTheCompany, quoteLinksTheTwo } from "./competitorEvidence";
import type { Mark } from "./fieldReview";

export interface MarkContext {
  /** The company's own domain ("dlight.com"), when known. Without it an unlisted source is not judged. */
  domain?: string | null;
  /** The quote stored with the value (field_review/run_N.csv): a competitor's is judged by it. */
  quote?: string | null;
}
export interface MarkJudgment { produced: boolean; rule?: string }

const PROFILE = new Set(["hq_city", "hq_country", "founded_year", "founding_country", "office", "employee_range", "employee_count", "founder", "founder_bio", "leader"]);
const keep: MarkJudgment = { produced: true };
const out = (rule: string): MarkJudgment => ({ produced: false, rule });

/** Name and the rest of a "Name — Role · bio" / "Name: bio" value. */
function splitPerson(value: string): { name: string; rest: string } {
  const m = value.match(/^(.+?)\s+—\s+(.*)$/s) ?? value.match(/^(.+?):\s+(.*)$/s);
  return m ? { name: m[1].trim(), rest: m[2].trim() } : { name: value.trim(), rest: "" };
}

export function judgeMark(mark: Mark, ctx: MarkContext = {}): MarkJudgment {
  const url = mark.source_url?.trim() ?? "";
  const company = mark.company;

  // ── The source ──────────────────────────────────────────────────────────────
  if (url) {
    const host = (() => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } })();
    const ownSite = !!ctx.domain && (host === ctx.domain || host.endsWith(`.${ctx.domain}`));
    if (PROFILE.has(mark.field)) {
      const sourceType = ownSite ? "company_site" : classifySourceType(url, ctx.domain);
      const allowed = profileSourceAllowed({ url, source_type: sourceType }, company);
      if (!allowed) {
        const standing = roundSourceStanding(url, { companyName: company });
        // Denied outright (data platform, social network, hint-only…) is a rule's rejection; an
        // unlisted site may be the company's own — judged only when its domain is known.
        // A republisher (Yahoo, TradingView…) is judged by its text, which is not stored: it stays.
        if (standing.kind === "denied" && standing.why !== "republished_without_allowed_original") return out(`source not allowed (${standing.why})`);
        if (standing.kind === "unlisted" && ctx.domain) return out("source not listed");
        // A leader's source here is only the first allowed page that names them: no judgment on its tier.
        if (standing.kind === "allowed" && mark.field !== "leader") return out("source above tier 3 for a profile field");
      }
    } else if (mark.field === "news" || mark.field === "competitor" || mark.field === "competitor_declared" || mark.field === "competitor_market" || mark.field === "round") {
      const standing = roundSourceStanding(url, { companyName: company, isCompanySite: ownSite });
      if (standing.kind === "denied" && standing.why !== "republished_without_allowed_original") return out(`source not allowed (${standing.why})`);
      // An unlisted site may be an investor's or a party's own release, which the stored value alone
      // cannot show (Laminar's news on its investor Insight Partners' site, run 3): it stays.
    }
  }

  switch (mark.field) {
    case "leader": {
      const { name, rest } = splitPerson(mark.value);
      // No source at all: a leader needs an allowed source that names them (field review run 1).
      if (!url) return out("no source");
      const role = rest.split(" · ")[0];
      const cls = roleAtCompany(role, company);
      if (cls.kind === "advisor") return out("an advisor");
      if (cls.kind === "board") return out("the board, kept apart");
      if (isOrganisationName(name)) return out("an organisation, not a person");
      return keep;
    }
    case "founder": {
      const { name, rest } = splitPerson(mark.value);
      if (isOrganisationName(name)) return out("an organisation, not a person");
      if (rest && roleAtCompany(rest, company).role === null) return out("a title at another company");
      return keep;
    }
    case "founder_bio": {
      const { name, rest } = splitPerson(mark.value);
      const parts = name.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      // A stored fragment ("founder and CEO of …") cannot be judged: it stays.
      if (!rest || /^[a-z…]/.test(rest)) return keep;
      const about = rest.split(/(?<=[.!?])\s+/).some((s) => parts.some((w) => s.toLowerCase().includes(w)) || /\b(he|she|his|her|they|their)\b/i.test(s));
      return about ? keep : out("not about the person");
    }
    case "competitor": case "competitor_declared": case "competitor_market": {
      // The quote must say, of the company, that it competes with this one (competitorEvidence.ts, owner 2026-11-06):
      // not a row of "X vs Y" links, not a rival of a third party ("Rippling competes with HiBob, Namely, BambooHR").
      const q = ctx.quote?.trim();
      if (!q) return keep;
      const ownSite = !!ctx.domain && (() => { try { const h = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); return h === ctx.domain || h.endsWith(`.${ctx.domain}`); } catch { return false; } })();
      if (isLinkList(q)) return out("a row of links, not a quote");
      // Without the mark's source (a competitors-sheet mark kept none) a "we / our" on its own site cannot be recognised: not judged.
      if (url && !quoteIsAboutTheCompany(q, company, ownSite)) return out("the quote is not about the company");
      if (!quoteLinksTheTwo(q, company, mark.value)) return out("the quote does not link the company and this competitor directly");
      return keep;
    }
    case "round": {
      // No amount while its own source's address states one (Forward Financing, run 3).
      if (/amount not disclosed/i.test(mark.value) && url && statesAmount(url)) return out("amount stated in its source");
      // Dated by an article that does not announce a raise (Speedb, run 4).
      const date = mark.value.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
      if (date && url && dateFromUrl(url) === date) {
        const slug = decodeURIComponent(new URL(url).pathname).replace(/[-_/]+/g, " ");
        if (!RAISE_RE.test(slug)) return out("dated by an article that does not announce the raise");
      }
      return keep;
    }
    default: return keep;
  }
}
