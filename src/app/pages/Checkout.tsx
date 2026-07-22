import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router";
import {
  CreditCard, Lock, CheckCircle2, ArrowRight, Loader2, ShieldCheck, Sparkles, Building2,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { useUserPlan, setPlanPlaceholder, type Plan } from "../../lib/plan";

// ─────────────────────────────────────────────────────────────────────────────
// Checkout — placeholder billing-details screen for the Pro / Enterprise
// upgrade flows. No payment is actually processed here: there is no Stripe or
// payment-provider integration wired up yet, so submitting this form simply
// flips the user's plan flag (see src/lib/plan.ts) to unlock the app's gated
// content, so the freemium flow can be demoed end-to-end. The "Demo mode"
// notice below is a deliberate, honest disclosure — this must never be
// mistaken for a real payment collector.
// ─────────────────────────────────────────────────────────────────────────────

const PRO_MONTHLY = 39;
const PRO_ANNUAL_MONTHLY = 31;
// Discounted while the product is still in beta — matches the Pricing page.
const PRO_BETA_PRICE = 15;

const PLAN_INFO: Record<"pro" | "enterprise", { name: string; icon: React.ElementType }> = {
  pro:        { name: "Pro",              icon: Sparkles },
  enterprise: { name: "Enterprise & VCs",  icon: Building2 },
};

export function Checkout() {
  const { plan: rawPlan } = useParams<{ plan: string }>();
  const [searchParams] = useSearchParams();
  const annual = searchParams.get("annual") === "1";
  const navigate = useNavigate();
  const { loggedIn, loading } = useUserPlan();

  const plan: "pro" | "enterprise" | null =
    rawPlan === "pro" || rawPlan === "enterprise" ? rawPlan : null;

  const [form, setForm] = useState({ name: "", number: "", expiry: "", cvc: "", zip: "" });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Not signed in yet — send through sign-up, then straight back here.
  useEffect(() => {
    if (!loading && !loggedIn && plan) {
      navigate(`/signup?next=${encodeURIComponent(`/checkout/${plan}${annual ? "?annual=1" : ""}`)}`, { replace: true });
    }
  }, [loading, loggedIn, plan, annual, navigate]);

  if (!plan) {
    return (
      <Layout>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <p className="text-sm font-semibold text-[#0F172A]">Unknown plan</p>
          <Link to="/pricing" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#0F172A] hover:underline">
            Back to pricing <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </Layout>
    );
  }

  const info = PLAN_INFO[plan];
  const Icon = info.icon;
  const fullPriceLabel = plan === "pro"
    ? annual ? `$${PRO_ANNUAL_MONTHLY}/mo billed annually` : `$${PRO_MONTHLY}/mo`
    : "Custom pricing";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.number.trim() || !form.expiry.trim() || !form.cvc.trim()) {
      setError("Fill in every field to continue.");
      return;
    }
    setSubmitting(true);
    try {
      await setPlanPlaceholder(plan as Plan);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Layout>
        <div className="mx-auto max-w-md px-4 py-24 text-center flex flex-col items-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-5">
            <CheckCircle2 className="w-7 h-7 text-emerald-600" />
          </div>
          <h1 className="text-xl font-bold text-[#0F172A]">You're on {info.name} now</h1>
          <p className="mt-2 text-sm text-gray-500">Every locked section across the platform is unlocked.</p>
          <button
            onClick={() => navigate("/dashboard")}
            className="mt-7 flex items-center gap-1.5 rounded-[13px] bg-[#0F172A] px-5 py-3 text-sm font-bold text-white hover:bg-gray-900 transition-colors"
          >
            Go to Dashboard <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8">

          {/* ── Order summary ── */}
          <div className="md:col-span-2">
            <div className="rounded-[20px] border border-gray-100 bg-gray-50/60 p-6 sticky top-6">
              <div className="w-10 h-10 rounded-[11px] bg-[#0F172A] flex items-center justify-center mb-4">
                <Icon className="w-5 h-5 text-white" />
              </div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Upgrading to</p>
              <h2 className="text-xl font-bold text-[#0F172A] mt-0.5">{info.name}</h2>
              {plan === "pro" ? (
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-semibold text-gray-300 line-through">{fullPriceLabel}</span>
                  <span className="text-sm font-bold text-[#7C8967]">${PRO_BETA_PRICE}/mo</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-white bg-[#7C8967] rounded-full px-2 py-0.5">Beta Version</span>
                </div>
              ) : (
                <p className="mt-1 text-sm font-semibold text-gray-500">{fullPriceLabel}</p>
              )}
              <div className="mt-5 pt-5 border-t border-gray-200 text-xs text-gray-500 leading-relaxed">
                Full data access, complete funding timelines, and everything currently locked on your account
                unlocks immediately after this step.
              </div>
            </div>
          </div>

          {/* ── Placeholder card form ── */}
          <div className="md:col-span-3">
            <div className="flex items-center gap-2 mb-1">
              <CreditCard className="w-4 h-4 text-gray-400" />
              <h1 className="text-lg font-bold text-[#0F172A]">Billing details</h1>
            </div>
            <div className="flex items-center gap-1.5 mb-6 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200/70 rounded-full px-2.5 py-1 w-fit">
              <Lock className="w-3 h-3" />
              Demo mode — no card is charged, no real payment is processed
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Field label="Name on card">
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Jane Doe"
                  className={inputCls}
                />
              </Field>

              <Field label="Card number">
                <input
                  value={form.number}
                  onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
                  placeholder="4242 4242 4242 4242"
                  inputMode="numeric"
                  className={inputCls}
                />
              </Field>

              <div className="grid grid-cols-3 gap-4">
                <Field label="Expiry">
                  <input
                    value={form.expiry}
                    onChange={(e) => setForm((f) => ({ ...f, expiry: e.target.value }))}
                    placeholder="MM / YY"
                    className={inputCls}
                  />
                </Field>
                <Field label="CVC">
                  <input
                    value={form.cvc}
                    onChange={(e) => setForm((f) => ({ ...f, cvc: e.target.value }))}
                    placeholder="123"
                    inputMode="numeric"
                    className={inputCls}
                  />
                </Field>
                <Field label="Billing ZIP">
                  <input
                    value={form.zip}
                    onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))}
                    placeholder="94103"
                    className={inputCls}
                  />
                </Field>
              </div>

              {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="mt-2 flex items-center justify-center gap-1.5 rounded-[13px] bg-[#0F172A] px-5 py-3.5 text-sm font-bold text-white hover:bg-gray-900 transition-colors disabled:opacity-60"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {submitting ? "Confirming…" : `Confirm & Start ${info.name}`}
              </button>
              <p className="text-center text-[11px] text-gray-400">
                By continuing you agree to a simulated subscription — this build has no live billing yet.
              </p>
            </form>
          </div>
        </div>
      </div>
    </Layout>
  );
}

const inputCls = "w-full px-3.5 py-2.5 text-sm bg-white border border-gray-200 rounded-[10px] text-[#0F172A] placeholder-gray-300 focus:outline-none focus:border-gray-300 focus:ring-2 focus:ring-[#0F172A]/10 transition-all";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-gray-500">{label}</span>
      {children}
    </label>
  );
}
