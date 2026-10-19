import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import {
  ShieldCheck, Check, X, ExternalLink, Loader2, AlertCircle, Bell, Eye, Globe, FileText, CheckSquare, Square, ArrowRight,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { RejectNote } from "../components/admin/RejectNote";
import { CheckPromotionsSheet } from "../components/admin/CheckPromotionsSheet";
import {
  fetchCompanyCandidates, approveCompanyCandidate, rejectCompanyCandidate,
} from "../../lib/supabase";
import {
  SOURCE_LABEL, registryUrl, evidenceLines, companyPath,
  type CompanyCandidate, type CandidateSource, type CandidateStatus,
} from "../../lib/candidateReview";

// ─────────────────────────────────────────────────────────────────────────────
// Admin — company review queue.
//
// The sourcing engine no longer creates companies from government filings: a
// new company that passes the quality gate becomes a candidate here, and only
// an approval makes it a startups row (company_candidates, approve/reject RPCs
// in 20261016000000). Rejected candidates stay rejected and are never proposed
// again. The route is admin-only (requireAdmin); the database enforces the
// same rule on every read and write.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = 50;
const STATUSES: CandidateStatus[] = ["pending", "approved", "rejected"];
const SOURCES: Array<CandidateSource | "all"> = ["all", "sec_form_d", "uk_companies_house", "epo_ops"];

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const min = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (min < 60) return min < 1 ? "just now" : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function AdminReview() {
  const { t } = useTranslation();
  // Two sheets: companies from government filings, and from users' checks (20261025000000).
  const [params, setParams] = useSearchParams();
  const sheet: "filings" | "checks" = params.get("sheet") === "checks" ? "checks" : "filings";
  const [status, setStatus] = useState<CandidateStatus>("pending");
  const [source, setSource] = useState<CandidateSource | "all">("all");
  const [items, setItems] = useState<CompanyCandidate[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<string | "bulk" | null>(null);
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchCompanyCandidates({ status, source, limit: PAGE, offset });
      setItems((prev) => (offset === 0 ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status, source]);

  useEffect(() => {
    setSelected(new Set());
    setRejecting(null);
    void load(0);
  }, [load]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(id);
  }, [flash]);

  const markBusy = (ids: string[], on: boolean) =>
    setBusy((prev) => { const next = new Set(prev); ids.forEach((id) => (on ? next.add(id) : next.delete(id))); return next; });

  const removeFromList = (ids: string[]) => {
    setItems((prev) => prev.filter((c) => !ids.includes(c.id)));
    setSelected((prev) => { const next = new Set(prev); ids.forEach((id) => next.delete(id)); return next; });
  };

  async function run(ids: string[], action: "approve" | "reject", reviewNote?: string) {
    markBusy(ids, true);
    setError(null);
    const done: string[] = [];
    const failed: string[] = [];
    // One at a time: each approval creates a company and links its filings in
    // its own transaction, and a failure must not hide the ones that worked.
    for (const id of ids) {
      try {
        if (action === "approve") await approveCompanyCandidate(id, reviewNote);
        else await rejectCompanyCandidate(id, reviewNote);
        done.push(id);
      } catch (e) {
        failed.push(`${items.find((c) => c.id === id)?.name ?? id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    markBusy(ids, false);
    removeFromList(done);
    setRejecting(null);
    setNote("");
    if (done.length) setFlash(t(action === "approve" ? "adminReview.approvedFlash" : "adminReview.rejectedFlash", { count: done.length }));
    if (failed.length) setError(failed.join(" · "));
  }

  const pendingIds = items.map((c) => c.id);
  const allSelected = status === "pending" && pendingIds.length > 0 && pendingIds.every((id) => selected.has(id));
  const toggle = (id: string) =>
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <Layout>
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="mb-6">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-[#0F172A]" />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A]">{t("adminReview.title")}</h1>
          </div>
        </div>

        <div className="mb-5 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          {(["filings", "checks"] as const).map((s) => (
            <button key={s} onClick={() => setParams(s === "checks" ? { sheet: "checks" } : {}, { replace: true })}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition-colors ${
                sheet === s ? "bg-white text-[#0F172A] shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {t(`adminReview.sheet.${s}`)}
            </button>
          ))}
        </div>

        {sheet === "checks" ? <CheckPromotionsSheet /> : (<>
        <p className="mb-4 text-sm text-gray-500">{t("adminReview.subtitle")}</p>

        {/* Status tabs */}
        <div className="flex items-center gap-1 border-b border-gray-100 mb-4 -mx-1 overflow-x-auto">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
                status === s ? "border-[#0F172A] text-[#0F172A]" : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              {t(`adminReview.status.${s}`)}
            </button>
          ))}
        </div>

        {/* Source filter */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {SOURCES.map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                source === s ? "border-[#0F172A] bg-[#0F172A] text-white" : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              {s === "all" ? t("adminReview.allSources") : SOURCE_LABEL[s]}
            </button>
          ))}
        </div>

        {flash && (
          <div className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800">{flash}</div>
        )}
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {/* Bulk bar */}
        {status === "pending" && items.length > 0 && (
          <div className="sticky top-2 z-10 mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-100 bg-white/95 px-4 py-2.5 shadow-sm backdrop-blur">
            <button
              onClick={() => setSelected(allSelected ? new Set() : new Set(pendingIds))}
              className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-[#0F172A]"
            >
              {allSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              {t("adminReview.selectAll")}
            </button>
            <span className="text-sm text-gray-400">{t("adminReview.selectedCount", { count: selected.size })}</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                disabled={selected.size === 0 || busy.size > 0}
                onClick={() => run([...selected], "approve")}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                {t("adminReview.approveSelected")}
              </button>
              <button
                disabled={selected.size === 0 || busy.size > 0}
                onClick={() => { setRejecting("bulk"); setNote(""); }}
                className="rounded-md border border-rose-200 px-3 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40"
              >
                {t("adminReview.rejectSelected")}
              </button>
            </div>
            {rejecting === "bulk" && (
              <RejectNote
                note={note} setNote={setNote}
                onCancel={() => setRejecting(null)}
                onConfirm={() => run([...selected], "reject", note || undefined)}
                busy={busy.size > 0}
              />
            )}
          </div>
        )}

        {/* List */}
        {items.length === 0 && !loading && !error && (
          <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
            <p className="text-sm font-semibold text-[#0F172A]">{t(`adminReview.empty.${status}`)}</p>
            {status === "pending" && <p className="mt-1 text-sm text-gray-500">{t("adminReview.emptyPendingBlurb")}</p>}
          </div>
        )}

        <div className="space-y-3">
          {items.map((c) => (
            <CandidateCard
              key={c.id}
              c={c}
              status={status}
              selected={selected.has(c.id)}
              busy={busy.has(c.id)}
              onToggle={() => toggle(c.id)}
              onApprove={() => run([c.id], "approve")}
              rejectingThis={rejecting === c.id}
              onStartReject={() => { setRejecting(c.id); setNote(""); }}
              rejectNote={
                <RejectNote
                  note={note} setNote={setNote}
                  onCancel={() => setRejecting(null)}
                  onConfirm={() => run([c.id], "reject", note || undefined)}
                  busy={busy.has(c.id)}
                />
              }
            />
          ))}
        </div>

        {loading && (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        )}
        {!loading && hasMore && (
          <div className="mt-6 flex justify-center">
            <button onClick={() => load(items.length)} className="rounded-md border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">
              {t("adminReview.loadMore")}
            </button>
          </div>
        )}
        </>)}
      </div>
    </Layout>
  );
}

function CandidateCard(props: {
  c: CompanyCandidate;
  status: CandidateStatus;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onApprove: () => void;
  rejectingThis: boolean;
  onStartReject: () => void;
  rejectNote: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { c } = props;
  const link = registryUrl(c);
  const lines = evidenceLines(c);
  const pending = props.status === "pending";

  return (
    <div className={`rounded-xl border bg-white p-4 sm:p-5 transition-colors ${props.selected ? "border-[#0F172A]" : "border-gray-100"}`}>
      <div className="flex items-start gap-3">
        {pending && (
          <button onClick={props.onToggle} className="mt-0.5 text-gray-400 hover:text-[#0F172A]" aria-label={t("adminReview.select")}>
            {props.selected ? <CheckSquare className="h-4 w-4 text-[#0F172A]" /> : <Square className="h-4 w-4" />}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-[#0F172A] break-words">{c.name}</h2>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">{SOURCE_LABEL[c.source] ?? c.source}</span>
            {c.gate_tier === "alert" ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <Bell className="h-3 w-3" />{t("adminReview.tier.alert")}
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                <Eye className="h-3 w-3" />{t("adminReview.tier.queue")}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {t("adminReview.firstSeen", { ago: timeAgo(c.first_seen_at) })}
            {" · "}{t("adminReview.filings", { count: c.filings_count })}
            {!pending && c.reviewed_at && <>{" · "}{t(`adminReview.reviewed.${props.status}`, { ago: timeAgo(c.reviewed_at) })}</>}
          </p>

          {lines.length > 0 && (
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-[140px_1fr] text-sm">
              {lines.map((l) => (
                <React.Fragment key={l.label}>
                  <dt className="text-gray-400">{l.label}</dt>
                  <dd className="text-[#111827] break-words">{l.value}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}

          {!pending && c.review_note && (
            <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
              <FileText className="mr-1.5 inline h-3.5 w-3.5 text-gray-400" />{c.review_note}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            {link && (
              <a href={link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium text-blue-600 hover:underline">
                <ExternalLink className="h-3.5 w-3.5" />{t("adminReview.officialRecord")}
              </a>
            )}
            {c.website && (
              <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 font-medium text-blue-600 hover:underline">
                <Globe className="h-3.5 w-3.5" />{t("adminReview.website")}
              </a>
            )}
            {props.status === "approved" && c.startup_id && (
              <Link to={companyPath(c.startup_id)} className="flex items-center gap-1 font-medium text-blue-600 hover:underline">
                <ArrowRight className="h-3.5 w-3.5" />{t("adminReview.openCompany")}
              </Link>
            )}
            {pending && (
              <div className="ml-auto flex items-center gap-2">
                <button disabled={props.busy} onClick={props.onApprove}
                  className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
                  {props.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {t("adminReview.approve")}
                </button>
                <button disabled={props.busy} onClick={props.onStartReject}
                  className="flex items-center gap-1 rounded-md border border-rose-200 px-3 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40">
                  <X className="h-3.5 w-3.5" />{t("adminReview.reject")}
                </button>
              </div>
            )}
          </div>
          {pending && props.rejectingThis && props.rejectNote}
        </div>
      </div>
    </div>
  );
}
