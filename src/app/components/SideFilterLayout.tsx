import { useTranslation } from "react-i18next";
import { stageLabel } from "../../lib/taxonomy";
import React, { useEffect, useRef, useState } from "react";
import { Search, X, SlidersHorizontal, ChevronUp, ChevronDown, Sparkles, Download, FileText, FileJson, Loader2 } from "lucide-react";
import type { ExportFormat } from "../../lib/exportData";

// ─────────────────────────────────────────────────────────────────────────────
// SideFilterLayout — the shared faceted-search shell used by every directory
// page (Startups, VCs, Private Equity). Extracted verbatim from the Startups
// Hub so all three pages share one structural component: a sticky 300px
// filter panel on the left (white card: Filters header + clear, search box,
// then the page's FilterAccordion stack) and a fluid main content area that
// resizes next to it. Any future layout change here applies globally.
// ─────────────────────────────────────────────────────────────────────────────

export function SideFilterLayout({
  search, onSearchChange, searchPlaceholder,
  activeFilterCount, onClearAll,
  filters, extraBottomPadding = false, children,
  hideSearchBox = false,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  activeFilterCount: number;
  onClearAll: () => void;
  filters: React.ReactNode;
  /** e.g. the Startups compare bar needs extra room at the bottom */
  extraBottomPadding?: boolean;
  children: React.ReactNode;
  /** Opt out of the sidebar's own search box — for a page that surfaces
   *  search elsewhere (e.g. Startups' top bar) and would otherwise show it twice. */
  hideSearchBox?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={`mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 py-6 ${extraBottomPadding ? "pb-28" : ""}`}>
      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">

        {/* ── Left sidebar: faceted search ── */}
        <aside className="w-full lg:w-[300px] lg:flex-none lg:sticky lg:top-6">
          <div className="bg-white border border-gray-100 rounded-[10px] shadow-[0_1px_3px_rgba(15,23,42,0.04)] px-5 py-1 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
            <div className="flex items-center justify-between py-3.5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-[#0F172A]/50" />
                <h2 className="text-sm font-bold text-[#0F172A]">{t("startups.filters")}</h2>
              </div>
              {activeFilterCount > 0 && (
                <button onClick={onClearAll} className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 hover:text-rose-600 transition-colors">
                  <X className="w-3 h-3" />{t("common.clearCount", { count: activeFilterCount })}
                </button>
              )}
            </div>

            {/* Search */}
            {!hideSearchBox && (
              <div className="py-4 border-b border-gray-100">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
                  <input type="text" value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder={searchPlaceholder}
                    data-tour="search-input"
                    className="w-full pl-8 pr-8 py-2 text-sm bg-gray-50 border border-gray-100 text-[#0F172A] placeholder-gray-400 rounded-[10px] focus:outline-none focus:border-gray-300 focus:ring-2 focus:ring-[#0F172A]/10 transition-all" />
                  {search && (
                    <button onClick={() => onSearchChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500"><X className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              </div>
            )}

            {filters}
          </div>
        </aside>

        {/* ── Main content ── */}
        <div className="flex-1 min-w-0 w-full">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Quick Questions ────────────────────────────────────────────────────────────
// A dropdown of canned natural-language questions over a page's data. Each
// question is just a preset combination of that page's own filter/sort
// state — no separate NL parsing or AI layer — so results are exactly as
// trustworthy as setting the filters by hand. Shared across every directory
// page (Startups, VCs, Private Equity, Public Market) so the trigger/panel
// look and dismissal behavior stay identical; only the question list and
// what selecting one does are page-specific.

export function QuickQuestionsMenu<T extends { label: string }>({
  questions, onSelect, triggerLabel,
}: {
  questions: T[];
  onSelect: (q: T) => void;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-[#0F172A] bg-white border border-gray-200 hover:bg-gray-50 transition-colors flex-none"
      >
        <Sparkles className="w-4 h-4 text-amber-500 flex-none" />
        <span className="hidden sm:inline">{triggerLabel ?? "Quick Questions"}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      <div
        role="menu"
        className={`absolute right-0 sm:left-0 top-full mt-1.5 w-80 max-w-[90vw] rounded-lg border border-gray-100 bg-white py-2 shadow-[0_12px_32px_rgba(15,23,42,0.10)] transition-all duration-150 ease-out z-40 ${
          open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 -translate-y-1 pointer-events-none"
        }`}
      >
        <p className="px-4 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Try asking</p>
        {questions.map((q) => (
          <button
            key={q.label}
            role="menuitem"
            onClick={() => { onSelect(q); setOpen(false); }}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-[#0F172A] transition-colors"
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Export Menu ────────────────────────────────────────────────────────────────
// Small "Export ▾" dropdown for the directory pages' top search bar — lets
// the current filtered result set be downloaded as CSV or JSON. The page
// owns what "current result set" means (already-fetched rows, or a fresh
// fetch of everything matching the active filters) and just hands this a
// row count plus an onExport callback; this component is pure UI chrome.

export function ExportMenu({
  onExport, rowCount, exporting = false, error, note, label,
}: {
  onExport: (format: ExportFormat) => void;
  /** Shown next to each format option, e.g. "248 companies". Omit while unknown. */
  rowCount?: number;
  /** True while a fetch for the export is in flight — disables the trigger and shows a spinner. */
  exporting?: boolean;
  /** Set by the page after a failed export fetch; shown under the trigger until the next attempt. */
  error?: string | null;
  /** Small caveat line under the row count, e.g. a result-cap notice. */
  note?: string;
  label?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const empty = rowCount === 0;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function pick(format: ExportFormat) {
    if (empty) return;
    setOpen(false);
    onExport(format);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={exporting}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-[#0F172A] bg-white border border-gray-200 hover:bg-gray-50 transition-colors flex-none disabled:opacity-60 disabled:cursor-wait"
      >
        {exporting ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin flex-none" /> : <Download className="w-4 h-4 text-gray-400 flex-none" />}
        <span className="hidden sm:inline">{label ?? t("common.export")}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {error && <p className="absolute right-0 top-full mt-1 w-56 text-[11px] font-semibold text-rose-600">{error}</p>}

      <div
        role="menu"
        className={`absolute right-0 top-full mt-1.5 w-56 rounded-lg border border-gray-100 bg-white py-2 shadow-[0_12px_32px_rgba(15,23,42,0.10)] transition-all duration-150 ease-out z-40 ${
          open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 -translate-y-1 pointer-events-none"
        }`}
      >
        <p className="px-4 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
          {empty ? t("common.exportEmpty") : rowCount != null ? t("common.exportRowCount", { count: rowCount }) : t("common.export")}
        </p>
        {!empty && note && <p className="px-4 pb-1.5 text-[10px] text-gray-400">{note}</p>}
        <button
          role="menuitem"
          onClick={() => pick("csv")}
          disabled={empty}
          className="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-[#0F172A] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <FileText className="w-3.5 h-3.5 text-gray-400 flex-none" />
          {t("common.exportCsv")}
        </button>
        <button
          role="menuitem"
          onClick={() => pick("json")}
          disabled={empty}
          className="w-full flex items-center gap-2.5 text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-[#0F172A] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <FileJson className="w-3.5 h-3.5 text-gray-400 flex-none" />
          {t("common.exportJson")}
        </button>
      </div>
    </div>
  );
}

// ── Sidebar Filter Accordion ──────────────────────────────────────────────────
// Collapsible section shell used for every sidebar filter category.

export function FilterAccordion({
  title, defaultOpen = true, badge, children, dataTour,
}: {
  title: string; defaultOpen?: boolean; badge?: React.ReactNode; children: React.ReactNode;
  /** Opt-in hook for ProductTour to spotlight this section — unused unless a page runs a tour. */
  dataTour?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-tour={dataTour} className="border-b border-gray-100 py-4 first:pt-0 last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-left group"
      >
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider group-hover:text-[#0F172A] transition-colors">{title}</span>
        <div className="flex items-center gap-2 flex-none">
          {badge}
          {open
            ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
            : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
        </div>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

// Small pill shown in a collapsed FilterAccordion header when a filter in
// that section is active, so the current selection is visible even closed.
export function FilterBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-[#0F172A] border border-gray-200 whitespace-nowrap max-w-[110px] truncate">
      {children}
    </span>
  );
}

// ── Step Slider (light sidebar variant) ───────────────────────────────────────

export function StepSlider({
  steps, value, onChange,
}: {
  steps: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  // Stage sliders carry canonical stage names ("Series A", "Growth/Late") as
  // their labels; headcount sliders carry plain numeric ranges. stageLabel
  // localises the former and passes the latter straight through.
  const idx = Math.max(0, steps.findIndex((s) => s.value === value));
  const pct = steps.length > 1 ? (idx / (steps.length - 1)) * 100 : 0;

  return (
    <div>
      <div className="relative h-4 flex items-center mx-1">
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-gray-200" />
        <div
          className="absolute left-0 h-[3px] rounded-full bg-[#0F172A] transition-all duration-100"
          style={{ width: `${pct}%` }}
        />
        {steps.map((_, i) => (
          <div
            key={i}
            className={`absolute w-2.5 h-2.5 rounded-full border-[2px] -translate-x-1/2 transition-all duration-100 ${
              i < idx   ? "bg-[#0F172A] border-[#0F172A]" :
              i === idx ? "bg-white border-[#0F172A] scale-125" :
                          "bg-white border-gray-300"
            }`}
            style={{ left: `${steps.length > 1 ? (i / (steps.length - 1)) * 100 : 0}%` }}
          />
        ))}
        <input
          type="range" min={0} max={steps.length - 1} step={1} value={idx}
          onChange={(e) => onChange(steps[Number(e.target.value)].value)}
          className="absolute inset-x-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
      </div>
      {/* items-start + a flex-basis cap lets a translated label wrap onto a
          second line instead of colliding with its neighbour. Truncating
          instead would render "シリーズA" and "シリーズB" identically. */}
      <div className="flex justify-between items-start mt-2 px-0.5 gap-0.5">
        {steps.map((s, i) => (
          <button
            key={s.value}
            onClick={() => onChange(s.value)}
            className={`flex-1 text-center text-[9px] font-semibold leading-[1.2] break-words transition-colors ${
              i === idx ? "text-[#0F172A]" : "text-gray-400 hover:text-gray-600"
            }`}
            style={{ minWidth: 0 }}
          >
            {stageLabel(s.label, t)}
          </button>
        ))}
      </div>
    </div>
  );
}
