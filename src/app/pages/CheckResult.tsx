import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft, Loader2, CheckCircle2, Circle, XCircle, EyeOff, ShieldCheck, AlertCircle, ExternalLink, RotateCcw, Lock, Globe,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { CompanyLogo } from "../components/CompanyLogo";
import { CandidateList, CheckCompanyDialog, GenericNameNote, OpenCompanyLink } from "../components/CheckCompanyDialog";
import { CheckProfileView } from "../components/CheckProfileView";
import { DeepenProfileButton } from "../components/DeepenProfileButton";
import { fetchCompanyCheck, confirmCompanyCheck, cancelCompanyCheck } from "../../lib/supabase";
import { companyPath } from "../../lib/candidateReview";
import {
  CHECK_POLL_MS, checkStep, checkTitle, displayDomain, formFromInput, isPending, progressKey,
  type CompanyCheckRow, type UpdateDiff,
} from "../../lib/companyCheck";

// ─────────────────────────────────────────────────────────────────────────────
// One "check a company" request (/checks/:id): follows the worker while it
// runs, then shows the verdict with its evidence. Private: the row is read
// through RLS, so another user's id simply reads as "not found".
// Stage 3: once the checks pass, the research runs in the same job and the
// profile appears here — unverified, every value linked to its source.
// ─────────────────────────────────────────────────────────────────────────────

export function CheckResult() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [row, setRow] = useState<CompanyCheckRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [pollKey, setPollKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await fetchCompanyCheck(id);
      setRow(r);
      setError(null);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Load, then keep polling while the worker has the check.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stop = false;
    const tick = async () => {
      const r = await load();
      if (!stop && (!r || isPending(r))) timer = setTimeout(tick, CHECK_POLL_MS);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [load, pollKey]);

  async function choose(choice: number | "none") {
    if (!row) return;
    setBusy(true);
    try {
      const res = await confirmCompanyCheck(row.id, choice);
      if (res.status === "matched") { navigate(companyPath(res.startup.id)); return; }
      setPollKey((k) => k + 1);   // follow the check phase
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout>
      <div className="mx-auto max-w-[760px] px-4 sm:px-6 py-8 sm:py-12">
        <Link to="/my-area?tab=crm" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-[#0F172A]">
          <ArrowLeft className="h-4 w-4" />{t("crm.back")}
        </Link>

        {loading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>}

        {!loading && !row && (
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-10 text-center">
            <p className="text-sm font-semibold text-[#0F172A]">{error ?? t("companyCheck.notFound")}</p>
          </div>
        )}

        {row && <CheckView row={row} busy={busy} error={error} onChoose={choose}
          onOpenCompany={(sid) => navigate(companyPath(sid))} onRetry={() => setRetryOpen(true)} />}
      </div>
      {retryOpen && row && <CheckCompanyDialog initial={formFromInput(row.input)} onClose={() => setRetryOpen(false)} />}
    </Layout>
  );
}

function CheckView({ row, busy, error, onChoose, onOpenCompany, onRetry }: {
  row: CompanyCheckRow; busy: boolean; error: string | null;
  onChoose: (c: number | "none") => void; onOpenCompany: (startupId: string) => void; onRetry: () => void;
}) {
  const { t } = useTranslation();
  const step = checkStep(row);
  const { name, website } = checkTitle(row);
  const domain = displayDomain(website);
  const deepen = row.kind === "deepen";
  const identified = row.phase === "check" && row.status !== "cancelled";
  const checksDone = row.gate?.status === "ready" || (step === "final" && row.status !== "cancelled" && row.status !== "matched");
  const profile = row.result?.profile;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <CompanyLogo name={name} website={website} size={56} rounded="rounded-xl" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-[#0F172A] break-words">{name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
            {domain && website && (
              <a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-blue-600">
                {domain}<ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Lock className="h-3 w-3" />{t("companyCheck.privateToYou")}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" /><span className="break-words">{error}</span>
        </div>
      )}

      {step === "confirm" && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-base font-bold text-[#0F172A]">{t("companyCheck.confirmTitle")}</h2>
          <p className="mb-4 mt-0.5 text-sm text-gray-500">{(row.candidates?.length ?? 0) > 0 ? t("companyCheck.confirmBlurb") : "\u00a0"}</p>
          {row.progress?.generic_name && !row.input.website && <GenericNameNote name={row.input.name} />}
          <CandidateList candidates={row.candidates ?? []} onChoose={onChoose} onOpenCompany={onOpenCompany} busy={busy} />
          {!row.input.website && (
            <div className="mt-4 flex justify-end border-t border-gray-100 pt-4">
              {/* A website is the strongest anchor: start over with it (this check is cancelled, never charged). */}
              <button disabled={busy} onClick={() => { void cancelCompanyCheck(row.id).catch(() => false); onRetry(); }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F172A] hover:underline disabled:opacity-50">
                <Globe className="h-3.5 w-3.5" />{t("companyCheck.addWebsite")}
              </button>
            </div>
          )}
        </section>
      )}

      {step !== "confirm" && <Outcome row={row} onRetry={onRetry} />}
      {/* The verdict may be about the wrong company when it was picked from search results (zero.ai, 2026-10-18). */}
      {["rejected_non_tech", "rejected_public", "stealth"].includes(row.status) && row.identity?.source === "search" && (
        <button onClick={onRetry} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0F172A] hover:underline">
          <Globe className="h-3.5 w-3.5" />{t("companyCheck.wrongCompany")}
        </button>
      )}

      {/* Where the check is, end to end. */}
      {/* Once the profile is there, it speaks for itself. */}
      {row.status !== "cancelled" && row.status !== "matched" && row.status !== "done" && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <ol className="space-y-3 text-sm">
            {!deepen && <StepLine state={identified ? "done" : step === "identifying" ? "active" : "todo"} label={t("companyCheck.steps.identified")} />}
            {!deepen && <StepLine state={checksDone ? (row.status === "failed" ? "failed" : "done") : step === "checking" ? "active" : "todo"} label={t("companyCheck.steps.checks")} />}
            {/* The profile only follows a check that passed. */}
            {!["rejected_public", "rejected_non_tech", "stealth", "failed", "no_new_data"].includes(row.status) && (
              <StepLine
                state={step === "researching" ? "active" : "todo"}
                label={t("companyCheck.steps.profile")}
                note={step === "researching" ? t(`companyCheck.progress.${progressKey(row.progress?.stage)}`, { count: row.progress?.sources ?? 0 })
                  : row.status === "ready" ? t("companyCheck.steps.beforeResearch") : undefined} />
            )}
          </ol>
        </section>
      )}

      {profile && <CheckProfileView profile={profile} investors={row.result?.investors ?? null} pendingReview={deepen && !!row.result?.deepen?.proposed} />}
    </div>
  );
}

function StepLine({ state, label, note }: { state: "done" | "active" | "todo" | "failed"; label: string; note?: string }) {
  const icon = state === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    : state === "active" ? <Loader2 className="h-4 w-4 animate-spin text-[#0F172A]" />
    : state === "failed" ? <XCircle className="h-4 w-4 text-rose-500" />
    : <Circle className="h-4 w-4 text-gray-300" />;
  return (
    <li className="flex items-center gap-2.5">
      {icon}
      <span className={state === "todo" ? "text-gray-400" : "text-[#0F172A]"}>{label}</span>
      {note && <span className="whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">{note}</span>}
    </li>
  );
}

function Outcome({ row, onRetry }: { row: CompanyCheckRow; onRetry: () => void }) {
  const { t } = useTranslation();
  const step = checkStep(row);
  const o = (k: string) => t(`companyCheck.outcome.${k}`);

  if (step === "identifying" || step === "checking") {
    return (
      <Panel tone="progress" icon={<Loader2 className="h-5 w-5 animate-spin" />}
        title={step === "identifying" ? t("companyCheck.finding") : o("checkingTitle")} body={o("checkingBody")} />
    );
  }
  if (step === "researching") {
    return (
      <Panel tone="progress" icon={<Loader2 className="h-5 w-5 animate-spin" />}
        title={o("researchingTitle")} body={o("researchingBody")} />
    );
  }

  const listing = row.gate?.evidence?.listing ?? null;
  const techReason = row.gate?.evidence?.tech?.reason;
  if (row.kind === "deepen" && row.status === "done") {
    const d = row.result?.deepen;
    const changes = d?.proposed ? countChanges(d.diff) : 0;
    return (
      <Panel tone="ok" icon={<ShieldCheck className="h-5 w-5" />} title={o("deepenDoneTitle")} body={o(d?.proposed ? "deepenReviewBody" : "deepenDoneBody")}>
        {d && d.direct.length > 0 && (
          <div className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm text-[#0F172A]">
            <p className="text-xs font-semibold text-emerald-800">{o("directTitle")}</p>
            <ul className="mt-1 space-y-0.5">
              {d.direct.map((w) => (
                <li key={w.field}>
                  {t(`companyCheck.fields.${w.field}`)}: <span className="font-semibold">{String(w.value)}</span>
                  {w.source_url && <> — <a href={w.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{o("source")}</a></>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {changes > 0 && <p className="mt-2 text-xs opacity-90">{t("companyCheck.outcome.waitingReview", { count: changes })}</p>}
        {row.matched_startup_id && <div className="mt-3"><OpenCompanyLink startupId={row.matched_startup_id} label={t("companyCheck.openInAlphaMap")} /></div>}
      </Panel>
    );
  }
  switch (row.status) {
    case "no_new_data":
      return (
        <Panel tone="neutral" icon={<Circle className="h-5 w-5" />} title={o("noNewDataTitle")} body={row.result?.note ?? o("noNewDataBody")}>
          {row.matched_startup_id && <div className="mt-3"><OpenCompanyLink startupId={row.matched_startup_id} label={t("companyCheck.openInAlphaMap")} /></div>}
        </Panel>
      );
    case "done":
      return (
        <Panel tone="ok" icon={<ShieldCheck className="h-5 w-5" />} title={o("doneTitle")} body={o("doneBody")}>
          {/* Approved by AlphaMap's team and added (check_promotions, 20261025000000). */}
          {row.matched_startup_id && <div className="mt-3"><OpenCompanyLink startupId={row.matched_startup_id} label={t("companyCheck.nowInAlphaMap")} /></div>}
        </Panel>
      );
    case "ready":   // checked before the research existed (stage 2)
      return (
        <Panel tone="ok" icon={<ShieldCheck className="h-5 w-5" />} title={o("readyTitle")} body={o("readyBody")}>
          <button onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">
            <RotateCcw className="h-3.5 w-3.5" />{t("companyCheck.runResearch")}
          </button>
        </Panel>
      );
    case "stealth":
      return <Panel tone="warn" icon={<EyeOff className="h-5 w-5" />} title={o("stealthTitle")} body={o("stealthBody")} />;
    case "rejected_public":
      return (
        <Panel tone="bad" icon={<XCircle className="h-5 w-5" />} title={o("publicTitle")} body={o("publicBody")}>
          {listing && (
            <p className="mt-2 text-xs text-gray-600">
              “{listing.quote}” —{" "}
              <a href={listing.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline">{o("source")}</a>
            </p>
          )}
        </Panel>
      );
    case "rejected_non_tech":
      return (
        <Panel tone="bad" icon={<XCircle className="h-5 w-5" />} title={o("nonTechTitle")} body={o("nonTechBody")}>
          {(techReason ?? row.gate?.reason) && <p className="mt-2 text-xs text-gray-600">{techReason ?? row.gate?.reason}</p>}
        </Panel>
      );
    case "matched":
      return (
        <Panel tone="ok" icon={<CheckCircle2 className="h-5 w-5" />} title={o("matchedTitle")} body={o("matchedBody")}>
          {row.matched_startup_id && <div className="mt-3"><OpenCompanyLink startupId={row.matched_startup_id} label={t("companyCheck.openInAlphaMap")} /></div>}
          {/* Thin or old profile: the same research can deepen it (worker/deepen.ts). */}
          {row.matched_startup_id && <div className="mt-4"><DeepenProfileButton startupId={row.matched_startup_id} /></div>}
        </Panel>
      );
    case "cancelled":
      return <Panel tone="neutral" icon={<Circle className="h-5 w-5" />} title={o("cancelledTitle")} body={o("cancelledBody")} />;
    default:
      return (
        <Panel tone="bad" icon={<AlertCircle className="h-5 w-5" />} title={o("failedTitle")} body={o("failedBody")}>
          <button onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#0F172A] hover:bg-gray-50">
            <RotateCcw className="h-3.5 w-3.5" />{t("companyCheck.tryAgain")}
          </button>
        </Panel>
      );
  }
}

/** How many single changes a deepen sent for review. */
function countChanges(d: UpdateDiff): number {
  return d.fields.length + d.lists.reduce((n, l) => n + l.added.length, 0) + d.rounds.inserts.length + d.rounds.updates.length
    + (d.headcount_points ? 1 : 0) + d.tags.length;
}

const TONES = {
  progress: "border-slate-200 bg-slate-50 text-[#0F172A]",
  ok: "border-emerald-100 bg-emerald-50 text-emerald-800",
  warn: "border-amber-100 bg-amber-50 text-amber-800",
  bad: "border-rose-100 bg-rose-50 text-rose-800",
  neutral: "border-gray-200 bg-gray-50 text-gray-700",
} as const;

function Panel({ tone, icon, title, body, children }: {
  tone: keyof typeof TONES; icon: React.ReactNode; title: string; body: string; children?: React.ReactNode;
}) {
  return (
    <section className={`rounded-xl border p-5 ${TONES[tone]}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex-none">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-base font-bold">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed opacity-90">{body}</p>
          {children}
        </div>
      </div>
    </section>
  );
}
