import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import {
  Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, Mail, ArrowRight, ArrowLeft, ShieldCheck,
} from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { FaLinkedin } from "react-icons/fa";
import { supabase } from "../../lib/supabase";

// ── Brand mark (matches TopNav.tsx exactly) ──────────────────────────────────

function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg bg-[#0F172A] flex-none"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round"
        style={{ width: size * 0.56, height: size * 0.56 }}
      >
        <path d="M15 8 C12 8 9 12 7 15 A4 4 0 1 1 8 8 C11 8 14 13 16 16 C17.5 18 19 12 20 6" />
        <polyline points="15 6 20 6 20 11" />
      </svg>
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
}

function validate(values: FormValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.fullName.trim()) {
    errors.fullName = "Enter your full name.";
  } else if (values.fullName.trim().length < 2) {
    errors.fullName = "Full name looks too short.";
  }

  if (!values.email.trim()) {
    errors.email = "Enter your email address.";
  } else if (!EMAIL_RE.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }

  if (!values.password) {
    errors.password = "Create a password.";
  } else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (!values.confirmPassword) {
    errors.confirmPassword = "Confirm your password.";
  } else if (values.password !== values.confirmPassword) {
    errors.confirmPassword = "Passwords do not match.";
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
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-[#0F172A] " +
  "placeholder-gray-400 transition-all focus:outline-none focus:border-[#0F172A]/30 focus:ring-2 focus:ring-[#0F172A]/10";
const inputErrCls =
  "border-rose-300 focus:border-rose-400 focus:ring-rose-100";
const labelCls = "block text-xs font-semibold text-gray-600 mb-1.5";

// ── Left brand panel (desktop only) ──────────────────────────────────────────

const FEATURES = [
  "AI-driven research across 10,000+ private companies",
  "Real-time funding, cap table, and market intelligence",
  "One workspace bridging private innovation and public markets",
];

function BrandPanel() {
  return (
    <div className="relative hidden lg:flex flex-col justify-between w-full h-full bg-[#0F172A] px-12 py-12 overflow-hidden">
      {/* subtle grid texture */}
      <div
        className="absolute inset-0 opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
          backgroundSize: "42px 42px",
        }}
      />
      <div
        className="absolute -top-32 -right-32 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(245,158,11,0.18), transparent 70%)" }}
      />

      <div className="relative z-10 flex items-center gap-2.5">
        <BrandMark size={36} />
        <span className="text-2xl font-bold tracking-tight text-white">AlphaMap</span>
      </div>

      <div className="relative z-10 max-w-md">
        <h2 className="font-serif text-3xl leading-tight text-white mb-5 text-balance">
          Bridging the gap between private innovation and public markets.
        </h2>
        <ul className="space-y-3.5">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-white/70 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 text-[#F59E0B] flex-none mt-0.5" />
              {f}
            </li>
          ))}
        </ul>
      </div>

      <p className="relative z-10 text-xs text-white/40">© {new Date().getFullYear()} AlphaMap. All rights reserved.</p>
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
      setError(`Enter the ${OTP_LENGTH}-digit code from your email.`);
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
      setError(err instanceof Error ? err.message : "That code is invalid or has expired. Please try again.");
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
      setError(err instanceof Error ? err.message : "Couldn't resend the code — please try again shortly.");
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
        <ArrowLeft className="w-3.5 h-3.5" />Back
      </button>

      <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mb-5">
        <ShieldCheck className="w-6 h-6 text-[#F59E0B]" />
      </div>
      <h1 className="font-serif text-2xl font-bold text-[#0F172A] mb-2">Check your inbox</h1>
      <p className="text-sm text-gray-500 mb-7 leading-relaxed">
        We sent a {OTP_LENGTH}-digit verification code to <span className="font-semibold text-[#0F172A]">{email}</span>.
        Enter it below to finish setting up your account.
      </p>

      <form onSubmit={handleVerify} noValidate>
        <label className={labelCls} htmlFor="otp">Verification code</label>
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
          {loading === "verify" ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Verify &amp; continue<ArrowRight className="w-4 h-4" /></>}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-gray-400">
        Didn't get a code?{" "}
        <button
          onClick={handleResend}
          disabled={cooldown > 0 || loading === "resend"}
          className="font-semibold text-[#0F172A] hover:underline disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed"
        >
          {loading === "resend" ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
      </p>
    </div>
  );
}

// ── Main sign-up form view ───────────────────────────────────────────────────

function SignUpForm({ onSignedUp }: { onSignedUp: (email: string) => void }) {
  const [values, setValues]           = useState<FormValues>({ fullName: "", email: "", password: "", confirmPassword: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError]     = useState<string | null>(null);
  const [loading, setLoading]         = useState<Loading>("idle");
  const [showPassword, setShowPassword]   = useState(false);
  const [showConfirm, setShowConfirm]     = useState(false);

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
      setFormError(err instanceof Error ? err.message : "Couldn't start sign-up. Please try again.");
      setLoading("idle");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const errors = validate(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading("submit");
    try {
      const { error } = await supabase.auth.signUp({
        email: values.email.trim(),
        password: values.password,
        options: { data: { full_name: values.fullName.trim() } },
      });
      if (error) throw error;
      onSignedUp(values.email.trim());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong creating your account. Please try again.");
    } finally {
      setLoading("idle");
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="lg:hidden flex items-center gap-2.5 mb-8">
        <BrandMark size={32} />
        <span className="text-xl font-bold tracking-tight text-[#0F172A]">AlphaMap</span>
      </div>

      <h1 className="font-serif text-2xl font-bold text-[#0F172A] mb-1.5">Create your account</h1>
      <p className="text-sm text-gray-500 mb-7">Start researching private markets in minutes.</p>

      <div className="space-y-2.5 mb-5">
        <button
          type="button"
          onClick={() => handleOAuth("google")}
          disabled={loading !== "idle"}
          className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-60 text-sm font-semibold text-[#0F172A] py-2.5 transition-all"
        >
          {loading === "google" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FcGoogle className="w-4.5 h-4.5" />}
          Sign up with Google
        </button>
        <button
          type="button"
          onClick={() => handleOAuth("linkedin_oidc")}
          disabled={loading !== "idle"}
          className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-60 text-sm font-semibold text-[#0F172A] py-2.5 transition-all"
        >
          {loading === "linkedin" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FaLinkedin className="w-4 h-4 text-[#0A66C2]" />}
          Sign up with LinkedIn
        </button>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Or</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label className={labelCls} htmlFor="fullName">Full name</label>
          <input
            id="fullName" type="text" autoComplete="name" placeholder="Jane Doe"
            value={values.fullName} onChange={(e) => setField("fullName", e.target.value)}
            className={`${inputCls} ${fieldErrors.fullName ? inputErrCls : ""}`}
          />
          <FieldError message={fieldErrors.fullName} />
        </div>

        <div>
          <label className={labelCls} htmlFor="email">Email address</label>
          <div className="relative">
            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
            <input
              id="email" type="email" autoComplete="email" placeholder="jane@company.com"
              value={values.email} onChange={(e) => setField("email", e.target.value)}
              className={`${inputCls} pl-10 ${fieldErrors.email ? inputErrCls : ""}`}
            />
          </div>
          <FieldError message={fieldErrors.email} />
        </div>

        <div>
          <label className={labelCls} htmlFor="password">Password</label>
          <div className="relative">
            <input
              id="password" type={showPassword ? "text" : "password"} autoComplete="new-password"
              placeholder="At least 8 characters"
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
          <label className={labelCls} htmlFor="confirmPassword">Confirm password</label>
          <div className="relative">
            <input
              id="confirmPassword" type={showConfirm ? "text" : "password"} autoComplete="new-password"
              placeholder="Re-enter your password"
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

        <ErrorBanner message={formError} />

        <button
          type="submit"
          disabled={loading !== "idle"}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#0F172A] hover:bg-[#1e293b] disabled:opacity-60 text-white font-semibold text-sm py-3 transition-all"
        >
          {loading === "submit" ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Create account<ArrowRight className="w-4 h-4" /></>}
        </button>
      </form>

      <p className="mt-7 text-center text-xs text-gray-400 leading-relaxed">
        By signing up, you agree to AlphaMap's Terms of Use and Privacy Policy.
      </p>
      <p className="mt-3 text-center text-sm text-gray-500">
        Already have an account?{" "}
        <span className="font-semibold text-[#0F172A]">Log in</span>
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SignUp() {
  const [stage, setStage] = useState<"form" | "otp">("form");
  const [pendingEmail, setPendingEmail] = useState("");
  const navigate = useNavigate();

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-white">
      <BrandPanel />
      <div className="flex items-center justify-center px-6 py-16">
        {stage === "form" ? (
          <SignUpForm
            onSignedUp={(email) => { setPendingEmail(email); setStage("otp"); }}
          />
        ) : (
          <OtpView
            email={pendingEmail}
            onBack={() => setStage("form")}
            onVerified={() => navigate("/dashboard")}
          />
        )}
      </div>
    </div>
  );
}
