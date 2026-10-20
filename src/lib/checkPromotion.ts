// Pure helpers for the admin's "From user checks" sheet (/admin/review):
// companies users checked that wait for approval before entering AlphaMap
// (check_promotions, migration 20261025000000). The data calls live in
// ./supabase.ts.

import type { CheckInput, CheckProfile, CheckProgress, CompanyCheckGate, IdentityCandidate, InvestorFact, UpdateDiff } from "./companyCheck";
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
  /** new = add the company; update = a deepen's additions to the AlphaMap company in startup_id (20261026000000). */
  kind?: "new" | "update";
  diff?: UpdateDiff | null;
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

const FIELD_LABEL: Record<string, string> = {
  founded_year: "Founded", employee_count: "Employees", employee_range: "Employee range", growth_trend: "Growth trend",
  linkedin_url: "LinkedIn", value_proposition: "Value proposition", funding_history_complete: "Funding history complete",
  revenue_estimate: "Revenue estimate", patent_count: "Patents", github_url: "GitHub", huggingface_url: "Hugging Face",
  arr_milestones: "ARR milestones", valuation_benchmarks: "Valuations", tech_stack: "Tech stack", patent_fields: "Patent fields",
};
const label = (f: string) => FIELD_LABEL[f] ?? f.charAt(0).toUpperCase() + f.slice(1).replace(/_/g, " ");

function show(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("range_low" in o || "range_high" in o) return `${formatUsd(o.range_low as number) ?? "?"}–${formatUsd(o.range_high as number) ?? "?"}`;
    return JSON.stringify(v);
  }
  const s = String(v);
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

/** An update proposal as lines the admin reads: "+ Country: Israel", "Country: Israel → UK", "+ Seed $8M 2025-05 (lead: Sequoia)". */
export function diffLines(d: UpdateDiff | null | undefined): Array<{ kind: "add" | "change"; text: string }> {
  if (!d) return [];
  const out: Array<{ kind: "add" | "change"; text: string }> = [];
  for (const f of d.fields) {
    out.push(f.from == null || f.from === ""
      ? { kind: "add", text: `${label(f.field)}: ${show(f.to)}` }
      : { kind: "change", text: `${label(f.field)}: ${show(f.from)} → ${show(f.to)}` });
  }
  for (const l of d.lists) {
    const names = l.added.slice(0, 6).join(", ") + (l.added.length > 6 ? ` +${l.added.length - 6}` : "");
    out.push({ kind: "add", text: `${label(l.field)}: ${names}` });
  }
  for (const r of d.rounds.inserts) {
    out.push({ kind: "add", text: `Round: ${[r.round_type, formatUsd(r.amount), r.date?.slice(0, 7), r.lead ? `(lead: ${r.lead})` : null].filter(Boolean).join(" ")}` });
  }
  for (const r of d.rounds.updates) out.push({ kind: "change", text: `Round ${r.round_type}: fills ${r.changes.join(", ").replace(/_/g, " ")}` });
  if (d.headcount_points) out.push({ kind: "add", text: `Headcount: ${d.headcount_points} dated point${d.headcount_points === 1 ? "" : "s"}` });
  if (d.tags.length) out.push({ kind: "add", text: `Sub-sector tags: ${d.tags.join(", ")}` });
  return out;
}
