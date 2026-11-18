import React, { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Briefcase, CalendarClock, Plus, ScanSearch } from "lucide-react";
import { CompanyLogo } from "../CompanyLogo";
import { CheckCompanyDialog } from "../CheckCompanyDialog";
import { AddCompanyDialog } from "../crm/CrmTab";
import { updateCrmCompany } from "../../../lib/supabase";
import { CRM_STAGES, isOverdue, sortCrm, stageCounts, type CrmCompany, type CrmStage } from "../../../lib/crm";
import { displayDomain, emptyCheckForm, statusKey } from "../../../lib/companyCheck";
import { watchlistErrorMessage } from "../../../lib/watchlist";
import { EmptyState, ErrorLine, Spinner, StageChip } from "./AlphaBits";
import type { AlphaData } from "./useAlphaData";
import { useAlphaT } from "./useAlphaT";

const today = () => new Date().toISOString().slice(0, 10);
type View = "board" | "list";

function Card({ c, onMove }: { c: CrmCompany; onMove: (stage: CrmStage) => void }) {
  const tt = useAlphaT();
  const { t } = useTranslation();
  const website = c.startup?.website ?? c.website;
  const pending = c.check && c.check.status !== "done" && c.check.status !== "matched";
  const over = isOverdue(c.next_step_date, today());
  return (
    <article className="bg-am-surface border border-am-line rounded-am-card shadow-am-1 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <CompanyLogo name={c.name} website={website} size={28} rounded="rounded-lg" />
        <div className="min-w-0 flex-1">
          <Link to={`/crm/${c.id}`} className="block text-am-body font-semibold text-am-ink truncate hover:text-am-accent">{c.name}</Link>
          <p className="text-am-caption text-am-ink-3 truncate">{displayDomain(website) || "—"}</p>
        </div>
      </div>
      {pending && c.check && <p className="text-am-caption text-am-ink-2">{t(`companyCheck.status.${statusKey(c.check)}`)}</p>}
      {c.next_step && (
        <p className={`flex items-center gap-1.5 text-am-caption ${over ? "font-semibold text-am-neg" : "text-am-ink-3"}`}>
          <CalendarClock className="w-3.5 h-3.5 flex-none" aria-hidden="true" /><span className="truncate">{c.next_step}{c.next_step_date ? ` · ${c.next_step_date}` : ""}</span>
        </p>
      )}
      <label className="sr-only" htmlFor={`mv-${c.id}`}>{tt("moveTo", "Move {{name}} to", { name: c.name })}</label>
      <select id={`mv-${c.id}`} value={c.stage} onChange={(e) => onMove(e.target.value as CrmStage)}
        className="h-8 rounded-am-ctl border border-am-line bg-am-surface text-am-caption text-am-ink-2 px-2 focus:outline-none focus:ring-2 focus:ring-am-accent/30">
        {CRM_STAGES.map((s) => <option key={s} value={s}>{tt(`stage_${s}`, s.replace("_", " "))}</option>)}
      </select>
    </article>
  );
}

export function CrmBoard({ data }: { data: AlphaData }) {
  const tt = useAlphaT();
  const { t } = useTranslation();
  const [view, setView] = useState<View>("board");
  const [stage, setStage] = useState<CrmStage | "all">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [check, setCheck] = useState<{ name: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const counts = useMemo(() => stageCounts(data.crm), [data.crm]);
  const sorted = useMemo(() => sortCrm(data.crm, today()), [data.crm]);

  async function move(c: CrmCompany, to: CrmStage) {
    const before = data.crm;
    data.setCrm((all) => all.map((x) => (x.id === c.id ? { ...x, stage: to } : x)));
    try { await updateCrmCompany(c.id, { stage: to }); } catch (e) { data.setCrm(before); setProblem(watchlistErrorMessage(e)); }
  }

  if (data.loading) return <Spinner label={tt("loading", "Loading")} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 min-w-[240px] text-am-body text-am-ink-3">{t("crm.blurb")}</p>
        <div role="group" aria-label={tt("view", "View")} className="inline-flex p-0.5 rounded-am-ctl border border-am-line bg-am-surface">
          {(["board", "list"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={`h-8 px-3.5 rounded-[7px] text-am-body font-medium ${view === v ? "bg-am-ink text-white" : "text-am-ink-2 hover:text-am-ink"}`}>{tt(`view_${v}`, v === "board" ? "Board" : "List")}</button>
          ))}
        </div>
        <button type="button" onClick={() => setCheck({ name: "" })} className="h-9 inline-flex items-center gap-1.5 px-3.5 rounded-am-ctl border border-am-line bg-am-surface text-am-body font-medium text-am-ink hover:bg-am-canvas"><ScanSearch className="w-4 h-4" aria-hidden="true" />{t("companyCheck.open")}</button>
        <button type="button" onClick={() => setAddOpen(true)} className="h-9 inline-flex items-center gap-1.5 px-3.5 rounded-am-ctl bg-am-ink border border-am-ink text-white text-am-body font-semibold hover:bg-slate-800"><Plus className="w-4 h-4" aria-hidden="true" />{t("crm.add")}</button>
      </div>
      {problem && <ErrorLine message={problem} />}

      {data.crm.length === 0 ? (
        <EmptyState icon={<Briefcase className="w-8 h-8" />} title={t("crm.emptyTitle")} body={t("crm.emptyBlurb")} />
      ) : view === "board" ? (
        <div className="overflow-x-auto pb-2 -mx-1 px-1">
          <div className="flex gap-3 min-w-max items-start">
            {CRM_STAGES.map((s) => {
              const col = sorted.filter((c) => c.stage === s);
              return (
                <section key={s} aria-label={tt(`stage_${s}`, s)} className="w-[250px] flex-none rounded-am-card bg-am-canvas border border-am-line p-2.5 space-y-2.5">
                  <h2 className="flex items-center gap-2 px-1 text-am-body font-semibold text-am-ink">{tt(`stage_${s}`, s.replace("_", " "))}<span className="text-am-ink-3 font-medium tabular-nums">{counts[s]}</span></h2>
                  {col.map((c) => <Card key={c.id} c={c} onMove={(to) => move(c, to)} />)}
                  {col.length === 0 && <p className="px-1 py-3 text-am-caption text-am-ink-3">{tt("colEmpty", "Nothing here")}</p>}
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={tt("stage", "Stage")}>
            {(["all", ...CRM_STAGES] as const).map((s) => (
              <button key={s} type="button" aria-pressed={stage === s} onClick={() => setStage(s)}
                className={`h-8 px-3.5 rounded-full border whitespace-nowrap text-am-caption font-medium ${stage === s ? "bg-am-ink border-am-ink text-white" : "bg-am-surface border-am-line text-am-ink-2 hover:border-am-ink-3"}`}>
                {s === "all" ? t("crm.all") : tt(`stage_${s}`, s.replace("_", " "))} <span className="opacity-60 tabular-nums">{counts[s]}</span>
              </button>
            ))}
          </div>
          <ul className="bg-am-surface border border-am-line rounded-am-card shadow-am-1 overflow-hidden divide-y divide-am-line-soft">
            {sorted.filter((c) => stage === "all" || c.stage === stage).map((c) => {
              const website = c.startup?.website ?? c.website;
              const over = isOverdue(c.next_step_date, today());
              return (
                <li key={c.id}>
                  <Link to={`/crm/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-am-canvas">
                    <CompanyLogo name={c.name} website={website} size={32} rounded="rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-am-body font-semibold text-am-ink truncate">{c.name}</span>
                      <span className="block text-am-caption text-am-ink-3 truncate">
                        {displayDomain(website)}
                        {c.next_step && <span className={over ? "font-semibold text-am-neg" : ""}>{displayDomain(website) ? " · " : ""}{c.next_step}{c.next_step_date ? ` · ${c.next_step_date}` : ""}</span>}
                      </span>
                    </span>
                    <StageChip stage={c.stage} label={tt(`stage_${c.stage}`, c.stage.replace("_", " "))} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {addOpen && <AddCompanyDialog onClose={() => setAddOpen(false)} onCheck={(name) => { setAddOpen(false); setCheck({ name }); }} />}
      {check && <CheckCompanyDialog initial={{ ...emptyCheckForm(), name: check.name }} onClose={() => setCheck(null)} />}
    </div>
  );
}
