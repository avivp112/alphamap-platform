import React from "react";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../ui/sheet";
import { rangeIsActive, rangeLabel } from "../../../lib/startupFilters";
import {
  SectorPanel, CountryPanel, StagePanel, HeadcountPanel, RangePanel, Segmented, SwitchRow,
  VALUATION_PRESETS, RAISED_PRESETS,
} from "./FilterPanels";
import { useV2T, type FilterActions, type FilterState, type HeadcountOption } from "./filterTypes";

function Section({ title, value, defaultOpen = true, children }: {
  title: string; value?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group border-b border-am-line-soft py-4">
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none text-am-title font-semibold text-am-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40 rounded">
        <span>{title}</span>
        <span className="flex items-center gap-2 text-am-caption font-normal text-am-ink-3">
          {value && <span className="max-w-[190px] truncate tabular-nums text-am-ink">{value}</span>}
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">▾</span>
        </span>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

/** Every filter in one place; opened by "All filters". Changes apply immediately. */
export function FilterDrawer({
  open, onOpenChange, state, actions, countries, headcountSteps, totalCount,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  state: FilterState;
  actions: FilterActions;
  countries: string[];
  headcountSteps: readonly HeadcountOption[];
  totalCount: number;
}) {
  const { t } = useTranslation();
  const tt = useV2T();
  const headcountLabel = state.headcountStep !== "all" ? (headcountSteps.find((h) => h.value === state.headcountStep)?.label ?? "") : "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-[420px] p-0 flex flex-col gap-0 bg-am-surface">
        <SheetHeader className="px-6 py-4 border-b border-am-line text-start">
          <SheetTitle className="text-am-title font-semibold text-am-ink">{tt("allFilters", "All filters")}</SheetTitle>
          <SheetDescription className="sr-only">{tt("drawerHint", "Narrow the list of companies. Changes apply immediately.")}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6">
          <Section title={t("startups.sectors")} value={state.subSectorTag || state.subSector || state.parentSector} defaultOpen={false}>
            <SectorPanel parent={state.parentSector} sub={state.subSector} onChange={actions.setSector} />
          </Section>
          <Section title={t("startups.fundingStage")} value={state.stageSteps.length ? String(state.stageSteps.length) : ""}>
            <StagePanel value={state.stageSteps} onChange={actions.setStageSteps} />
          </Section>
          <Section title={t("startups.headcount")} value={headcountLabel}>
            <HeadcountPanel value={state.headcountStep} options={headcountSteps} onChange={actions.setHeadcountStep} />
          </Section>
          <Section title={tt("valuation", "Valuation")} value={rangeIsActive(state.valuation) ? rangeLabel(state.valuation) : ""}>
            <RangePanel value={state.valuation} onChange={actions.setValuation} presets={VALUATION_PRESETS} allowUnknown />
          </Section>
          <Section title={tt("raised", "Raised")} value={rangeIsActive(state.raised) ? rangeLabel(state.raised) : ""} defaultOpen={false}>
            <RangePanel value={state.raised} onChange={actions.setRaised} presets={RAISED_PRESETS} allowUnknown={false} />
          </Section>
          <Section title={tt("geography", "Geography")} value={state.country} defaultOpen={false}>
            <CountryPanel countries={countries} value={state.country} onChange={actions.setCountry} />
          </Section>
          <div className="border-b border-am-line-soft py-4">
            <SwitchRow title={tt("raisedAndGrowing", "Raised and growing")}
              hint={tt("raisedAndGrowingHint", "Raised in the last 6 months and headcount is growing")}
              checked={state.momentum} onChange={actions.setMomentum} />
          </div>
          <div className="border-b border-am-line-soft py-4">
            <div className="text-am-title font-semibold text-am-ink mb-2.5">{t("startups.competitiveDensity", { defaultValue: "Competitive density" })}</div>
            <Segmented label={tt("density", "Competitive density")} value={state.density} onChange={actions.setDensity}
              options={[
                { value: "all" as const, label: tt("all", "All") },
                { value: "crowded" as const, label: tt("crowded", "Crowded") },
                { value: "blue-ocean" as const, label: tt("blueOcean", "Blue ocean") },
              ]} />
          </div>
          <div className="py-4">
            <div className="text-am-title font-semibold text-am-ink mb-2.5">{tt("profileUpdated", "Profile updated")}</div>
            <Segmented label={tt("profileUpdated", "Profile updated")} value={state.updatedWithinDays} onChange={actions.setUpdatedWithinDays}
              options={[
                { value: null, label: tt("anyTime", "Any time") },
                { value: 30, label: tt("last30", "Last 30 days") },
                { value: 7, label: tt("last7", "Last 7 days") },
              ]} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-3.5 border-t border-am-line bg-am-surface">
          <button type="button" onClick={actions.clearAll} className="text-am-body font-medium text-am-ink-3 hover:text-am-ink">
            {tt("clearAll", "Clear all")}
          </button>
          <button type="button" onClick={() => onOpenChange(false)}
            className="h-9 px-4 rounded-am-ctl bg-am-ink text-white text-am-body font-semibold hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/60">
            {tt("showCompanies", "Show {{count}} companies", { count: totalCount.toLocaleString() })}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
