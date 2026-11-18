import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Bell, CheckCheck } from "lucide-react";
import {
  fetchAlertsFilter, fetchNotifications, markAllNotificationsRead, markNotificationRead, setAlertsFiltered, type Notification,
} from "../../../lib/supabase";
import { alertKind, groupByDay, mergeTimeline, relativeTime, type AlertKind } from "../../../lib/alpha";
import { watchlistErrorMessage } from "../../../lib/watchlist";
import { EmptyState, ErrorLine, Pulse, Spinner } from "./AlphaBits";
import type { AlphaData } from "./useAlphaData";
import { useAlphaT } from "./useAlphaT";

const KIND_LABEL: Record<AlertKind, string> = { filing: "Filing", trending: "Trending", match: "Match", new: "New company", other: "Update" };
const KIND_TONE: Record<AlertKind, "accent" | "pos" | "warn"> = { filing: "accent", trending: "warn", match: "pos", new: "warn", other: "accent" };

function FilterSwitch() {
  const { t } = useTranslation();
  const [state, setState] = useState<{ hasMandate: boolean; filtered: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchAlertsFilter().then(setState).catch(() => setState(null)); }, []);
  if (!state) return null;
  async function toggle() {
    if (!state || saving) return;
    const next = !state.filtered;
    setSaving(true); setError(null); setState({ ...state, filtered: next });
    try { await setAlertsFiltered(next); } catch (e) { setState({ ...state, filtered: !next }); setError(watchlistErrorMessage(e)); } finally { setSaving(false); }
  }
  return (
    <div className="bg-am-surface border border-am-line rounded-am-card shadow-am-1 px-5 py-4 flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-am-title font-semibold text-am-ink">{t("myArea.alerts.filterTitle")}</p>
        <p className="mt-0.5 text-am-body text-am-ink-3">{state.filtered ? t("myArea.alerts.filterOn") : t("myArea.alerts.filterOff")}</p>
        {!state.hasMandate && (
          <p className="mt-1.5 text-am-body text-am-ink-3">{t("myArea.alerts.filterNeedsMandate")}{" "}
            <Link to={`/onboarding?next=${encodeURIComponent("/my-area?tab=alerts")}`} className="font-medium text-am-accent hover:underline">{t("myArea.alerts.filterCompleteMandate")}</Link></p>
        )}
        {error && <p role="alert" className="mt-1.5 text-am-body text-am-neg">{error}</p>}
      </div>
      <button type="button" role="switch" aria-checked={state.filtered} aria-label={t("myArea.alerts.filterTitle")} disabled={!state.hasMandate || saving} onClick={toggle}
        className={`relative mt-0.5 h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40 ${state.filtered ? "bg-am-ink" : "bg-am-line"}`}>
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${state.filtered ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

export function AlertsTab({ data }: { data: AlphaData }) {
  const tt = useAlphaT();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetchNotifications(80).then((r) => { setItems(r); setError(null); }).catch((e) => { setItems([]); setError(watchlistErrorMessage(e)); });
  useEffect(() => { void load(); }, []);

  const unread = (items ?? []).filter((n) => !n.read_at).length;
  const groups = useMemo(() => groupByDay(mergeTimeline((items ?? []).map((n) => ({ id: n.id, at: n.created_at, kind: "alert" as const, data: n }))), new Date()), [items]);

  async function open(n: Notification) {
    if (!n.read_at) {
      setItems((all) => (all ?? []).map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      data.setUnread((u) => Math.max(0, u - 1));
      markNotificationRead(n.id).catch(() => void load());
    }
    if (n.link) navigate(n.link);
  }
  async function markAll() {
    const now = new Date().toISOString();
    setItems((all) => (all ?? []).map((x) => ({ ...x, read_at: x.read_at ?? now })));
    data.setUnread(0);
    markAllNotificationsRead().catch(() => void load());
  }

  const dayLabel = (g: (typeof groups)[number]): string =>
    g.label.kind === "today" ? tt("today", "Today") : g.label.kind === "yesterday" ? tt("yesterday", "Yesterday")
      : new Date(`${g.label.iso}T00:00:00Z`).toLocaleDateString(lang, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div className="max-w-3xl space-y-5">
      <FilterSwitch />
      <div className="flex items-center gap-3">
        <p className="flex-1 text-am-body text-am-ink-3">{t("myArea.alerts.blurb")}</p>
        {unread > 0 && (
          <button type="button" onClick={markAll} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-am-ctl border border-am-line bg-am-surface text-am-body font-medium text-am-ink hover:bg-am-canvas">
            <CheckCheck className="w-4 h-4" aria-hidden="true" />{t("myArea.alerts.markAllRead")}
          </button>
        )}
      </div>
      {error && <ErrorLine message={error} />}
      {items === null ? <Spinner label={tt("loading", "Loading")} /> : items.length === 0 && !error ? (
        <EmptyState icon={<Bell className="w-8 h-8" />} title={t("myArea.alerts.emptyTitle")} body={t("myArea.alerts.emptyBlurb")} />
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-label={dayLabel(g)}>
            <h2 className="mb-2 text-am-caption font-medium text-am-ink-3">{dayLabel(g)}</h2>
            <ul className="bg-am-surface border border-am-line rounded-am-card shadow-am-1 overflow-hidden divide-y divide-am-line-soft">
              {g.entries.map((e) => {
                const n = e.data as Notification;
                const kind = alertKind(n.type);
                return (
                  <li key={n.id}>
                    <button type="button" onClick={() => open(n)} className={`w-full text-start px-5 py-3.5 flex items-start gap-3.5 hover:bg-am-canvas focus:outline-none focus-visible:bg-am-canvas ${n.read_at ? "" : "bg-am-accent-soft/40"}`}>
                      <span className="mt-1.5 w-2 flex-none">{!n.read_at && <Pulse tone={KIND_TONE[kind]} />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-am-caption text-am-ink-3 mb-0.5">
                          <span className="font-semibold">{tt(`kind_${kind}`, KIND_LABEL[kind])}</span><span>·</span><span>{relativeTime(n.created_at, lang)}</span>
                        </span>
                        <span className="block text-am-body font-semibold text-am-ink">{n.title}</span>
                        <span className="block text-am-body text-am-ink-2">{n.body}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
