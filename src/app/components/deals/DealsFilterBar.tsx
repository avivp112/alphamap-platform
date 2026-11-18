import React from "react";
import { Star } from "lucide-react";
import {
  DEAL_SECTORS, FILED_WINDOWS, SOLD_PRESETS, toggleSector, type DealFilterState, type DealStatusFilter,
} from "../../../lib/dealFilters";
import { rangeIsActive, rangeLabel, type MoneyRange } from "../../../lib/startupFilters";
import type { DealKind } from "../../../lib/dealFeed";
import { FilterTrigger } from "../startups/FilterBar";
import { RangePanel } from "../startups/FilterPanels";
import { useDealsT } from "./useDealsT";

export interface DealFilterActions {
  setSectors: (v: string[]) => void;
  setFiled: (v: number | null) => void;
  setSold: (v: MoneyRange) => void;
  setStatus: (v: DealStatusFilter) => void;
  setFollowing: (v: boolean) => void;
  /** Remove one filter by its chip id. */
  clearOne: (id: string) => void;
  clearAll: () => void;
}

const chipBase = "px-3 py-1.5 rounded-full text-am-caption font-medium border transition-colors";
const chipOn = "bg-am-accent-soft border-am-accent text-am-accent";
const chipOff = "bg-am-surface border-am-line text-am-ink-2 hover:border-am-ink-3";

export function Chips<T extends string | number | null>({ options, value, onPick, multi }: {
  options: readonly { value: T; label: string }[];
  value: readonly T[];
  onPick: (v: T) => void;
  multi?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={String(o.value)} type="button" aria-pressed={on} onClick={() => onPick(o.value)} className={`${chipBase} ${on ? chipOn : chipOff}`}>
            {multi && on ? "✓ " : ""}{o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The filters of the Deals page: popovers for the four that narrow the list, one toggle for the watchlist. */
export function DealsFilterBar({ kind, state, actions, followingAvailable }: {
  kind: DealKind;
  state: DealFilterState;
  actions: DealFilterActions;
  /** False when the user has nothing on the watchlist to filter by. */
  followingAvailable: boolean;
}) {
  const tt = useDealsT();
  const sectorSummary = state.sectors.length === 0 ? "" : state.sectors.length === 1 ? state.sectors[0] : String(state.sectors.length);
  const filedSummary = state.filedWithinDays != null ? tt("lastNDays", "Last {{count}} days", { count: state.filedWithinDays }) : "";
  const statusSummary = state.status === "all" ? "" : state.status === "verified"
    ? (kind === "fund" ? tt("inAlphaMap", "In AlphaMap") : tt("verified", "Verified"))
    : (kind === "fund" ? tt("newFirm", "New firm") : tt("unreviewed", "Not reviewed"));

  return (
    <div className="flex flex-nowrap md:flex-wrap items-center gap-2 overflow-x-auto md:overflow-visible pb-1 md:pb-0" role="toolbar" aria-label={tt("filters", "Filters")}>
      {kind === "company" && (
        <FilterTrigger label={tt("sector", "Sector")} summary={sectorSummary} width={300}>
          <Chips multi options={DEAL_SECTORS.map((s) => ({ value: s as string, label: s }))} value={state.sectors}
            onPick={(s) => actions.setSectors(toggleSector(state.sectors, s))} />
        </FilterTrigger>
      )}
      <FilterTrigger label={tt("filed", "Filed")} summary={filedSummary} width={300}>
        <Chips
          options={[{ value: null as number | null, label: tt("anyTime", "Any time") },
            ...FILED_WINDOWS.map((d) => ({ value: d as number | null, label: tt("lastNDays", "Last {{count}} days", { count: d }) }))]}
          value={[state.filedWithinDays]} onPick={(v) => actions.setFiled(v)} />
      </FilterTrigger>
      <FilterTrigger label={tt("amountSold", "Amount sold")} summary={rangeIsActive(state.sold) ? rangeLabel(state.sold) : ""} width={340}>
        <RangePanel value={state.sold} onChange={actions.setSold} presets={SOLD_PRESETS} allowUnknown={false} />
      </FilterTrigger>
      <FilterTrigger label={kind === "fund" ? tt("firmStatus", "Firm") : tt("status", "Status")} summary={statusSummary} width={280}>
        <Chips
          options={[
            { value: "all" as DealStatusFilter, label: tt("all", "All") },
            { value: "verified" as DealStatusFilter, label: kind === "fund" ? tt("inAlphaMap", "In AlphaMap") : tt("verified", "Verified") },
            { value: "unreviewed" as DealStatusFilter, label: kind === "fund" ? tt("newFirm", "New firm") : tt("unreviewed", "Not reviewed") },
          ]}
          value={[state.status]} onPick={(v) => actions.setStatus(v)} />
      </FilterTrigger>

      <button type="button" aria-pressed={state.followingOnly} disabled={!followingAvailable && !state.followingOnly}
        title={followingAvailable ? undefined : tt("followingEmpty", "Follow a company to use this filter")}
        onClick={() => actions.setFollowing(!state.followingOnly)}
        className={`inline-flex flex-none items-center gap-1.5 h-9 px-3 rounded-am-ctl border text-am-body font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40 disabled:opacity-50 disabled:cursor-not-allowed ${
          state.followingOnly ? "border-am-accent bg-am-accent-soft text-am-accent" : "border-am-line bg-am-surface text-am-ink-2 hover:border-am-ink-3 hover:text-am-ink"}`}>
        <Star className={`w-3.5 h-3.5 ${state.followingOnly ? "fill-am-star text-am-star" : ""}`} aria-hidden="true" />
        {tt("followingOnly", "Following only")}
      </button>
    </div>
  );
}
