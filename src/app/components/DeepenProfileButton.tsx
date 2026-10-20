import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { Sparkles, Loader2 } from "lucide-react";
import { deepenStatus, deepenProfile } from "../../lib/supabase";
import type { DeepenStatus } from "../../lib/companyCheck";

// ─────────────────────────────────────────────────────────────────────────────
// "Deepen this profile": runs AlphaMap's research (enrichment v2) on a company
// already in AlphaMap. Whether it may, and whether it is free, is decided by
// the company-check function (thresholds in _shared/check-limits.ts); the
// button stays hidden when the profile was updated recently.
// ─────────────────────────────────────────────────────────────────────────────

export function DeepenProfileButton({ startupId, variant = "button" }: { startupId: string; variant?: "button" | "chip" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<DeepenStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    deepenStatus(startupId).then((s) => { if (!cancelled) setStatus(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [startupId]);

  if (!status) return null;
  if (status.pending_check_id) {
    return (
      <Link to={`/checks/${status.pending_check_id}`}
        className={variant === "chip"
          ? "flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full whitespace-nowrap bg-white/70 text-cyan-700 hover:bg-white"
          : "inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-700 hover:underline"}
        style={variant === "chip" ? { border: "1px solid rgba(15,23,42,0.12)" } : undefined}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" />{t("companyCheck.deepen.inProgress")}
      </Link>
    );
  }
  if (!status.eligible) return null;

  const hint = status.free ? t("companyCheck.deepen.free") : t("companyCheck.deepen.usesCheck");
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await deepenProfile(startupId);
      navigate(`/checks/${encodeURIComponent(res.check_id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (variant === "chip") {
    return (
      <span className="inline-flex flex-col">
        <button onClick={run} disabled={busy} title={`${t("companyCheck.deepen.blurb")} ${hint}`}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full whitespace-nowrap bg-white/70 hover:bg-white text-[#0F172A]/60 hover:text-cyan-700 transition-colors disabled:opacity-50"
          style={{ border: "1px solid rgba(15,23,42,0.12)" }}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {t("companyCheck.deepen.button")}
        </button>
        {error && <span className="mt-1 max-w-[220px] text-[11px] text-rose-600">{error}</span>}
      </span>
    );
  }
  return (
    <div className="rounded-lg border border-cyan-100 bg-cyan-50/60 px-4 py-3">
      <p className="text-sm text-[#0F172A]">{t("companyCheck.deepen.blurb")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button onClick={run} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F172A] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1e293b] disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{t("companyCheck.deepen.button")}
        </button>
        <span className="text-xs text-gray-500">{hint}</span>
      </div>
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </div>
  );
}
