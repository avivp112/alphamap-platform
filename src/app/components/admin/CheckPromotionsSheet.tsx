import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Check, X, Loader2, AlertCircle, Globe, FileText, ArrowRight, Search, UserCheck, RotateCcw, ScanSearch } from "lucide-react";
import { CompanyLogo } from "../CompanyLogo";
import { RejectNote } from "./RejectNote";
import { fetchCheckPromotions, approveCheckPromotion, rejectCheckPromotion } from "../../../lib/supabase";
import { companyPath } from "../../../lib/candidateReview";
import { displayDomain } from "../../../lib/companyCheck";
import {
  PROMOTION_TABS, canRetry, identitySource, promotionSummary,
  type CheckPromotion, type PromotionTab, type PromotionStatus,
} from "../../../lib/checkPromotion";

// ─────────────────────────────────────────────────────────────────────────────
// Admin review → "From user checks": companies users checked, waiting for an
// approval before they enter AlphaMap (check_promotions, 20261025000000). An
// approval hands the company to the worker, which writes it by enrichment
// v2's own rules from the research shown here (worker/promote.ts).
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = 30;

const STATUS_CHIP: Record<PromotionStatus, string> = {
  pending: "bg-slate-100 text-slate-700", approved: "bg-sky-50 text-sky-700", writing: "bg-sky-50 text-sky-700",
  written: "bg-emerald-50 text-emerald-700", linked: "bg-emerald-50 text-emerald-700",
  rejected: "bg-gray-100 text-gray-500", failed: "bg-rose-50 text-rose-700",
};

export function CheckPromotionsSheet() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<PromotionTab>("pending");
  const [items, setItems] = useState<CheckPromotion[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchCheckPromotions({ tab, limit: PAGE, offset });
      setItems((prev) => (offset === 0 ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { setRejecting(null); void load(0); }, [load]);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(id);
  }, [flash]);

  async function decide(p: CheckPromotion, action: "approve" | "reject", reviewNote?: string) {
    setBusy(p.id);
    setError(null);
    try {
      if (action === "approve") await approveCheckPromotion(p.id, reviewNote);
      else await rejectCheckPromotion(p.id, reviewNote);
      setItems((prev) => prev.filter((x) => x.id !== p.id));
      setFlash(t(action === "approve" ? "adminReview.checks.approvedFlash" : "adminReview.checks.rejectedFlash"));
    } catch (e) {
      setError(`${promotionSummary(p).name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
      setRejecting(null);
      setNote("");
    }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-gray-500">{t("adminReview.checks.blurb")}</p>
      <div className="flex items-center gap-1 border-b border-gray-100 mb-6 -mx-1 overflow-x-auto">
        {PROMOTION_TABS.map((s) => (
          <button key={s} onClick={() => setTab(s)}
            className={`px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === s ? "border-[#0F172A] text-[#0F172A]" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            {t(`adminReview.checks.tab.${s}`)}
          </button>
        ))}
      </div>

      {flash && <div className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800">{flash}</div>}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" /><span className="break-words">{error}</span>
        </div>
      )}

      {items.length === 0 && !loading && !error && (
        <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <p className="text-sm font-semibold text-[#0F172A]">{t(`adminReview.checks.empty.${tab}`)}</p>
          {tab === "pending" && <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">{t("adminReview.checks.emptyPendingBlurb")}</p>}
        </div>
      )}

      <div className="space-y-3">
        {items.map((p) => (
          <PromotionCard key={p.id} p={p} busy={busy === p.id}
            onApprove={() => decide(p, "approve")}
            rejectingThis={rejecting === p.id}
            onStartReject={() => { setRejecting(p.id); setNote(""); }}
            rejectNote={<RejectNote note={note} setNote={setNote} onCancel={() => setRejecting(null)}
              onConfirm={() => decide(p, "reject", note || undefined)} busy={busy === p.id} />} />
        ))}
      </div>

      {loading && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
      {!loading && hasMore && (
        <div className="mt-6 flex justify-center">
          <button onClick={() => load(items.length)} className="rounded-md border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">
            {t("adminReview.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}

function PromotionCard(props: {
  p: CheckPromotion; busy: boolean; onApprove: () => void;
  rejectingThis: boolean; onStartReject: () => void; rejectNote: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { p } = props;
  const s = promotionSummary(p);
  const source = identitySource(p);
  const decidable = p.status === "pending" || canRetry(p);
  const domain = displayDomain(s.website);
  const lines: Array<{ label: string; value: string }> = [
    s.founders ? { label: t("adminReview.checks.founders"), value: s.founders } : null,
    s.funding ? { label: t("adminReview.checks.funding"), value: s.funding } : null,
    s.investors ? { label: t("adminReview.checks.investors"), value: s.investors } : null,
    p.check?.gate?.reason ? { label: t("adminReview.checks.checks"), value: p.check.gate.reason } : null,
  ].filter((x): x is { label: string; value: string } => !!x);

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <CompanyLogo name={s.name} website={s.website} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-[#0F172A] break-words">{s.name}</h2>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[p.status]}`}>{t(`adminReview.checks.status.${p.status}`)}</span>
            {source && (
              <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                {source === "your_website" ? <UserCheck className="h-3 w-3" /> : <Search className="h-3 w-3" />}
                {t(`adminReview.checks.source.${source}`)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {[domain, ...s.facts].filter(Boolean).join(" · ")}
            {" · "}{t("adminReview.checks.sources", { count: s.sources })}
          </p>

          {p.check?.progress?.generic_name && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />{t("adminReview.checks.genericName", { name: s.name })}
            </p>
          )}
          {s.description && <p className="mt-3 text-sm text-[#111827]">{s.description}</p>}

          {lines.length > 0 && (
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-[120px_1fr] text-sm">
              {lines.map((l) => (
                <React.Fragment key={l.label}>
                  <dt className="text-gray-400">{l.label}</dt>
                  <dd className="text-[#111827] break-words">{l.value}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}

          {p.error && p.status === "failed" && (
            <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700 break-words">
              {p.error}{!canRetry(p) && <> — {t("adminReview.checks.noRetry")}</>}
            </p>
          )}
          {p.status !== "pending" && p.review_note && (
            <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
              <FileText className="mr-1.5 inline h-3.5 w-3.5 text-gray-400" />{p.review_note}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <Link to={`/checks/${p.check_id}`} className="flex items-center gap-1 font-medium text-blue-600 hover:underline">
              <ScanSearch className="h-3.5 w-3.5" />{t("adminReview.checks.fullProfile")}
            </Link>
            {s.website && (
              <a href={s.website.startsWith("http") ? s.website : `https://${s.website}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 font-medium text-blue-600 hover:underline">
                <Globe className="h-3.5 w-3.5" />{t("adminReview.website")}
              </a>
            )}
            {(p.status === "written" || p.status === "linked") && p.startup_id && (
              <Link to={companyPath(p.startup_id)} className="flex items-center gap-1 font-medium text-blue-600 hover:underline">
                <ArrowRight className="h-3.5 w-3.5" />{t("adminReview.openCompany")}
              </Link>
            )}
            {decidable && (
              <div className="ml-auto flex items-center gap-2">
                <button disabled={props.busy} onClick={props.onApprove}
                  className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
                  {props.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : p.status === "failed" ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                  {t(p.status === "failed" ? "adminReview.checks.retry" : "adminReview.checks.approve")}
                </button>
                <button disabled={props.busy} onClick={props.onStartReject}
                  className="flex items-center gap-1 rounded-md border border-rose-200 px-3 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40">
                  <X className="h-3.5 w-3.5" />{t("adminReview.reject")}
                </button>
              </div>
            )}
          </div>
          {decidable && props.rejectingThis && props.rejectNote}
        </div>
      </div>
    </div>
  );
}
