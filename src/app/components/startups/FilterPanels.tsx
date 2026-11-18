import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { STAGE_STEPS, SECTOR_TAXONOMY, stageLabel, sectorLabel } from "../../../lib/taxonomy";
import {
  EMPTY_RANGE, normalizeRange, parseMillions, rangeIsActive, toggleStage,
  type MoneyRange, type StageChoice,
} from "../../../lib/startupFilters";
import { Switch } from "../ui/switch";
import { useV2T, type HeadcountOption } from "./filterTypes";

// The body of every filter. The FilterBar shows each one in a popover and the
// FilterDrawer shows the same components in a list, so a filter looks and
// behaves identically in both places.

const rowBase = "w-full text-start px-2.5 py-2 rounded-am-ctl text-am-body font-medium transition-colors";
const rowOn = "bg-am-ink text-white";
const rowOff = "text-am-ink-2 hover:bg-am-canvas";
const rowAll = "bg-am-canvas text-am-ink font-semibold";
const chipBase = "px-3 py-1.5 rounded-full text-am-caption font-medium border transition-colors";
const chipOn = "bg-am-accent-soft border-am-accent text-am-accent";
const chipOff = "bg-am-surface border-am-line text-am-ink-2 hover:border-am-ink-3";
const inputCls = "w-full h-9 px-2.5 rounded-am-ctl border border-am-line bg-am-surface text-am-body text-am-ink tabular-nums placeholder:text-am-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40";

// ── Sector (one parent, optionally one child) ───────────────────────────────

export function SectorPanel({ parent, sub, onChange }: {
  parent: string; sub: string; onChange: (parent: string, sub: string) => void;
}) {
  const { t } = useTranslation();
  const tt = useV2T();
  const parents = Object.keys(SECTOR_TAXONOMY).filter((p) => p !== "Uncategorized");
  return (
    <div className="max-h-80 overflow-y-auto space-y-0.5 pe-1">
      <button type="button" onClick={() => onChange("", "")} className={`${rowBase} ${!parent ? rowAll : rowOff}`}>
        {t("startups.allSectors")}
      </button>
      {parents.map((p) => {
        const subs = SECTOR_TAXONOMY[p] ?? [];
        const active = parent === p;
        return (
          <div key={p}>
            <button type="button" onClick={() => onChange(active ? "" : p, "")} className={`${rowBase} ${active ? rowOn : rowOff}`}>
              {sectorLabel(p, t)}
            </button>
            {active && subs.length > 0 && (
              <div className="ms-3 my-1 ps-2.5 border-s-2 border-am-line space-y-0.5">
                <button type="button" onClick={() => onChange(p, "")} className={`${rowBase} ${!sub ? "bg-am-canvas text-am-ink font-semibold" : rowOff}`}>
                  {tt("allOfSector", "All of {{sector}}", { sector: sectorLabel(p, t) })}
                </button>
                {subs.map((s) => (
                  <button key={s} type="button" onClick={() => onChange(p, sub === s ? "" : s)}
                    className={`${rowBase} ${sub === s ? "bg-am-canvas text-am-ink font-semibold" : rowOff}`}>
                    {sectorLabel(s, t)}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Country (single, searchable) ────────────────────────────────────────────

export function CountryPanel({ countries, value, onChange }: {
  countries: string[]; value: string; onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const tt = useV2T();
  const [q, setQ] = useState("");
  const list = useMemo(() => countries.filter((c) => c.toLowerCase().includes(q.toLowerCase())), [countries, q]);
  return (
    <div>
      <div className="relative mb-2">
        <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-am-ink-3" aria-hidden="true" />
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} aria-label={tt("filterCountries", "Filter countries")}
          placeholder={tt("filterCountries", "Filter countries")} className={`${inputCls} ps-8`} />
      </div>
      <div className="max-h-60 overflow-y-auto space-y-0.5 pe-1">
        <button type="button" onClick={() => onChange("")} className={`${rowBase} ${!value ? rowAll : rowOff}`}>{t("startups.allCountries")}</button>
        {list.map((c) => (
          <button key={c} type="button" onClick={() => onChange(value === c ? "" : c)} className={`${rowBase} ${value === c ? rowOn : rowOff}`}>{c}</button>
        ))}
        {list.length === 0 && <p className="px-2.5 py-1 text-am-caption text-am-ink-3">{t("startups.noMatches")}</p>}
      </div>
    </div>
  );
}

// ── Stage (several) ─────────────────────────────────────────────────────────

export function StagePanel({ value, onChange }: { value: StageChoice[]; onChange: (v: StageChoice[]) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1.5">
      {STAGE_STEPS.filter((s) => s.value !== "all").map((s) => {
        const on = value.includes(s.value as StageChoice);
        return (
          <button key={s.value} type="button" aria-pressed={on} onClick={() => onChange(toggleStage(value, s.value as StageChoice))}
            className={`${chipBase} ${on ? chipOn : chipOff}`}>
            {stageLabel(s.label, t)}
          </button>
        );
      })}
    </div>
  );
}

// ── Headcount (one bucket) ──────────────────────────────────────────────────

export function HeadcountPanel({ value, options, onChange }: {
  value: string; options: readonly HeadcountOption[]; onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.filter((o) => o.value !== "all").map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(on ? "all" : o.value)}
            className={`${chipBase} ${on ? chipOn : chipOff}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Money range (valuation, total raised) ───────────────────────────────────

const M = 1_000_000;
export const VALUATION_PRESETS = [
  { label: "Under $50M", min: null, max: 50 * M },
  { label: "$50M to $250M", min: 50 * M, max: 250 * M },
  { label: "$250M to $1B", min: 250 * M, max: 1000 * M },
  { label: "$1B and up", min: 1000 * M, max: null },
] as const;
export const RAISED_PRESETS = [
  { label: "Under $10M", min: null, max: 10 * M },
  { label: "$10M to $50M", min: 10 * M, max: 50 * M },
  { label: "$50M to $200M", min: 50 * M, max: 200 * M },
  { label: "$200M and up", min: 200 * M, max: null },
] as const;

export function RangePanel({ value, onChange, presets, allowUnknown }: {
  value: MoneyRange;
  onChange: (v: MoneyRange) => void;
  presets: readonly { label: string; min: number | null; max: number | null }[];
  /** Offer "include companies with no value on record" (valuation only). */
  allowUnknown: boolean;
}) {
  const tt = useV2T();
  const asText = (n: number | null) => (n == null ? "" : String(n / M));
  const [min, setMin] = useState(asText(value.min));
  const [max, setMax] = useState(asText(value.max));
  // The same filter can be changed from the other place (chip, drawer, popover): follow it.
  useEffect(() => { setMin(asText(value.min)); setMax(asText(value.max)); }, [value.min, value.max]);

  const apply = (next: Partial<MoneyRange>) => onChange(normalizeRange({ ...value, ...next }));
  const commit = () => apply({ min: parseMillions(min), max: parseMillions(max) });
  const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") commit(); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const on = value.min === p.min && value.max === p.max;
          return (
            <button key={p.label} type="button" aria-pressed={on}
              onClick={() => apply(on ? { min: null, max: null } : { min: p.min, max: p.max })}
              className={`${chipBase} ${on ? chipOn : chipOff}`}>
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2.5">
        <label className="flex-1 text-am-caption text-am-ink-3">
          {tt("minMillions", "Min ($M)")}
          <input className={`${inputCls} mt-1`} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} onBlur={commit} onKeyDown={onKey} />
        </label>
        <label className="flex-1 text-am-caption text-am-ink-3">
          {tt("maxMillions", "Max ($M)")}
          <input className={`${inputCls} mt-1`} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} onBlur={commit} onKeyDown={onKey} />
        </label>
      </div>
      {allowUnknown && (
        <label className="flex items-start gap-2.5 text-am-body text-am-ink-2 cursor-pointer">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--am-accent)]" checked={value.includeUnknown}
            onChange={(e) => apply({ includeUnknown: e.target.checked })} />
          <span>{tt("includeNoValuation", "Include companies with no valuation on record")}</span>
        </label>
      )}
      {rangeIsActive(value) && (
        <button type="button" onClick={() => onChange({ ...EMPTY_RANGE, includeUnknown: value.includeUnknown })}
          className="text-am-caption font-medium text-am-ink-3 hover:text-am-ink">
          {tt("clear", "Clear")}
        </button>
      )}
    </div>
  );
}

// ── Small controls used by the drawer ───────────────────────────────────────

export function Segmented<T extends string | number | null>({ options, value, onChange, label }: {
  options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex bg-am-line-soft rounded-am-ctl p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
            className={`flex-1 px-2 py-1.5 rounded-[6px] text-am-caption font-medium transition-colors ${on ? "bg-am-surface text-am-ink shadow-am-1 font-semibold" : "text-am-ink-3 hover:text-am-ink"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SwitchRow({ title, hint, checked, onChange }: { title: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-am-title font-semibold text-am-ink">{title}</div>
        {hint && <div className="text-am-caption text-am-ink-3 mt-0.5">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}
