// Phase 9: the CRM Webhook Engine's actual signing + delivery step.
//
// This deliberately does NOT run as a service-role function. It creates its
// Supabase client with the caller's own forwarded Authorization header, so
// the SAME RLS policies the client already relies on (user_webhooks_select_own:
// auth.uid() = user_id) are what actually restrict the lookup below to the
// caller's own webhook config -- a bug in this function's own logic could
// never leak or trigger another user's webhook, because the database enforces
// it, not this code. See user_webhooks_select_own in
// supabase/migrations/20260924000000_preference_engine_phase1.sql.
//
// Signing and the outbound POST have to happen server-side, not in the
// browser: a client-computed HMAC could be forged by anyone with devtools
// (defeating the whole point of "the receiving endpoint can verify this came
// from AlphaMap"), and an arbitrary third-party CRM/Zapier URL won't send
// CORS headers for a direct browser fetch anyway.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncRequestBody {
  startup_id?: string;
  test?: boolean;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return Response.json({ error: "Missing Authorization header" }, { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    // ANON key for the client handshake, but the caller's own JWT forwarded
    // as the Authorization header -- PostgREST resolves auth.uid() and the
    // `authenticated` role from THAT header, regardless of which apikey was
    // used to construct the client. This is what makes every query below
    // "as the calling user," not "as an admin."
    const supa = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const body = (await req.json().catch(() => ({}))) as SyncRequestBody;

    const { data: webhook, error: webhookErr } = await supa
      .from("user_webhooks")
      .select("target_url, secret, enabled")
      .maybeSingle();

    if (webhookErr) {
      console.error("[crm-webhook-sync] Failed to load webhook config:", webhookErr);
      return Response.json({ error: "Failed to load your webhook configuration." }, { status: 500, headers: corsHeaders });
    }
    if (!webhook) {
      return Response.json(
        { error: "No CRM webhook configured. Set one up in Profile > Integrations." },
        { status: 404, headers: corsHeaders },
      );
    }
    if (!webhook.enabled) {
      return Response.json({ error: "Your CRM webhook is currently disabled." }, { status: 409, headers: corsHeaders });
    }

    let payload: Record<string, unknown>;

    if (body.test) {
      payload = {
        event: "webhook.test",
        timestamp: new Date().toISOString(),
        message: "This is a test event from AlphaMap. If you're seeing this, your webhook is wired up correctly.",
      };
    } else {
      if (!body.startup_id) {
        return Response.json({ error: "startup_id is required" }, { status: 400, headers: corsHeaders });
      }

      const { data: startup, error: startupErr } = await supa
        .from("startups_search")
        .select(
          "id, name, website, sector_parent, sub_sector_names, latest_round_type, city, country, latest_valuation, total_raised, employee_count, founded_year",
        )
        .eq("id", body.startup_id)
        .maybeSingle();

      if (startupErr || !startup) {
        return Response.json({ error: "Company not found." }, { status: 404, headers: corsHeaders });
      }

      const [{ data: scoreData }, { data: matchRows }] = await Promise.all([
        supa.rpc("calculate_alphamap_score", { p_startup_id: body.startup_id }),
        supa.rpc("match_scores_for_startups", { p_startup_ids: [body.startup_id] }),
      ]);
      const match = Array.isArray(matchRows) ? matchRows[0] : null;

      // Configurable so this never has to guess the deployed domain --
      // omitted entirely if the project hasn't set it.
      const siteUrl = Deno.env.get("SITE_URL");

      payload = {
        event: "tearsheet.synced",
        timestamp: new Date().toISOString(),
        company: {
          id: startup.id,
          name: startup.name,
          website: startup.website,
          sector: startup.sector_parent,
          sub_sectors: startup.sub_sector_names,
          stage: startup.latest_round_type,
          location: [startup.city, startup.country].filter(Boolean).join(", ") || null,
          latest_valuation: startup.latest_valuation,
          total_raised: startup.total_raised,
          employee_count: startup.employee_count,
          founded_year: startup.founded_year,
        },
        scores: {
          alphamap_score: scoreData?.score ?? null,
          alphamap_tier: scoreData?.tier ?? null,
          match_pct: match?.match_pct ?? null,
        },
        alphamap_url: siteUrl ? `${siteUrl}/startups?company=${startup.id}` : null,
      };
    }

    const payloadStr = JSON.stringify(payload);
    const signature = await hmacSha256Hex(webhook.secret, payloadStr);

    const deliveryRes = await fetch(webhook.target_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AlphaMap-Event": String(payload.event),
        "X-AlphaMap-Signature": `sha256=${signature}`,
      },
      body: payloadStr,
    });

    if (!deliveryRes.ok) {
      const detail = await deliveryRes.text().catch(() => "");
      console.error(`[crm-webhook-sync] Receiving endpoint returned ${deliveryRes.status}:`, detail.slice(0, 500));
      return Response.json(
        { error: `Your CRM endpoint responded with ${deliveryRes.status}.` },
        { status: 502, headers: corsHeaders },
      );
    }

    return Response.json({ success: true }, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[crm-webhook-sync] Error:", message);
    return Response.json({ error: "Something went wrong while syncing to your CRM." }, { status: 500, headers: corsHeaders });
  }
});
