import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Freemium plan state. There is no billing backend yet — no Stripe, no
// webhooks, no `profiles` table — so the current plan is stored directly on
// the Supabase auth user's own metadata (the same mechanism TopNav already
// reads `full_name` from). setPlanPlaceholder() is what the placeholder
// checkout screen calls to "complete" a purchase: it flips this flag and
// nothing else. This is intentionally a presentation-layer gate, not a real
// entitlement/security boundary — swap in a real `subscription_tier` column
// driven by payment-provider webhooks when real billing lands, and update
// useUserPlan() to read from that instead.
// ─────────────────────────────────────────────────────────────────────────────

export type Plan = "free" | "pro" | "enterprise";

export const PLAN_LABEL: Record<Plan, string> = {
  free: "Explorer",
  pro: "Pro",
  enterprise: "Enterprise",
};

function coercePlan(value: unknown): Plan {
  return value === "pro" || value === "enterprise" ? value : "free";
}

export function isPaidPlan(plan: Plan): boolean {
  return plan !== "free";
}

export async function setPlanPlaceholder(plan: Plan): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { plan } });
  if (error) throw error;
}

export interface UserPlanState {
  plan: Plan;
  loggedIn: boolean;
  loading: boolean;
}

// Mirrors the auth-state subscription pattern already used in TopNav.tsx.
export function useUserPlan(): UserPlanState {
  const [state, setState] = useState<UserPlanState>({ plan: "free", loggedIn: false, loading: true });

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data.user) { setState({ plan: "free", loggedIn: false, loading: false }); return; }
      setState({ plan: coercePlan(data.user.user_metadata?.plan), loggedIn: true, loading: false });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (!session?.user) { setState({ plan: "free", loggedIn: false, loading: false }); return; }
      setState({ plan: coercePlan(session.user.user_metadata?.plan), loggedIn: true, loading: false });
    });

    return () => { cancelled = true; subscription.subscription.unsubscribe(); };
  }, []);

  return state;
}
