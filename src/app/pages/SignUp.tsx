import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { localeFor } from "../../lib/i18n";
import {
  Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, Mail, ArrowRight, ArrowLeft, ShieldCheck, X,
} from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { FaLinkedin } from "react-icons/fa";
import { supabase } from "../../lib/supabase";
import { TERMS_SECTIONS } from "../../lib/legal";
import { BrandMark, BrandWordmark } from "../components/BrandMark";

function TermsOfUseModal({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6"
      style={{ background: "rgba(6,13,25,0.55)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-2xl bg-white rounded-[24px] shadow-[0_32px_80px_rgba(15,23,42,0.35)]"
        style={{ maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-none flex items-start justify-between px-7 pt-6 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-[#0F172A]">{t("auth.signup.termsTitle")}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {t("auth.signup.lastUpdated", {
                date: new Date().toLocaleDateString(localeFor(i18n.resolvedLanguage ?? "en"), { month: "long", year: "numeric" }),
              })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex-none w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-[#0F172A] transition-colors"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-7 py-5" style={{ scrollbarWidth: "thin" }}>
          <div className="space-y-5">
            {TERMS_SECTIONS.map((s) => (
              <div key={s.heading}>
                <h3 className="text-sm font-bold text-[#0F172A] mb-1.5">{s.heading}</h3>
                {s.body.map((p, i) => (
                  <p key={i} className="text-xs text-gray-600 leading-relaxed mb-2 last:mb-0">{p}</p>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex-none px-7 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-[#0F172A] hover:bg-gray-900 text-white font-semibold text-sm py-2.5 transition-colors"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Validation ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

interface FormValues {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface FieldErrors {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  terms?: string;
}

// Takes t so messages resolve in the active language at validation time.
function validate(values: FormValues, t: TFunction): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.fullName.trim()) {
    errors.fullName = t("auth.validation.nameRequired");
  } else if (values.fullName.trim().length < 2) {
    errors.fullName = t("auth.validation.nameShort");
  }

  if (!values.email.trim()) {
    errors.email = t("auth.validation.emailRequired");
  } else if (!EMAIL_RE.test(values.email.trim())) {
    errors.email = t("auth.validation.emailInvalid");
  }

  if (!values.password) {
    errors.password = t("auth.validation.passwordCreate");
  } else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = t("auth.validation.passwordMin", { count: MIN_PASSWORD_LENGTH });
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = t("auth.validation.confirmRequired");
  } else if (values.password !== values.confirmPassword) {
    errors.confirmPassword = t("auth.validation.passwordMismatch");
  }

  return errors;
}

// ── Shared bits ───────────────────────────────────────────────────────────────

type Loading = "idle" | "google" | "linkedin" | "submit" | "verify" | "resend";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1.5 text-xs font-medium text-rose-600">{message}</p>;
}

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">
      <AlertCircle className="w-4 h-4 flex-none mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-[#0F172A] " +
  "placeholder-gray-400 transition-all focus:outline-none focus:border-[#0F172A]/30 focus:ring-2 focus:ring-[#0F172A]/10";
const inputErrCls =
  "border-rose-300 focus:border-rose-400 focus:ring-rose-100";
const labelCls = "block text-xs font-semibold text-gray-600 mb-1";

// ── Left brand panel (desktop only) ──────────────────────────────────────────

const FEATURE_KEYS = ["auth.brand.f1", "auth.brand.f2", "auth.brand.f3"];

function BrandPanel() {
  const { t } = useTranslation();
  return (
    <div
      className="relative hidden lg:flex flex-col justify-between w-full h-full px-12 py-12 overflow-hidden"
      style={{ background: "linear-gradient(155deg, #EEF0EB 0%, #E7ECEE 55%, #F7F9F9 100%)" }}
    >
      <style>{`
        @keyframes rhino-blink { 0%, 100% { opacity: 0.07; } 50% { opacity: 0.16; } }
        .rhino-watermark-signup { animation: rhino-blink 5s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .rhino-watermark-signup { animation: none; opacity: 0.1; }
        }
      `}</style>
      {/* subtle grid texture */}
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(#0F172A 1px, transparent 1px), linear-gradient(90deg, #0F172A 1px, transparent 1px)",
          backgroundSize: "42px 42px",
        }}
      />
      <div
        className="absolute -top-32 -left-24 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(124,137,103,0.16), transparent 70%)" }}
      />
      {/* subtle rhino watermark, same mark as the logo — shifted toward the left, gently pulsing */}
      <div aria-hidden className="rhino-watermark-signup pointer-events-none absolute -bottom-16 -left-16 rotate-[7deg]">
        <BrandMark size={340} />
      </div>

      <div className="relative z-10 flex items-center gap-2.5">
        <div className="rounded-xl bg-white/80 p-1.5 shadow-[0_2px_8px_rgba(15,23,42,0.08)]">
          <BrandMark size={30} />
        </div>
        <BrandWordmark className="text-2xl tracking-tight text-[#0F172A]" />
      </div>

      <div className="relative z-10 max-w-md">
        <span className="inline-block mb-4 text-[10px] font-bold uppercase tracking-widest text-[#5C6A4C]">
          {t("auth.brand.welcomeTo")}
        </span>
        <h2 className="font-serif text-3xl leading-tight text-[#0F172A] mb-5 text-balance">
          {t("auth.brand.edgePrefix")}<span className="text-[#5C6A4C]">{t("auth.brand.edgeAccent")}</span>{t("auth.brand.edgeSuffix")}
        </h2>
        <p className="text-sm text-[#0F172A]/60 leading-relaxed mb-6">
          {t("auth.brand.joinBlurb")}
        </p>
        <ul className="space-y-3.5">
          {FEATURE_KEYS.map((k) => (
            <li key={k} className="flex items-start gap-2.5 text-sm text-[#0F172A]/65 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 text-[#7C8967] flex-none mt-0.5" />
              {t(k)}
            </li>
          ))}
        </ul>
      </div>

      <p className="relative z-10 text-xs text-[#0F172A]/35">{t("common.allRightsReserved", { year: new Date().getFullYear() })}</p>
    </div>
  );
}

// ── OTP verification view ────────────────────────────────────────────────────

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_S = 30;

function OtpView({
  email, onVerified, onBack,
}: {
  email: string; onVerified: () => void; onBack: () => void;
}) {
  const { t } = useTranslation();
  const [otp, setOtp]           = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState<Loading>("idle");
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const code = otp.trim();
    if (code.length !== OTP_LENGTH) {
      setError(t("auth.otp.errLength", { length: OTP_LENGTH }));
      return;
    }
    setLoading("verify");
    try {
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        email, token: code, type: "signup",
      });
      if (verifyErr) throw verifyErr;
      onVerified();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.otp.errInvalid"));
    } finally {
      setLoading("idle");
    }
  }

  async function handleResend() {
    if (cooldown > 0) return;
    setError(null);
    setLoading("resend");
    try {
      const { error: resendErr } = await supabase.auth.resend({ type: "signup", email });
      if (resendErr) throw resendErr;
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.otp.errResend"));
    } finally {
      setLoading("idle");
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-[#0F172A] transition-colors mb-6"
      >
        <ArrowLeft className="w-3.5 h-3.5" />{t("common.back")}
      </button>

      <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mb-5">
        <ShieldCheck className="w-6 h-6 text-[#F59E0B]" />
      </div>
      <h1 className="font-serif text-2xl font-bold text-[#0F172A] mb-2">{t("auth.otp.title")}</h1>
      <p className="text-sm text-gray-500 mb-7 leading-relaxed">
        {t("auth.otp.blurb", { length: OTP_LENGTH })} <span className="font-semibold text-[#0F172A]">{email}</span>{t("auth.otp.blurbAfter")}
      </p>

      <form onSubmit={handleVerify} noValidate>
        <label className={labelCls} htmlFor="otp">{t("auth.otp.label")}</label>
        <input
          ref={inputRef}
          id="otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
          placeholder="••••••"
          className={`${inputCls} ${error ? inputErrCls : ""} text-center text-xl tracking-[0.5em] font-semibold`}
        />

        <div className="mt-4">
          <ErrorBanner message={error} />
        </div>

        <button
          type="submit"
          disabled={loading === "verify" || otp.length !== OTP_LENGTH}
          className="mt-5 w-full flex items-center justify-center gap-2 rounded-xl bg-[#0F172A] hover:bg-[#1e293b] disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm py-3 transition-all"
        >
          {loading === "verify" ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{t("auth.otp.verify")}<ArrowRight className="w-4 h-4" /></>}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-gray-400">
        {t("auth.otp.didntGet")}{" "}
        <button
          onClick={handleResend}
          disabled={cooldown > 0 || loading === "resend"}
          className="font-semibold text-[#0F172A] hover:underline disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed"
        >
          {loading === "resend" ? t("auth.login.sending") : cooldown > 0 ? t("auth.otp.resendIn", { seconds: cooldown }) : t("auth.otp.resend")}
        </button>
      </p>
    </div>
  );
}

// ── Main sign-up form view ───────────────────────────────────────────────────

function SignUpForm({ onSignedUp }: { onSignedUp: (email: string) => void }) {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const [values, setValues]           = useState<FormValues>({ fullName: "", email: "", password: "", confirmPassword: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError]     = useState<string | null>(null);
  const [loading, setLoading]         = useState<Loading>("idle");
  const [showPassword, setShowPassword]   = useState(false);
  const [showConfirm, setShowConfirm]     = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [termsAccepted, setTermsAccepted]   = useState(false);
  const [showTerms, setShowTerms]           = useState(false);

  function setField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((e) => ({ ...e, [key]: undefined }));
  }

  async function handleOAuth(provider: "google" | "linkedin_oidc") {
    setFormError(null);
    setLoading(provider === "google" ? "google" : "linkedin");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/dashboard` },
      });
      if (error) throw error;
      // On success the browser is redirected to the provider — no further action needed here.
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("auth.signup.errStart"));
      setLoading("idle");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const errors = validate(values, t);
    if (!termsAccepted) errors.terms = t("auth.validation.termsRequired");
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading("submit");
    try {
      const { data, error } = await supabase.auth.signUp({
        email: values.email.trim(),
        password: values.password,
        options: {
          data: {
            full_name: values.fullName.trim(),
            marketing_opt_in: marketingOptIn,
            terms_accepted_at: new Date().toISOString(),
          },
          // No redirect URL — we want the "Confirm signup" email to carry a
          // {{ .Token }} OTP code, not a clickable {{ .ConfirmationURL }} link.
          emailRedirectTo: undefined,
        },
      });
      if (error) throw error;

      // Supabase returns a 200 with no error — and sends no email — when the
      // address already belongs to a confirmed account (this is deliberate,
      // to avoid leaking which emails are registered). The only signal is an
      // empty identities array, so surface it explicitly instead of silently
      // advancing to an OTP screen for a code that will never arrive.
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        throw new Error(t("auth.signup.errExists"));
      }

      onSignedUp(values.email.trim());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("auth.signup.errGeneric"));
    } finally {
      setLoading("idle");
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="lg:hidden flex items-center gap-2.5 mb-5">
        <BrandMark size={32} />
        <BrandWordmark className="text-xl tracking-tight text-[#0F172A]" />
      </div>

      <h1 className="font-serif text-2xl font-bold text-[#0F172A] mb-1">{t("auth.signup.title")}</h1>
      <p className="text-sm text-gray-500 mb-4">{t("auth.signup.subtitle")}</p>

      <div className="space-y-2 mb-4">
        <button
          type="button"
          onClick={() => handleOAuth("google")}
          disabled={loading !== "idle"}
          className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-60 text-sm font-semibold text-[#0F172A] py-2 transition-all"
        >
          {loading === "google" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FcGoogle className="w-4.5 h-4.5" />}
          {t("auth.signup.google")}
        </button>
        <button
          type="button"
          onClick={() => handleOAuth("linkedin_oidc")}
          disabled={loading !== "idle"}
          className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-60 text-sm font-semibold text-[#0F172A] py-2 transition-all"
        >
          {loading === "linkedin" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FaLinkedin className="w-4 h-4 text-[#0A66C2]" />}
          {t("auth.signup.linkedin")}
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{t("common.or")}</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        <div>
          <label className={labelCls} htmlFor="fullName">{t("auth.signup.fullName")}</label>
          <input
            id="fullName" type="text" autoComplete="name" placeholder={t("auth.signup.fullNamePlaceholder")}
            value={values.fullName} onChange={(e) => setField("fullName", e.target.value)}
            className={`${inputCls} ${fieldErrors.fullName ? inputErrCls : ""}`}
          />
          <FieldError message={fieldErrors.fullName} />
        </div>

        <div>
          <label className={labelCls} htmlFor="email">{t("auth.fields.email")}</label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
            <input
              id="email" type="email" autoComplete="email" placeholder={t("auth.fields.emailPlaceholder")}
              value={values.email} onChange={(e) => setField("email", e.target.value)}
              className={`${inputCls} pl-10 ${fieldErrors.email ? inputErrCls : ""}`}
            />
          </div>
          <FieldError message={fieldErrors.email} />
        </div>

        <div>
          <label className={labelCls} htmlFor="password">{t("auth.fields.password")}</label>
          <div className="relative">
            <input
              id="password" type={showPassword ? "text" : "password"} autoComplete="new-password"
              placeholder={t("auth.signup.passwordPlaceholder")}
              value={values.password} onChange={(e) => setField("password", e.target.value)}
              className={`${inputCls} pr-10 ${fieldErrors.password ? inputErrCls : ""}`}
            />
            <button
              type="button" onClick={() => setShowPassword((s) => !s)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <FieldError message={fieldErrors.password} />
        </div>

        <div>
          <label className={labelCls} htmlFor="confirmPassword">{t("auth.signup.confirmPassword")}</label>
          <div className="relative">
            <input
              id="confirmPassword" type={showConfirm ? "text" : "password"} autoComplete="new-password"
              placeholder={t("auth.signup.confirmPlaceholder")}
              value={values.confirmPassword} onChange={(e) => setField("confirmPassword", e.target.value)}
              className={`${inputCls} pr-10 ${fieldErrors.confirmPassword ? inputErrCls : ""}`}
            />
            <button
              type="button" onClick={() => setShowConfirm((s) => !s)}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"
              aria-label={showConfirm ? "Hide password" : "Show password"}
            >
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <FieldError message={fieldErrors.confirmPassword} />
        </div>

        <div className="space-y-2">
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none rounded border-gray-300 text-[#0F172A] focus:ring-[#0F172A]/20"
            />
            <span className="text-xs text-gray-500 leading-snug">
              {t("auth.signup.marketingOptIn")}{" "}
              <span className="text-gray-400">{t("common.optional")}</span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => {
                setTermsAccepted(e.target.checked);
                if (fieldErrors.terms) setFieldErrors((err) => ({ ...err, terms: undefined }));
              }}
              className={`mt-0.5 h-4 w-4 flex-none rounded border-gray-300 text-[#0F172A] focus:ring-[#0F172A]/20 ${fieldErrors.terms ? "border-rose-300" : ""}`}
            />
            <span className="text-xs text-gray-500 leading-snug">
              {t("auth.signup.acceptPrefix")}
              <button
                type="button"
                onClick={() => setShowTerms(true)}
                className="font-semibold text-[#0F172A] underline underline-offset-2 hover:text-gray-700"
              >
                {t("auth.signup.termsOfUse")}
              </button>{t("auth.signup.acceptSuffix")}
            </span>
          </label>
          <FieldError message={fieldErrors.terms} />
        </div>

        <ErrorBanner message={formError} />

        <button
          type="submit"
          disabled={loading !== "idle"}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#0F172A] hover:bg-[#1e293b] disabled:opacity-60 text-white font-semibold text-sm py-2.5 transition-all"
        >
          {loading === "submit" ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{t("auth.signup.createAccount")}<ArrowRight className="w-4 h-4" /></>}
        </button>
      </form>

      {showTerms && <TermsOfUseModal onClose={() => setShowTerms(false)} />}

      <p className="mt-4 text-center text-sm text-gray-500">
        {t("auth.signup.haveAccount")}{" "}
        <Link
          to={next === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(next)}`}
          className="font-semibold text-[#0F172A] hover:underline"
        >
          {t("auth.signup.logInLink")}
        </Link>
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SignUp() {
  const [stage, setStage] = useState<"form" | "otp">("form");
  const [pendingEmail, setPendingEmail] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // ?next= carries the visitor onward to a paid-tier checkout after signing
  // up (e.g. from a locked tearsheet tab or the Pricing page) — defaults to
  // the normal post-signup destination when absent.
  const next = searchParams.get("next") || "/dashboard";

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-white">
      <BrandPanel />
      <div className="flex items-center justify-center px-6 py-6">
        {stage === "form" ? (
          <SignUpForm
            onSignedUp={(email) => { setPendingEmail(email); setStage("otp"); }}
          />
        ) : (
          <OtpView
            email={pendingEmail}
            onBack={() => setStage("form")}
            onVerified={() => navigate(next)}
          />
        )}
      </div>
    </div>
  );
}
