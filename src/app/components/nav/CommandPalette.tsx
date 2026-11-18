import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { CornerDownLeft, History, Search, Sparkles } from "lucide-react";
import { CompanyLogo } from "../CompanyLogo";
import { fetchStartupsPage, type StartupListRow } from "../../../lib/supabase";
import { askPath, filterPages, stepIndex } from "../../../lib/commandPalette";
import { loadRecent } from "../../../lib/recentQuestions";

type Row =
  | { kind: "ask"; key: string; label: string; to: string }
  | { kind: "page"; key: string; label: string; hint: string; to: string }
  | { kind: "recent"; key: string; label: string; to: string }
  | { kind: "company"; key: string; label: string; hint: string; to: string; website: string | null };

/** Ctrl+K: ask the analyst, jump to a page, or open a company, from anywhere. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [companies, setCompanies] = useState<StartupListRow[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => { if (open) { setQ(""); setHi(0); setCompanies([]); setRecent(loadRecent()); } }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) { setCompanies([]); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      fetchStartupsPage({ search: term }, 1).then((r) => { if (!cancelled) setCompanies(r.slice(0, 5)); }).catch(() => { if (!cancelled) setCompanies([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(id); };
  }, [q, open]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const term = q.trim();
    if (term) out.push({ kind: "ask", key: "ask", label: term, to: askPath(term) });
    else for (const r of recent) out.push({ kind: "recent", key: `r:${r}`, label: r, to: askPath(r) });
    for (const p of filterPages(term)) out.push({ kind: "page", key: `p:${p.id}`, label: t(`nav.v2.page_${p.id}`, { defaultValue: p.label }) as string, hint: t(`nav.v2.hint_${p.id}`, { defaultValue: p.hint }) as string, to: p.to });
    for (const c of companies) out.push({ kind: "company", key: `c:${c.id}`, label: c.name, hint: [c.sector_parent || c.industry, c.country].filter(Boolean).join(" · "), to: `/startups?company=${c.id}`, website: c.website });
    return out;
  }, [q, recent, companies, t]);

  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${hi}"]`)?.scrollIntoView({ block: "nearest" }); }, [hi]);

  function go(row: Row | undefined) {
    if (!row) return;
    onOpenChange(false);
    navigate(row.to);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => stepIndex(i, 1, rows.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => stepIndex(i, -1, rows.length)); }
    else if (e.key === "Enter") { e.preventDefault(); go(rows[hi]); }
  }

  const group = (r: Row): string => r.kind === "ask" ? t("nav.v2.ask", { defaultValue: "Ask" }) as string
    : r.kind === "recent" ? t("nav.v2.recent", { defaultValue: "Recent questions" }) as string
    : r.kind === "page" ? t("nav.v2.goTo", { defaultValue: "Go to" }) as string
    : t("nav.v2.companies", { defaultValue: "Companies" }) as string;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-am-ink/40" />
        <Dialog.Content aria-describedby={undefined} onKeyDown={onKeyDown}
          className="fixed left-1/2 top-[14vh] z-50 w-[calc(100%-2rem)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-2xl border border-am-line bg-am-surface shadow-am-2 focus:outline-none">
          <Dialog.Title className="sr-only">{t("nav.v2.paletteTitle", { defaultValue: "Search AlphaMap" })}</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-am-line px-4">
            <Search className="h-4 w-4 flex-none text-am-ink-3" aria-hidden="true" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} autoComplete="off"
              aria-label={t("nav.v2.paletteTitle", { defaultValue: "Search AlphaMap" }) as string}
              placeholder={t("nav.v2.palettePlaceholder", { defaultValue: "Ask a question, or jump to a page or company" }) as string}
              className="h-14 flex-1 bg-transparent text-[15px] text-am-ink placeholder:text-am-ink-3 focus:outline-none" />
            <kbd className="rounded-md border border-am-line bg-am-canvas px-1.5 py-0.5 text-[11px] font-semibold text-am-ink-3">Esc</kbd>
          </div>
          <ul ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto py-1.5">
            {rows.length === 0 && <li className="px-5 py-8 text-center text-am-body text-am-ink-3">{t("nav.v2.noResults", { defaultValue: "Nothing matches." })}</li>}
            {rows.map((r, i) => {
              const head = i === 0 || group(rows[i - 1]) !== group(r);
              return (
                <React.Fragment key={r.key}>
                  {head && <li role="presentation" className="px-5 pb-1 pt-2.5 text-am-caption font-medium text-am-ink-3">{group(r)}</li>}
                  <li role="option" aria-selected={i === hi} data-idx={i}>
                    <button type="button" tabIndex={-1} onMouseEnter={() => setHi(i)} onClick={() => go(r)}
                      className={`flex w-full items-center gap-3 px-5 py-2.5 text-start ${i === hi ? "bg-am-canvas" : ""}`}>
                      {r.kind === "ask" && <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-am-accent-soft text-am-accent"><Sparkles className="h-4 w-4" aria-hidden="true" /></span>}
                      {r.kind === "recent" && <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-am-canvas text-am-ink-3"><History className="h-4 w-4" aria-hidden="true" /></span>}
                      {r.kind === "page" && <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-am-canvas text-am-ink-2"><CornerDownLeft className="h-4 w-4" aria-hidden="true" /></span>}
                      {r.kind === "company" && <CompanyLogo name={r.label} website={r.website} size={28} rounded="rounded-lg" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-am-body font-medium text-am-ink">
                          {r.kind === "ask" ? <>{t("nav.v2.askPrefix", { defaultValue: "Ask AlphaMap:" })} <span className="font-semibold">{r.label}</span></> : r.label}
                        </span>
                        {(r.kind === "page" || r.kind === "company") && r.hint && <span className="block truncate text-am-caption text-am-ink-3">{r.hint}</span>}
                      </span>
                      {i === hi && <CornerDownLeft className="h-3.5 w-3.5 flex-none text-am-ink-3" aria-hidden="true" />}
                    </button>
                  </li>
                </React.Fragment>
              );
            })}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
