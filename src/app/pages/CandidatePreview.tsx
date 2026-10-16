import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { Building2, ExternalLink, Globe, Loader2, AlertCircle, Info, CheckCircle2, ArrowLeft } from "lucide-react";
import { Layout } from "../components/Layout";
import { fetchCandidatePreview, fetchStartupListRowById } from "../../lib/supabase";
import { SOURCE_LABEL, registryUrl, evidenceLines, companyPath, type CandidatePreview as Preview } from "../../lib/candidateReview";

// ─────────────────────────────────────────────────────────────────────────────
// /candidates/:id — where a "New company" alert lands.
//
// The company was found in a government filing and passed the quality gate,
// but an admin has not reviewed it yet, so it is not in the database and has
// no tearsheet. This page shows what the filing says and links to the official
// record. Once approved (and in startups_search) it forwards straight to the
// company's tearsheet; until the next search refresh it stays here with an
// "added" note instead of landing on a company that cannot be opened yet.
// ─────────────────────────────────────────────────────────────────────────────

export function CandidatePreview() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Preview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const p = await fetchCandidatePreview(id);
        if (cancelled) return;
        if (!p) { setState("missing"); return; }
        if (p.status === "approved" && p.startup_id) {
          const row = await fetchStartupListRowById(p.startup_id).catch(() => null);
          if (cancelled) return;
          if (row) { navigate(companyPath(p.startup_id), { replace: true }); return; }
        }
        setData(p);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [id, navigate]);

  return (
    <Layout>
      <div className="mx-auto max-w-[820px] px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <Link to="/my-area?tab=alerts" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-[#0F172A]">
          <ArrowLeft className="h-4 w-4" />{t("candidatePreview.back")}
        </Link>

        {state === "loading" && (
          <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        )}
        {state === "error" && (
          <Notice icon={AlertCircle} tone="rose" title={t("candidatePreview.errorTitle")} body={t("candidatePreview.errorBody")} />
        )}
        {state === "missing" && (
          <Notice icon={Info} tone="gray" title={t("candidatePreview.missingTitle")} body={t("candidatePreview.missingBody")} />
        )}
        {state === "ready" && data && data.status === "rejected" && (
          <Notice icon={Info} tone="gray" title={t("candidatePreview.rejectedTitle")} body={t("candidatePreview.rejectedBody")} />
        )}
        {state === "ready" && data && data.status !== "rejected" && <Details p={data} />}
      </div>
    </Layout>
  );
}

function Details({ p }: { p: Exclude<Preview, { status: "rejected" }> }) {
  const { t } = useTranslation();
  const link = registryUrl(p);
  const lines = evidenceLines(p);
  const approved = p.status === "approved";

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-gray-100 bg-gray-50">
          <Building2 className="h-5 w-5 text-gray-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A] break-words">{p.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">{SOURCE_LABEL[p.source] ?? p.source}</span>
            {p.sector && <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700">{p.sector}</span>}
            {p.country && <span className="text-xs text-gray-400">{p.country}</span>}
          </div>
        </div>
      </div>

      {approved ? (
        <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />
          <span>{t("candidatePreview.approvedNote")}</span>
        </div>
      ) : (
        <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Info className="mt-0.5 h-4 w-4 flex-none" />
          <span>{t("candidatePreview.pendingNote")}</span>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-gray-100 bg-white p-5">
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">{t("candidatePreview.fromFiling")}</h2>
        {lines.length > 0 ? (
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-[150px_1fr] text-sm">
            {lines.map((l) => (
              <React.Fragment key={l.label}>
                <dt className="text-gray-400">{l.label}</dt>
                <dd className="text-[#111827] break-words">{l.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-gray-500">{t("candidatePreview.noDetails")}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium text-blue-600 hover:underline">
              <ExternalLink className="h-3.5 w-3.5" />{t("candidatePreview.officialRecord")}
            </a>
          )}
          {p.website && (
            <a href={p.website.startsWith("http") ? p.website : `https://${p.website}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 font-medium text-blue-600 hover:underline">
              <Globe className="h-3.5 w-3.5" />{t("candidatePreview.website")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Notice({ icon: Icon, tone, title, body }: { icon: React.ElementType; tone: "rose" | "gray"; title: string; body: string }) {
  return (
    <div className={`flex flex-col items-center rounded-xl border border-dashed px-6 py-16 text-center ${tone === "rose" ? "border-rose-200" : "border-gray-200"}`}>
      <Icon className={`mb-3 h-8 w-8 ${tone === "rose" ? "text-rose-300" : "text-gray-300"}`} />
      <p className="text-sm font-semibold text-[#0F172A]">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-gray-500">{body}</p>
    </div>
  );
}
