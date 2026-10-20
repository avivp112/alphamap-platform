import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { X, Loader2, Lock, MapPin, ExternalLink, AlertCircle, ArrowRight, Search, Globe } from "lucide-react";
import { useBackClose } from "../../lib/hardwareBack";
import { CompanyLogo } from "./CompanyLogo";
import { SECTOR_TAXONOMY, sectorLabel } from "../../lib/taxonomy";
import { companyPath } from "../../lib/candidateReview";
import {
  identifyCompany, confirmCompanyCheck, cancelCompanyCheck, fetchCompanyCheck,
} from "../../lib/supabase";
import {
  CheckRequestError, CHECK_POLL_MS, SLOW_WORKER_MS, emptyCheckForm, displayDomain,
  type CheckFormValues, type IdentityCandidate,
} from "../../lib/companyCheck";

// ─────────────────────────────────────────────────────────────────────────────
// "Check a company" — the one dialog every entry point opens (My Area today,
// the Private Market search from stage 5). The work happens in the
// company-check Edge Function and the check worker:
//   form -> identify (one search, not charged) -> "is this the company?"
//   -> confirm (charged) -> the /checks/:id page follows the run.
// A company already in AlphaMap opens its tearsheet instead, at any point.
// ─────────────────────────────────────────────────────────────────────────────

type Step = "form" | "finding" | "confirm" | "starting";

const SECTORS = Object.keys(SECTOR_TAXONOMY).filter((s) => s !== "Uncategorized");

export function CheckCompanyDialog({ onClose, initial }: { onClose: () => void; initial?: CheckFormValues }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useBackClose(true, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [step, setStep] = useState<Step>("form");
  const [form, setForm] = useState<CheckFormValues>(initial ?? emptyCheckForm());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [checkId, setCheckId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<IdentityCandidate[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const [generic, setGeneric] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Follow the identify phase until the worker leaves candidates.
  useEffect(() => {
    if (step !== "finding" || !checkId) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const row = await fetchCompanyCheck(checkId);
        if (!alive.current) return;
        if (row?.status === "awaiting_confirmation") {
          setCandidates(row.candidates ?? []);
          setGeneric(row.progress?.generic_name === true);
          setStep("confirm");
          return;
        }
        if (row && row.status !== "queued" && row.status !== "running") {
          setError(t("companyCheck.outcome.failedBody"));
          setStep("form");
          return;
        }
      } catch { /* a missed poll is retried */ }
      setSlow(Date.now() - started > SLOW_WORKER_MS);
      timer = setTimeout(tick, CHECK_POLL_MS);
    };
    timer = setTimeout(tick, 800);
    return () => clearTimeout(timer);
  }, [step, checkId, t]);

  const set = (k: keyof CheckFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function openCompany(startupId: string) {
    onClose();
    navigate(companyPath(startupId));
  }

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (form.name.trim().length < 2) { setFieldErrors({ name: t("companyCheck.nameRequired") }); return; }
    setStep("finding");
    setSlow(false);
    try {
      const res = await identifyCompany(form);
      if (!alive.current) return;
      // Already in AlphaMap: the check page offers it, and deepening a thin profile.
      if (res.status === "matched") { onClose(); navigate(`/checks/${encodeURIComponent(res.check_id)}`); return; }
      setCheckId(res.check_id);
      setRemaining(res.remaining);
    } catch (err) {
      if (!alive.current) return;
      setStep("form");
      if (err instanceof CheckRequestError) {
        setError(err.failure.message);
        setFieldErrors(err.failure.fields ?? {});
      } else setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function choose(choice: number | "none") {
    if (!checkId) return;
    setStep("starting");
    setError(null);
    try {
      const res = await confirmCompanyCheck(checkId, choice);
      onClose();
      navigate(`/checks/${encodeURIComponent(res.check_id)}`);
    } catch (err) {
      if (!alive.current) return;
      setStep("confirm");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function abandon() {
    if (checkId) await cancelCompanyCheck(checkId).catch(() => false);
    onClose();
  }

  function addWebsite() {
    if (checkId) void cancelCompanyCheck(checkId).catch(() => false);
    setCheckId(null);
    setCandidates([]);
    setStep("form");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t("companyCheck.title")}
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-gray-100 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-[#0F172A]">
              {step === "confirm" ? t("companyCheck.confirmTitle") : t("companyCheck.title")}
            </h2>
            {step === "form" && <p className="mt-0.5 text-sm text-gray-500">{t("companyCheck.intro")}</p>}
            {step === "confirm" && candidates.length > 0 && <p className="mt-0.5 text-sm text-gray-500">{t("companyCheck.confirmBlurb")}</p>}
          </div>
          <button onClick={onClose} aria-label={t("common.close")} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none" /><span className="break-words">{error}</span>
            </div>
          )}

          {step === "form" && (
            <form onSubmit={find} className="space-y-4" noValidate>
              <Field label={t("companyCheck.name")} required error={fieldErrors.name}>
                <input autoFocus value={form.name} onChange={set("name")} maxLength={120}
                  placeholder={t("companyCheck.namePlaceholder")} className={inputCls(!!fieldErrors.name)} />
              </Field>
              <Field label={t("companyCheck.website")} hint={t("companyCheck.websiteHint")} error={fieldErrors.website}>
                <input value={form.website} onChange={set("website")} inputMode="url" autoCapitalize="none" autoCorrect="off"
                  placeholder={t("companyCheck.websitePlaceholder")} className={inputCls(!!fieldErrors.website)} />
              </Field>

              <p className="pt-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">{t("companyCheck.moreAnchors")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label={t("companyCheck.country")}>
                  <input value={form.country} onChange={set("country")} maxLength={80} placeholder={t("companyCheck.countryPlaceholder")} className={inputCls(false)} />
                </Field>
                <Field label={t("companyCheck.founder")}>
                  <input value={form.founder} onChange={set("founder")} maxLength={120} placeholder={t("companyCheck.founderPlaceholder")} className={inputCls(false)} />
                </Field>
                <Field label={t("companyCheck.linkedin")} error={fieldErrors.linkedin}>
                  <input value={form.linkedin} onChange={set("linkedin")} inputMode="url" autoCapitalize="none" autoCorrect="off"
                    placeholder={t("companyCheck.linkedinPlaceholder")} className={inputCls(!!fieldErrors.linkedin)} />
                </Field>
                <Field label={t("companyCheck.sector")}>
                  <select value={form.sector} onChange={set("sector")} className={inputCls(false)}>
                    <option value="">{t("companyCheck.sectorAny")}</option>
                    {SECTORS.map((s) => <option key={s} value={s}>{sectorLabel(s, t)}</option>)}
                  </select>
                </Field>
              </div>

              <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-600">
                <Lock className="mt-0.5 h-3.5 w-3.5 flex-none text-gray-400" />{t("companyCheck.privacy")}
              </p>

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
                <p className="text-[11px] text-gray-400">{t("companyCheck.notCharged")}</p>
                <button type="submit"
                  className="inline-flex flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-[#0F172A] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1e293b]">
                  <Search className="h-4 w-4" />{t("companyCheck.find")}
                </button>
              </div>
            </form>
          )}

          {(step === "finding" || step === "starting") && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              <p className="text-sm font-semibold text-[#0F172A]">{t(step === "finding" ? "companyCheck.finding" : "companyCheck.starting")}</p>
              {step === "finding" && slow && <p className="max-w-sm text-xs text-gray-500">{t("companyCheck.slow")}</p>}
            </div>
          )}

          {step === "confirm" && (
            <>
              {generic && !form.website.trim() && <GenericNameNote name={form.name.trim()} />}
              <CandidateList candidates={candidates} onChoose={choose} onOpenCompany={openCompany} />
              {remaining !== null && candidates.some((c) => !c.startup_id) && (
                <p className="mt-3 text-[11px] text-gray-400">{t("companyCheck.remaining", { count: remaining })}</p>
              )}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                <button onClick={abandon} className="text-xs font-medium text-gray-500 hover:text-gray-700">{t("companyCheck.cancelCheck")}</button>
                {!form.website.trim() && (
                  <button onClick={addWebsite} className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F172A] hover:underline">
                    <Globe className="h-3.5 w-3.5" />{t("companyCheck.addWebsite")}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls = (bad: boolean) =>
  `w-full rounded-lg border bg-white px-3 py-2 text-sm text-[#0F172A] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0F172A]/10 ${
    bad ? "border-rose-300" : "border-gray-200"}`;

function Field({ label, hint, error, required, children }: {
  label: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-700">{label}{required && <span className="text-rose-500"> *</span>}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span>
        : hint ? <span className="mt-1 block text-xs text-gray-500">{hint}</span> : null}
    </label>
  );
}

/**
 * "Is this the company you mean?" — also used by the /checks/:id page when the
 * user comes back to a check waiting for them.
 */
export function CandidateList({ candidates, onChoose, onOpenCompany, busy = false }: {
  candidates: IdentityCandidate[];
  onChoose: (choice: number | "none") => void;
  onOpenCompany: (startupId: string) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  if (candidates.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center">
        <p className="text-sm font-semibold text-[#0F172A]">{t("companyCheck.noCandidatesTitle")}</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-500">{t("companyCheck.noCandidatesBlurb")}</p>
        <button disabled={busy} onClick={() => onChoose("none")}
          className="mt-4 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-[#0F172A] hover:bg-gray-50 disabled:opacity-50">
          {t("companyCheck.checkAnyway")}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {candidates.map((c, i) => {
        const domain = c.domain ?? displayDomain(c.website);
        return (
          <div key={`${domain ?? c.name}-${i}`} className="rounded-xl border border-gray-200 p-3.5">
            <div className="flex items-start gap-3">
              <CompanyLogo name={c.name} website={c.website} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-bold text-[#0F172A] break-words">{c.name}</span>
                  {c.startup_id && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{t("companyCheck.inAlphaMap")}</span>
                  )}
                  {c.source === "your_website" && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{t("companyCheck.yourWebsite")}</span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                  {domain && c.website && (
                    <a href={c.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-blue-600">
                      {domain}<ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {c.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{c.location}</span>}
                </div>
                {c.description && <p className="mt-1.5 text-xs leading-relaxed text-gray-600 line-clamp-3">{c.description}</p>}
                {c.unreachable && <p className="mt-1 text-[11px] text-amber-700">{t("companyCheck.unreachable")}</p>}
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              {c.startup_id ? (
                <button disabled={busy} onClick={() => onOpenCompany(c.startup_id!)}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {t("companyCheck.openInAlphaMap")}<ArrowRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button disabled={busy} onClick={() => onChoose(i)}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#0F172A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1e293b] disabled:opacity-50">
                  {t("companyCheck.thisOne")}<ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}
      <button disabled={busy} onClick={() => onChoose("none")}
        className="w-full rounded-lg border border-dashed border-gray-200 px-3 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
        {t("companyCheck.noneOfThese")}
      </button>
    </div>
  );
}

/** "Open in AlphaMap" for a matched check, as a link (used on the result page). */
export function OpenCompanyLink({ startupId, label }: { startupId: string; label: string }) {
  return (
    <Link to={companyPath(startupId)}
      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
      {label}<ArrowRight className="h-4 w-4" />
    </Link>
  );
}

/** A name many companies share: the website is what tells them apart. */
export function GenericNameNote({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <p className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />{t("companyCheck.genericName", { name })}
    </p>
  );
}
