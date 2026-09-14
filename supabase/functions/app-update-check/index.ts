// app-update-check — self-hosted update-check endpoint for the AlphaMap
// mobile app's Capacitor "live update" (OTA) mechanism.
//
// Wired up via capacitor.config.ts's CapacitorUpdater.updateUrl. The
// @capgo/capacitor-updater native plugin POSTs here on every app foreground
// (see its android/CapgoUpdater.java#createInfoObject for the exact request
// shape, and CapacitorUpdaterPlugin.java's auto-update handler for exactly
// what it does with each response shape below — both read from the
// installed node_modules/@capgo/capacitor-updater source, since this wire
// protocol isn't fully documented anywhere public).
//
// Request body (fields this endpoint actually reads; the plugin sends a few
// more that aren't needed here — platform/app identity, device telemetry):
//   { platform: "android"|"ios", version_name: string, defaultChannel?: string }
//
// Response, no update available:
//   { version: string, kind: "up_to_date", message: "No new version available" }
// Response, update available:
//   { version: string, url: string, checksum: string, message?: string }
// (the plugin treats ANY response with an "error" or "kind" field as
// non-updating, and requires a valid "url" to treat a response as an update
// — see the handler code above for the exact branching.)
//
// scripts/release_app_update.ts is the only writer of the app_releases table
// this reads from (public.app_releases, migration 20260914000000).
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    // Malformed request — "up_to_date" is the plugin's own safe default for
    // anything it can't act on, so failing this open (rather than a 400) is
    // the same "never break the user's app over a bad update check" spirit.
    return json({ version: "unknown", kind: "up_to_date", message: "Malformed request" });
  }

  const platform = typeof body.platform === "string" ? body.platform : null;
  const currentVersion = typeof body.version_name === "string" && body.version_name ? body.version_name : "unknown";
  const channel = typeof body.defaultChannel === "string" && body.defaultChannel ? body.defaultChannel : "production";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Most recent release for this channel that either targets this specific
  // platform or is universal (platform IS NULL). Ordered by created_at, not
  // by parsing the version string as semver — so "releasing" is always just
  // "insert a new row", including a deliberate rollback (insert an older
  // version again with a fresh created_at).
  const platformFilter = platform ? `platform.is.null,platform.eq.${platform}` : "platform.is.null";
  const { data, error } = await supabase
    .from("app_releases")
    .select("version, bundle_url, checksum, notes")
    .eq("channel", channel)
    .or(platformFilter)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[app-update-check] query failed:", error.message);
    // Same fail-open reasoning as the malformed-request case above — a
    // broken update check must never look like "you must update now".
    return json({ version: currentVersion, kind: "up_to_date", message: "Update check unavailable" });
  }

  if (!data || data.version === currentVersion) {
    return json({ version: currentVersion, kind: "up_to_date", message: "No new version available" });
  }

  return json({
    version: data.version,
    url: data.bundle_url,
    checksum: data.checksum,
    ...(data.notes ? { message: data.notes } : {}),
  });
});
