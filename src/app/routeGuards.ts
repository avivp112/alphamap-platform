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
