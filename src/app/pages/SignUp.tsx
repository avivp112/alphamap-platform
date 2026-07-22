import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router";
import {
  Eye, EyeOff, Loader2, AlertCircle, CheckCircle2, Mail, ArrowRight, ArrowLeft, ShieldCheck, X,
} from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { FaLinkedin } from "react-icons/fa";
import { supabase } from "../../lib/supabase";
import { BrandMark, BrandWordmark } from "../components/BrandMark";

// ── Terms of Use content ─────────────────────────────────────────────────────

const TERMS_SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: "1. Acceptance of Terms",
    body: [
      "These Terms of Use (\"Terms\") govern your access to and use of AlphaMap (the \"Service\"), a private-market intelligence platform. By creating an account, you confirm that you have read, understood, and agree to be bound by these Terms. If you do not agree, do not register for or use the Service.",
    ],
  },
  {
    heading: "2. Description of Service",
    body: [
      "AlphaMap aggregates, structures, and analyzes information about private companies, investors, and market activity, including funding history, cap tables, headcount trends, and comparative scoring. The Service may use automated tools, including AI-assisted research and search, to compile and summarize publicly available information.",
      "AlphaMap is under active development. Features, pricing, and data coverage may change, and some functionality described as \"beta\" may be incomplete, limited in accuracy, or modified without notice.",
    ],
  },
  {
    heading: "3. Eligibility and Account Registration",
    body: [
      "You must be at least 18 years old and capable of forming a binding contract to use the Service. You agree to provide accurate, current information when registering and to keep your account credentials confidential. You are responsible for all activity that occurs under your account.",
      "You agree to notify us promptly of any unauthorized use of your account or any other breach of security.",
    ],
  },
  {
    heading: "4. Subscriptions, Fees, and Beta Pricing",
    body: [
      "Certain features of the Service require a paid subscription. Prices, billing cycles, and available tiers (including any promotional or beta pricing) are displayed at the time of purchase and may change going forward; changes will not retroactively affect an active billing period without notice.",
      "Where a feature is explicitly marked as a beta or discounted offering, pricing may be temporary and subject to change once the underlying feature is generally available.",
    ],
  },
  {
    heading: "5. Acceptable Use",
    body: [
      "You agree not to: (a) scrape, harvest, or bulk-export data from the Service beyond what your plan permits; (b) reverse-engineer, decompile, or attempt to extract the Service's underlying models, scoring methods, or source code; (c) use the Service to build a competing product; (d) misrepresent your identity or affiliation; or (e) use the Service for any unlawful purpose, including in a manner that infringes the rights of any third party.",
      "We reserve the right to suspend or terminate accounts that violate this section or that we reasonably believe pose a security, legal, or operational risk to the Service or other users.",
    ],
  },
  {
    heading: "6. Not Investment Advice",
    body: [
      "AlphaMap provides information and analytical tools for general research purposes only. Nothing on the Service constitutes investment, legal, tax, or financial advice, and no content should be relied upon as a recommendation to buy, sell, hold, or otherwise transact in any security or private instrument.",
      "Company and investor data, including AI-generated summaries, scores, and valuations, may be incomplete, estimated, delayed, or inaccurate. You are solely responsible for independently verifying any information before making financial, investment, or business decisions, and you should consult a licensed financial, legal, or tax professional as appropriate. AlphaMap and its data are not a substitute for professional due diligence.",
    ],
  },
  {
    heading: "7. Intellectual Property",
    body: [
      "The Service, including its design, software, scoring methodologies, and original written content, is owned by AlphaMap and protected by applicable intellectual property laws. Subject to your compliance with these Terms, we grant you a limited, non-exclusive, non-transferable license to access and use the Service for your own internal research purposes.",
      "Underlying facts about third-party companies and investors are not owned by AlphaMap; our compilation, structuring, and analysis of that information is.",
    ],
  },
  {
    heading: "8. Third-Party Data and Links",
    body: [
      "The Service may reference or link to third-party websites, data providers, or search results. AlphaMap does not control and is not responsible for the accuracy, completeness, or availability of third-party content, and inclusion of such content does not imply endorsement.",
    ],
  },
  {
    heading: "9. Privacy",
    body: [
      "Our collection and use of personal information in connection with the Service is described in our Privacy Policy. By using the Service, you consent to that collection and use.",
    ],
  },
  {
    heading: "10. Disclaimer of Warranties",
    body: [
      "The Service is provided \"as is\" and \"as available,\" without warranties of any kind, whether express, implied, or statutory, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or that data will be complete or accurate.",
    ],
  },
  {
    heading: "11. Limitation of Liability",
    body: [
      "To the fullest extent permitted by law, AlphaMap and its officers, employees, and affiliates will not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or business opportunity, arising from your use of or inability to use the Service, including any financial or investment decision made in reliance on information obtained through the Service.",
      "Our total aggregate liability for any claim arising from these Terms or the Service is limited to the amount you paid us, if any, in the twelve months preceding the claim.",
    ],
  },
  {
    heading: "12. Indemnification",
    body: [
      "You agree to indemnify and hold AlphaMap harmless from any claims, damages, liabilities, and expenses (including reasonable legal fees) arising from your violation of these Terms or misuse of the Service.",
    ],
  },
  {
    heading: "13. Termination",
    body: [
      "You may stop using the Service and close your account at any time. We may suspend or terminate your access if we reasonably believe you have violated these Terms, with notice where practicable. Provisions that by their nature should survive termination (including intellectual property, disclaimers, and limitation of liability) will survive.",
    ],
  },
  {
    heading: "14. Governing Law and Disputes",
    body: [
      "These Terms are governed by applicable law without regard to conflict-of-laws principles. Any dispute arising from these Terms or the Service shall be resolved in the courts of competent jurisdiction, except where mandatory local consumer-protection law provides otherwise.",
    ],
  },
  {
    heading: "15. Changes to These Terms",
    body: [
      "We may update these Terms from time to time to reflect changes to the Service or applicable law. If we make material changes, we will provide reasonable notice, such as an in-app notice or an update to the \"last updated\" date below. Continued use of the Service after changes take effect constitutes acceptance of the revised Terms.",
    ],
  },
  {
    heading: "16. Contact",
    body: [
      "Questions about these Terms can be directed to the support contact listed in your account settings or on the AlphaMap website.",
    ],
  },
];

function TermsOfUseModal({ onClose }: { onClose: () => void }) {
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
            <h2 className="text-lg font-bold text-[#0F172A]">Terms of Use</h2>
            <p className="text-xs text-gray-400 mt-0.5">Last updated {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
          </div>
          <button
            onClick={onClose}
            className="flex-none w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-[#0F172A] transition-colors"
            aria-label="Close"
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
            Close
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
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-[#0F172A] " +
  "placeholder-gray-400 transition-all focus:outline-none focus:border-[#0F172A]/30 focus:ring-2 focus:ring-[#0F172A]/10";
const inputErrCls =
  "border-rose-300 focus:border-rose-400 focus:ring-rose-100";
const labelCls = "block text-xs font-semibold text-gray-600 mb-1";

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
        style={{ background: "radial-gradient(circle, rgba(184,201,209,0.16), transparent 70%)" }}
      />
      {/* subtle rhino watermark, same mark as the logo */}
      <div aria-hidden className="pointer-events-none absolute -bottom-16 -right-14 opacity-[0.08] -rotate-[4deg]">
        <BrandMark size={340} />
      </div>

      <div className="relative z-10 flex items-center gap-2.5">
        <BrandMark size={36} />
        <BrandWordmark className="text-2xl tracking-tight text-white" />
      </div>

      <div className="relative z-10 max-w-md">
        <span className="inline-block mb-4 text-[10px] font-bold uppercase tracking-widest text-[#B8C9D1]">
          Welcome to AlphaMap
        </span>
        <h2 className="font-serif text-3xl leading-tight text-white mb-5 text-balance">
          Your <span className="text-[#B8C9D1]">edge</span> in private markets starts here.
        </h2>
        <p className="text-sm text-white/60 leading-relaxed mb-6">
          Join the analysts, investors, and operators using AlphaMap to see the full picture — before the rest of the market catches up.
        </p>
        <ul className="space-y-3.5">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-white/70 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 text-[#7C8967] flex-none mt-0.5" />
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
      setFormError(err instanceof Error ? err.message : "Couldn't start sign-up. Please try again.");
      setLoading("idle");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const errors = validate(values);
    if (!termsAccepted) errors.terms = "You must accept the Terms of Use to create an account.";
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
        throw new Error("An account with this email already exists. Try logging in instead.");
      }

      onSignedUp(values.email.trim());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong creating your account. Please try again.");
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

      <h1 className="font-serif text-2xl font-bold text-[#0F172A] mb-1">Create your account</h1>
      <p className="text-sm text-gray-500 mb-4">Start researching private markets in minutes.</p>

      <div className="space-y-2 mb-4">
        <button
          type="button"
          onClick={() => handleOAuth("google")}
          disabled={loading !== "idle"}
          className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-60 text-sm font-semibold text-[#0F172A] py-2 transition-all"
        >
          {loading === "google" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FcGoogle className="w-4.5 h-4.5" />}
          Sign up with Google
        </button>
        <button
          type="button"
          onClick={() => handleOAuth("linkedin_oidc")}
          disabled={loading !== "idle"}
          className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-60 text-sm font-semibold text-[#0F172A] py-2 transition-all"
        >
          {loading === "linkedin" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FaLinkedin className="w-4 h-4 text-[#0A66C2]" />}
          Sign up with LinkedIn
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Or</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-3">
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

        <div className="space-y-2">
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none rounded border-gray-300 text-[#0F172A] focus:ring-[#0F172A]/20"
            />
            <span className="text-xs text-gray-500 leading-snug">
              I'd like to receive product updates, reports, and market analyses from AlphaMap.{" "}
              <span className="text-gray-400">(optional)</span>
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
              I accept AlphaMap's{" "}
              <button
                type="button"
                onClick={() => setShowTerms(true)}
                className="font-semibold text-[#0F172A] underline underline-offset-2 hover:text-gray-700"
              >
                Terms of Use
              </button>.
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
          {loading === "submit" ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Create account<ArrowRight className="w-4 h-4" /></>}
        </button>
      </form>

      {showTerms && <TermsOfUseModal onClose={() => setShowTerms(false)} />}

      <p className="mt-4 text-center text-sm text-gray-500">
        Already have an account?{" "}
        <Link
          to={next === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(next)}`}
          className="font-semibold text-[#0F172A] hover:underline"
        >
          Log in
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
