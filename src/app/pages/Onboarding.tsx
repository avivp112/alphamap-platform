import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2, ChevronLeft, ChevronRight, Loader2,
  Search, FileText, BarChart2, ClipboardCheck,
  UserCircle, TrendingUp, Building2, Rocket,
  Bell, Mail, FileDown, RefreshCw,
} from "lucide-react";
import { BrandMark, BrandWordmark } from "../components/BrandMark";
import { sectorLabel, stageLabel, SECTOR_TAXONOMY, STAGE_STEPS, type StageStep } from "../../lib/taxonomy";
import {
  upsertUserMandate, fetchDistinctCountries,
  type PainPointFocus, type SignalTrigger, type UserMandateDeliveryPrefs,
} from "../../lib/supabase";

// Supabase/PostgREST errors are plain { message, details, hint, code }
// objects, not Error instances -- `err instanceof Error` is always false for
// them, so a naive check here silently swallows the real failure reason and
// always shows the generic fallback text. Same pattern as getErrorMessage in
// src/app/pages/Startups.tsx.
function getErrorMessage(err: unknown): string | null {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return null;
}

// ── Shared step shape ────────────────────────────────────────────────────────
// Carried between steps in local state, then written once (upsertUserMandate)
// when the flow finishes or is skipped — no partial writes mid-flow.
interface OnboardingAnswers {
  stages: StageStep[];
  sectors: string[];
  geographies: string[];
  pain_point_focus: PainPointFocus | null;
  signal_triggers: SignalTrigger[];
  delivery_prefs: UserMandateDeliveryPrefs;
}

const EMPTY_ANSWERS: OnboardingAnswers = {
  stages: [],
  sectors: [],
  geographies: [],
  pain_point_focus: null,
  signal_triggers: [],
  delivery_prefs: {},
};

const TOTAL_STEPS = 4;

// ── Shared visual primitives (same tokens as the rest of the app: #0F172A
// navy for the primary/selected state, #7C8967/#7c3aed as secondary accents,
// rounded-[8px] corners, Playfair/serif for headings via font-serif) ────────

function ChipToggle({
  label, selected, onClick, tone = "navy",
}: {
  label: string; selected: boolean; onClick: () => void; tone?: "navy" | "violet";
}) {
  const selectedCls = tone === "violet"
    ? "bg-violet-50 border-violet-400 text-violet-700"
    : "bg-[#0F172A] border-[#0F172A] text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`text-sm font-semibold px-3.5 py-2 rounded-full border transition-colors ${
        selected ? selectedCls : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
      }`}
    >
      {label}
    </button>
  );
}

function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-7">
      <div className="flex items-baseline justify-between mb-2.5">
        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</span>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function StepHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-8">
      <h1 className="font-serif text-2xl sm:text-[1.75rem] leading-tight text-[#0F172A] mb-2">{title}</h1>
      <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
    </div>
  );
}

function StepProgress({ step }: { step: number }) {
  const { t } = useTranslation();
  return (
    <div className="mb-8">
      <div className="flex items-center gap-1.5 mb-2">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${i < step ? "bg-[#0F172A]" : "bg-gray-200"}`}
          />
        ))}
      </div>
      <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
        {t("onboarding.stepLabel", { current: step, total: TOTAL_STEPS })}
      </span>
    </div>
  );
}

function StepFooter({
  onBack, onNext, onSkip, nextLabel, nextDisabled, saving,
}: {
  onBack?: () => void;
  onNext: () => void;
  onSkip: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  saving?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between pt-2 mt-2 border-t border-gray-100">
      <div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-[#0F172A] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> {t("common.back")}
          </button>
        )}
      </div>
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={onSkip}
          disabled={saving}
          className="text-sm font-semibold text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
        >
          {t("onboarding.skipForNow")}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || saving}
          className="flex items-center gap-1.5 rounded-[8px] bg-[#0F172A] px-5 py-2.5 text-sm font-bold text-white hover:bg-gray-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {nextLabel}
          {!saving && <ChevronRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// ── Step 1: Investment Mandate (stages + sectors + geographies) ─────────────

function MandateStep({
  value, onNext, onSkip,
}: {
  value: OnboardingAnswers;
  onNext: (patch: Pick<OnboardingAnswers, "stages" | "sectors" | "geographies">) => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const [stages, setStages] = useState<StageStep[]>(value.stages);
  const [sectors, setSectors] = useState<string[]>(value.sectors);
  const [geographies, setGeographies] = useState<string[]>(value.geographies);
  const [countries, setCountries] = useState<string[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(true);

  useEffect(() => {
    fetchDistinctCountries()
      .then(setCountries)
      .catch(() => setCountries([]))
      .finally(() => setCountriesLoading(false));
  }, []);

  function toggleStage(s: StageStep) {
    setStages((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }
  function toggleSector(s: string) {
    setSectors((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }
  function toggleGeo(g: string) {
    setGeographies((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  }

  const parents = Object.keys(SECTOR_TAXONOMY).filter((p) => p !== "Uncategorized");
  const canContinue = stages.length > 0 && sectors.length > 0;

  return (
    <div>
      <StepHeading title={t("onboarding.mandate.title")} description={t("onboarding.mandate.description")} />

      <FieldGroup label={t("onboarding.mandate.stagesLabel")}>
        <div className="flex flex-wrap gap-2">
          {STAGE_STEPS.filter((s) => s.value !== "all").map((s) => (
            <ChipToggle
              key={s.value}
              label={stageLabel(s.label, t)}
              selected={stages.includes(s.value)}
              onClick={() => toggleStage(s.value)}
            />
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label={t("onboarding.mandate.sectorsLabel")} hint={t("onboarding.mandate.sectorsHint")}>
        <div className="flex flex-col gap-2.5">
          {parents.map((parent) => (
            <div key={parent}>
              <ChipToggle label={sectorLabel(parent, t)} selected={sectors.includes(parent)} onClick={() => toggleSector(parent)} />
              {sectors.includes(parent) && SECTOR_TAXONOMY[parent].length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2 ml-3 pl-3 border-l-2 border-violet-100">
                  {SECTOR_TAXONOMY[parent].map((sub) => (
                    <ChipToggle
                      key={sub}
                      label={sectorLabel(sub, t)}
                      selected={sectors.includes(sub)}
                      onClick={() => toggleSector(sub)}
                      tone="violet"
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label={t("onboarding.mandate.geographiesLabel")} hint={t("onboarding.mandate.geographiesHint")}>
        {countriesLoading ? (
          <Loader2 className="w-4 h-4 text-gray-300 animate-spin" />
        ) : (
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            {countries.map((c) => (
              <ChipToggle key={c} label={c} selected={geographies.includes(c)} onClick={() => toggleGeo(c)} />
            ))}
          </div>
        )}
      </FieldGroup>

      <StepFooter
        onNext={() => onNext({ stages, sectors, geographies })}
        onSkip={onSkip}
        nextLabel={t("common.next")}
        nextDisabled={!canContinue}
      />
    </div>
  );
}

// ── Step 2: Pain Point Focus (single-select) ─────────────────────────────────

const PAIN_POINT_OPTIONS: { value: PainPointFocus; icon: React.ElementType }[] = [
  { value: "origination", icon: Search },
  { value: "deck_processing", icon: FileText },
  { value: "comps_dd", icon: BarChart2 },
  { value: "ic_prep", icon: ClipboardCheck },
];

function PainPointStep({
  value, onBack, onNext, onSkip,
}: {
  value: PainPointFocus | null;
  onBack: () => void;
  onNext: (v: PainPointFocus) => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<PainPointFocus | null>(value);

  return (
    <div>
      <StepHeading title={t("onboarding.painPoint.title")} description={t("onboarding.painPoint.description")} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-7">
        {PAIN_POINT_OPTIONS.map(({ value: v, icon: Icon }) => {
          const active = selected === v;
          const key = v === "deck_processing" ? "deckProcessing" : v === "comps_dd" ? "compsDd" : v === "ic_prep" ? "icPrep" : "origination";
          return (
            <button
              key={v}
              type="button"
              onClick={() => setSelected(v)}
              className={`text-left rounded-[10px] p-4 border transition-all ${
                active
                  ? "border-2 border-[#0F172A] shadow-[0_8px_24px_rgba(15,23,42,0.10)]"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className={`w-9 h-9 rounded-[8px] flex items-center justify-center mb-3 ${active ? "bg-[#0F172A]" : "bg-gray-100"}`}>
                <Icon className={`w-4.5 h-4.5 ${active ? "text-white" : "text-gray-500"}`} />
              </div>
              <p className="text-sm font-bold text-[#0F172A] mb-1">{t(`onboarding.painPoint.options.${key}.title`)}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{t(`onboarding.painPoint.options.${key}.description`)}</p>
            </button>
          );
        })}
      </div>
      <StepFooter
        onBack={onBack}
        onNext={() => selected && onNext(selected)}
        onSkip={onSkip}
        nextLabel={t("common.next")}
        nextDisabled={!selected}
      />
    </div>
  );
}

// ── Step 3: Signal Triggers (multi-select) ───────────────────────────────────

const SIGNAL_TRIGGER_OPTIONS: { value: SignalTrigger; icon: React.ElementType }[] = [
  { value: "founder_pedigree", icon: UserCircle },
  { value: "traction_spikes", icon: TrendingUp },
  { value: "company_registrations", icon: Building2 },
  { value: "pre_public_funding", icon: Rocket },
];

function SignalTriggersStep({
  value, onBack, onNext, onSkip,
}: {
  value: SignalTrigger[];
  onBack: () => void;
  onNext: (v: SignalTrigger[]) => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<SignalTrigger[]>(value);

  function toggle(v: SignalTrigger) {
    setSelected((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  return (
    <div>
      <StepHeading title={t("onboarding.signalTriggers.title")} description={t("onboarding.signalTriggers.description")} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-7">
        {SIGNAL_TRIGGER_OPTIONS.map(({ value: v, icon: Icon }) => {
          const active = selected.includes(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              aria-pressed={active}
              className={`flex items-start gap-3 text-left rounded-[10px] p-4 border transition-all ${
                active ? "border-2 border-[#0F172A] shadow-[0_8px_24px_rgba(15,23,42,0.10)]" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className={`w-9 h-9 rounded-[8px] flex items-center justify-center flex-none ${active ? "bg-[#0F172A]" : "bg-gray-100"}`}>
                <Icon className={`w-4.5 h-4.5 ${active ? "text-white" : "text-gray-500"}`} />
              </div>
              <div>
                <p className="text-sm font-bold text-[#0F172A] mb-1">{t(`onboarding.signalTriggers.options.${v}.title`)}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{t(`onboarding.signalTriggers.options.${v}.description`)}</p>
              </div>
            </button>
          );
        })}
      </div>
      <StepFooter onBack={onBack} onNext={() => onNext(selected)} onSkip={onSkip} nextLabel={t("common.next")} />
    </div>
  );
}

// ── Step 4: Delivery Preferences (multi-select) ──────────────────────────────

const DELIVERY_OPTIONS: { key: keyof UserMandateDeliveryPrefs; icon: React.ElementType }[] = [
  { key: "push", icon: Bell },
  { key: "digest", icon: Mail },
  { key: "tearsheet_1click", icon: FileDown },
  { key: "crm_sync", icon: RefreshCw },
];

function DeliveryPrefsStep({
  value, saving, error, onBack, onFinish, onSkip,
}: {
  value: UserMandateDeliveryPrefs;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onFinish: (v: UserMandateDeliveryPrefs) => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<UserMandateDeliveryPrefs>(value);

  function toggle(key: keyof UserMandateDeliveryPrefs) {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div>
      <StepHeading title={t("onboarding.delivery.title")} description={t("onboarding.delivery.description")} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        {DELIVERY_OPTIONS.map(({ key, icon: Icon }) => {
          const active = Boolean(prefs[key]);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              aria-pressed={active}
              className={`flex items-start gap-3 text-left rounded-[10px] p-4 border transition-all ${
                active ? "border-2 border-[#0F172A] shadow-[0_8px_24px_rgba(15,23,42,0.10)]" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className={`w-9 h-9 rounded-[8px] flex items-center justify-center flex-none ${active ? "bg-[#0F172A]" : "bg-gray-100"}`}>
                <Icon className={`w-4.5 h-4.5 ${active ? "text-white" : "text-gray-500"}`} />
              </div>
              <div>
                <p className="text-sm font-bold text-[#0F172A] mb-1">{t(`onboarding.delivery.options.${key}.title`)}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{t(`onboarding.delivery.options.${key}.description`)}</p>
              </div>
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm text-rose-600 mb-4">{error}</p>}
      <StepFooter onBack={onBack} onNext={() => onFinish(prefs)} onSkip={onSkip} nextLabel={t("onboarding.finishButton")} saving={saving} />
    </div>
  );
}

// ── Side panel — same gradient/watermark/token language as SignUp.tsx's
// BrandPanel, with onboarding-specific copy (this is the screen right after
// signup, so it should read as a continuation, not a new product). ─────────

function OnboardingSidePanel() {
  const { t } = useTranslation();
  return (
    <div
      className="relative hidden lg:flex flex-col justify-between w-full h-full px-12 py-12 overflow-hidden"
      style={{ background: "linear-gradient(155deg, #EEF0EB 0%, #E7ECEE 55%, #F7F9F9 100%)" }}
    >
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(#0F172A 1px, transparent 1px), linear-gradient(90deg, #0F172A 1px, transparent 1px)",
          backgroundSize: "42px 42px",
        }}
      />
      <div
        className="absolute -top-32 -left-24 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(124,137,103,0.16), transparent 70%)" }}
      />
      <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-16 rotate-[7deg] opacity-[0.1]">
        <BrandMark size={340} />
      </div>

      <div className="relative z-10 flex items-center gap-2.5">
        <div className="rounded-lg bg-white/80 p-1.5 shadow-[0_2px_8px_rgba(15,23,42,0.08)]">
          <BrandMark size={30} />
        </div>
        <BrandWordmark className="text-2xl tracking-tight text-[#0F172A]" />
      </div>

      <div className="relative z-10 max-w-md">
        <span className="inline-block mb-4 text-[10px] font-bold uppercase tracking-widest text-[#5C6A4C]">
          {t("onboarding.eyebrow")}
        </span>
        <h2 className="font-serif text-3xl leading-tight text-[#0F172A] mb-5 text-balance">
          {t("onboarding.sidePanel.title")}
        </h2>
        <p className="text-sm text-[#0F172A]/60 leading-relaxed mb-6">{t("onboarding.sidePanel.body")}</p>
        <ul className="space-y-3.5">
          {(["f1", "f2", "f3"] as const).map((k) => (
            <li key={k} className="flex items-start gap-2.5 text-sm text-[#0F172A]/65 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 text-[#7C8967] flex-none mt-0.5" />
              {t(`onboarding.sidePanel.${k}`)}
            </li>
          ))}
        </ul>
      </div>

      <p className="relative z-10 text-xs text-[#0F172A]/35">{t("common.allRightsReserved", { year: new Date().getFullYear() })}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Onboarding() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState<OnboardingAnswers>(EMPTY_ANSWERS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(finalAnswers: OnboardingAnswers) {
    setSaving(true);
    setError(null);
    try {
      await upsertUserMandate(finalAnswers);
      navigate(next);
    } catch (err) {
      console.error("[Onboarding] Failed to save mandate:", err);
      setError(getErrorMessage(err) ?? t("onboarding.savingError"));
      setSaving(false);
    }
  }

  async function skip() {
    setSaving(true);
    setError(null);
    try {
      await upsertUserMandate(EMPTY_ANSWERS);
      navigate(next);
    } catch (err) {
      console.error("[Onboarding] Failed to save mandate:", err);
      setError(getErrorMessage(err) ?? t("onboarding.savingError"));
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* justify-start + fixed top padding, not justify-center: steps vary a
          lot in content height (Step 1's sector/stage/geo picker vs. a
          4-card grid), and centering vertically made the heading visibly
          jump position between steps. Anchoring to a fixed top offset keeps
          it in the same place throughout the flow. */}
      <div className="flex-1 flex flex-col justify-start px-6 sm:px-12 lg:px-16 pt-16 sm:pt-20 pb-12 overflow-y-auto">
        <div className="w-full max-w-xl mx-auto">
          <StepProgress step={step} />

          {step === 1 && (
            <MandateStep
              value={answers}
              onSkip={skip}
              onNext={(patch) => {
                setAnswers((a) => ({ ...a, ...patch }));
                setStep(2);
              }}
            />
          )}
          {step === 2 && (
            <PainPointStep
              value={answers.pain_point_focus}
              onBack={() => setStep(1)}
              onSkip={skip}
              onNext={(v) => {
                setAnswers((a) => ({ ...a, pain_point_focus: v }));
                setStep(3);
              }}
            />
          )}
          {step === 3 && (
            <SignalTriggersStep
              value={answers.signal_triggers}
              onBack={() => setStep(2)}
              onSkip={skip}
              onNext={(v) => {
                setAnswers((a) => ({ ...a, signal_triggers: v }));
                setStep(4);
              }}
            />
          )}
          {step === 4 && (
            <DeliveryPrefsStep
              value={answers.delivery_prefs}
              saving={saving}
              error={error}
              onBack={() => setStep(3)}
              onSkip={skip}
              onFinish={(prefs) => finish({ ...answers, delivery_prefs: prefs })}
            />
          )}
        </div>
      </div>
      <div className="hidden lg:block lg:w-[42%]">
        <OnboardingSidePanel />
      </div>
    </div>
  );
}
