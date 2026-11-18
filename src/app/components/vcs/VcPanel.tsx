import React from "react";
import { ExternalLink, Loader2, Star, X } from "lucide-react";
import { AM_DONUT_RAMP, DonutFocusChart } from "../DonutFocusChart";
import { CompanyLogo } from "../CompanyLogo";
import { daysSince, freshnessLabel } from "../../../lib/startupFilters";
import { isOpenOffering, soldPercent, type FundFiling, type VcFirm } from "../../../lib/vcFirms";
import { fmtUsd } from "../../../lib/dealFeed";
import { useVcT } from "./useVcT";

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-am-title font-semibold text-am-ink mb-2.5">{title}</h3>
      {children}
    </section>
  );
}

/**
 * One firm, in the column beside the list. Shows what the directory row and the firm's SEC fund
 * filings say, and leaves out any section that has nothing to show.
 */
export function VcPanel({ firm, filings, recordUpdatedAt, onClose, following, followBusy, onToggleFollow }: {
  firm: VcFirm;
  filings: FundFiling[];
  recordUpdatedAt: string | null;
  onClose: () => void;
  following: boolean;
  followBusy: boolean;
  onToggleFollow: () => void;
}) {
  const tt = useVcT();
  const total = firm.sectors.reduce((s, x) => s + x.weight, 0);
  const legend = firm.sectors.map((x, i) => ({ ...x, pct: total > 0 ? Math.round((x.weight / total) * 100) : 0, color: AM_DONUT_RAMP[Math.min(i, AM_DONUT_RAMP.length - 1)] })).filter((x) => x.pct >= 4);
  const about = firm.thesis ?? firm.description;
  const days = daysSince(recordUpdatedAt);
  const now = Date.now();
  const href = firm.website ? (firm.website.startsWith("http") ? firm.website : `https://${firm.website}`) : null;
  const management = firm.leadership.filter((l) => l.group !== "board");
  const board = firm.leadership.filter((l) => l.group === "board");

  return (
    <div className="relative flex flex-col h-full rounded-am-card border border-am-line bg-am-surface shadow-am-1 overflow-y-auto">
      <div className="flex-none flex items-start justify-between gap-3 px-5 pt-4 pb-3.5">
        <div className="flex items-center gap-3.5 min-w-0">
          <CompanyLogo name={firm.name} website={firm.website} size={44} rounded="rounded-xl" />
          <div className="min-w-0">
            <h2 className="text-am-kpi font-semibold text-am-ink tracking-tight break-words">{firm.name}</h2>
            <div className="mt-0.5 text-am-body text-am-ink-3 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
              {firm.hq && <span>{firm.hq}</span>}
              {firm.foundedYear && <span>{tt("founded", "Founded {{year}}", { year: firm.foundedYear })}</span>}
              {href && (
                <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-am-accent">
                  {tt("website", "Website")}<ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          <button type="button" onClick={onToggleFollow} disabled={followBusy} aria-pressed={following}
            className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-am-ctl text-am-body font-semibold transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/50 ${
              following ? "bg-am-surface border border-am-line text-am-ink hover:bg-am-canvas" : "bg-am-ink border border-am-ink text-white hover:bg-slate-800"}`}>
            {followBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Star className={`w-4 h-4 ${following ? "fill-am-star text-am-star" : ""}`} aria-hidden="true" />}
            {following ? tt("following", "Following") : tt("followFirm", "Follow firm")}
          </button>
          <button type="button" onClick={onClose} aria-label={tt("close", "Close")}
            className="grid place-items-center w-9 h-9 rounded-full text-am-ink-3 hover:bg-am-canvas hover:text-am-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/50">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <dl className="flex-none grid grid-cols-3 border-y border-am-line">
        <div className="px-5 py-3 border-e border-am-line"><dt className="text-am-caption text-am-ink-3">{tt("fundSize", "Fund size")}</dt><dd className="text-am-kpi font-semibold tabular-nums">{firm.fundSizeLabel ?? "—"}</dd></div>
        <div className="px-5 py-3 border-e border-am-line"><dt className="text-am-caption text-am-ink-3">{tt("typicalCheck", "Typical check")}</dt><dd className="text-am-kpi font-semibold tabular-nums">{firm.checkLabel ?? "—"}</dd></div>
        <div className="px-5 py-3"><dt className="text-am-caption text-am-ink-3">{tt("portfolio", "Portfolio, reported")}</dt><dd className="text-am-kpi font-semibold tabular-nums">{firm.portfolio != null ? firm.portfolio.toLocaleString() : "—"}</dd></div>
      </dl>
      {days != null && (
        <div className="flex-none px-5 py-1.5 bg-am-canvas border-b border-am-line text-am-caption text-am-ink-3">
          {days === 0 ? tt("updatedToday", "Record updated today") : tt("updatedAgo", "Record updated {{ago}} ago", { ago: freshnessLabel(days) })}
        </div>
      )}

      <div className="px-5 py-5 space-y-6">
        {about && <Section title={firm.thesis ? tt("thesis", "Thesis") : tt("about", "About")}><p className="text-am-body text-am-ink-2 leading-relaxed">{about}</p></Section>}

        {firm.stages.length > 0 && (
          <Section title={tt("stages", "Stages")}>
            <div className="flex flex-wrap gap-1.5">{firm.stages.map((s) => (
              <span key={s} className="px-3 py-1 rounded-full border border-am-line bg-am-canvas text-am-caption font-medium text-am-ink-2">{s}</span>
            ))}</div>
          </Section>
        )}

        {legend.length > 0 && (
          <Section title={tt("sectors", "Sectors")}>
            <div className="grid grid-cols-[190px_1fr] items-center gap-4">
              <DonutFocusChart variant="am" data={firm.sectors} accentColor="#2F5BD9" height={190} />
              <ul className="min-w-0">
                {legend.map((x) => (
                  <li key={x.sector} className="flex items-center justify-between gap-3 py-1.5 border-t border-am-line-soft first:border-t-0 text-am-body">
                    <span className="inline-flex items-center gap-2 min-w-0"><i className="w-2.5 h-2.5 rounded-[3px] flex-none" style={{ background: x.color }} aria-hidden="true" /><span className="truncate text-am-ink-2">{x.sector}</span></span>
                    <span className="tabular-nums font-medium">{x.pct}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        )}

        {filings.length > 0 && (
          <Section title={tt("fundFilings", "Fund filings (SEC Form D)")}>
            <ul>
              {filings.slice(0, 5).map((f) => {
                const pct = soldPercent(f);
                const open = isOpenOffering(f, now);
                return (
                  <li key={`${f.name}-${f.filedOn}`} className="py-2.5 border-t border-am-line-soft first:border-t-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{f.name}</span>
                        {open && <span className="flex-none px-2 py-0.5 rounded-full bg-am-accent-soft text-am-accent text-[11px] font-medium">{tt("open", "Open")}</span>}
                      </div>
                      <span className="text-am-caption text-am-ink-3 whitespace-nowrap">{tt("filedOn", "Filed {{date}}", { date: fmtDate(f.filedOn) })}</span>
                    </div>
                    {f.sold != null && f.offering != null && f.offering > 0 && (
                      <div className="mt-1.5 flex items-center gap-3">
                        <span className="flex-1 h-1 rounded-full bg-am-line" aria-hidden="true"><span className="block h-1 rounded-full bg-am-ink" style={{ width: `${pct ?? 0}%` }} /></span>
                        <span className="text-am-caption text-am-ink-2 tabular-nums whitespace-nowrap">{fmtUsd(f.sold)} {tt("ofOffering", "of {{amount}}", { amount: fmtUsd(f.offering) })}</span>
                      </div>
                    )}
                    {f.url && <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 text-am-caption text-am-accent hover:underline">{tt("secFiling", "SEC filing")}<ExternalLink className="w-3 h-3" aria-hidden="true" /></a>}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {firm.notable.length > 0 && (
          <Section title={tt("notable", "Notable investments")}>
            <div className="flex flex-wrap gap-1.5">{firm.notable.map((n) => (
              <span key={n} className="px-3 py-1 rounded-full border border-am-line bg-am-canvas text-am-caption font-medium text-am-ink-2">{n}</span>
            ))}</div>
          </Section>
        )}

        {firm.leadership.length > 0 && (
          <Section title={tt("people", "People")}>
            <ul>
              {[...management, ...board].slice(0, 8).map((l, i) => (
                <li key={`${l.name}-${i}`} className="flex items-baseline justify-between gap-4 py-2 border-t border-am-line-soft first:border-t-0">
                  <span className="font-medium">{l.name}</span>
                  <span className="text-am-ink-3 text-am-body text-end">{l.group === "board" ? `${l.role} · ${tt("board", "board")}` : l.role}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {!about && firm.stages.length === 0 && legend.length === 0 && filings.length === 0 && firm.notable.length === 0 && firm.leadership.length === 0 && (
          <p className="text-am-body text-am-ink-3">{tt("sparse", "This profile is still being filled in. What AlphaMap has so far is shown above.")}</p>
        )}
      </div>
    </div>
  );
}
