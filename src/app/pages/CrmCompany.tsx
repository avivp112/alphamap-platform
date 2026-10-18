import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import {
  ArrowLeft, Loader2, Lock, ExternalLink, Trash2, Plus, FileText, Upload, Download, X, Check, ScanSearch, Building2, AlertCircle,
} from "lucide-react";
import { Layout } from "../components/Layout";
import { CompanyLogo } from "../components/CompanyLogo";
import { STAGE_CHIP } from "../components/crm/CrmTab";
import {
  fetchCrmCompany, updateCrmCompany, deleteCrmCompany, saveDealTerm, deleteDealTerm, uploadCrmDocument, crmDocumentUrl, deleteCrmDocument,
  type DealTermInput,
} from "../../lib/supabase";
import {
  CRM_STAGES, DEAL_INSTRUMENTS, documentProblem, fmtBytes, normalizeTags, parseMoney, totalInvested,
  type CrmCompany as Company, type CrmDocument, type DealTerm, type ValuationKind,
} from "../../lib/crm";
import { companyPath } from "../../lib/candidateReview";
import { displayDomain } from "../../lib/companyCheck";
import { fmtUsd } from "../../lib/dealFeed";

// ─────────────────────────────────────────────────────────────────────────────
// One company in the user's CRM (/crm/:id). Everything on this page is the
// user's own and private (RLS; documents in their own Storage folder). It
// links out to the AlphaMap tearsheet and to the user's check, never the
// other way round: nothing typed here reaches anything shared.
// ─────────────────────────────────────────────────────────────────────────────

const input = "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-[#0F172A] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0F172A]/10";

export function CrmCompany() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<{ company: Company; terms: DealTerm[]; documents: CrmDocument[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchCrmCompany(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function patch(p: Parameters<typeof updateCrmCompany>[1]) {
    if (!data) return;
    setData({ ...data, company: { ...data.company, ...p } });
    try {
      await updateCrmCompany(data.company.id, p);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    if (!data || !window.confirm(t("crm.removeConfirm", { name: data.company.name }))) return;
    try {
      await deleteCrmCompany(data.company.id);
      navigate("/my-area?tab=crm");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const c = data?.company;
  const website = c?.startup?.website ?? c?.website ?? null;

  return (
    <Layout>
      <div className="mx-auto max-w-[860px] px-4 sm:px-6 py-8 sm:py-12">
        <Link to="/my-area?tab=crm" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-[#0F172A]">
          <ArrowLeft className="h-4 w-4" />{t("crm.back")}
        </Link>

        {loading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>}
        {!loading && !c && (
          <div className="rounded-xl border border-gray-200 bg-white px-5 py-10 text-center text-sm font-semibold text-[#0F172A]">{error ?? t("crm.notFoundPage")}</div>
        )}

        {c && data && (
          <div className="space-y-5">
            <div className="flex items-start gap-4">
              <CompanyLogo name={c.name} website={website} size={56} rounded="rounded-xl" />
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-bold tracking-tight text-[#0F172A] break-words">{c.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                  {website && displayDomain(website) && (
                    <a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-blue-600">
                      {displayDomain(website)}<ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {c.startup_id && (
                    <Link to={companyPath(c.startup_id)} className="inline-flex items-center gap-1 font-medium text-[#0F172A] hover:underline">
                      <Building2 className="h-3.5 w-3.5" />{t("crm.openInAlphaMap")}
                    </Link>
                  )}
                  {c.check_id && (
                    <Link to={`/checks/${c.check_id}`} className="inline-flex items-center gap-1 font-medium text-[#0F172A] hover:underline">
                      <ScanSearch className="h-3.5 w-3.5" />{t("crm.openResearch")}
                    </Link>
                  )}
                </div>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400"><Lock className="h-3 w-3" />{t("crm.privateLine")}</p>
              </div>
              {saved && <span className="flex-none inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><Check className="h-3.5 w-3.5" />{t("crm.saved")}</span>}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-none" /><span className="break-words">{error}</span>
              </div>
            )}

            <Card title={t("crm.pipeline")}>
              <div className="flex flex-wrap gap-1.5">
                {CRM_STAGES.map((s) => (
                  <button key={s} onClick={() => patch({ stage: s })}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${c.stage === s ? STAGE_CHIP[s] + " ring-1 ring-current" : "border border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                    {t(`crm.stage.${s}`)}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_170px] gap-3">
                <BlurInput value={c.next_step ?? ""} placeholder={t("crm.nextStepPlaceholder")} label={t("crm.nextStep")} maxLength={500}
                  onCommit={(v) => patch({ next_step: v || null })} />
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-gray-700">{t("crm.nextStepDate")}</span>
                  <input type="date" value={c.next_step_date ?? ""} onChange={(e) => patch({ next_step_date: e.target.value || null })} className={input} />
                </label>
              </div>
            </Card>

            <Card title={t("crm.notes")}>
              <BlurTextarea value={c.notes ?? ""} placeholder={t("crm.notesPlaceholder")} onCommit={(v) => patch({ notes: v || null })} />
              <TagsEditor tags={c.tags} onChange={(tags) => patch({ tags })} />
            </Card>

            <DealTerms companyId={c.id} terms={data.terms} onChanged={load} onError={setError} />
            <Documents companyId={c.id} documents={data.documents} onChanged={load} onError={setError} />

            <div className="flex justify-end">
              <button onClick={remove} className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:underline">
                <Trash2 className="h-3.5 w-3.5" />{t("crm.remove")}
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Edits locally, saves when the field loses focus — no save on every keystroke. */
function BlurInput({ value, onCommit, label, placeholder, maxLength }: {
  value: string; onCommit: (v: string) => void; label: string; placeholder?: string; maxLength?: number;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-700">{label}</span>
      <input value={v} maxLength={maxLength} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (v.trim() !== value) onCommit(v.trim()); }} className={input} />
    </label>
  );
}

function BlurTextarea({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea value={v} rows={5} maxLength={20000} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onCommit(v); }} className={`${input} resize-y leading-relaxed`} />
  );
}

function TagsEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const add = () => { const next = normalizeTags([...tags, ...draft.split(",")]); setDraft(""); if (next.length !== tags.length) onChange(next); };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
          {tag}
          <button onClick={() => onChange(tags.filter((x) => x !== tag))} aria-label={t("common.clear")} className="text-slate-400 hover:text-slate-700"><X className="h-3 w-3" /></button>
        </span>
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("crm.addTag")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} onBlur={() => draft.trim() && add()}
        className="min-w-[120px] flex-1 rounded-full border border-dashed border-gray-200 px-3 py-1 text-xs focus:outline-none" />
    </div>
  );
}

// ── Deal terms ────────────────────────────────────────────────────────────────

interface TermForm { instrument: DealTerm["instrument"]; round_label: string; amount: string; valuation: string; valuation_kind: ValuationKind | ""; invested_on: string; ownership_pct: string; notes: string }
const emptyTerm = (): TermForm => ({ instrument: "safe", round_label: "", amount: "", valuation: "", valuation_kind: "", invested_on: "", ownership_pct: "", notes: "" });
const termToForm = (d: DealTerm): TermForm => ({
  instrument: d.instrument, round_label: d.round_label ?? "", amount: d.amount != null ? String(d.amount) : "", valuation: d.valuation != null ? String(d.valuation) : "",
  valuation_kind: d.valuation_kind ?? "", invested_on: d.invested_on ?? "", ownership_pct: d.ownership_pct != null ? String(d.ownership_pct) : "", notes: d.notes ?? "",
});

function DealTerms({ companyId, terms, onChanged, onError }: { companyId: string; terms: DealTerm[]; onChanged: () => void; onError: (e: string) => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<{ id?: string; form: TermForm } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const total = totalInvested(terms);

  async function save() {
    if (!editing) return;
    const f = editing.form;
    const amount = parseMoney(f.amount), valuation = parseMoney(f.valuation);
    const ownership = f.ownership_pct.trim() ? Number(f.ownership_pct) : null;
    if (Number.isNaN(amount) || Number.isNaN(valuation)) { setProblem(t("crm.terms.badMoney")); return; }
    if (ownership != null && (Number.isNaN(ownership) || ownership < 0 || ownership > 100)) { setProblem(t("crm.terms.badOwnership")); return; }
    const term: DealTermInput = {
      instrument: f.instrument, round_label: f.round_label.trim() || null, amount, valuation,
      valuation_kind: valuation != null && f.valuation_kind ? f.valuation_kind : null,
      invested_on: f.invested_on || null, ownership_pct: ownership, notes: f.notes.trim() || null,
    };
    try {
      await saveDealTerm(companyId, term, editing.id);
      setEditing(null);
      setProblem(null);
      onChanged();
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  }

  async function remove(id: string) {
    if (!window.confirm(t("crm.terms.removeConfirm"))) return;
    try { await deleteDealTerm(id); onChanged(); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  }

  const set = (k: keyof TermForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setEditing((s) => (s ? { ...s, form: { ...s.form, [k]: e.target.value } } : s));

  return (
    <Card title={t("crm.terms.title")} action={!editing && (
      <button onClick={() => setEditing({ form: emptyTerm() })} className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F172A] hover:underline">
        <Plus className="h-3.5 w-3.5" />{t("crm.terms.add")}
      </button>
    )}>
      {terms.length === 0 && !editing && <p className="text-sm text-gray-400">{t("crm.terms.empty")}</p>}
      {total != null && <p className="mb-2 text-sm text-gray-600">{t("crm.terms.total")} <span className="font-bold tabular-nums text-[#0F172A]">{fmtUsd(total)}</span></p>}
      {terms.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {terms.map((d) => (
            <li key={d.id} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-semibold text-[#0F172A]">{t(`crm.terms.instrument.${d.instrument}`)}</span>
                  {d.round_label && <span className="text-gray-500">{d.round_label}</span>}
                  {d.amount != null && <span className="font-bold tabular-nums text-[#0F172A]">{fmtUsd(d.amount)}</span>}
                </div>
                <p className="mt-0.5 text-xs text-gray-600">
                  {[
                    d.valuation != null ? `${t(`crm.terms.kind.${d.valuation_kind ?? "post"}`)} ${fmtUsd(d.valuation)}` : null,
                    d.ownership_pct != null ? t("crm.terms.ownership", { pct: d.ownership_pct }) : null,
                    d.invested_on,
                  ].filter(Boolean).join(" · ")}
                </p>
                {d.notes && <p className="mt-1 text-xs text-gray-500 break-words">{d.notes}</p>}
              </div>
              <button onClick={() => setEditing({ id: d.id, form: termToForm(d) })} className="text-xs font-medium text-gray-500 hover:text-[#0F172A]">{t("crm.edit")}</button>
              <button onClick={() => remove(d.id)} aria-label={t("crm.delete")} className="text-gray-300 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <div className="mt-3 space-y-3 rounded-lg bg-gray-50 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Labeled label={t("crm.terms.instrumentLabel")}>
              <select value={editing.form.instrument} onChange={set("instrument")} className={input}>
                {DEAL_INSTRUMENTS.map((i) => <option key={i} value={i}>{t(`crm.terms.instrument.${i}`)}</option>)}
              </select>
            </Labeled>
            <Labeled label={t("crm.terms.round")}><input value={editing.form.round_label} onChange={set("round_label")} maxLength={60} placeholder={t("crm.terms.roundPlaceholder")} className={input} /></Labeled>
            <Labeled label={t("crm.terms.amount")}><input value={editing.form.amount} onChange={set("amount")} inputMode="decimal" placeholder="250k" className={input} /></Labeled>
            <Labeled label={t("crm.terms.valuation")}><input value={editing.form.valuation} onChange={set("valuation")} inputMode="decimal" placeholder="12m" className={input} /></Labeled>
            <Labeled label={t("crm.terms.valuationKind")}>
              <select value={editing.form.valuation_kind} onChange={set("valuation_kind")} className={input}>
                <option value="">—</option>
                {(["pre", "post", "cap"] as const).map((k) => <option key={k} value={k}>{t(`crm.terms.kind.${k}`)}</option>)}
              </select>
            </Labeled>
            <Labeled label={t("crm.terms.ownershipLabel")}><input value={editing.form.ownership_pct} onChange={set("ownership_pct")} inputMode="decimal" placeholder="2.5" className={input} /></Labeled>
            <Labeled label={t("crm.terms.date")}><input type="date" value={editing.form.invested_on} onChange={set("invested_on")} className={input} /></Labeled>
          </div>
          <Labeled label={t("crm.terms.notes")}><textarea value={editing.form.notes} onChange={set("notes")} rows={2} maxLength={5000} className={input} /></Labeled>
          {problem && <p className="text-xs text-rose-600">{problem}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setEditing(null); setProblem(null); }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100">{t("crm.cancel")}</button>
            <button onClick={save} className="rounded-lg bg-[#0F172A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1e293b]">{t("crm.save")}</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-700">{label}</span>{children}</label>;
}

// ── Documents ─────────────────────────────────────────────────────────────────

function Documents({ companyId, documents, onChanged, onError }: { companyId: string; documents: CrmDocument[]; onChanged: () => void; onError: (e: string) => void }) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const p = documentProblem(f);
        if (p) { onError(t(p === "too_large" ? "crm.docs.too_large" : "crm.docs.emptyFile", { name: f.name })); continue; }
        await uploadCrmDocument(companyId, f);
      }
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function open(d: CrmDocument) {
    try { window.open(await crmDocumentUrl(d.storage_path), "_blank", "noopener"); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  }

  async function remove(d: CrmDocument) {
    if (!window.confirm(t("crm.docs.removeConfirm", { name: d.file_name }))) return;
    try { await deleteCrmDocument(d); onChanged(); } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <Card title={t("crm.docs.title")} action={
      <button disabled={uploading} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F172A] hover:underline disabled:opacity-50">
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{t("crm.docs.upload")}
      </button>
    }>
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      {documents.length === 0 ? <p className="text-sm text-gray-400">{t("crm.docs.empty")}</p> : (
        <ul className="divide-y divide-gray-100">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2.5">
              <FileText className="h-4 w-4 flex-none text-gray-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[#0F172A]">{d.file_name}</div>
                <div className="text-xs text-gray-400">{[fmtBytes(d.size_bytes), d.created_at.slice(0, 10)].filter(Boolean).join(" · ")}</div>
              </div>
              <button onClick={() => open(d)} aria-label={t("crm.docs.open")} className="text-gray-400 hover:text-[#0F172A]"><Download className="h-4 w-4" /></button>
              <button onClick={() => remove(d)} aria-label={t("crm.delete")} className="text-gray-300 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-gray-400">{t("crm.docs.note")}</p>
    </Card>
  );
}
