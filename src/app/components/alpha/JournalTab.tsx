import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { NotebookPen } from "lucide-react";
import { CompanyLogo } from "../CompanyLogo";
import { fetchNotifications, fetchStartupsPage, type Notification } from "../../../lib/supabase";
import {
  activeMentionQuery, alertKind, applyMention, groupByDay, matchesFilter, mentionToken, mergeTimeline, noteSegments,
  refKey, relativeTime, type AlphaRef, type JournalFilter, type TimelineEntry,
} from "../../../lib/alpha";
import { createNote, deleteNote, fetchNotes, updateNote, type AlphaEntity, type AlphaNote } from "../../../lib/alphaData";
import { watchlistErrorMessage } from "../../../lib/watchlist";
import { EmptyState, ErrorLine, Pulse, Spinner } from "./AlphaBits";
import type { AlphaData } from "./useAlphaData";
import { useAlphaT } from "./useAlphaT";

type Mention = { name: string; ref: AlphaRef };
interface Suggestion { ref: AlphaRef; name: string; website: string | null; subtitle: string | null }

const hrefOf = (r: AlphaRef): string => (r.type === "startup" ? `/startups?company=${r.id}` : r.type === "crm" ? `/crm/${r.id}` : "/vcs");

/** `@Name` in the box → `@[Name](type:id)` in the saved body. Longest names first, so "Acme Labs" wins over "Acme". */
function toBody(text: string, mentions: Mention[]): string {
  let out = text;
  for (const m of [...mentions].sort((a, b) => b.name.length - a.name.length)) {
    out = out.split(`@${m.name}`).join(mentionToken(m.name, m.ref));
  }
  return out.trim();
}

function fromBody(body: string): { text: string; mentions: Mention[] } {
  const mentions: Mention[] = [];
  const text = noteSegments(body).map((s) => {
    if (s.kind === "text") return s.text;
    mentions.push({ name: s.name, ref: s.ref });
    return `@${s.name}`;
  }).join("");
  return { text, mentions };
}

function MentionChip({ name, ref_ }: { name: string; ref_: AlphaRef }) {
  return (
    <Link to={hrefOf(ref_)} className="inline-flex items-center px-2 py-px rounded-full bg-am-accent-soft text-am-accent font-semibold text-am-body hover:underline">@{name}</Link>
  );
}

function NoteBody({ body }: { body: string }) {
  return (
    <p className="text-am-body text-am-ink leading-relaxed whitespace-pre-wrap break-words">
      {noteSegments(body).map((s, i) => s.kind === "text" ? <React.Fragment key={i}>{s.text}</React.Fragment> : <MentionChip key={i} name={s.name} ref_={s.ref} />)}
    </p>
  );
}

function Composer({ data, editing, onDone }: { data: AlphaData; editing: AlphaNote | null; onDone: () => void }) {
  const tt = useAlphaT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const initial = useMemo(() => (editing ? fromBody(editing.body) : { text: "", mentions: [] as Mention[] }), [editing]);
  const [text, setText] = useState(initial.text);
  const [mentions, setMentions] = useState<Mention[]>(initial.mentions);
  const [caret, setCaret] = useState(initial.text.length);
  const [remote, setRemote] = useState<Suggestion[]>([]);
  const [hi, setHi] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setText(initial.text); setMentions(initial.mentions); if (editing) ref.current?.focus(); }, [initial, editing]);

  const query = activeMentionQuery(text, caret);
  useEffect(() => {
    if (!query || query.query.trim().length < 2) { setRemote([]); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      fetchStartupsPage({ search: query.query.trim() }, 1)
        .then((rows) => { if (!cancelled) setRemote(rows.slice(0, 5).map((s) => ({ ref: { type: "startup" as const, id: s.id }, name: s.name, website: s.website, subtitle: s.industry }))); })
        .catch(() => { if (!cancelled) setRemote([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(id); };
  }, [query?.query]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions: Suggestion[] = useMemo(() => {
    if (!query) return [];
    const term = query.query.trim().toLowerCase();
    const local: Suggestion[] = [];
    for (const e of data.entities.values()) {
      if (!term || e.name.toLowerCase().includes(term)) local.push({ ref: e.ref, name: e.name, website: e.website, subtitle: e.subtitle });
      if (local.length >= 6) break;
    }
    const seen = new Set(local.map((l) => refKey(l.ref)));
    return [...local, ...remote.filter((r) => !seen.has(refKey(r.ref)))].slice(0, 8);
  }, [query, data.entities, remote]);
  useEffect(() => { setHi(0); }, [query?.query]);

  function pick(s: Suggestion) {
    if (!query) return;
    const r = applyMention(text, query.start, caret, `@${s.name}`);
    setText(r.text);
    setMentions((m) => (m.some((x) => refKey(x.ref) === refKey(s.ref)) ? m : [...m, { name: s.name, ref: s.ref }]));
    requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(r.caret, r.caret); setCaret(r.caret); });
  }

  async function save() {
    const body = toBody(text, mentions);
    if (!body || busy) return;
    setBusy(true); setError(null);
    try {
      if (editing) await updateNote(editing.id, body); else await createNote(body);
      data.setNotes(await fetchNotes());
      setText(""); setMentions([]);
      onDone();
    } catch (e) { setError(watchlistErrorMessage(e)); }
    finally { setBusy(false); }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % suggestions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + suggestions.length) % suggestions.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(suggestions[hi]); return; }
      if (e.key === "Escape") { e.preventDefault(); setCaret(0); return; }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
  }

  return (
    <div className="relative bg-am-surface border border-am-line rounded-am-card shadow-am-1 p-4">
      <label htmlFor="alpha-note" className="sr-only">{tt("noteLabel", "Write a note")}</label>
      <textarea id="alpha-note" ref={ref} value={text} rows={3} maxLength={10000}
        onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
        onKeyDown={onKeyDown}
        placeholder={tt("notePlaceholder", "What are you thinking about? Type @ to link a company.")}
        className="w-full resize-y bg-transparent text-am-title leading-relaxed text-am-ink placeholder:text-am-ink-3 focus:outline-none" />
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label={tt("suggestions", "Companies")} className="absolute left-4 right-4 z-20 mt-1 max-h-64 overflow-y-auto rounded-am-card border border-am-line bg-am-surface shadow-am-2 py-1">
          {suggestions.map((s, i) => (
            <li key={refKey(s.ref)} role="option" aria-selected={i === hi}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setHi(i)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-start ${i === hi ? "bg-am-canvas" : ""}`}>
                <CompanyLogo name={s.name} website={s.website} size={24} rounded="rounded-md" />
                <span className="min-w-0 flex-1"><span className="block text-am-body font-medium truncate">{s.name}</span>{s.subtitle && <span className="block text-am-caption text-am-ink-3 truncate">{s.subtitle}</span>}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="mt-2"><ErrorLine message={error} /></div>}
      <div className="mt-3 pt-3 border-t border-am-line-soft flex items-center gap-3">
        <span className="text-am-caption text-am-ink-3 flex-1">{tt("composerHint", "@ links a company · Ctrl+Enter saves")}</span>
        {editing && <button type="button" onClick={onDone} className="h-9 px-3.5 rounded-am-ctl border border-am-line text-am-body font-medium hover:bg-am-canvas">{tt("cancel", "Cancel")}</button>}
        <button type="button" disabled={busy || !text.trim()} onClick={save}
          className="h-9 px-4 rounded-am-ctl bg-am-ink border border-am-ink text-white text-am-body font-semibold hover:bg-slate-800 disabled:opacity-50">
          {editing ? tt("saveEdit", "Save changes") : tt("saveNote", "Save note")}
        </button>
      </div>
    </div>
  );
}

export function JournalTab({ data }: { data: AlphaData }) {
  const tt = useAlphaT();
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<Notification[] | null>(null);
  const [filter, setFilter] = useState<JournalFilter>("all");
  const [editing, setEditing] = useState<AlphaNote | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => { fetchNotifications(50).then(setAlerts).catch(() => setAlerts([])); }, []);

  const entries = useMemo(() => {
    const list: TimelineEntry<AlphaNote | Notification>[] = [
      ...data.notes.map((n) => ({ id: `n:${n.id}`, at: n.createdAt, kind: "note" as const, data: n })),
      ...(alerts ?? []).map((a) => ({ id: `a:${a.id}`, at: a.created_at, kind: "alert" as const, data: a })),
    ].filter((e) => matchesFilter(e.kind, filter));
    return mergeTimeline(entries);
  }, [data.notes, alerts, filter]);
  const groups = useMemo(() => groupByDay(entries, new Date()), [entries]);

  // Companies named in notes, most-mentioned first.
  const mentioned = useMemo(() => {
    const counts = new Map<string, { ref: AlphaRef; name: string; n: number }>();
    for (const note of data.notes) {
      for (const s of noteSegments(note.body)) {
        if (s.kind !== "mention") continue;
        const k = refKey(s.ref);
        const cur = counts.get(k);
        if (cur) cur.n += 1; else counts.set(k, { ref: s.ref, name: s.name, n: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  }, [data.notes]);

  const todos = useMemo(() => data.crm.filter((c) => c.next_step && c.stage !== "passed" && c.stage !== "invested")
    .sort((a, b) => (a.next_step_date ?? "9999").localeCompare(b.next_step_date ?? "9999")).slice(0, 6), [data.crm]);
  const today = new Date().toISOString().slice(0, 10);

  // Notes written before the Journal: kept where they were, shown here without a date (they never had one).
  const earlier = useMemo(() => {
    const out: { key: string; entity: AlphaEntity | null; name: string; text: string }[] = [];
    for (const s of data.watchlist.startups) if (s.watchlistNotes) out.push({ key: `s:${s.id}`, entity: data.entities.get(`startup:${s.id}`) ?? null, name: s.name, text: s.watchlistNotes });
    for (const i of data.watchlist.investors) if (i.watchlistNotes) out.push({ key: `i:${i.id}`, entity: data.entities.get(`investor:${i.id}`) ?? null, name: i.name, text: i.watchlistNotes });
    for (const c of data.crm) if (c.notes) out.push({ key: `c:${c.id}`, entity: data.entities.get(`crm:${c.id}`) ?? null, name: c.name, text: c.notes });
    return out;
  }, [data.watchlist, data.crm, data.entities]);

  async function remove(n: AlphaNote) {
    if (!window.confirm(tt("confirmDelete", "Delete this note?"))) return;
    try { await deleteNote(n.id); data.setNotes((all) => all.filter((x) => x.id !== n.id)); } catch (e) { setProblem(watchlistErrorMessage(e)); }
  }

  if (data.notesError) return <ErrorLine message={tt("journalUnavailable", "The journal could not be loaded: {{error}}", { error: data.notesError })} />;

  const dayLabel = (g: (typeof groups)[number]): string =>
    g.label.kind === "today" ? tt("today", "Today") : g.label.kind === "yesterday" ? tt("yesterday", "Yesterday")
      : new Date(`${g.label.iso}T00:00:00Z`).toLocaleDateString(lang, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div className="flex flex-wrap gap-8 items-start">
      <div className="flex-[999_1_560px] min-w-0 space-y-5">
        <Composer key={editing?.id ?? "new"} data={data} editing={editing} onDone={() => setEditing(null)} />
        {problem && <ErrorLine message={problem} />}

        <div className="flex flex-wrap gap-1.5" role="group" aria-label={tt("show", "Show")}>
          {(["all", "notes", "updates"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
              className={`h-8 px-3.5 rounded-full border text-am-caption font-medium transition-colors ${filter === f ? "bg-am-ink border-am-ink text-white" : "bg-am-surface border-am-line text-am-ink-2 hover:border-am-ink-3"}`}>
              {tt(`filter_${f}`, f === "all" ? "Everything" : f === "notes" ? "My notes" : "Updates")}
            </button>
          ))}
        </div>

        {alerts === null && data.loading ? <Spinner label={tt("loading", "Loading")} /> : groups.length === 0 ? (
          <EmptyState icon={<NotebookPen className="w-8 h-8" />} title={tt("emptyTitle", "Nothing here yet")}
            body={filter === "updates" ? tt("emptyUpdates", "Filings, matches and new companies will appear here.") : tt("emptyBody", "Write your first note above. Link a company with @ and it follows that company from now on.")} />
        ) : (
          <div>
            {groups.map((g) => (
              <section key={g.key} aria-label={dayLabel(g)} className="flex gap-5">
                <div className="flex-none w-[64px] pt-3 text-end text-am-caption text-am-ink-3">{dayLabel(g)}</div>
                <ol className="flex-1 min-w-0 border-s border-am-line ps-5 pb-2">
                  {g.entries.map((e) => (
                    <li key={e.id} className="relative pb-6">
                      <span aria-hidden="true" className={`absolute -start-[25px] top-1.5 w-[9px] h-[9px] rounded-full border-2 bg-am-surface ${e.kind === "alert" ? "border-am-accent" : "border-am-ink bg-am-ink"}`} />
                      {e.kind === "note" ? (() => {
                        const n = e.data as AlphaNote;
                        return (
                          <div className="group">
                            <div className="flex items-center gap-2 text-am-caption text-am-ink-3 mb-1">
                              <span className="inline-flex items-center h-[22px] px-2.5 rounded-full bg-am-canvas border border-am-line text-[11px] font-semibold text-am-ink">{tt("note", "Note")}</span>
                              <span>{relativeTime(n.createdAt, lang)}</span>
                              <span className="flex-1" />
                              <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity inline-flex gap-3">
                                <button type="button" onClick={() => { setEditing(n); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="hover:text-am-ink">{tt("edit", "Edit")}</button>
                                <button type="button" onClick={() => remove(n)} className="hover:text-am-neg">{tt("delete", "Delete")}</button>
                              </span>
                            </div>
                            <NoteBody body={n.body} />
                          </div>
                        );
                      })() : (() => {
                        const a = e.data as Notification;
                        const kind = alertKind(a.type);
                        return (
                          <div>
                            <div className="flex items-center gap-2 text-am-caption text-am-ink-3 mb-1">
                              <span className={`inline-flex items-center h-[22px] px-2.5 rounded-full text-[11px] font-semibold ${kind === "match" ? "bg-[#E7F6EF] text-am-pos" : "bg-am-accent-soft text-am-accent"}`}>{tt(`kind_${kind}`, { filing: "Filing", trending: "Trending", match: "Match", new: "New company", other: "Update" }[kind])}</span>
                              <span>{relativeTime(a.created_at, lang)}</span>
                              {!a.read_at && <Pulse />}
                            </div>
                            <p className="text-am-body font-semibold text-am-ink">{a.title}</p>
                            <p className="text-am-body text-am-ink-2">{a.body}</p>
                            {a.link && <button type="button" onClick={() => navigate(a.link as string)} className="mt-1 text-am-body font-medium text-am-accent hover:underline">{tt("open", "Open")}</button>}
                          </div>
                        );
                      })()}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}

        {earlier.length > 0 && filter !== "updates" && (
          <details className="bg-am-surface border border-am-line rounded-am-card shadow-am-1">
            <summary className="cursor-pointer select-none px-5 py-3.5 text-am-title font-semibold text-am-ink">{tt("earlier", "Earlier notes")} <span className="text-am-ink-3 font-medium tabular-nums">{earlier.length}</span></summary>
            <ul className="px-5 pb-3">
              {earlier.map((x) => (
                <li key={x.key} className="py-3 border-t border-am-line-soft">
                  {x.entity ? <Link to={x.entity.href} className="text-am-body font-semibold text-am-ink hover:text-am-accent">{x.name}</Link> : <span className="text-am-body font-semibold">{x.name}</span>}
                  <p className="mt-0.5 text-am-body text-am-ink-2 whitespace-pre-wrap break-words">{x.text}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <aside className="flex-[1_1_280px] max-w-[340px] min-w-[260px] space-y-4">
        <section className="bg-am-surface border border-am-line rounded-am-card shadow-am-1 p-4" aria-label={tt("inNotes", "Companies in your notes")}>
          <h2 className="text-am-title font-semibold text-am-ink">{tt("inNotes", "Companies in your notes")}</h2>
          {mentioned.length === 0 ? <p className="mt-2 text-am-body text-am-ink-3">{tt("inNotesEmpty", "Companies you link with @ appear here.")}</p> : (
            <ul className="mt-3 space-y-2.5">
              {mentioned.map((m) => {
                const e = data.entities.get(refKey(m.ref));
                return (
                  <li key={refKey(m.ref)} className="flex items-center gap-2.5">
                    <CompanyLogo name={m.name} website={e?.website ?? null} size={24} rounded="rounded-md" />
                    <Link to={hrefOf(m.ref)} className="flex-1 min-w-0 truncate text-am-body font-medium text-am-ink hover:text-am-accent">{m.name}</Link>
                    <span className="text-am-caption text-am-ink-3 tabular-nums">{m.n}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="bg-am-surface border border-am-line rounded-am-card shadow-am-1 p-4" aria-label={tt("todos", "Next steps")}>
          <h2 className="text-am-title font-semibold text-am-ink">{tt("todos", "Next steps")}</h2>
          {todos.length === 0 ? <p className="mt-2 text-am-body text-am-ink-3">{tt("todosEmpty", "Set a next step on a company in your CRM and it shows up here.")}</p> : (
            <ul className="mt-3 space-y-3">
              {todos.map((c) => {
                const over = !!c.next_step_date && c.next_step_date < today;
                return (
                  <li key={c.id}>
                    <Link to={`/crm/${c.id}`} className="block text-am-body text-am-ink hover:text-am-accent"><strong className="font-semibold">{c.name}</strong> · {c.next_step}</Link>
                    {c.next_step_date && <p className={`text-am-caption ${over ? "font-semibold text-am-neg" : "text-am-ink-3"}`}>{over ? tt("overdue", "Overdue") + " · " : ""}{c.next_step_date}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
