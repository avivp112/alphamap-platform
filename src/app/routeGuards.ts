import { redirect } from "react-router";
import { supabase } from "../lib/supabase";

// Loader-level gate for routes that require a signed-in user. Runs before the
// route renders, so a signed-out visitor never sees so much as a flash of
// protected content — they land straight on /pricing, matching the
// destination the "View Dashboard" CTA already sends signed-out visitors to
// (see navHome.ts). getSession() reads the persisted session from local
// storage rather than validating it over the network, the same trade-off
// navHome.ts makes for the same reason: it has to be fast enough to sit in
// front of every protected page.
export async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) throw redirect("/pricing");
  return null;
}

// Same as requireAuth, plus a one-time onboarding gate — used ONLY on
// /dashboard (the one canonical post-signup landing spot for all three auth
// methods), not on every protected route, so this doesn't add a DB round
// trip to every page load for the lifetime of the account. A missing
// user_mandates row means the user has never completed (or skipped)
// onboarding; "Skip for now" writes an empty row via upsertUserMandate so
// this never redirects them again.
export async function requireOnboarding() {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) throw redirect("/pricing");

  const { data: mandate } = await supabase
    .from("user_mandates")
    .select("user_id")
    .eq("user_id", data.session.user.id)
    .maybeSingle();
  if (!mandate) throw redirect("/onboarding?next=/dashboard");

  return null;
}
