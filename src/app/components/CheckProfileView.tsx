import React from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Users, Banknote, Building2, Landmark, LineChart, AlertTriangle, Linkedin } from "lucide-react";
import { fmtUsd } from "../../lib/dealFeed";
import { sectorLabel, stageLabel } from "../../lib/taxonomy";
import type { CheckProfile, InvestorFact, ProfilePerson, Sourced } from "../../lib/companyCheck";

// ─────────────────────────────────────────────────────────────────────────────
// The research on one checked company (/checks/:id), from worker/profile.ts.
// Unverified by design until enrichment v2 passes Phase 1: the label says so,
// and every value carries the link to the page it came from. Revenue and
// customers are not shown until that module has been validated (decision of
// 2026-10-21) — the card says so instead of showing an estimate as a fact.
// ─────────────────────────────────────────────────────────────────────────────

const CONF_DOT: Record<string, string> = { high: "bg-emerald-500", medium: "bg-amber-400", low: "bg-gray-300" };

function SourceLink({ url, quote }: { url: string | null; quote?: string | null }) {
  const { t } = useTranslation();
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={quote ? `“${quote}”` : t("companyCheck.profile.source")}
      aria-label={t("companyCheck.profile.source")} className="inline-flex flex-none text-gray-300 hover:text-blue-600">
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function SourcedText<T>({ v, render }: { v: Sourced<T>; render?: (x: T) => string }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{render ? render(v.value) : String(v.value)}</span>
      <span className={`h-1.5 w-1.5 flex-none rounded-full ${CONF_DOT[v.confidence]}`} title={t(`companyCheck.profile.confidence.${v.confidence}`)} />
      <SourceLink url={v.source_url} quote={v.quote} />
    </span>
  );
}

function Card({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-gray-500">
        <Icon className="h-4 w-4" />{title}
      </h2>
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="text-sm text-gray-400">{text}</p>;

function Person({ p }: { p: ProfilePerson }) {
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-sm font-semibold text-[#0F172A]">{p.name}</span>
        {p.title && <span className="text-xs text-gray-500">{p.title}</span>}
        {p.linkedin_url && (
          <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="text-gray-400 hover:text-[#0A66C2]">
            <Linkedin className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      {p.bio && <p className="mt-1 text-xs leading-relaxed text-gray-600 line-clamp-3">{p.bio}</p>}
    </li>
  );
}

export function CheckProfileView({ profile, investors }: { profile: CheckProfile; investors: InvestorFact[] | null }) {
  const { t } = useTranslation();
  const k = (key: string, o?: Record<string, unknown>) => t(`companyCheck.profile.${key}`, o);
  const ov = profile.overview;
  const location = [ov.city, ov.country].filter((x): x is Sourced<string> => !!x);

  const facts: Array<[string, React.ReactNode]> = [];
  if (ov.founded_year) facts.push([k("founded"), <SourcedText v={ov.founded_year} />]);
  if (location.length) {
    facts.push([k("location"), (
      <span className="inline-flex flex-wrap items-center gap-x-1">
        {location.map((l, i) => <React.Fragment key={i}>{i > 0 && ", "}<SourcedText v={l} /></React.Fragment>)}
      </span>
    )]);
  }
  if (ov.headcount) facts.push([k("team"), <SourcedText v={ov.headcount} render={(n) => k("employees", { count: n })} />]);
  else if (ov.employee_range) facts.push([k("team"), k("employeesRange", { range: ov.employee_range })]);
  if (ov.sector) facts.push([k("sector"), [sectorLabel(ov.sector, t), ...ov.sub_sectors].join(" · ")]);
  if (ov.linkedin_url) {
    facts.push(["LinkedIn", (
      <a href={ov.linkedin_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">
        {ov.linkedin_url.replace(/^https?:\/\/(www\.)?/, "")}<ExternalLink className="h-3 w-3" />
      </a>
    )]);
  }

  const rounds = profile.funding.rounds;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
        <p><span className="font-semibold">{k("unverifiedTitle")}</span> {k("unverifiedBody", { count: profile.sources_count })}</p>
      </div>

      <Card icon={Building2} title={k("overview")}>
        {ov.description ? <p className="text-sm leading-relaxed text-[#111827]">{ov.description}</p> : <Empty text={k("noDescription")} />}
        {facts.length > 0 && (
          <dl className="mt-4 grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">
            {facts.map(([label, value]) => (
              <React.Fragment key={label}>
                <dt className="text-gray-400">{label}</dt>
                <dd className="text-[#111827] break-words -mt-1.5 sm:mt-0">{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
      </Card>

      <Card icon={Users} title={k("people")}>
        {profile.people.founders.length + profile.people.leadership.length === 0 ? <Empty text={k("noPeople")} /> : (
          <div className="space-y-4">
            {profile.people.founders.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">{k("founders")}</p>
                <ul className="divide-y divide-gray-100">{profile.people.founders.map((p) => <Person key={p.name} p={p} />)}</ul>
              </div>
            )}
            {profile.people.leadership.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">{k("leadership")}</p>
                <ul className="divide-y divide-gray-100">{profile.people.leadership.map((p) => <Person key={p.name} p={p} />)}</ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card icon={Banknote} title={k("funding")}>
        {rounds.length === 0 ? <Empty text={k("noRounds")} /> : (
          <>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {profile.funding.total_raised != null && (
                <span className="text-2xl font-black tabular-nums text-[#0F172A]">{fmtUsd(profile.funding.total_raised)}</span>
              )}
              <span className="text-xs text-gray-500">
                {k("roundsFound", { count: rounds.length })}
                {profile.funding.history_complete !== true && ` · ${k("mayBeIncomplete")}`}
              </span>
            </div>
            <ul className="divide-y divide-gray-100">
              {rounds.map((r, i) => (
                <li key={`${r.round_type}-${r.date}-${i}`} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="w-24 flex-none text-xs tabular-nums text-gray-500">{r.date ?? k("noDate")}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="text-sm font-semibold text-[#0F172A]">{stageLabel(r.round_type, t)}</span>
                      {r.amount != null && <span className="text-sm font-bold tabular-nums text-[#0F172A]">{fmtUsd(r.amount)}</span>}
                      <SourceLink url={r.source_url} />
                    </div>
                    {(r.lead_investor || r.investors.length > 0) && (
                      <p className="mt-0.5 text-xs text-gray-600 break-words">
                        {r.lead_investor && <>{k("ledBy")} <span className="font-medium">{r.lead_investor}</span></>}
                        {r.lead_investor && r.investors.length > 0 && " · "}
                        {r.investors.length > 0 && r.investors.join(", ")}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card icon={Landmark} title={k("investors")}>
        {investors === null ? <Empty text={k("investorsLoading")} /> : investors.length === 0 ? <Empty text={k("noInvestors")} /> : (
          <>
            <ul className="divide-y divide-gray-100">
              {investors.map((f) => (
                <li key={f.name} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-[#0F172A]">{f.investor_name ?? f.name}</span>
                    {f.led_here && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">{k("ledHere")}</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-600">
                    {f.rounds === 0 ? k("notInData") : [
                      k("inData", { count: f.companies }),
                      k("ledRounds", { count: f.rounds_led }),
                      f.main_stages.length ? k("mostly", { stages: f.main_stages.map((s) => stageLabel(s, t)).join(", ") }) : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-gray-400">{k("investorsNote")}</p>
          </>
        )}
      </Card>

      <Card icon={LineChart} title={k("revenue")}>
        <Empty text={k("revenuePending")} />
      </Card>
    </div>
  );
}
