import React from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Layout } from "../components/Layout";
import { useAlphaData } from "../components/alpha/useAlphaData";
import { useAlphaT } from "../components/alpha/useAlphaT";
import { BenchTab } from "../components/alpha/BenchTab";
import { JournalTab } from "../components/alpha/JournalTab";
import { WatchlistTab } from "../components/alpha/WatchlistTab";
import { MatchesTab } from "../components/alpha/MatchesTab";
import { AlertsTab } from "../components/alpha/AlertsTab";
import { CrmBoard } from "../components/alpha/CrmBoard";
import { ErrorLine } from "../components/alpha/AlphaBits";

const TAB_IDS = ["bench", "journal", "watchlist", "matches", "alerts", "crm"] as const;
type TabId = (typeof TAB_IDS)[number];
const TAB_LABEL: Record<TabId, string> = { bench: "Bench", journal: "Journal", watchlist: "Watchlist", matches: "Thesis Matches", alerts: "Live Alerts", crm: "CRM" };

function tabFrom(param: string | null): TabId {
  if (param === "checks") return "crm"; // the CRM's old name
  return (TAB_IDS as readonly string[]).includes(param ?? "") ? (param as TabId) : "bench";
}

/** "Your Alpha": the Bench, the Journal and the four lists behind them. Behind ?ui=2. */
export function MyAreaRedesign() {
  const tt = useAlphaT();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = tabFrom(params.get("tab"));
  const data = useAlphaData();

  function go(next: string) {
    const id = tabFrom(next);
    setParams((p) => { if (id === "bench") p.delete("tab"); else p.set("tab", id); return p; }, { preventScrollReset: true });
  }

  const count: Partial<Record<TabId, number>> = {
    watchlist: data.watchlist.startups.length + data.watchlist.investors.length,
    crm: data.crm.length,
    alerts: data.unread,
  };

  return (
    <Layout>
      <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 pt-6 pb-12">
        <header className="mb-5">
          <h1 className="text-am-display font-bold tracking-tight text-am-ink">{t("myArea.title")}</h1>
          <p className="mt-1 text-am-body text-am-ink-3">{t("myArea.subtitle")}</p>
        </header>

        <div role="tablist" aria-label={t("myArea.title")} className="flex gap-1 border-b border-am-line mb-6 overflow-x-auto -mx-1 px-1">
          {TAB_IDS.map((id) => {
            const on = tab === id;
            const n = count[id];
            return (
              <button key={id} role="tab" id={`alpha-tab-${id}`} aria-selected={on} aria-controls="alpha-panel" type="button" onClick={() => go(id)}
                className={`relative h-11 px-4 whitespace-nowrap text-am-body font-semibold -mb-px border-b-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40 rounded-t ${on ? "border-am-ink text-am-ink" : "border-transparent text-am-ink-3 hover:text-am-ink"}`}>
                {tt(`tab_${id}`, TAB_LABEL[id])}
                {n != null && n > 0 && <span className={`ms-1.5 tabular-nums text-am-caption ${id === "alerts" && !on ? "text-am-accent font-semibold" : "text-am-ink-3 font-medium"}`}>{n}</span>}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id="alpha-panel" aria-labelledby={`alpha-tab-${tab}`}>
          {data.error && <div className="mb-4"><ErrorLine message={data.error} /></div>}
          {tab === "bench" && <BenchTab data={data} onTab={go} />}
          {tab === "journal" && <JournalTab data={data} />}
          {tab === "watchlist" && <WatchlistTab data={data} />}
          {tab === "matches" && <MatchesTab data={data} />}
          {tab === "alerts" && <AlertsTab data={data} />}
          {tab === "crm" && <CrmBoard data={data} />}
        </div>
      </div>
    </Layout>
  );
}
