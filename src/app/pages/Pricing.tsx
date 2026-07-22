import React, { useState } from "react";
import { useNavigate } from "react-router";
import {
  Check, Sparkles, Building2, Compass, ArrowRight, ShieldCheck,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { useUserPlan, type Plan } from "../../lib/plan";

// ─────────────────────────────────────────────────────────────────────────────
// Pricing — the freemium tier-selection page. Reachable from the sidebar/nav
// at any time, and it's where every "locked" upgrade prompt in the app
// ultimately points. Routes each tier's CTA to the right next step: free goes
// straight to sign-up, paid tiers go to sign-up (if not yet authenticated)
// then the placeholder checkout screen — or straight to checkout if the
// visitor already has an account.
// ─────────────────────────────────────────────────────────────────────────────

const PRO_MONTHLY = 39;
const PRO_ANNUAL_MONTHLY = 31; // ~20% off, billed yearly
const PRO_ANNUAL_TOTAL = PRO_ANNUAL_MONTHLY * 12;

interface Tier {
  id: Plan;
  name: string;
  icon: React.ElementType;
  tagline: string;
  features: string[];
  cta: string;
  highlight?: boolean;
  /** Not open for signup yet — button is inert and reads "Available Soon". */
  disabled?: boolean;
}

const TIERS: Tier[] = [
  {
    id: "free",
    name: "Explorer",
    icon: Compass,
    tagline: "Get a feel for the platform.",
    features: [
      "Basic company overview for every listing",
      "Limited public directory view",
      "Read-only access — no deep financials",
    ],
    cta: "Get Started Free",
  },
  {
    id: "pro",
    name: "Pro",
    icon: Sparkles,
    tagline: "Full-depth intelligence for individual investors and analysts.",
    features: [
      "Full data access across every company",
      "Complete funding timelines — Pre-Seed/Seed through Series A+",
      "Cap tables, headcount history, and competitor mapping",
      "Advanced filtering and unlimited searches",
    ],
    cta: "Upgrade to Pro",
    highlight: true,
    disabled: true,
  },
  {
    id: "enterprise",
    name: "Enterprise & VCs",
    icon: Building2,
    tagline: "Built for teams and firms operating at scale.",
    features: [
      "Multi-seat access for your whole team",
      "Direct CRM API integration",
      "Custom scoring models",
      "Priority support and bulk data exports",
    ],
    cta: "Contact Sales",
    disabled: true,
  },
];

function priceFor(tier: Tier["id"], annual: boolean): { amount: string; suffix: string; note?: string } {
  if (tier === "free") return { amount: "$0", suffix: "/ forever" };
  if (tier === "enterprise") return { amount: "Custom", suffix: "/ team" };
  return annual
    ? { amount: `$${PRO_ANNUAL_MONTHLY}`, suffix: "/ month", note: `billed annually · $${PRO_ANNUAL_TOTAL}/yr` }
    : { amount: `$${PRO_MONTHLY}`, suffix: "/ month" };
}

export function Pricing() {
  const [annual, setAnnual] = useState(true);
  const navigate = useNavigate();
  const { plan, loggedIn } = useUserPlan();

  function handleSelect(tierId: Plan) {
    if (tierId === "free") {
      navigate(loggedIn ? "/dashboard" : "/signup");
      return;
    }
    const dest = `/checkout/${tierId}${tierId === "pro" && annual ? "?annual=1" : ""}`;
    navigate(loggedIn ? dest : `/signup?next=${encodeURIComponent(dest)}`);
  }

  return (
    <Layout>
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-12 sm:py-16">

        {/* ── Header ── */}
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-semibold text-gray-500 mb-4">
            <Sparkles className="w-3.5 h-3.5 text-[#7C8967]" />
            Simple, transparent pricing
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#0F172A]">
            Find your edge in private markets
          </h1>
          <p className="mt-3 text-sm sm:text-base text-gray-500">
            Start free with the overview every company gets. Upgrade whenever you need the full picture —
            funding history, cap tables, and competitive intelligence.
          </p>
        </div>

        {/* ── Monthly / Annual toggle ── */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <span className={`text-sm font-semibold transition-colors ${!annual ? "text-[#0F172A]" : "text-gray-400"}`}>Monthly</span>
          <button
            onClick={() => setAnnual((a) => !a)}
            className="relative w-12 h-7 rounded-full bg-[#0F172A] transition-colors flex-none"
            aria-label="Toggle annual billing"
          >
            <span
              className="absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform duration-200"
              style={{ transform: annual ? "translateX(20px)" : "translateX(0)" }}
            />
          </button>
          <span className={`text-sm font-semibold transition-colors ${annual ? "text-[#0F172A]" : "text-gray-400"}`}>
            Annual <span className="text-emerald-600">· save 20%</span>
          </span>
        </div>

        {/* ── Tier cards ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {TIERS.map((tier) => {
            const price = priceFor(tier.id, annual);
            const Icon = tier.icon;
            const isCurrent = loggedIn && plan === tier.id;

            return (
              <div
                key={tier.id}
                className={`relative flex flex-col rounded-[24px] p-7 bg-white transition-all duration-300 ${
                  tier.highlight
                    ? "border-2 border-[#0F172A] shadow-[0_24px_60px_rgba(15,23,42,0.12)] md:-translate-y-3"
                    : "border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.02)]"
                }`}
              >
                {tier.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#0F172A] text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 whitespace-nowrap">
                    Most Popular
                  </span>
                )}

                <div className="flex items-center justify-between mb-5">
                  <div className={`w-11 h-11 rounded-[13px] flex items-center justify-center ${
                    tier.highlight ? "bg-[#0F172A]" : "bg-gray-50 border border-gray-100"
                  }`}>
                    <Icon className={`w-5 h-5 ${tier.highlight ? "text-white" : "text-[#0F172A]"}`} />
                  </div>
                  {tier.disabled && (
                    <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 bg-white border border-gray-200 rounded-full px-2 py-0.5">
                      Coming Soon
                    </span>
                  )}
                </div>

                <h3 className="text-lg font-bold text-[#0F172A]">{tier.name}</h3>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed min-h-[32px]">{tier.tagline}</p>

                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold tracking-tight text-[#0F172A]">{price.amount}</span>
                  <span className="text-sm font-medium text-gray-400">{price.suffix}</span>
                </div>
                {price.note && <p className="mt-1 text-[11px] text-gray-400">{price.note}</p>}

                <ul className="mt-6 flex flex-col gap-2.5 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px] text-gray-600 leading-snug">
                      <Check className="w-3.5 h-3.5 text-[#7C8967] mt-0.5 flex-none" />
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => !tier.disabled && handleSelect(tier.id)}
                  disabled={isCurrent || tier.disabled}
                  className={`mt-7 w-full flex items-center justify-center gap-1.5 rounded-[13px] px-4 py-3 text-sm font-bold transition-all ${
                    tier.disabled || isCurrent
                      ? "bg-gray-50 border border-gray-100 text-gray-400 cursor-not-allowed"
                      : tier.highlight
                        ? "bg-[#0F172A] text-white hover:bg-gray-900"
                        : "bg-gray-50 border border-gray-200 text-[#0F172A] hover:bg-gray-100"
                  }`}
                >
                  {tier.disabled ? "Available Soon" : isCurrent ? "Your Current Plan" : tier.cta}
                  {!tier.disabled && !isCurrent && <ArrowRight className="w-3.5 h-3.5" />}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-center gap-1.5 mt-10 text-xs text-gray-400">
          <ShieldCheck className="w-3.5 h-3.5" />
          No commitment — cancel anytime. Prices in USD.
        </div>
      </div>
    </Layout>
  );
}
