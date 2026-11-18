import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { stageLabel, sectorLabel, STAGE_STEPS } from "../../../lib/taxonomy";
import { rangeIsActive, rangeLabel, type FilterChip } from "../../../lib/startupFilters";
import {
  SectorPanel, CountryPanel, StagePanel, HeadcountPanel, RangePanel, VALUATION_PRESETS, RAISED_PRESETS,
} from "./FilterPanels";
import { useV2T, type FilterActions, type FilterState, type HeadcountOption } from "./filterTypes";

function FilterTrigger({ label, summary, children, width = 320 }: {
  label: string; summary?: string; children: React.ReactNode; width?: number;
}) {
  const on = !!summary;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button"
          className={`inline-flex flex-none items-center gap-1.5 h-9 px-3 rounded-am-ctl border text-am-body font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40 ${
            on ? "border-am-accent bg-am-accent-soft text-am-accent" : "border-am-line bg-am-surface text-am-ink-2 hover:border-am-ink-3 hover:text-am-ink"}`}>
          <span>{label}</span>
          {on && <span className="max-w-[130px] truncate font-semibold">{summary}</span>}
          <ChevronDown className="w-3.5 h-3.5 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} style={{ width }}
        className="p-4 rounded-am-card border border-am-line bg-am-surface shadow-am-2">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function FilterBar({
  state, actions, countries, headcountSteps, activeCount, onOpenDrawer, density, onDensity,
}: {
  state: FilterState;
  actions: FilterActions;
  countries: string[];
  headcountSteps: readonly HeadcountOption[];
  activeCount: number;
  onOpenDrawer: () => void;
  density: "comfortable" | "compact";
  onDensity: (d: "comfortable" | "compact") => void;
}) {
  const { t } = useTranslation();
  const tt = useV2T();
  const sectorSummary = state.subSectorTag || (state.parentSector ? sectorLabel(state.subSector || state.parentSector, t) : "");
  const stageSummary = state.stageSteps.length === 0 ? ""
    : state.stageSteps.length === 1 ? stageLabel(STAGE_STEPS.find((s) => s.value === state.stageSteps[0])?.label ?? "", t)
    : String(state.stageSteps.length);
  const headcountSummary = state.headcountStep !== "all" ? (headcountSteps.find((h) => h.value === state.headcountStep)?.label ?? "") : "";

  return (
    <div className="flex flex-nowrap md:flex-wrap items-center gap-2 overflow-x-auto md:overflow-visible pb-1 md:pb-0" role="toolbar" aria-label={tt("filters", "Filters")}>
      <FilterTrigger label={t("startups.sectors")} summary={sectorSummary} width={300}>
        <SectorPanel parent={state.parentSector} sub={state.subSector} onChange={actions.setSector} />
      </FilterTrigger>
      <FilterTrigger label={t("startups.fundingStage")} summary={stageSummary} width={300}>
        <StagePanel value={state.stageSteps} onChange={actions.setStageSteps} />
      </FilterTrigger>
      <FilterTrigger label={tt("geography", "Geography")} summary={state.country} width={280}>
        <CountryPanel countries={countries} value={state.country} onChange={actions.setCountry} />
      </FilterTrigger>
      <FilterTrigger label={t("startups.headcount")} summary={headcountSummary} width={300}>
        <HeadcountPanel value={state.headcountStep} options={headcountSteps} onChange={actions.setHeadcountStep} />
      </FilterTrigger>
      <FilterTrigger label={tt("valuation", "Valuation")} summary={rangeIsActive(state.valuation) ? rangeLabel(state.valuation) : ""} width={340}>
        <RangePanel value={state.valuation} onChange={actions.setValuation} presets={VALUATION_PRESETS} allowUnknown />
      </FilterTrigger>
      <FilterTrigger label={tt("raised", "Raised")} summary={rangeIsActive(state.raised) ? rangeLabel(state.raised) : ""} width={340}>
        <RangePanel value={state.raised} onChange={actions.setRaised} presets={RAISED_PRESETS} allowUnknown={false} />
      </FilterTrigger>

      <button type="button" onClick={onOpenDrawer}
        className="inline-flex flex-none items-center gap-2 h-9 px-3 rounded-am-ctl border border-am-line bg-am-surface text-am-body font-medium text-am-ink-2 hover:border-am-ink-3 hover:text-am-ink transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40">
        <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
        {tt("allFilters", "All filters")}
        {activeCount > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-am-ink text-white text-[11px] font-semibold leading-[18px] text-center tabular-nums">{activeCount}</span>
        )}
      </button>

      <div className="hidden md:block flex-1" />

      <div role="group" aria-label={tt("density", "Row density")} className="hidden md:inline-flex rounded-am-ctl border border-am-line bg-am-surface p-0.5">
        {(["comfortable", "compact"] as const).map((d) => (
          <button key={d} type="button" aria-pressed={density === d} onClick={() => onDensity(d)}
            className={`px-2.5 h-8 rounded-[6px] text-am-caption font-medium transition-colors ${density === d ? "bg-am-canvas text-am-ink" : "text-am-ink-3 hover:text-am-ink"}`}>
            {d === "comfortable" ? tt("comfortable", "Comfortable") : tt("compact", "Compact")}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FilterChips({ chips, onClear, onClearAll }: {
  chips: FilterChip[]; onClear: (id: string) => void; onClearAll: () => void;
}) {
  const tt = useV2T();
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label={tt("activeFilters", "Active filters")}>
      {chips.map((c) => (
        <li key={c.id} className="inline-flex items-center gap-1 ps-3 pe-1 py-1 rounded-full bg-am-accent-soft text-am-accent text-am-caption font-medium">
          {c.label}
          <button type="button" onClick={() => onClear(c.id)} aria-label={tt("removeFilter", "Remove filter: {{label}}", { label: c.label })}
            className="w-5 h-5 grid place-items-center rounded-full hover:bg-am-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40">
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        </li>
      ))}
      {chips.length > 1 && (
        <li>
          <button type="button" onClick={onClearAll} className="px-2 py-1 text-am-caption font-medium text-am-ink-3 hover:text-am-ink">
            {tt("clearAll", "Clear all")}
          </button>
        </li>
      )}
    </ul>
  );
}
