import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  Mail, Calendar, ShieldCheck, Sparkles, Bell, BellOff, KeyRound, ArrowRight, Globe,
  Webhook, Eye, EyeOff, Copy, RefreshCw, Send, Check, AlertCircle, Loader2,
} from "lucide-react";
import { Layout } from "../components/Layout";
import {
  supabase, fetchUserWebhook, upsertUserWebhook, generateWebhookSecret, sendCrmTestEvent,
  type UserWebhook,
} from "../../lib/supabase";
import { useUserPlan, PLAN_LABEL } from "../../lib/plan";

// ─────────────────────────────────────────────────────────────────────────────
// Profile — read-only view of the signed-in user's own registration details.
// Reached from the TopNav account dropdown. Everything shown here comes
// straight from the Supabase auth user record (no separate profiles table
// exists yet) — full name, email, sign-in method, and the two consent flags
// captured at sign-up (marketing opt-in + terms acceptance).
// ─────────────────────────────────────────────────────────────────────────────

interface ProfileUser {
  name: string | null;
  email: string | null;
  createdAt: string | null;
  provider: string | null;
  marketingOptIn: boolean;
  termsAcceptedAt: string | null;
  country: string | null;
}

function getInitials({ name, email }: { name: string | null; email: string | null }): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return parts.length === 1
      ? parts[0].slice(0, 2).toUpperCase()
      : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const PROVIDER_LABEL: Record<string, string> = {
  email: "Email & password",
  google: "Google",
  linkedin_oidc: "LinkedIn",
};

function DetailRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-[8px] p-4 flex flex-col gap-2 border bg-gray-50 border-gray-100">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 flex-none text-[#0F172A]/50" />
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
      </div>
      <span className="text-sm font-bold text-gray-900 truncate">{value}</span>
    </div>
  );
}

// Phase 9: CRM Webhook Engine settings. user_webhooks is "one target per
// user" (see the UNIQUE(user_id) constraint added in
// 20260929000000_user_webhooks_unique_per_user.sql), so this form always
// edits a single row, created on first Save rather than requiring a
// separate "add" step.
const URL_RE = /^https:\/\/.+/;

function IntegrationsCard() {
  const [webhook, setWebhook]     = useState<UserWebhook | null>(null);
  const [loading, setLoading]     = useState(true);
  const [targetUrl, setTargetUrl] = useState("");
  const [secret, setSecret]       = useState("");
  const [enabled, setEnabled]     = useState(true);
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [copied, setCopied]       = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved]         = useState(false);
  const [testState, setTestState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchUserWebhook()
      .then((w) => {
        if (cancelled) return;
        setWebhook(w);
        setTargetUrl(w?.target_url ?? "");
        setSecret(w?.secret ?? generateWebhookSecret());
        setEnabled(w?.enabled ?? true);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const dirty = !webhook
    || targetUrl !== webhook.target_url
    || secret !== webhook.secret
    || enabled !== webhook.enabled;
  const urlValid = URL_RE.test(targetUrl.trim());

  async function handleSave() {
    if (!urlValid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await upsertUserWebhook({ target_url: targetUrl.trim(), secret, enabled });
      const fresh = await fetchUserWebhook();
      setWebhook(fresh);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save webhook settings.");
    } finally {
      setSaving(false);
    }
  }

  function handleRegenerate() {
    setSecret(generateWebhookSecret());
    setSecretRevealed(true);
  }

  function handleCopy() {
    navigator.clipboard?.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  async function handleSendTest() {
    setTestState("sending");
    setTestMessage("");
    const result = await sendCrmTestEvent();
    if (result.ok) {
      setTestState("success");
      setTestMessage("Test event delivered successfully.");
    } else {
      setTestState("error");
      setTestMessage(result.error ?? "Test event failed.");
    }
  }

  return (
    <div className="rounded-[10px] border border-gray-100 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 mb-1">
        <Webhook className="w-4 h-4 text-[#7C8967]" />
        <h3 className="text-sm font-bold text-[#0F172A]">Integrations</h3>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed mt-1 mb-5">
        Sync a company's tear sheet straight to your CRM (Zapier, Make, or any HTTPS endpoint) with one click from its tearsheet.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 block">
              Webhook URL
            </label>
            <input
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://hooks.zapier.com/hooks/catch/..."
              className="w-full text-sm px-3 py-2 rounded-[8px] border border-gray-200 focus:border-[#0F172A]/30 focus:outline-none placeholder:text-gray-300"
            />
            {targetUrl.trim().length > 0 && !urlValid && (
              <p className="text-[10px] text-rose-600 mt-1">Must be a valid https:// URL.</p>
            )}
          </div>

          <div>
            <label className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1.5 block">
              Signing Secret
            </label>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-[8px] border border-gray-200 bg-gray-50 min-w-0">
                <span className="text-xs font-mono text-gray-700 truncate flex-1">
                  {secretRevealed ? secret : "•".repeat(24)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSecretRevealed((v) => !v)}
                title={secretRevealed ? "Hide" : "Reveal"}
                className="w-8 h-8 flex-none rounded-[8px] border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
              >
                {secretRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                title="Copy"
                className="w-8 h-8 flex-none rounded-[8px] border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={handleRegenerate}
                title="Regenerate"
                className="w-8 h-8 flex-none rounded-[8px] border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
              Every synced payload is signed with this secret via HMAC-SHA256, sent as{" "}
              <code className="text-[9px] bg-gray-100 px-1 py-0.5 rounded">X-AlphaMap-Signature: sha256=...</code>.
              Verify it on your end: <code className="text-[9px] bg-gray-100 px-1 py-0.5 rounded">hmac_sha256(secret, raw_body)</code> should
              equal the hex after <code className="text-[9px] bg-gray-100 px-1 py-0.5 rounded">sha256=</code>. Regenerating requires
              saving to take effect, and updating this value on your receiving end too.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-[8px] border border-gray-100 bg-gray-50 px-3.5 py-3">
            <div>
              <p className="text-xs font-bold text-gray-900">Enabled</p>
              <p className="text-[10px] text-gray-400">Turn off to pause syncing without losing your settings.</p>
            </div>
            <button
              type="button"
              onClick={() => setEnabled((v) => !v)}
              className="relative w-10 h-[22px] rounded-full transition-colors flex-none"
              style={{ background: enabled ? "#059669" : "#D1D5DB" }}
              aria-pressed={enabled}
            >
              <span
                className="absolute top-[3px] w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
                style={{ transform: enabled ? "translateX(19px)" : "translateX(3px)" }}
              />
            </button>
          </div>

          {saveError && (
            <div className="flex items-center gap-1.5 text-xs text-rose-600">
              <AlertCircle className="w-3.5 h-3.5 flex-none" /> {saveError}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={!urlValid || saving || !dirty}
              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-full bg-[#0F172A] text-white hover:bg-[#0F172A]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : null}
              {saved ? "Saved" : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={handleSendTest}
              disabled={dirty || !webhook?.enabled || testState === "sending"}
              title={dirty ? "Save your changes first" : undefined}
              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testState === "sending" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send Test Event
            </button>
          </div>

          {testState !== "idle" && testState !== "sending" && (
            <div className={`flex items-center gap-1.5 text-xs ${testState === "success" ? "text-emerald-600" : "text-rose-600"}`}>
              {testState === "success" ? <Check className="w-3.5 h-3.5 flex-none" /> : <AlertCircle className="w-3.5 h-3.5 flex-none" />}
              {testMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Profile() {
  const { t } = useTranslation();
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const { plan } = useUserPlan();

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data.user) { setUser(null); setLoading(false); return; }
      const u = data.user;
      setUser({
        name: (u.user_metadata?.full_name as string | undefined)?.trim() || null,
        email: u.email ?? null,
        createdAt: u.created_at ?? null,
        provider: u.app_metadata?.provider ?? null,
        marketingOptIn: Boolean(u.user_metadata?.marketing_opt_in),
        termsAcceptedAt: (u.user_metadata?.terms_accepted_at as string | undefined) ?? null,
        country: (u.user_metadata?.country as string | undefined) ?? null,
      });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <Layout>
      <div className="mx-auto max-w-[880px] px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* ── Hero header — plain dark navy, no watermark ── */}
        <div className="relative overflow-hidden rounded-[10px] bg-[#0F172A] px-7 sm:px-9 py-9 sm:py-11">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(70% 90% at 0% 0%, rgba(184,201,209,0.16) 0%, rgba(184,201,209,0) 60%)" }}
          />
          <div className="relative flex items-center gap-5">
            <div className="flex h-16 w-16 flex-none items-center justify-center rounded-full bg-white/10 border border-white/15">
              {loading ? (
                <div className="h-5 w-5 rounded-full bg-white/20 animate-pulse" />
              ) : (
                <span className="text-lg font-bold text-white">{getInitials(user ?? { name: null, email: null })}</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#B8C9D1]">{t("profile.title")}</p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-white truncate">
                {loading ? "Loading…" : user?.name || "Your account"}
              </h1>
              <p className="mt-1 text-sm text-white/60 truncate">{user?.email ?? ""}</p>
            </div>
          </div>
        </div>

        {/* ── Personal details ── */}
        <div className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">{t("profile.personalDetails")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DetailRow icon={Mail} label="Email" value={user?.email ?? "—"} />
            <DetailRow
              icon={KeyRound}
              label="Sign-in Method"
              value={user?.provider ? (PROVIDER_LABEL[user.provider] ?? user.provider) : "—"}
            />
            <DetailRow icon={Calendar} label="Member Since" value={fmtDate(user?.createdAt ?? null)} />
            <DetailRow icon={Globe} label="Country" value={user?.country ?? "—"} />
            <DetailRow
              icon={user?.marketingOptIn ? Bell : BellOff}
              label="Marketing Updates"
              value={user?.marketingOptIn ? "Subscribed" : "Not subscribed"}
            />
          </div>
        </div>

        {/* ── Plan & agreements ── */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="rounded-[10px] border border-gray-100 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-[#7C8967]" />
              <h3 className="text-sm font-bold text-[#0F172A]">{t("profile.currentPlan")}</h3>
            </div>
            <p className="text-2xl font-bold text-[#0F172A] mt-2">{PLAN_LABEL[plan]}</p>
            <Link
              to="/pricing"
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-[#0F172A] hover:underline"
            >{t("profile.viewPlans")}<ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="rounded-[10px] border border-gray-100 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-[#7C8967]" />
              <h3 className="text-sm font-bold text-[#0F172A]">{t("profile.termsOfUse")}</h3>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed mt-2">
              {user?.termsAcceptedAt
                ? `Accepted on ${fmtDate(user.termsAcceptedAt)}.`
                : "Acceptance on file from registration."}
            </p>
          </div>
        </div>

        {/* ── Integrations (Phase 9: CRM Webhook Engine) ── */}
        <div className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Integrations</h2>
          <IntegrationsCard />
        </div>
      </div>
    </Layout>
  );
}
