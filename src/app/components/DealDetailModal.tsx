import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { X, ExternalLink, ArrowRight, Users, Info, ShieldCheck, Eye } from "lucide-react";
import { useBackClose } from "../../lib/hardwareBack";
import { fmtUsd, soldPct, personLabel, dealAppLink, type DealFeedRow } from "../../lib/dealFeed";

// ─────────────────────────────────────────────────────────────────────────────
// One deal from deal_feed. Shows only what the SEC filing says — the old
// DealModal "estimated" investors, headcount and runway from a hash of the
// company name, which this replaces (2026-10-20): missing is better than wrong.
// ─────────────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function DealDetailModal({ deal, onClose }: { deal: DealFeedRow; onClose: () => void }) {
  const { t } = useTranslation();
  useBackClose(true, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pct = soldPct(deal);
  const appLink = dealAppLink(deal);
  const people = deal.people.map(personLabel).filter((p): p is string => !!p);
  const amended = deal.updated_date && deal.updated_date !== deal.deal_date ? deal.updated_date : null;
  const facts: Array<[string, string]> = [
    [t("deals.detail.filed"), fmtDate(deal.deal_date)],
    ...(amended ? [[t("deals.detail.amended"), fmtDate(amended)] as [string, string]] : []),
    ...(deal.kind === "fund"
      ? [
          [t("deals.detail.firm"), deal.firm_name ?? "—"] as [string, string],
          ...(deal.fund_series ? [[t("deals.detail.fundNumber"), String(deal.fund_series)] as [string, string]] : []),
        ]
      : [
          [t("deals.detail.sector"), deal.sector ?? "—"] as [string, string],
          [t("deals.detail.secIndustry"), deal.industry_group ?? "—"] as [string, string],
          ...(deal.country ? [[t("deals.detail.country"), deal.country] as [string, string]] : []),
        ]),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={deal.name}
        className="w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start gap-3 border-b border-gray-100 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-[#0F172A] break-words">{deal.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                {deal.kind === "fund" ? t("deals.fundRaise") : deal.deal_type}
              </span>
              {deal.review_status === "verified" ? (
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  <ShieldCheck className="h-3 w-3" />{t(deal.kind === "fund" ? "deals.firmInAlphaMap" : "deals.verified")}
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  <Eye className="h-3 w-3" />{t(deal.kind === "fund" ? "deals.newFirm" : "deals.unreviewed")}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} aria-label={t("common.close")} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {/* Amounts */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-100 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t("deals.sold")}</p>
              <p className="mt-1 text-xl font-black text-[#0F172A] tabular-nums">{fmtUsd(deal.amount_raised)}</p>
            </div>
            <div className="rounded-lg border border-gray-100 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t("deals.offering")}</p>
              <p className="mt-1 text-xl font-black text-[#0F172A] tabular-nums">{fmtUsd(deal.target_amount)}</p>
            </div>
          </div>
          {pct !== null && (
            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-gray-500">{t("deals.detail.soldPct", { pct })}</p>
            </div>
          )}

          {/* Facts */}
          <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-1.5 text-sm">
            {facts.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-gray-400">{k}</dt>
                <dd className="text-[#111827] break-words">{v}</dd>
              </React.Fragment>
            ))}
          </dl>

          {/* People */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              <Users className="h-3.5 w-3.5" />{t(deal.kind === "fund" ? "deals.detail.managers" : "deals.detail.people")}
            </p>
            {people.length ? (
              <ul className="space-y-1 text-sm text-[#111827]">{people.map((p) => <li key={p}>{p}</li>)}</ul>
            ) : (
              <p className="text-sm text-gray-400">{t("deals.detail.noPeople")}</p>
            )}
          </div>

          <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-500">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-none text-gray-400" />
            {t("deals.detail.formDNote")}
          </p>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            {appLink && (
              <Link to={appLink} className="flex items-center gap-1 font-semibold text-[#0F172A] hover:underline">
                <ArrowRight className="h-3.5 w-3.5" />{t(deal.startup_id ? "deals.detail.openCompany" : "deals.detail.openPreview")}
              </Link>
            )}
            {deal.source_url && (
              <a href={deal.source_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium text-blue-600 hover:underline">
                <ExternalLink className="h-3.5 w-3.5" />{t("deals.detail.secFiling")}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
