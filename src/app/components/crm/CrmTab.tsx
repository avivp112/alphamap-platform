import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { Plus, ScanSearch, ChevronRight, Loader2, AlertCircle, Lock, Search, X, Briefcase, CalendarClock } from "lucide-react";
import { CompanyLogo } from "../CompanyLogo";
import { CheckCompanyDialog } from "../CheckCompanyDialog";
import { useBackClose } from "../../../lib/hardwareBack";
import { fetchCrmCompanies, fetchStartupsPage, addCrmCompany, type StartupListRow } from "../../../lib/supabase";
import { CRM_STAGES, isOverdue, sortCrm, stageCounts, type CrmCompany, type CrmStage } from "../../../lib/crm";
import { displayDomain, emptyCheckForm, statusKey, statusTone, type StatusTone } from "../../../lib/companyCheck";

// ─────────────────────────────────────────────────────────────────────────────
// My Area → CRM: the companies the user tracks as an investor. Private (RLS);
// a confirmed "check a company" lands here on its own (migration
// 20261024000000), and an AlphaMap company added here goes on the watchlist.
// ─────────────────────────────────────────────────────────────────────────────

export const STAGE_CHIP: Record<CrmStage, string> = {
  watching: "bg-slate-100 text-slate-700",
  reviewing: "bg-sky-50 text-sky-700",
  diligence: "bg-violet-50 text-violet-700",
  term_sheet: "bg-amber-50 text-amber-800",
  invested: "bg-emerald-50 text-emerald-700",
  passed: "bg-gray-100 text-gray-500",
};

const TONE_CHIP: Record<StatusTone, string> = {
  progress: "bg-slate-100 text-slate-700", ok: "bg-emerald-50 text-emerald-700", warn: "bg-amber-50 text-amber-700",
  bad: "bg-rose-50 text-rose-700", neutral: "bg-gray-100 text-gray-500",
};

const today = () => new Date().toISOString().slice(0, 10);

export function CrmTab() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CrmCompany[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<CrmStage | "all">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [check, setCheck] = useState<{ name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCrmCompanies()
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setRows([]); } });
    return () => { cancelled = true; };
  }, []);

  const counts = useMemo(() => stageCounts(rows ?? []), [rows]);
  const shown = useMemo(() => sortCrm((rows ?? []).filter((r) => stage === "all" || r.stage === stage), today()), [rows, stage]);

  return (
    <div>
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm text-gray-500"><Lock className="h-3.5 w-3.5 flex-none" />{t("crm.blurb")}</p>
        <div className="flex gap-2">
          <button onClick={() => setAddOpen(true)}
            className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-lg bg-[#0F172A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1e293b]">
            <Plus className="h-4 w-4" />{t("crm.add")}
          </button>
          <button onClick={() => setCheck({ name: "" })}
            className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#0F172A] hover:bg-gray-50">
            <ScanSearch className="h-4 w-4" />{t("companyCheck.open")}
          </button>
        </div>
      </div>

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {(["all", ...CRM_STAGES] as const).map((s) => (
          <button key={s} onClick={() => setStage(s)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              stage === s ? "bg-[#0F172A] text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            {t(s === "all" ? "crm.all" : `crm.stage.${s}`)} <span className="opacity-60">{counts[s]}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" /><span className="break-words">{error}</span>
        </div>
      )}
      {rows === null && <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}

      {rows !== null && shown.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-gray-200 px-6 py-12 text-center">
          <Briefcase className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm font-semibold text-gray-700">{t(rows.length ? "crm.emptyStageTitle" : "crm.emptyTitle")}</p>
          {!rows.length && <p className="mx-auto mt-1 max-w-md text-xs text-gray-500">{t("crm.emptyBlurb")}</p>}
        </div>
      )}

      {shown.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {shown.map((r) => {
            const website = r.startup?.website ?? r.website;
            const checkPending = r.check && r.check.status !== "done" && r.check.status !== "matched";
            return (
              <li key={r.id}>
                <Link to={`/crm/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <CompanyLogo name={r.name} website={website} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="truncate text-sm font-semibold text-[#0F172A]">{r.name}</span>
                      {checkPending && r.check && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE_CHIP[statusTone(r.check.status)]}`}>
                          {t(`companyCheck.status.${statusKey(r.check)}`)}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-500">
                      {displayDomain(website) && <span className="truncate">{displayDomain(website)}</span>}
                      {r.next_step && (
                        <span className={`inline-flex items-center gap-1 ${isOverdue(r.next_step_date, today()) ? "font-semibold text-rose-600" : ""}`}>
                          <CalendarClock className="h-3 w-3" />{r.next_step}{r.next_step_date ? ` · ${r.next_step_date}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`hidden sm:inline flex-none rounded-full px-2 py-0.5 text-[11px] font-semibold ${STAGE_CHIP[r.stage]}`}>{t(`crm.stage.${r.stage}`)}</span>
                  <ChevronRight className="h-4 w-4 flex-none text-gray-300" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {addOpen && <AddCompanyDialog onClose={() => setAddOpen(false)} onCheck={(name) => { setAddOpen(false); setCheck({ name }); }} />}
      {check && <CheckCompanyDialog initial={{ ...emptyCheckForm(), name: check.name }} onClose={() => setCheck(null)} />}
    </div>
  );
}

/** Add an AlphaMap company; not found -> check it (which adds it on its own). */
function AddCompanyDialog({ onClose, onCheck }: { onClose: () => void; onCheck: (name: string) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useBackClose(true, onClose);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StartupListRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      fetchStartupsPage({ search: term }, 1)
        .then((r) => { if (!cancelled) setResults(r.slice(0, 8)); })
        .catch(() => { if (!cancelled) setResults([]); });
    }, 300);
    return () => { cancelled = true; clearTimeout(id); };
  }, [q]);

  async function add(s: StartupListRow) {
    setBusy(true);
    setError(null);
    try {
      const id = await addCrmCompany({ startupId: s.id, name: s.name, website: s.website });
      onClose();
      navigate(`/crm/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t("crm.add")} onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center gap-3 border-b border-gray-100 bg-white px-5 py-4">
          <h2 className="flex-1 text-lg font-bold text-[#0F172A]">{t("crm.add")}</h2>
          <button onClick={onClose} aria-label={t("common.close")} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("crm.searchPlaceholder")}
              className="w-full rounded-lg border border-gray-200 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F172A]/10" />
          </div>
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          {results && results.length > 0 && (
            <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100">
              {results.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                  <CompanyLogo name={s.name} website={s.website} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[#0F172A]">{s.name}</div>
                    <div className="truncate text-xs text-gray-500">{[displayDomain(s.website), s.country].filter(Boolean).join(" · ")}</div>
                  </div>
                  <button disabled={busy} onClick={() => add(s)}
                    className="flex-none rounded-lg bg-[#0F172A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1e293b] disabled:opacity-50">{t("crm.addThis")}</button>
                </li>
              ))}
            </ul>
          )}
          {q.trim().length >= 2 && results !== null && (
            <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
              {results.length === 0 ? t("crm.notFound", { name: q.trim() }) : t("crm.notListed")}
              <button onClick={() => onCheck(q.trim())} className="mt-2 flex items-center gap-1.5 font-semibold text-[#0F172A] hover:underline">
                <ScanSearch className="h-4 w-4" />{t("crm.checkIt", { name: q.trim() })}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
