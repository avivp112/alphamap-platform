import React from "react";
import { Star, Zap } from "lucide-react";
import {
  CHECK_BUCKETS, FUND_BUCKETS, REGIONS, toggleIn, type Region, type VcFilterState,
} from "../../../lib/vcFirms";
import { FilterTrigger } from "../startups/FilterBar";
import { Chips } from "../deals/DealsFilterBar";
import { useVcT } from "./useVcT";

export interface VcFilterActions {
  setStages: (v: string[]) => void;
  setSectors: (v: string[]) => void;
  setRegions: (v: Region[]) => void;
  setCheckIds: (v: string[]) => void;
  setFundIds: (v: string[]) => void;
  setRaising: (v: boolean) => void;
  setFollowing: (v: boolean) => void;
  /** Remove one filter by its chip id. */
  clearOne: (id: string) => void;
  clearAll: () => void;
}

const summary = (n: number, one: string) => (n === 0 ? "" : n === 1 ? one : String(n));

function Toggle({ on, onClick, icon, label, disabled, title }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean; title?: string }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled && !on} title={title} onClick={onClick}
      className={`inline-flex flex-none items-center gap-1.5 h-9 px-3 rounded-am-ctl border text-am-body font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40 disabled:opacity-50 disabled:cursor-not-allowed ${
        on ? "border-am-accent bg-am-accent-soft text-am-accent" : "border-am-line bg-am-surface text-am-ink-2 hover:border-am-ink-3 hover:text-am-ink"}`}>
      {icon}{label}
    </button>
  );
}

/** Filters of the VCs page. Stage and sector options come from the data, so a name the data uses is always offered. */
export function VcsFilterBar({ state, actions, stageOptions, sectorOptions, raisingAvailable, followingAvailable }: {
  state: VcFilterState;
  actions: VcFilterActions;
  stageOptions: string[];
  sectorOptions: { sector: string; count: number }[];
  raisingAvailable: boolean;
  followingAvailable: boolean;
}) {
  const tt = useVcT();
  const check = state.checkIds.map((id) => CHECK_BUCKETS.find((b) => b.id === id)?.label ?? "");
  const fund = state.fundIds.map((id) => FUND_BUCKETS.find((b) => b.id === id)?.label ?? "");
  return (
    <div className="flex flex-nowrap md:flex-wrap items-center gap-2 overflow-x-auto md:overflow-visible pb-1 md:pb-0" role="toolbar" aria-label={tt("filters", "Filters")}>
      <FilterTrigger label={tt("stage", "Stage")} summary={summary(state.stages.length, state.stages[0] ?? "")} width={300}>
        {stageOptions.length === 0 ? <p className="text-am-body text-am-ink-3">{tt("noStages", "No stages on record yet.")}</p> : (
          <Chips multi options={stageOptions.map((s) => ({ value: s, label: s }))} value={state.stages} onPick={(s) => actions.setStages(toggleIn(state.stages, s))} />
        )}
      </FilterTrigger>
      <FilterTrigger label={tt("sector", "Sector")} summary={summary(state.sectors.length, state.sectors[0] ?? "")} width={320}>
        {sectorOptions.length === 0 ? <p className="text-am-body text-am-ink-3">{tt("noSectors", "No sector data on record yet.")}</p> : (
          <div className="max-h-72 overflow-y-auto">
            <Chips multi options={sectorOptions.map((s) => ({ value: s.sector, label: `${s.sector} · ${s.count}` }))} value={state.sectors}
              onPick={(name) => actions.setSectors(toggleIn(state.sectors, name))} />
          </div>
        )}
      </FilterTrigger>
      <FilterTrigger label={tt("geography", "Geography")} summary={summary(state.regions.length, state.regions[0] ?? "")} width={300}>
        <Chips multi options={REGIONS.map((r) => ({ value: r as Region, label: r }))} value={state.regions} onPick={(r) => actions.setRegions(toggleIn(state.regions, r))} />
        <p className="mt-3 text-am-caption text-am-ink-3">{tt("geographyNote", "From the headquarters on record. Firms with an unrecognised or missing headquarters are not matched.")}</p>
      </FilterTrigger>
      <FilterTrigger label={tt("checkSize", "Check size")} summary={summary(state.checkIds.length, check[0] ?? "")} width={320}>
        <Chips multi options={CHECK_BUCKETS.map((b) => ({ value: b.id, label: b.label }))} value={state.checkIds} onPick={(id) => actions.setCheckIds(toggleIn(state.checkIds, id))} />
        <p className="mt-3 text-am-caption text-am-ink-3">{tt("checkNote", "A firm matches when its typical check overlaps the range.")}</p>
      </FilterTrigger>
      <FilterTrigger label={tt("fundSize", "Fund size")} summary={summary(state.fundIds.length, fund[0] ?? "")} width={320}>
        <Chips multi options={FUND_BUCKETS.map((b) => ({ value: b.id, label: b.label }))} value={state.fundIds} onPick={(id) => actions.setFundIds(toggleIn(state.fundIds, id))} />
      </FilterTrigger>
      <Toggle on={state.raisingOnly} onClick={() => actions.setRaising(!state.raisingOnly)} disabled={!raisingAvailable}
        title={raisingAvailable ? tt("raisingHint", "An SEC fund filing from the last 18 months that has sold less than it set out to raise") : tt("raisingNone", "No open fund offerings on record")}
        icon={<Zap className="w-3.5 h-3.5" aria-hidden="true" />} label={tt("raising", "Raising a fund")} />
      <Toggle on={state.followingOnly} onClick={() => actions.setFollowing(!state.followingOnly)} disabled={!followingAvailable}
        title={followingAvailable ? undefined : tt("followingEmpty", "Follow a firm to use this filter")}
        icon={<Star className={`w-3.5 h-3.5 ${state.followingOnly ? "fill-am-star text-am-star" : ""}`} aria-hidden="true" />} label={tt("followingOnly", "Following only")} />
    </div>
  );
}
