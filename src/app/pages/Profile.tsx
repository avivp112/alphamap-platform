import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Mail, Calendar, ShieldCheck, Sparkles, Bell, BellOff, KeyRound, ArrowRight,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { supabase } from "../../lib/supabase";
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
    <div className="rounded-[14px] p-4 flex flex-col gap-2 border bg-gray-50 border-gray-100">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 flex-none text-[#0F172A]/50" />
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
      </div>
      <span className="text-sm font-bold text-gray-900 truncate">{value}</span>
    </div>
  );
}

export function Profile() {
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
      });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <Layout>
      <div className="mx-auto max-w-[880px] px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* ── Hero header — rhino watermark, subtle ── */}
        <div className="relative overflow-hidden rounded-[24px] bg-[#0F172A] px-7 sm:px-9 py-9 sm:py-11">
          <img
            aria-hidden
            src="/media/rhino-still.png"
            alt=""
            className="pointer-events-none absolute -bottom-8 -right-6 w-[360px] max-w-none opacity-[0.16] rotate-[3deg]"
          />
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
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#B8C9D1]">My Profile</p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-white truncate">
                {loading ? "Loading…" : user?.name || "Your account"}
              </h1>
              <p className="mt-1 text-sm text-white/60 truncate">{user?.email ?? ""}</p>
            </div>
          </div>
        </div>

        {/* ── Personal details ── */}
        <div className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Personal Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DetailRow icon={Mail} label="Email" value={user?.email ?? "—"} />
            <DetailRow
              icon={KeyRound}
              label="Sign-in Method"
              value={user?.provider ? (PROVIDER_LABEL[user.provider] ?? user.provider) : "—"}
            />
            <DetailRow icon={Calendar} label="Member Since" value={fmtDate(user?.createdAt ?? null)} />
            <DetailRow
              icon={user?.marketingOptIn ? Bell : BellOff}
              label="Marketing Updates"
              value={user?.marketingOptIn ? "Subscribed" : "Not subscribed"}
            />
          </div>
        </div>

        {/* ── Plan & agreements ── */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="rounded-[20px] border border-gray-100 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-[#7C8967]" />
              <h3 className="text-sm font-bold text-[#0F172A]">Current Plan</h3>
            </div>
            <p className="text-2xl font-bold text-[#0F172A] mt-2">{PLAN_LABEL[plan]}</p>
            <Link
              to="/pricing"
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-[#0F172A] hover:underline"
            >
              View plans <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="rounded-[20px] border border-gray-100 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-[#7C8967]" />
              <h3 className="text-sm font-bold text-[#0F172A]">Terms of Use</h3>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed mt-2">
              {user?.termsAcceptedAt
                ? `Accepted on ${fmtDate(user.termsAcceptedAt)}.`
                : "Acceptance on file from registration."}
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
