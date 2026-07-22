import React, { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router";
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, Mail, ArrowRight } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { FaLinkedin } from "react-icons/fa";
import { supabase } from "../../lib/supabase";
import { BrandMark, BrandWordmark } from "../components/BrandMark";

// ── Validation ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormValues {
  email: string;
  password: string;
}

interface FieldErrors {
  email?: string;
  password?: string;
}

function validate(values: FormValues): FieldErrors {
  const errors: FieldErrors = {};
  if (!values.email.trim()) {
    errors.email = "Enter your email address.";
  } else if (!EMAIL_RE.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  if (!values.password) {
    errors.password = "Enter your password.";
  }
  return errors;
}

// ── Shared bits (same styling as SignUp.tsx) ─────────────────────────────────

type Loading = "idle" | "google" | "linkedin" | "submit" | "reset";

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

function InfoBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-700">
      <CheckCircle2 className="w-4 h-4 flex-none mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-[#0F172A] " +
  "placeholder-gray-400 transition-all focus:outline-none focus:border-[#0F172A]/30 focus:ring-2 focus:ring-[#0F172A]/10";
const inputErrCls = "border-rose-300 focus:border-rose-400 focus:ring-rose-100";
const labelCls = "block text-xs font-semibold text-gray-600 mb-1.5";

// ── Left brand panel (desktop only) — identical to SignUp.tsx ────────────────

const FEATURES = [
  "AI-driven research across 10,000+ private companies",
  "Real-time funding, cap table, and market intelligence",
  "One workspace bridging private innovation and public markets",
];

function BrandPanel() {
  return (
    <div
      className="relative hidden lg:flex flex-col justify-between w-full h-full px-12 py-12 overflow-hidden"
      style={{ background: "linear-gradient(155deg, #EEF0EB 0%, #E7ECEE 55%, #F7F9F9 100%)" }}
    >
      <style>{`
        @keyframes rhino-blink { 0%, 100% { opacity: 0.07; } 50% { opacity: 0.16; } }
        .rhino-watermark-login { animation: rhino-blink 5s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .rhino-watermark-login { animation: none; opacity: 0.1; }
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
      <div aria-hidden className="rhino-watermark-login pointer-events-none absolute -bottom-16 -left-20 rotate-[-8deg]">
        <BrandMark size={320} />
      </div>

      <div className="relative z-10 flex items-center gap-2.5">
        <div className="rounded-xl bg-white/80 p-1.5 shadow-[0_2px_8px_rgba(15,23,42,0.08)]">
          <BrandMark size={30} />
        </div>
        <BrandWordmark className="text-2xl tracking-tight text-[#0F172A]" />
      </div>

      <div className="relative z-10 max-w-md">
        <h2 className="font-serif text-3xl leading-tight text-[#0F172A] mb-5 text-balance">
          Bridging the gap between private innovation and <span className="text-[#5C6A4C]">public markets</span>.
        </h2>
        <ul className="space-y-3.5">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-[#0F172A]/65 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 text-[#7C8967] flex-none mt-0.5" />
              {f}
            </li>
          ))}
        </ul>
      </div>

      <p className="relative z-10 text-xs text-[#0F172A]/35">© {new Date().getFullYear()} AlphaMap. All rights reserved.</p>
    </div>
  );
}

// ── Login form ────────────────────────────────────────────────────────────────

function LoginForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const [values, setValues]           = useState<FormValues>({ email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError]     = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [loading, setLoading]         = useState<Loading>("idle");
  const [showPassword, setShowPassword] = useState(false);

  function setField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((e) => ({ ...e, [key]: undefined }));
    if (resetMessage) setResetMessage(null);
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
      setFormError(err instanceof Error ? err.message : "Couldn't start login. Please try again.");
      setLoading("idle");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setResetMessage(null);
    const errors = validate(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading("submit");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email.trim(),
        password: values.password,
      });
      if (error) throw error;
      navigate(next);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't log you in. Please check your credentials and try again.");
    } finally {
      setLoading("idle");
    }
  }

  async function handleForgotPassword() {
    setFormError(null);
    setResetMessage(null);
    const email = values.email.trim();
    if (!EMAIL_RE.test(email)) {
      setFieldErrors((e) => ({ ...e, email: "Enter your email address above first." }));
      return;
    }
    setLoading("reset");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setResetMessage(`If an account exists for ${email}, a password reset link is on its way.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't send a reset link. Please try again.");
    } finally {
      setLoading("idle");
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="lg:hidden flex items-center gap-2.5 mb-8">
        <BrandMark size={32} />
        <BrandWordmark className="text-xl tracking-tight text-[#0F172A]" />
      </div>

      <h1 className="font-serif text-2xl font-bold text-[#0F172A] mb-1.5">Welcome back</h1>
      <p className="text-sm text-gray-500 mb-7">Log in to keep researching private markets.</p>

      <div className="space-y-2.5 mb-5">
        <button
          type="button"
          onClick={() => handleOAuth("google")}
          disabled={loading !== "idle"}
          className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-60 text-sm font-semibold text-[#0F172A] py-2.5 transition-all"
        >
          {loading === "google" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FcGoogle className="w-4.5 h-4.5" />}
          Log in with Google
        </button>
        <button
          type="button"
          onClick={() => handleOAuth("linkedin_oidc")}
          disabled={loading !== "idle"}
          className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-60 text-sm font-semibold text-[#0F172A] py-2.5 transition-all"
        >
          {loading === "linkedin" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FaLinkedin className="w-4 h-4 text-[#0A66C2]" />}
          Log in with LinkedIn
        </button>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Or</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
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
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-semibold text-gray-600" htmlFor="password">Password</label>
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={loading !== "idle"}
              className="text-xs font-semibold text-[#0F172A] hover:underline disabled:text-gray-300 disabled:no-underline"
            >
              {loading === "reset" ? "Sending…" : "Forgot password?"}
            </button>
          </div>
          <div className="relative">
            <input
              id="password" type={showPassword ? "text" : "password"} autoComplete="current-password"
              placeholder="Enter your password"
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

        <InfoBanner message={resetMessage} />
        <ErrorBanner message={formError} />

        <button
          type="submit"
          disabled={loading !== "idle"}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#0F172A] hover:bg-[#1e293b] disabled:opacity-60 text-white font-semibold text-sm py-3 transition-all"
        >
          {loading === "submit" ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Sign In<ArrowRight className="w-4 h-4" /></>}
        </button>
      </form>

      <p className="mt-7 text-center text-sm text-gray-500">
        Don't have an account?{" "}
        <Link
          to={next === "/dashboard" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`}
          className="font-semibold text-[#0F172A] hover:underline"
        >
          Sign up
        </Link>
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Login() {
  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-white">
      <BrandPanel />
      <div className="flex items-center justify-center px-6 py-16">
        <LoginForm />
      </div>
    </div>
  );
}
