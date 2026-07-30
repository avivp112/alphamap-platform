// Delivers Contact Us submissions by email via Resend's HTTP API (no SDK
// needed — a plain fetch call, matching how every other function in this
// project calls out to a third-party API). Requires a RESEND_API_KEY secret:
//   supabase secrets set RESEND_API_KEY="re_..."
// Without it configured, this returns a 500 with a clear setup message rather
// than silently swallowing submissions.
//
// CONTACT_TO_EMAIL lets the destination be overridden via a secret without a
// redeploy; it defaults to the address inquiries should land in today.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_TO_EMAIL = "avivp112@gmail.com";
// resend.dev is Resend's shared sending domain — works with no DNS setup,
// but mail sent from it is more likely to land in spam than a verified
// domain would. Swap CONTACT_FROM_EMAIL once a domain is verified in Resend.
const DEFAULT_FROM_EMAIL = "AlphaMap Contact Form <onboarding@resend.dev>";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOPICS = new Set(["general", "partnership", "press", "support", "enterprise"]);
const MAX_LEN = { name: 200, email: 320, message: 5000 };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim();
    const topic = String(body.topic ?? "").trim();
    const message = String(body.message ?? "").trim();

    if (!name || name.length > MAX_LEN.name) {
      return Response.json({ error: "A valid name is required" }, { status: 400, headers: corsHeaders });
    }
    if (!email || email.length > MAX_LEN.email || !EMAIL_RE.test(email)) {
      return Response.json({ error: "A valid email is required" }, { status: 400, headers: corsHeaders });
    }
    if (!TOPICS.has(topic)) {
      return Response.json({ error: `topic must be one of: ${[...TOPICS].join(", ")}` }, { status: 400, headers: corsHeaders });
    }
    if (!message || message.length > MAX_LEN.message) {
      return Response.json({ error: "A message is required" }, { status: 400, headers: corsHeaders });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("[send-contact-message] RESEND_API_KEY is not configured");
      return Response.json(
        { error: "Email delivery isn't configured yet. Set the RESEND_API_KEY secret on this Supabase project." },
        { status: 500, headers: corsHeaders },
      );
    }

    const toEmail = Deno.env.get("CONTACT_TO_EMAIL") || DEFAULT_TO_EMAIL;
    const fromEmail = Deno.env.get("CONTACT_FROM_EMAIL") || DEFAULT_FROM_EMAIL;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        reply_to: email,
        subject: `[AlphaMap contact] ${topic} — ${name}`,
        html: `
          <p><strong>Topic:</strong> ${escapeHtml(topic)}</p>
          <p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p>
          <p><strong>Message:</strong></p>
          <p>${escapeHtml(message).replace(/\n/g, "<br/>")}</p>
        `,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error(`[send-contact-message] Resend API error (${res.status}):`, detail);
      return Response.json({ error: "Failed to send message. Please try again shortly." }, { status: 502, headers: corsHeaders });
    }

    return Response.json({ success: true }, { headers: corsHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[send-contact-message] Error:", message);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500, headers: corsHeaders });
  }
});
