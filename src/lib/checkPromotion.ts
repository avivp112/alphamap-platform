// Pure helpers for the admin's "From user checks" sheet (/admin/review):
// companies users checked that wait for approval before entering AlphaMap
// (check_promotions, migration 20261025000000). The data calls live in
// ./supabase.ts.

import type { CheckInput, CheckProfile, CheckProgress, CompanyCheckGate, IdentityCandidate, InvestorFact } from "./companyCheck";
import { formatUsd } from "./candidateReview";

export type PromotionStatus = "pending" | "approved" | "writing" | "written" | "linked" | "rejected" | "failed";

/** The sheet's three tabs. */
export type PromotionTab = "pending" | "accepted" | "rejected";
export const PROMOTION_TABS: PromotionTab[] = ["pending", "accepted", "rejected"];

export const TAB_STATUSES: Record<PromotionTab, PromotionStatus[]> = {
  pending: ["pending"],
  accepted: ["approved", "writing", "written", "linked", "failed"],
  rejected: ["rejected"],
};

export interface CheckPromotion {
  id: string;
  check_id: string;
  status: PromotionStatus;
  startup_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  error: string | null;
  created_at: string;
  check: {
    id: string;
    input: CheckInput;
    identity: Partial<IdentityCandidate> | null;
    gate: CompanyCheckGate | null;
    result: { profile?: CheckProfile; investors?: InvestorFact[] } | null;
    progress: CheckProgress | null;
    created_at: string;
  } | null;
}

/** A failed write may be approved again only if it never created its company (its rounds would double). */
export const canRetry = (p: Pick<CheckPromotion, "status" | "startup_id">): boolean => p.status === "failed" && !p.startup_id;

/** Where the website came from: typed by the user, or picked by them from the search. */
export function identitySource(p: CheckPromotion): "your_website" | "search" | null {
  const s = p.check?.identity?.source;
  return s === "your_website" || s === "search" ? s : null;
}

export interface PromotionSummary {
  name: string;
  website: string | null;
  description: string | null;
  facts: string[];
  founders: string | null;
  funding: string | null;
  investors: string | null;
  sources: number;
}

/** What the card shows, from the check's own profile — the research the approval would write. */
export function promotionSummary(p: CheckPromotion): PromotionSummary {
  const c = p.check;
  const profile = c?.result?.profile;
  const o = profile?.overview;
  const name = (c?.identity?.name as string | undefined) || c?.input.name || "—";
  const website = (c?.identity?.website as string | undefined) ?? c?.input.website ?? null;
  const place = [o?.city?.value, o?.country?.value].filter(Boolean).join(", ");
  const facts = [
    o?.sector ?? null,
    place || null,
    o?.founded_year ? `founded ${o.founded_year.value}` : null,
    o?.headcount ? `${o.headcount.value} employees` : o?.employee_range ? `${o.employee_range} employees` : null,
  ].filter((x): x is string => !!x);

  const founders = (profile?.people.founders ?? []).map((f) => (f.title ? `${f.name} (${f.title})` : f.name));
  const rounds = profile?.funding.rounds ?? [];
  const total = formatUsd(profile?.funding.total_raised ?? null);
  const latest = [...rounds].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
  const funding = rounds.length
    ? [`${rounds.length} round${rounds.length === 1 ? "" : "s"}`, total ? `${total} raised` : null,
       latest ? `latest: ${[latest.round_type, formatUsd(latest.amount), latest.date?.slice(0, 7)].filter(Boolean).join(" ")}` : null]
        .filter(Boolean).join(" · ")
    : null;
  const investorNames = (c?.result?.investors ?? []).map((i) => i.name);

  return {
    name, website,
    description: o?.description ?? null,
    facts,
    founders: founders.length ? founders.join(", ") : null,
    funding,
    investors: investorNames.length ? investorNames.slice(0, 8).join(", ") + (investorNames.length > 8 ? ` +${investorNames.length - 8}` : "") : null,
    sources: profile?.sources_count ?? 0,
  };
}
