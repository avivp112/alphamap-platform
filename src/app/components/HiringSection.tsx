// The hiring section of a company's profile (Talent & Growth tab).
//
// Everything here comes from startup_hiring (migration 20261029000000), which
// reads only job boards VERIFIED to be the company's own (worker/boards.ts):
// linked from its website, naming its website, or giving its domain. A board
// matched by name alone is never shown, so a company with no verified board
// shows that, and nothing else.
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Briefcase, ExternalLink, Loader2 } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend,
} from "recharts";
import { fetchStartupHiring, boardUrl, type StartupHiring } from "../../lib/supabase";

const PROVIDER_LABEL: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workable: "Workable", comeet: "Comeet" };

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

function Heading({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{children}</h4>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[8px] p-4 flex flex-col gap-1.5 border bg-gray-50 border-gray-100">
      <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
      <span className="text-sm font-bold text-gray-900">{value.toLocaleString()}</span>
    </div>
  );
}

/** A labelled bar per row: departments, seniority, technologies. */
function Bars({ rows }: { rows: Array<{ label: string; n: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[11px]">
          <span className="w-32 sm:w-40 truncate text-gray-600" title={r.label}>{r.label}</span>
          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-[#0e7490]" style={{ width: `${(r.n / max) * 100}%` }} />
          </div>
          <span className="w-8 text-right font-semibold text-gray-700 tabular-nums">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

export function HiringSection({ startupId, load = fetchStartupHiring }: {
  startupId: string;
  /** For previews and tests; the profile uses the database. */
  load?: (startupId: string) => Promise<StartupHiring>;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<StartupHiring | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null); setError(false);
    load(startupId)
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load is fixed for a mounted section
  }, [startupId]);

  const header = (
    <div className="flex items-center gap-2 mb-3">
      <Briefcase className="w-4 h-4 text-gray-400" />
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t("startups.hiring.title")}</h3>
    </div>
  );

  if (error) return <div>{header}<p className="text-xs text-gray-400">{t("startups.hiring.loadError")}</p></div>;
  if (!data) return <div>{header}<Loader2 className="w-4 h-4 animate-spin text-gray-300" /></div>;
  if (!data.has_board) {
    return <div>{header}<p className="text-xs text-gray-400 leading-relaxed">{t("startups.hiring.noBoard")}</p></div>;
  }

  const chart = data.timeline.map((w) => ({
    week: new Date(w.week).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    open: w.open, new: w.new, closed: w.closed,
  }));

  return (
    <div>
      {header}
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t("startups.hiring.openRoles")} value={data.open_roles} />
          <Stat label={t("startups.hiring.new30d")} value={data.new_roles_30d} />
          <Stat label={t("startups.hiring.closedSince")} value={data.closed_since_tracking} />
        </div>
        <p className="text-[10px] text-gray-400 -mt-2">{t("startups.hiring.newExplained")}</p>

        <div className="bg-gray-50 border border-gray-100 rounded-[8px] p-4">
          <Heading>{t("startups.hiring.timeline")}</Heading>
          {chart.length >= 2 ? (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="week" tick={{ fill: "#9CA3AF", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: "#9CA3AF", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <ReTooltip
                    contentStyle={{ background: "#0b1626", border: "1px solid #1a2a3f", borderRadius: 8, fontSize: 11 }}
                    labelStyle={{ color: "#94a3b8" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                  <Bar isAnimationActive={false} dataKey="new" name={t("startups.hiring.seriesNew")} fill="#10b981" radius={[2, 2, 0, 0]} />
                  <Bar isAnimationActive={false} dataKey="closed" name={t("startups.hiring.seriesClosed")} fill="#cbd5e1" radius={[2, 2, 0, 0]} />
                  <Line isAnimationActive={false} type="monotone" dataKey="open" name={t("startups.hiring.seriesOpen")} stroke="#0e7490" strokeWidth={1.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-[11px] text-gray-400">{t("startups.hiring.timelineTooShort", { date: day(data.tracking_since) })}</p>
          )}
        </div>

        {data.open_roles === 0 ? (
          <p className="text-xs text-gray-400">{t("startups.hiring.noOpenRoles")}</p>
        ) : (
          <>
            {data.by_department.length > 0 && (
              <div>
                <Heading>{t("startups.hiring.byDepartment")}</Heading>
                <Bars rows={data.by_department.slice(0, 10).map((d) => ({ label: d.department, n: d.open }))} />
                {data.departments_known < data.open_roles && (
                  <p className="text-[10px] text-gray-400 mt-1.5">
                    {t("startups.hiring.departmentsPartial", { known: data.departments_known, total: data.open_roles })}
                  </p>
                )}
              </div>
            )}

            {(data.seniority.length > 0 || data.tech.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {data.seniority.length > 0 && (
                  <div>
                    <Heading>{t("startups.hiring.seniority")}</Heading>
                    <Bars rows={data.seniority.map((s) => ({ label: s.value, n: s.open }))} />
                  </div>
                )}
                {data.tech.length > 0 && (
                  <div>
                    <Heading>{t("startups.hiring.tech")}</Heading>
                    <div className="flex flex-wrap gap-1.5">
                      {data.tech.map((s) => (
                        <span key={s.value} className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-gray-200 bg-white text-gray-600">
                          {s.value} <span className="text-gray-400">{s.open}</span>
                        </span>
                      ))}
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1.5">{t("startups.hiring.fromTitles")}</p>
                  </div>
                )}
              </div>
            )}

            <div>
              <Heading>{t("startups.hiring.latest")}</Heading>
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded-[8px] bg-white">
                {data.latest.map((j) => (
                  <li key={j.url} className="px-3 py-2 flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <a href={j.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs font-semibold text-[#0F172A] hover:underline inline-flex items-center gap-1 max-w-full">
                        <span className="truncate">{j.title}</span>
                        <ExternalLink className="w-3 h-3 flex-none text-gray-400" />
                      </a>
                      <div className="text-[10px] text-gray-400 truncate">
                        {[j.department, j.location, day(j.first_seen_at)].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {j.is_new && (
                      <span className="flex-none text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full border text-emerald-700 bg-emerald-50 border-emerald-200">
                        {t("startups.hiring.newBadge")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        <div className="text-[10px] text-gray-400 space-y-0.5">
          {data.sources.map((s) => {
            const url = boardUrl(s.provider, s.token);
            const method = s.verified_by ? t(`startups.hiring.method_${s.verified_by}`, { defaultValue: s.verified_by }) : null;
            return (
              <div key={`${s.provider}/${s.token}`}>
                {t("startups.hiring.source")}:{" "}
                {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600">{PROVIDER_LABEL[s.provider] ?? s.provider}</a>
                  : (PROVIDER_LABEL[s.provider] ?? s.provider)}
                {" · "}{t("startups.hiring.lastChecked", { date: day(s.last_crawled_at) })}
                {" · "}{t("startups.hiring.trackingSince", { date: day(s.tracking_since) })}
                {method && <>{" · "}{t("startups.hiring.verifiedBy", { method })}</>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
