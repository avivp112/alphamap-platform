import React from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2, Download, Globe, Layers, Loader2, MapPin, MoreHorizontal, Calendar, Star, Webhook, X, XCircle,
} from "lucide-react";
import type { MatchScoreResult, StartupListRow } from "../../../lib/supabase";
import { daysSince, formatUsdShort, freshnessLabel, isStale, trendView } from "../../../lib/startupFilters";
import { CompanyLogo } from "../CompanyLogo";
import { DeepenProfileButton } from "../DeepenProfileButton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { useV2T } from "./filterTypes";

export interface TearsheetTabDef { id: string; label: string }

type Busy = "idle" | "busy" | "done";

/**
 * The redesigned top of a company card: identity, one primary action (Save), a
 * menu for the rest, the four numbers an analyst looks for first, how fresh the
 * profile is, and the section tabs. Shown instead of the older header when the
 * redesigned page is on (?ui=2). It owns no data and no side effects: the card
 * passes in what to show and what each button does.
 */
export function TearsheetHeader({
  startup, website, location, origin, founded, statusBadge, roundLabel, acquiredNote,
  saved, onSave, onClose, onPass, onLookalikes, onDownload, downloadState, downloadDisabled,
  onSyncCrm, crmState, crmNotice, match, matchLoading, tabs, activeTab, onTab,
}: {
  startup: StartupListRow;
  website: string | null;
  location: string | null;
  origin: string | null;
  founded: number | null;
  /** "Acquired" / "Majority acquired" when the record is an exit; replaces the stage chip. */
  statusBadge: string | null;
  roundLabel: string | null;
  acquiredNote: string | null;
  saved: boolean;
  onSave: () => void;
  onClose: () => void;
  onPass: () => void;
  onLookalikes: () => void;
  onDownload: () => void;
  downloadState: Busy;
  downloadDisabled: boolean;
  onSyncCrm: () => void;
  crmState: Busy;
  /** Short message under the header: "set up a webhook first" or a sync error. */
  crmNotice: React.ReactNode | null;
  match: MatchScoreResult | undefined;
  matchLoading: boolean;
  tabs: TearsheetTabDef[];
  activeTab: string;
  onTab: (id: string) => void;
}) {
  const { t } = useTranslation();
  const tt = useV2T();
  const days = daysSince(startup.updated_at);
  const trend = trendView(startup.growth_trend);
  const href = website ? (website.startsWith("http") ? website : `https://${website}`) : null;

  const itemCls = "flex items-center gap-2.5 px-3 py-2 text-am-body text-am-ink rounded-md cursor-pointer focus:bg-am-canvas";

  return (
    <div className="flex-none bg-am-surface border-b border-am-line">
      <div className="flex items-start justify-between gap-4 px-4 sm:px-6 pt-5 pb-4">
        <div className="flex items-center gap-4 min-w-0">
          <CompanyLogo name={startup.name} website={website} size={56} rounded="rounded-xl" />
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-am-display font-semibold text-am-ink tracking-tight truncate max-w-full">{startup.name}</h2>
              {statusBadge ? (
                <span className="px-2.5 py-0.5 rounded-full bg-am-ink text-white text-am-caption font-medium">{statusBadge}</span>
              ) : roundLabel ? (
                <span className="px-2.5 py-0.5 rounded-full border border-am-line bg-am-canvas text-am-caption font-medium text-am-ink-2">{roundLabel}</span>
              ) : null}
            </div>
            <div className="mt-1.5 flex items-center flex-wrap gap-x-3 gap-y-1 text-am-body text-am-ink-3">
              {location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 flex-none" aria-hidden="true" />{location}</span>}
              {origin && <span>{origin}</span>}
              {founded && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5 flex-none" aria-hidden="true" />{tt("founded", "Founded {{year}}", { year: founded })}</span>}
              {acquiredNote && <span className="font-medium text-am-ink-2">{acquiredNote}</span>}
              {href && (
                <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 hover:text-am-accent transition-colors">
                  <Globe className="w-3.5 h-3.5 flex-none" aria-hidden="true" />{tt("website", "Website")}
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-none">
          <button type="button" onClick={onSave} aria-pressed={saved}
            className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-am-ctl text-am-body font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/50 ${
              saved ? "bg-am-surface border border-am-line text-am-ink hover:bg-am-canvas" : "bg-am-ink border border-am-ink text-white hover:bg-slate-800"}`}>
            <Star className={`w-4 h-4 ${saved ? "fill-am-star text-am-star" : ""}`} aria-hidden="true" />
            {saved ? tt("saved", "Saved") : tt("saveToWatchlist", "Save to watchlist")}
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={tt("moreActions", "More actions")}
                className="grid place-items-center w-9 h-9 rounded-am-ctl border border-am-line bg-am-surface text-am-ink-2 hover:bg-am-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/50">
                <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[240px] p-1.5 rounded-am-card border border-am-line bg-am-surface shadow-am-2 z-[80]">
              <DropdownMenuItem className={itemCls} onSelect={onLookalikes}>
                <Layers className="w-4 h-4 text-am-ink-3" aria-hidden="true" />{t("startups.lookalikes")}
              </DropdownMenuItem>
              <DropdownMenuItem className={itemCls} disabled={downloadDisabled || downloadState === "busy"} onSelect={onDownload}>
                {downloadState === "busy" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  : downloadState === "done" ? <CheckCircle2 className="w-4 h-4 text-am-pos" aria-hidden="true" />
                  : <Download className="w-4 h-4 text-am-ink-3" aria-hidden="true" />}
                {downloadState === "done" ? t("startups.downloaded") : tt("downloadTearSheet", "Download tear sheet (PDF)")}
              </DropdownMenuItem>
              <DropdownMenuItem className={itemCls} disabled={crmState === "busy"} onSelect={onSyncCrm}>
                {crmState === "busy" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  : crmState === "done" ? <CheckCircle2 className="w-4 h-4 text-am-pos" aria-hidden="true" />
                  : <Webhook className="w-4 h-4 text-am-ink-3" aria-hidden="true" />}
                {crmState === "done" ? t("startups.synced") : t("startups.syncToCrm")}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1.5 bg-am-line" />
              <DropdownMenuItem className={`${itemCls} text-am-neg focus:text-am-neg`} onSelect={onPass}>
                <XCircle className="w-4 h-4" aria-hidden="true" />{tt("passOnCompany", "Pass on this company…")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button type="button" onClick={onClose} aria-label={t("common.close")}
            className="grid place-items-center w-9 h-9 rounded-full text-am-ink-3 hover:bg-am-canvas hover:text-am-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/50">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* The four numbers an analyst reads first. */}
      <dl className="grid grid-cols-2 md:grid-cols-4 border-t border-am-line">
        <Kpi label={tt("kpiValuation", "Valuation")} tag={startup.latest_round_is_estimated && startup.latest_valuation ? "Est." : undefined}
          value={startup.latest_valuation ? formatUsdShort(startup.latest_valuation) : "—"} />
        <Kpi label={tt("kpiRaised", "Total raised")} value={startup.total_raised ? formatUsdShort(startup.total_raised) : "—"} />
        <Kpi label={tt("kpiHeadcount", "Headcount")} value={startup.employee_count != null ? startup.employee_count.toLocaleString() : "—"}
          note={trend.tone !== "none" ? `${trend.arrow} ${trend.label}` : undefined}
          noteCls={trend.tone === "pos" ? "text-am-pos" : trend.tone === "neg" ? "text-am-neg" : "text-am-ink-3"} />
        <Kpi label={tt("kpiMatch", "Match to your mandate")} last
          value={match ? String(Math.round(match.match_pct)) : matchLoading ? "…" : "—"}
          note={match ? "/ 100" : undefined} noteCls="text-am-ink-3" />
      </dl>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 sm:px-6 py-2.5 border-t border-am-line bg-am-canvas text-am-caption text-am-ink-3">
        <span className={isStale(days) ? "text-am-warn font-medium" : ""}>
          {days == null ? tt("updatedUnknown", "Profile update date unknown")
            : days === 0 ? tt("updatedToday", "Profile updated today")
            : tt("updatedAgo", "Profile updated {{ago}} ago", { ago: freshnessLabel(days) })}
        </span>
        {startup.latest_round_is_estimated && startup.latest_valuation ? <span>{tt("valuationEstimated", "Valuation is estimated")}</span> : null}
        {/* Shown only when the profile is thin or old (company-check decides). */}
        <DeepenProfileButton startupId={startup.id} variant="chip" />
        {crmNotice && <span className="text-am-ink-2" role="status">{crmNotice}</span>}
      </div>

      <div role="tablist" aria-label={tt("sections", "Sections")} className="flex items-center overflow-x-auto px-3 sm:px-5 border-t border-am-line" style={{ scrollbarWidth: "none" }}>
        {tabs.map((tab) => {
          const on = tab.id === activeTab;
          return (
            <button key={tab.id} type="button" role="tab" aria-selected={on} onClick={() => onTab(tab.id)}
              className={`relative flex-none px-3.5 py-3 text-am-body whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/50 ${on ? "font-semibold text-am-ink" : "font-medium text-am-ink-3 hover:text-am-ink"}`}>
              {tab.label}
              {on && <span className="absolute bottom-0 inset-x-2 h-0.5 rounded-full bg-am-ink" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({ label, value, tag, note, noteCls, last }: {
  label: string; value: string; tag?: string; note?: string; noteCls?: string; last?: boolean;
}) {
  return (
    <div className={`px-4 sm:px-6 py-3.5 ${last ? "" : "md:border-e border-am-line"} border-b md:border-b-0 border-am-line-soft`}>
      <dt className="flex items-center gap-1.5 text-am-caption text-am-ink-3">
        {label}
        {tag && <span className="px-1 rounded border border-am-line text-[11px] text-am-ink-3">{tag}</span>}
      </dt>
      <dd className="mt-0.5 flex items-baseline gap-2 text-am-kpi font-semibold text-am-ink tabular-nums tracking-tight">
        {value}
        {note && <span className={`text-am-caption font-medium ${noteCls ?? ""}`}>{note}</span>}
      </dd>
    </div>
  );
}
