import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import { ExternalLink, Loader2, Star, X } from "lucide-react";
import { fetchStartupListRowById, type StartupListRow } from "../../../lib/supabase";
import { dealAppLink, fmtUsd, soldPct, type DealFeedRow } from "../../../lib/dealFeed";
import { formatUsdShort, trendView } from "../../../lib/startupFilters";
import { roundTypeLabel } from "../../../lib/taxonomy";
import { useDealsT } from "./useDealsT";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** One deal, in the column beside the list. Shows only what the SEC filing says, plus the company if AlphaMap has it. */
export function DealPanel({ deal, onClose, followable, following, followBusy, onToggleFollow }: {
  deal: DealFeedRow;
  onClose: () => void;
  /** False when the deal's company or firm is not in the database, so there is nothing to follow. */
  followable: boolean;
  following: boolean;
  followBusy: boolean;
  onToggleFollow: () => void;
}) {
  const tt = useDealsT();
  const isFund = deal.kind === "fund";
  const pct = soldPct(deal);
  const amended = deal.updated_date && deal.updated_date !== deal.deal_date ? deal.updated_date : null;
  const appLink = dealAppLink(deal);

  // The company's own numbers, when AlphaMap has it.
  const [company, setCompany] = useState<StartupListRow | null>(null);
  const [companyLoading, setCompanyLoading] = useState(false);
  useEffect(() => {
    setCompany(null);
    if (!deal.startup_id) return;
    let cancelled = false;
    setCompanyLoading(true);
    fetchStartupListRowById(deal.startup_id)
      .then((row) => { if (!cancelled) setCompany(row); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCompanyLoading(false); });
    return () => { cancelled = true; };
  }, [deal.startup_id]);

  const people = deal.people.filter((p) => p.name?.trim());
  const trend = company ? trendView(company.growth_trend) : null;

  return (
    <div className="relative flex flex-col h-full rounded-am-card border border-am-line bg-am-surface shadow-am-1 overflow-y-auto">
      <div className="flex-none flex items-start justify-between gap-3 px-5 pt-4 pb-3.5">
        <div className="min-w-0">
          <h2 className="text-am-kpi font-semibold text-am-ink tracking-tight break-words">{deal.name}</h2>
          <div className="mt-1 text-am-body text-am-ink-3">
            {isFund ? tt("vcFund", "VC fund") : "Form D"} · {tt("filedOn", "filed {{date}}", { date: fmtDate(deal.deal_date) })}
            {amended ? ` · ${tt("amendedOn", "amended {{date}}", { date: fmtDate(amended) })}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {followable && (
            <button type="button" onClick={onToggleFollow} disabled={followBusy} aria-pressed={following}
              className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-am-ctl text-am-body font-semibold transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/50 ${
                following ? "bg-am-surface border border-am-line text-am-ink hover:bg-am-canvas" : "bg-am-ink border border-am-ink text-white hover:bg-slate-800"}`}>
              {followBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Star className={`w-4 h-4 ${following ? "fill-am-star text-am-star" : ""}`} aria-hidden="true" />}
              {following ? tt("followingBtn", "Following") : isFund ? tt("followFirm", "Follow firm") : tt("followCompany", "Follow company")}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label={tt("close", "Close")}
            className="grid place-items-center w-9 h-9 rounded-full text-am-ink-3 hover:bg-am-canvas hover:text-am-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/50">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <dl className="flex-none grid grid-cols-3 border-y border-am-line">
        <div className="px-5 py-3 border-e border-am-line"><dt className="text-am-caption text-am-ink-3">{tt("amountSoldLabel", "Amount sold")}</dt><dd className="text-am-kpi font-semibold tabular-nums">{fmtUsd(deal.amount_raised)}</dd></div>
        <div className="px-5 py-3 border-e border-am-line"><dt className="text-am-caption text-am-ink-3">{tt("offeringSize", "Offering size")}</dt><dd className="text-am-kpi font-semibold tabular-nums">{fmtUsd(deal.target_amount)}</dd></div>
        <div className="px-5 py-3">
          <dt className="text-am-caption text-am-ink-3">{tt("soldSoFar", "Sold so far")}</dt>
          <dd className="text-am-kpi font-semibold tabular-nums">{pct == null ? "—" : `${pct}%`}</dd>
          {pct != null && <div className="h-1 rounded-full bg-am-line mt-1.5" aria-hidden="true"><div className="h-1 rounded-full bg-am-ink" style={{ width: `${pct}%` }} /></div>}
        </div>
      </dl>

      <div className="px-5 py-5 space-y-6">
        {/* The company or firm inside AlphaMap */}
        <section className="rounded-am-card border border-am-line bg-am-canvas px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-am-title font-semibold text-am-ink">{tt("inAlphaMapTitle", "In AlphaMap")}</h3>
            <span className={`text-am-caption font-medium ${deal.review_status === "verified" ? "text-am-pos" : "text-am-warn"}`}>
              {deal.review_status === "verified" ? (isFund ? tt("firmInDirectory", "Firm in the directory") : tt("verifiedCompany", "Verified company")) : (isFund ? tt("newFirm", "New firm") : tt("notYetReviewed", "Not yet reviewed"))}
            </span>
          </div>
          {companyLoading && <div className="mt-3 flex items-center gap-2 text-am-caption text-am-ink-3"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />{tt("loading", "Loading")}</div>}
          {company && (
            <dl className="mt-3 grid grid-cols-3 gap-3">
              <div><dt className="text-am-caption text-am-ink-3">{tt("stage", "Stage")}</dt><dd className="font-semibold">{company.latest_round_type ? roundTypeLabel(company.latest_round_type) : "—"}</dd></div>
              <div><dt className="text-am-caption text-am-ink-3">{tt("valuation", "Valuation")}</dt><dd className="font-semibold tabular-nums">{company.latest_valuation ? formatUsdShort(company.latest_valuation) : "—"}{company.latest_round_is_estimated && company.latest_valuation ? <span className="ms-1.5 px-1 rounded border border-am-line text-[11px] text-am-ink-3">Est.</span> : null}</dd></div>
              <div><dt className="text-am-caption text-am-ink-3">{tt("headcount", "Headcount")}</dt><dd className="font-semibold tabular-nums">{company.employee_count != null ? company.employee_count.toLocaleString() : "—"}{trend && trend.tone !== "none" ? <span className={`ms-1.5 text-am-caption font-medium ${trend.tone === "pos" ? "text-am-pos" : trend.tone === "neg" ? "text-am-neg" : "text-am-ink-3"}`}>{trend.arrow} {trend.label}</span> : null}</dd></div>
            </dl>
          )}
          {appLink && (
            <Link to={appLink} className="inline-block mt-3 text-am-body font-semibold text-am-accent hover:underline">
              {deal.startup_id ? tt("openProfile", "Open company profile") : tt("openCandidate", "See what we know so far")} →
            </Link>
          )}
          {!appLink && <p className="mt-2 text-am-caption text-am-ink-3">{tt("notInDatabase", "AlphaMap has no profile for this one yet.")}</p>}
        </section>

        <section>
          <h3 className="text-am-title font-semibold text-am-ink mb-2">{isFund ? tt("managers", "Managers") : tt("relatedPersons", "Related persons")}</h3>
          {people.length === 0 ? <p className="text-am-body text-am-ink-3">{tt("noPeople", "The filing lists no related persons.")}</p> : (
            <ul>
              {people.map((p, i) => (
                <li key={`${p.name}-${i}`} className="flex items-baseline justify-between gap-4 py-2 border-t border-am-line-soft first:border-t-0">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-am-ink-3 text-am-body text-end">{(p.relationships ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean).join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="text-am-title font-semibold text-am-ink mb-2">{tt("filingDetails", "Filing details")}</h3>
          <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-am-body">
            <dt className="text-am-ink-3">{tt("filed", "Filed")}</dt><dd>{fmtDate(deal.deal_date)}</dd>
            {amended && (<><dt className="text-am-ink-3">{tt("amended", "Last amended")}</dt><dd>{fmtDate(amended)}</dd></>)}
            {isFund ? (<>
              <dt className="text-am-ink-3">{tt("firm", "Firm")}</dt><dd>{deal.firm_name ?? "—"}</dd>
              {deal.fund_series ? (<><dt className="text-am-ink-3">{tt("fundNumber", "Fund number")}</dt><dd>{deal.fund_series}</dd></>) : null}
            </>) : (<>
              <dt className="text-am-ink-3">{tt("sector", "Sector")}</dt><dd>{deal.sector ?? "—"}</dd>
              <dt className="text-am-ink-3">{tt("secIndustry", "SEC industry group")}</dt><dd>{deal.industry_group ?? "—"}</dd>
              {deal.country ? (<><dt className="text-am-ink-3">{tt("country", "Country")}</dt><dd>{deal.country}</dd></>) : null}
            </>)}
          </dl>
          {deal.source_url && (
            <a href={deal.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-3 text-am-body font-medium text-am-accent hover:underline">
              {tt("secFiling", "Open the SEC filing")}<ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          )}
        </section>
      </div>
    </div>
  );
}
