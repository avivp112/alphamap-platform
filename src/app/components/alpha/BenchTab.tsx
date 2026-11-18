import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Plus, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { CompanyLogo } from "../CompanyLogo";
import {
  fetchNotifications, fetchPreferenceSignalCount, fetchUserMandate, type Notification, type UserMandate,
} from "../../../lib/supabase";
import {
  BENCH_SEATS, alertKind, daysAgo, monthYear, notePlainText, refKey, relativeTime, thesisParts, type AlphaRef,
} from "../../../lib/alpha";
import { addToBench, fetchBench, removeFromBench, setBenchConviction, type AlphaEntity } from "../../../lib/alphaData";
import { watchlistErrorMessage } from "../../../lib/watchlist";
import { ConvictionDots, ErrorLine, Pulse, StageChip } from "./AlphaBits";
import type { AlphaData } from "./useAlphaData";
import { useAlphaT } from "./useAlphaT";

const NEW_ROUND_DAYS = 45;
const CALIBRATED_AT = 3; // top_thesis_matches withholds matches below this many signals

function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The newest thing the user wrote about a company: a Journal note, else an older single-text note. */
function lastNote(data: AlphaData, e: AlphaEntity): string | null {
  const k = refKey(e.ref);
  const note = data.notes.find((n) => n.links.some((l) => refKey(l) === k));
  if (note) return excerpt(notePlainText(note.body));
  if (e.ref.type === "crm") return e.crm?.notes ? excerpt(e.crm.notes) : null;
  const w = e.ref.type === "startup"
    ? data.watchlist.startups.find((s) => s.id === e.ref.id)?.watchlistNotes
    : data.watchlist.investors.find((i) => i.id === e.ref.id)?.watchlistNotes;
  return w ? excerpt(w) : null;
}

export function BenchTab({ data, onTab }: { data: AlphaData; onTab: (tab: string) => void }) {
  const tt = useAlphaT();
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const [mandate, setMandate] = useState<UserMandate | null>(null);
  const [signals, setSignals] = useState<number | null>(null);
  const [recent, setRecent] = useState<Notification[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    fetchUserMandate().then(setMandate).catch(() => setMandate(null));
    fetchPreferenceSignalCount().then(setSignals).catch(() => setSignals(null));
    fetchNotifications(5).then(setRecent).catch(() => setRecent([]));
  }, []);

  const full = data.bench.length >= BENCH_SEATS;
  const onBench = useMemo(() => new Set(data.bench.map((b) => refKey(b.ref))), [data.bench]);
  const crmByStartup = useMemo(() => new Map(data.crm.filter((c) => c.startup_id).map((c) => [c.startup_id as string, c])), [data.crm]);

  /** Everyone the user already tracks and has not seated. */
  const candidates = useMemo(() => {
    const list: AlphaEntity[] = [];
    for (const e of data.entities.values()) {
      if (onBench.has(refKey(e.ref))) continue;
      if (e.ref.type === "crm" && data.crm.find((c) => c.id === e.ref.id)?.startup_id) continue; // listed once, by its AlphaMap company
      list.push(e);
    }
    return list.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }, [data.entities, data.crm, onBench]);

  const radar = useMemo(() => {
    const wl = new Set<string>([...data.watchlist.startups.map((s) => `startup:${s.id}`), ...data.watchlist.investors.map((i) => `investor:${i.id}`)]);
    return candidates.filter((e) => wl.has(refKey(e.ref))).slice(0, 20);
  }, [candidates, data.watchlist]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setProblem(null);
    try { await fn(); } catch (e) { setProblem(watchlistErrorMessage(e)); }
    finally { setBusy(false); }
  }
  const seat = (ref: AlphaRef) => run(async () => { await addToBench(ref); data.setBench(await fetchBench()); });
  const unseat = (id: string) => run(async () => { await removeFromBench(id); data.setBench((b) => b.filter((x) => x.id !== id)); });
  function rate(id: string, v: number | null) {
    const before = data.bench;
    data.setBench((b) => b.map((x) => (x.id === id ? { ...x, conviction: v } : x)));
    setBenchConviction(id, v).catch((e) => { data.setBench(before); setProblem(watchlistErrorMessage(e)); });
  }

  const parts = thesisParts(mandate);
  const calibrated = signals != null && signals >= CALIBRATED_AT;

  if (data.benchError) {
    return <ErrorLine message={tt("benchUnavailable", "The bench could not be loaded: {{error}}", { error: data.benchError })} />;
  }

  return (
    <div className="space-y-6">
      {/* The thesis */}
      <section className="bg-am-surface border border-am-line rounded-am-card shadow-am-1 px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-3" aria-label={tt("thesis", "What I look for")}>
        <div className="flex-1 min-w-[260px]">
          <p className="text-am-caption text-am-ink-3">{tt("thesis", "What I look for")}</p>
          {parts ? (
            <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1.5">
              {([["stage", "Stage", parts.stages], ["sector", "Sector", parts.sectors], ["region", "Region", parts.geographies]] as const)
                .filter(([, , xs]) => xs.length > 0)
                .map(([k, label, xs]) => (
                  <div key={k} className="flex items-baseline gap-2 min-w-0">
                    <dt className="text-am-caption text-am-ink-3">{tt(k, label)}</dt>
                    <dd className="text-am-title font-semibold text-am-ink truncate">{xs.slice(0, 3).join(" · ")}{xs.length > 3 ? ` +${xs.length - 3}` : ""}</dd>
                  </div>
                ))}
            </dl>
          ) : (
            <p className="mt-1 text-am-body text-am-ink-2">{tt("thesisEmpty", "Tell AlphaMap what you look for and matches start to appear.")}</p>
          )}
        </div>
        <div className="text-am-body text-am-ink-2">
          {signals == null ? null : calibrated
            ? tt("calibrated", "{{count}} signals · matches sharpen with every decision", { count: signals })
            : tt("calibrating", "Calibrating · {{count}} of {{need}} signals", { count: signals, need: CALIBRATED_AT })}
        </div>
        <Link to="/onboarding" className="h-9 inline-flex items-center px-3.5 rounded-am-ctl border border-am-line bg-am-surface text-am-body font-medium text-am-ink hover:bg-am-canvas">
          {parts ? tt("editThesis", "Edit thesis") : tt("setThesis", "Set thesis")}
        </Link>
      </section>

      {/* The bench */}
      <section aria-label={tt("bench", "The Bench")}>
        <div className="flex items-baseline gap-3 mb-2.5">
          <h2 className="text-am-title font-semibold text-am-ink">{tt("bench", "The Bench")} <span className="text-am-ink-3 font-medium tabular-nums">{data.bench.length} / {BENCH_SEATS}</span></h2>
          <p className="text-am-caption text-am-ink-3">{tt("benchHint", "The companies you would actually act on.")}</p>
        </div>
        {problem && <div className="mb-3"><ErrorLine message={problem} /></div>}
        <div className="grid gap-3.5 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">
          {data.bench.map((row) => {
            const e = data.entities.get(refKey(row.ref));
            if (!e) {
              return (
                <div key={row.id} className="bg-am-surface border border-am-line rounded-am-card p-4 flex items-center justify-between text-am-body text-am-ink-3">
                  <span>{tt("gone", "This record is no longer available")}</span>
                  <button type="button" disabled={busy} onClick={() => unseat(row.id)} aria-label={tt("removeFromBench", "Remove from the bench")} className="p-1 rounded hover:bg-am-canvas"><X className="w-4 h-4" aria-hidden="true" /></button>
                </div>
              );
            }
            const crm = e.crm ?? (e.ref.type === "startup" ? crmByStartup.get(e.ref.id) : undefined);
            const crmStage = crm ? ("stage" in crm ? crm.stage : null) : null;
            const nextStep = crm?.next_step ?? null;
            const nextDate = crm?.next_step_date ?? null;
            const overdue = !!nextDate && nextDate < new Date().toISOString().slice(0, 10);
            const roundAge = daysAgo(e.lastRound?.date);
            const fresh = roundAge != null && roundAge <= NEW_ROUND_DAYS;
            const note = lastNote(data, e);
            return (
              <article key={row.id} className={`bg-am-surface rounded-am-card p-4 flex flex-col gap-3 shadow-am-1 border ${fresh ? "border-am-accent shadow-[0_0_0_3px_var(--am-accent-soft)]" : "border-am-line"}`}>
                <div className="flex items-start gap-3">
                  <CompanyLogo name={e.name} website={e.website} size={36} rounded="rounded-[10px]" />
                  <div className="min-w-0 flex-1">
                    <Link to={e.href} className="block text-am-title font-semibold text-am-ink truncate hover:text-am-accent">{e.name}</Link>
                    <p className="text-am-caption text-am-ink-3 truncate">{e.subtitle ?? "—"}</p>
                  </div>
                  {fresh && <Pulse />}
                  <button type="button" disabled={busy} onClick={() => unseat(row.id)} aria-label={tt("removeFromBench", "Remove from the bench")}
                    className="-mt-1 -mr-1 p-1.5 rounded-full text-am-ink-3 hover:bg-am-canvas hover:text-am-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40"><X className="w-4 h-4" aria-hidden="true" /></button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-am-caption text-am-ink-3">{tt("conviction", "Conviction")}</span>
                  <ConvictionDots value={row.conviction} onChange={(v) => rate(row.id, v)} label={tt("conviction", "Conviction")} />
                  <span className="flex-1" />
                  {crmStage && <StageChip stage={crmStage} label={tt(`stage_${crmStage}`, crmStage.replace("_", " "))} />}
                </div>
                <p className={`text-am-body leading-relaxed border-s-2 border-am-line ps-3 ${note ? "text-am-ink-2" : "text-am-ink-3"}`}>
                  {note ? `“${note}”` : tt("noNote", "No note yet")}
                </p>
                <div className="mt-auto space-y-1 text-am-caption">
                  {fresh && e.lastRound && <p className="font-semibold text-am-accent">{tt("newRound", "New round")}{e.lastRound.type ? ` · ${e.lastRound.type}` : ""} · {monthYear(e.lastRound.date, lang)}</p>}
                  {nextStep && <p className={overdue ? "font-semibold text-am-neg" : "text-am-ink-3"}>{overdue ? tt("overdue", "Overdue") : tt("next", "Next")} · {nextStep}{nextDate ? ` · ${nextDate}` : ""}</p>}
                  {!fresh && !nextStep && e.updatedAt && <p className="text-am-ink-3">{tt("updated", "Record updated {{when}}", { when: relativeTime(e.updatedAt, lang) })}</p>}
                </div>
              </article>
            );
          })}

          {Array.from({ length: BENCH_SEATS - data.bench.length }, (_, i) => (
            <SeatPicker key={`free-${i}`} first={i === 0} candidates={candidates} busy={busy} onPick={seat}
              onBrowse={() => onTab("watchlist")} />
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-5 items-start">
        {/* Radar */}
        <section className="flex-[999_1_520px] min-w-0 bg-am-surface border border-am-line rounded-am-card shadow-am-1" aria-label={tt("radar", "On the radar")}>
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-am-line">
            <h2 className="text-am-title font-semibold text-am-ink flex-1">{tt("radar", "On the radar")}</h2>
            <button type="button" onClick={() => onTab("watchlist")} className="text-am-body font-medium text-am-accent hover:underline">{tt("openWatchlist", "Open Watchlist")}</button>
          </div>
          {radar.length === 0 ? (
            <p className="px-5 py-8 text-am-body text-am-ink-3">{tt("radarEmpty", "Companies you follow appear here, newest activity first.")}</p>
          ) : (
            <ul>
              {radar.map((e) => (
                <li key={refKey(e.ref)} className="flex items-center gap-3 px-5 py-2.5 border-t border-am-line-soft first:border-t-0">
                  <CompanyLogo name={e.name} website={e.website} size={28} rounded="rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <Link to={e.href} className="block text-am-body font-semibold text-am-ink truncate hover:text-am-accent">{e.name}</Link>
                    <p className="text-am-caption text-am-ink-3 truncate">{e.subtitle ?? "—"}</p>
                  </div>
                  <span className="hidden sm:block text-am-caption text-am-ink-3 whitespace-nowrap">{e.updatedAt ? relativeTime(e.updatedAt, lang) : ""}</span>
                  <button type="button" disabled={busy || full} onClick={() => seat(e.ref)} title={full ? tt("benchFull", "The bench is full") : undefined}
                    className="h-8 px-3 rounded-am-ctl border border-am-line bg-am-surface text-am-body font-medium text-am-ink hover:bg-am-canvas disabled:opacity-50 disabled:cursor-not-allowed">
                    {tt("promote", "Promote")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent */}
        <section className="flex-[1_1_320px] min-w-0 bg-am-surface border border-am-line rounded-am-card shadow-am-1" aria-label={tt("recent", "Lately")}>
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-am-line">
            <h2 className="text-am-title font-semibold text-am-ink flex-1">{tt("recent", "Lately")}</h2>
            <button type="button" onClick={() => onTab("alerts")} className="text-am-body font-medium text-am-accent hover:underline">{tt("allAlerts", "All alerts")}</button>
          </div>
          {recent.length === 0 ? (
            <p className="px-5 py-8 text-am-body text-am-ink-3">{tt("recentEmpty", "Filings, matches and new companies show up here.")}</p>
          ) : (
            <ul>
              {recent.map((n) => (
                <li key={n.id} className="flex items-start gap-3 px-5 py-3 border-t border-am-line-soft first:border-t-0">
                  <span className="mt-1.5"><Pulse tone={alertKind(n.type) === "match" ? "pos" : alertKind(n.type) === "filing" ? "accent" : "warn"} /></span>
                  <div className="min-w-0">
                    <p className="text-am-body font-semibold text-am-ink">{n.title}</p>
                    <p className="text-am-caption text-am-ink-3">{relativeTime(n.created_at, lang)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function SeatPicker({ first, candidates, busy, onPick, onBrowse }: {
  first: boolean; candidates: AlphaEntity[]; busy: boolean; onPick: (ref: AlphaRef) => void; onBrowse: () => void;
}) {
  const tt = useAlphaT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (term ? candidates.filter((c) => c.name.toLowerCase().includes(term)) : candidates).slice(0, 30);
  }, [candidates, q]);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button type="button" className={`min-h-[132px] rounded-am-card border-[1.5px] border-dashed border-am-line text-am-body text-am-ink-3 hover:border-am-ink-3 hover:text-am-ink flex flex-col items-center justify-center gap-1.5 p-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40 ${first ? "" : "opacity-80"}`}>
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>{tt("freeSeat", "Free seat")}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[320px] p-0 rounded-am-card border border-am-line bg-am-surface shadow-am-2">
        <div className="relative p-3 border-b border-am-line">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-am-ink-3" aria-hidden="true" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt("pickPlaceholder", "Search your companies")} aria-label={tt("pickPlaceholder", "Search your companies")}
            className="w-full h-9 ps-8 pe-3 rounded-am-ctl border border-am-line text-am-body focus:outline-none focus:ring-2 focus:ring-am-accent/30" />
        </div>
        {shown.length === 0 ? (
          <div className="p-5 text-center text-am-body text-am-ink-3">
            {candidates.length === 0 ? tt("pickNone", "Follow a company first, then give it a seat.") : tt("pickNoMatch", "No company matches.")}
            {candidates.length === 0 && <button type="button" onClick={() => { setOpen(false); onBrowse(); }} className="block mx-auto mt-2 font-medium text-am-accent hover:underline">{tt("openWatchlist", "Open Watchlist")}</button>}
          </div>
        ) : (
          <ul className="max-h-72 overflow-y-auto py-1">
            {shown.map((c) => (
              <li key={refKey(c.ref)}>
                <button type="button" disabled={busy} onClick={() => { setOpen(false); onPick(c.ref); }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-start hover:bg-am-canvas focus:outline-none focus-visible:bg-am-canvas">
                  <CompanyLogo name={c.name} website={c.website} size={26} rounded="rounded-md" />
                  <span className="min-w-0 flex-1"><span className="block text-am-body font-medium text-am-ink truncate">{c.name}</span><span className="block text-am-caption text-am-ink-3 truncate">{c.subtitle ?? "—"}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

