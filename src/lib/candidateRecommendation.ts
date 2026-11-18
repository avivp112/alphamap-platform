// =============================================================================
// The analyst's recommendation for a review candidate: approve / borderline /
// reject, with the reasons in Hebrew. Pure and deterministic — the same
// evidence always gives the same answer, so it can be audited and tuned.
//
// What it reads is only what the card already shows: the registry signals
// (stage 2), the watchlist event (stage 3) and the verified website with its
// signals (stage 4). It never looks at the name to guess what a company does.
//
// It RECOMMENDS; it never rejects anything by itself. The owner decides, and
// the recommendation shown at decision time is stored so that recommendation
// and decision can be compared later (record_candidate_recommendation).
//
// The rules are the first version (owner, 2026-11-18) — tune them from that
// comparison, not from guesses.
// =============================================================================

import { formatUsd, type CandidateEvidence, type CandidateSignal, type CompanyCandidate } from "./candidateReview";

export type Verdict = "approve" | "borderline" | "reject";

export interface Recommendation {
  verdict: Verdict;
  /** Hebrew label of the verdict. */
  label: string;
  /** For the verdict first, then what speaks against it; each a short Hebrew sentence. */
  reasons: string[];
  /** The ids of the rules that fired, for the log of recommendation vs decision. */
  rules: string[];
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  approve: "מומלץ לאישור",
  borderline: "גבולי",
  reject: "לדחייה",
};

/** Sorting: recommended first, rejects last. */
export const VERDICT_ORDER: Record<Verdict, number> = { approve: 0, borderline: 1, reject: 2 };

export type RecommendationInput =
  Pick<CompanyCandidate, "source" | "evidence" | "gate_tier"> &
  Partial<Pick<CompanyCandidate, "promoted_reason">>;

/** Raising at least this much on a Form D, in a technology group, is a company with real money behind it. */
export const RAISING_MIN_USD = 1_000_000;

const CORE_GROUPS = new Set(["technology", "computers", "telecommunications", "other technology", "biotechnology"]);

// Signal kinds, in Hebrew. The registry's own wording (English) stays in the card's "Signals" line.
const POSITIVE_HE: Record<string, string> = {
  serial_founder: "מייסד סדרתי: לדירקטור יש חברות פעילות נוספות",
  known_company_link: "אחד מהדירקטורים קשור לחברה שכבר ב-AlphaMap",
  known_company_psc: "בבעלות חברה שכבר ב-AlphaMap",
  investor_psc: "בעל שליטה שנראה כמשקיע (לפי שם)",
  share_allotment: "הוגשה הקצאת מניות",
  previous_raise: "לאותו מנפיק יש גיוסים קודמים ב-Form D",
  person_prior_form_d: "אחד האנשים מופיע ב-Form D של חברה אחרת (אותו שם)",
  person_fund_manager: "אחד האנשים מנהל קרן (אותו שם)",
};
const WARNING_HE: Record<string, string> = {
  many_directorships: "דירקטור עם הרבה מינויים פעילים (דפוס אפשרי של nominee)",
  holding_psc: "בעל השליטה נראה כחברת אחזקות (לפי שם)",
  shared_address: "כתובת רשומה משותפת להרבה מועמדים (אולי סוכן הקמה)",
};
/** Registry positives strong enough, with a verified site, to recommend approval. */
const STRONG = new Set(["share_allotment", "known_company_link", "known_company_psc", "investor_psc", "serial_founder", "previous_raise", "person_prior_form_d", "person_fund_manager"]);
/** Warnings that point to a shell or a formation agent. */
const SHELL_WARNINGS = new Set(["many_directorships", "holding_psc", "shared_address"]);

const MATCH_HE: Record<string, string> = {
  director: "שם דירקטור", company_number: "מספר חברה", postcode: "מיקוד", legal_name: "שם משפטי מלא", city: "עיר", founded: "שנת הקמה",
};

const uniq = <T,>(xs: T[]): T[] => [...new Set(xs)];

function signalsOf(e: CandidateEvidence): CandidateSignal[] {
  return e.signals?.items ?? [];
}

export function recommend(c: RecommendationInput): Recommendation {
  const e = c.evidence ?? {};
  const enr = e.enrichment;
  const signals = signalsOf(e);
  const positive = uniq(signals.filter((s) => s.level === "positive").map((s) => s.kind));
  const strong = positive.filter((k) => STRONG.has(k));
  const shell = uniq(signals.filter((s) => s.level === "warning" && SHELL_WARNINGS.has(s.kind)).map((s) => s.kind));

  const siteVerified = enr?.status === "verified";
  const product = (enr?.site_signals ?? []).filter((s) => s.level === "product");
  const services = (enr?.site_signals ?? []).filter((s) => s.level === "services");
  const hasDescription = siteVerified && !!enr?.description_he;
  const raising = typeof e.total_offering === "number" ? e.total_offering : 0;
  const coreIndustry = CORE_GROUPS.has((e.industry_group ?? "").toLowerCase());
  const raisingBig = raising >= RAISING_MIN_USD;
  const surfaced = !!c.promoted_reason;

  const rules: string[] = [];
  const forV: string[] = [];
  const against: string[] = [];

  // ── What speaks for the company ──
  if (siteVerified) {
    const matches = uniq((enr!.match_signals ?? []).map((m) => MATCH_HE[m.kind] ?? m.kind)).join(", ");
    forV.push(`אתר רשמי מאומת (לפי: ${matches})`);
  }
  if (hasDescription) forV.push(`מה שהחברה אומרת על עצמה: ${enr!.description_he}`);
  if (product.length > 0) forV.push(`באתר: ${product.map((s) => s.text).join(", ")}`);
  if (raisingBig) forV.push(`גייסה ${formatUsd(raising)} לפי Form D${coreIndustry ? " בקטגוריית טכנולוגיה" : ""}`);
  for (const k of strong) forV.push(POSITIVE_HE[k]);
  if (surfaced) forV.push(`עלתה מרשימת המעקב: ${c.promoted_reason}`);

  // ── What speaks against ──
  if (siteVerified && services.length > 0) against.push(`האתר מתאר ${services.map((s) => s.text.replace("האתר מתאר ", "")).join(" ו")}`);
  for (const k of shell) against.push(WARNING_HE[k]);
  if (enr && enr.status === "no_site") against.push("לא נמצאה זהות דיגיטלית מאומתת");
  if (enr && enr.status === "unverified") against.push("נמצא אתר, אבל ההתאמה לרשומה לא מספיקה: לא נמצאה זהות דיגיטלית מאומתת");
  if (!enr && c.source === "sec_form_d") against.push("האתר עדיין לא נבדק");

  // ── The verdict ──
  let verdict: Verdict = "borderline";

  if (siteVerified && services.length > 0 && product.length === 0) {
    verdict = "reject"; rules.push("R1_services_site");
  } else if (shell.length >= 2 && strong.length === 0 && !siteVerified) {
    verdict = "reject"; rules.push("R2_shell_warnings");
  } else if (hasDescription && (product.length > 0 || raisingBig || strong.length > 0)) {
    verdict = "approve"; rules.push("A1_verified_site_with_substance");
  } else if (c.source === "sec_form_d" && coreIndustry && raisingBig && strong.length > 0) {
    verdict = "approve"; rules.push("A2_form_d_money_and_history");
  } else if (siteVerified && (strong.length > 0 || surfaced) && shell.length === 0) {
    verdict = "approve"; rules.push("A3_verified_site_with_registry_signal");
  } else {
    rules.push("B_not_enough");
  }

  // A verified site that is a services business is not rescued by money or signals.
  if (verdict === "approve" && siteVerified && services.length > 0 && product.length === 0) { verdict = "borderline"; rules.push("D_services_downgrade"); }
  // Shell warnings next to an approval are shown, and keep it from being a clean approval.
  if (verdict === "approve" && shell.length >= 2) { verdict = "borderline"; rules.push("D_shell_downgrade"); }

  const reasons = verdict === "reject" ? [...against, ...forV] : [...forV, ...against];
  if (reasons.length === 0) reasons.push("אין עדיין מספיק מידע בכרטיס כדי להמליץ");
  return { verdict, label: VERDICT_LABEL[verdict], reasons: reasons.slice(0, 7), rules };
}
