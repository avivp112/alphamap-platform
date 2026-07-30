import { supabase } from "./supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Where "home" is depends on who is asking, and the answer has to be correct
// on the FIRST click.
//
// useUserPlan() and TopNav both discover the session asynchronously and start
// out reporting logged-OUT. Routing off that state means a signed-in user who
// clicks before the check resolves — which is most of them, since the check is
// a network round trip and the button is above the fold — gets sent to the
// pricing page they already paid past. The bug is invisible in development,
// where the session resolves instantly against a warm local cache.
//
// So this resolves at CLICK time instead of render time. getSession() reads the
// persisted session from local storage rather than validating it over the
// network, which is what makes it fast enough to sit inside a click handler.
// That is the right trade here: the cost of trusting a stale token is landing
// on the dashboard a moment before it redirects to login, whereas the cost of
// being wrong the other way is telling a paying customer to buy a plan again.
// ─────────────────────────────────────────────────────────────────────────────

/** The signed-in landing spot. The app's real home, not the marketing page. */
export const APP_HOME = "/dashboard";

/**
 * Resolve the destination for a "go home" affordance.
 *
 * @param anonymous Where to send a visitor who is NOT signed in. This differs
 *   by affordance and is deliberately not defaulted: the "View Dashboard" CTA
 *   sends them to `/pricing` to choose a plan, whereas the logo sends them to
 *   `/` — a logo that dumps a browsing visitor onto a pricing table reads as a
 *   sales trap rather than navigation.
 */
export async function homePathNow(anonymous: string): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user ? APP_HOME : anonymous;
  } catch {
    // Storage unreadable (private browsing, blocked cookies). Treat as signed
    // out — the anonymous destination is always safe to show, and throwing
    // inside a click handler would leave the button silently dead.
    return anonymous;
  }
}
