import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  Search, Sparkles, ArrowRight, X, Building2, Landmark,
  MapPin, TrendingUp, Loader2, CornerDownLeft, ExternalLink, RotateCcw,
} from "lucide-react";
import { CompanyLogo } from "./CompanyLogo";
import type { SemanticMatch } from "../../lib/semanticSearch";
import { streamChatAnalyst, parseAnswerSegments, type ChatHistoryTurn } from "../../lib/chatAnalyst";

// ─────────────────────────────────────────────────────────────────────────────
// AISearchWorkspace — the multi-turn AlphaMap AI Analyst on the Market
// Intelligence home ("Ask anything about the private markets").
//
// Backed by the `chat-analyst` Edge Function's Hybrid retrieval loop: Claude
// picks between fuzzy semantic search and precise structured filter tools
// (sector/stage/headcount/funding-recency, funding rounds, news, patents,
// investors) turn by turn, chaining calls as needed, before writing its
// answer. Every turn keeps the same anti-hallucination/citation guarantees as
// the original single-shot version: the model can only state a fact a tool
// call actually returned, and every named entity carries a [Name](cite:ID)
// token that resolves to a real row via `citeMap` below.
//
// State is one conversation thread (`turns`) — each user question and its
// assistant reply (streamed text + a running "tool status" line while a tool
// is executing + any entities that tool run retrieved) — kept client-side
// only for this version; refreshing the page starts a new conversation, same
// as clicking "New conversation".
// ─────────────────────────────────────────────────────────────────────────────

const EXAMPLE_QUERIES = [
  "European Series A cybersecurity startups with stable headcount",
  "AI infrastructure companies scaling fast",
  "Growth-stage fintech investors in the US",
  "Climate hardware startups founded after 2020",
];

type TurnStatus = "streaming" | "done" | "error";

interface Turn {
  role: "user" | "assistant";
  content: string;
  matches: SemanticMatch[];
  toolStatus: string | null;
  status: TurnStatus;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
const FIRM_TYPE_LABEL: Record<string, string> = { vc: "VC", pe: "Private Equity", growth: "Growth" };

function dedupeMatches(items: SemanticMatch[]): SemanticMatch[] {
  const seen = new Set<string>();
  const out: SemanticMatch[] = [];
  for (const m of items) {
    const key = `${m.entity_type}-${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export function AISearchWorkspace() {
  const { t } = useTranslation();
  const [input, setInput]           = useState("");
  const [turns, setTurns]           = useState<Turn[]>([]);
  const [citeTarget, setCiteTarget] = useState<SemanticMatch | null>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  // id → match across the WHOLE conversation, so a citation in turn 3 still
  // resolves even if the entity was only retrieved back in turn 1.
  const citeMap = useMemo(() => {
    const m = new Map<string, SemanticMatch>();
    for (const turn of turns) for (const match of turn.matches) m.set(match.id, match);
    return m;
  }, [turns]);

  // Keep the newest turn in view as it streams in.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const updateLastTurn = useCallback((patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, ...(typeof patch === "function" ? patch(last) : patch) };
      return next;
    });
  }, []);

  const sendMessage = useCallback((raw: string) => {
    const text = raw.trim();
    if (!text) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const history: ChatHistoryTurn[] = [
      ...turns.map((t) => ({ role: t.role, content: t.content })),
      { role: "user" as const, content: text },
    ];

    setTurns((prev) => [
      ...prev,
      { role: "user", content: text, matches: [], toolStatus: null, status: "done" },
      { role: "assistant", content: "", matches: [], toolStatus: null, status: "streaming" },
    ]);
    setInput("");

    streamChatAnalyst(history, {
      signal: ac.signal,
      onEvent: (evt) => {
        if (evt.type === "tool_start") updateLastTurn({ toolStatus: evt.label });
        else if (evt.type === "tool_done") updateLastTurn({ toolStatus: null });
        else if (evt.type === "matches") updateLastTurn((t) => ({ matches: dedupeMatches([...t.matches, ...evt.items]) }));
        else if (evt.type === "text") updateLastTurn((t) => ({ content: t.content + evt.delta }));
        else if (evt.type === "done") updateLastTurn({ status: "done", toolStatus: null });
        else if (evt.type === "error") updateLastTurn({ status: "error", toolStatus: null });
      },
    }).catch((err) => {
      if ((err as Error)?.name !== "AbortError") updateLastTurn({ status: "error", toolStatus: null });
    });
  }, [turns, updateLastTurn]);

  const newConversation = () => {
    abortRef.current?.abort();
    setTurns([]);
    setInput("");
    setCiteTarget(null);
    inputRef.current?.focus();
  };

  const isSending = turns.length > 0 && turns[turns.length - 1].status === "streaming";
  const hasConversation = turns.length > 0;

  return (
    <section className="relative overflow-hidden rounded-[10px] border border-gray-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -20%, rgba(124,137,103,0.10) 0%, rgba(124,137,103,0) 55%), radial-gradient(90% 60% at 90% 0%, rgba(245,158,11,0.06) 0%, rgba(245,158,11,0) 50%)",
        }}
      />

      <div className="relative px-5 py-10 sm:px-8 sm:py-12 lg:py-14">
        {!hasConversation ? (
          <>
            {/* Eyebrow */}
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/70 px-3 py-1 text-[11px] font-semibold text-gray-500 backdrop-blur">
                <Sparkles className="h-3.5 w-3.5 text-[#7C8967]" />{t("aiSearch.title")}</div>
            </div>

            <h1 className="mx-auto mt-4 max-w-2xl text-center text-2xl font-bold tracking-tight text-[#0F172A] sm:text-[32px] sm:leading-[1.15]">{t("aiSearch.askAnything")}</h1>
            <p className="mx-auto mt-2 max-w-xl text-center text-sm text-gray-500">
              Ask about companies, funds, and market trends in natural language — answered strictly from the AlphaMap database, with follow-ups.
            </p>
          </>
        ) : (
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-bold text-[#0F172A]">
              <Sparkles className="h-4 w-4 text-[#7C8967]" />{t("aiSearch.aiAnalysis")}
            </div>
            <button
              type="button"
              onClick={newConversation}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 transition-colors hover:border-gray-300 hover:text-[#0F172A]"
            >
              <RotateCcw className="h-3.5 w-3.5" />New conversation
            </button>
          </div>
        )}

        {/* Conversation thread */}
        {hasConversation && (
          <div ref={threadRef} className="mx-auto mt-6 max-h-[560px] max-w-2xl space-y-5 overflow-y-auto pr-1 text-left">
            {turns.map((turn, i) =>
              turn.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-[10px] bg-[#0F172A] px-4 py-2.5 text-sm leading-relaxed text-white">
                    {turn.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="space-y-4">
                  <AnswerBlock
                    answer={turn.content}
                    streaming={turn.status === "streaming"}
                    toolStatus={turn.toolStatus}
                    sourceCount={turn.matches.length}
                    citeMap={citeMap}
                    onCite={setCiteTarget}
                  />
                  {turn.status === "error" && (
                    <StatePanel
                      icon={<Loader2 className="h-5 w-5 text-amber-500" />}
                      title="Something went wrong"
                      body="The AI Analyst couldn't complete that request. Please try again — your question is still in the input box's history above."
                    />
                  )}
                  {(() => {
                    const companies = turn.matches.filter((m) => m.entity_type === "startup");
                    const investors = turn.matches.filter((m) => m.entity_type === "investor");
                    return (
                      <>
                        {companies.length > 0 && <ResultGroup icon={Building2} title="Companies" items={companies} onOpen={setCiteTarget} />}
                        {investors.length > 0 && <ResultGroup icon={Landmark} title="Investors" items={investors} onOpen={setCiteTarget} />}
                      </>
                    );
                  })()}
                </div>
              ),
            )}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
          className={hasConversation ? "mx-auto mt-5 max-w-2xl" : "mx-auto mt-7 max-w-2xl"}
        >
          <div className="group relative flex items-center rounded-[9px] border border-gray-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)] transition-all focus-within:border-[#0F172A]/30 focus-within:shadow-[0_12px_40px_rgba(15,23,42,0.10)] focus-within:ring-4 focus-within:ring-[#0F172A]/[0.06]">
            <Search className="ml-4 h-5 w-5 flex-none text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={hasConversation ? "Ask a follow-up…" : t("aiSearch.examplePrompt")}
              className="w-full bg-transparent px-3 py-4 text-[15px] text-[#0F172A] placeholder:text-gray-400 focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            {input && (
              <button
                type="button"
                onClick={() => { setInput(""); inputRef.current?.focus(); }}
                className="mr-1 flex-none rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label={t("aiSearch.clearSearch")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={!input.trim() || isSending}
              className="m-1.5 flex flex-none items-center gap-1.5 rounded-[8px] bg-[#0F172A] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><span className="hidden sm:inline">{t("header.search")}</span><ArrowRight className="h-4 w-4" /></>}
            </button>
          </div>

          {!hasConversation && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {EXAMPLE_QUERIES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => sendMessage(ex)}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 transition-all hover:border-gray-300 hover:text-[#0F172A]"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
        </form>
      </div>

      {!hasConversation && (
        <div className="relative flex items-center justify-center gap-1.5 border-t border-gray-100 py-2.5 text-[11px] text-gray-400">
          <CornerDownLeft className="h-3 w-3" />{t("aiSearch.pressEnter")}</div>
      )}

      {/* Citation / result tearsheet modal */}
      {citeTarget && <CitationModal match={citeTarget} onClose={() => setCiteTarget(null)} />}
    </section>
  );
}

// ── Grounded answer block ────────────────────────────────────────────────────
function AnswerBlock({
  answer, streaming, toolStatus, sourceCount, citeMap, onCite,
}: {
  answer: string;
  streaming: boolean;
  toolStatus?: string | null;
  sourceCount: number;
  citeMap: Map<string, SemanticMatch>;
  onCite: (m: SemanticMatch) => void;
}) {
  const { t } = useTranslation();
  const segments = useMemo(() => parseAnswerSegments(answer), [answer]);

  return (
    <div className="relative overflow-hidden rounded-[10px] border border-gray-100 bg-gradient-to-b from-[#7C8967]/[0.04] to-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0F172A]">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <h3 className="text-sm font-bold text-[#0F172A]">{t("aiSearch.aiAnalysis")}</h3>
        {streaming && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-gray-400">
            <Loader2 className="h-3 w-3 animate-spin" /> {toolStatus ?? "synthesizing…"}
          </span>
        )}
      </div>

      {answer.length === 0 && streaming ? (
        <div className="space-y-2">
          <div className="h-3 w-11/12 animate-pulse rounded bg-gray-100" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-gray-100" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-gray-50" />
        </div>
      ) : (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
          {segments.map((seg, i) =>
            seg.kind === "text"
              ? <RichText key={i} value={seg.value} />
              : <CitationChip key={i} label={seg.label} match={citeMap.get(seg.id)} onCite={onCite} />
          )}
          {streaming && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-[#0F172A]/60" />}
        </div>
      )}

      {!streaming && answer.length > 0 && sourceCount > 0 && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-gray-100 pt-3 text-[11px] text-gray-400">
          <Sparkles className="h-3 w-3 text-[#7C8967]" />
          Grounded in {sourceCount} AlphaMap {sourceCount === 1 ? "record" : "records"} · always verify before acting
        </div>
      )}
    </div>
  );
}

// Minimal inline formatter: renders **bold** spans; everything else verbatim.
function RichText({ value }: { value: string }) {
  const parts = value.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**")
          ? <strong key={i} className="font-semibold text-[#0F172A]">{p.slice(2, -2)}</strong>
          : <React.Fragment key={i}>{p}</React.Fragment>
      )}
    </>
  );
}

// ── Citation chip (inline in the answer) ─────────────────────────────────────
function CitationChip({
  label, match, onCite,
}: {
  label: string; match: SemanticMatch | undefined; onCite: (m: SemanticMatch) => void;
}) {
  // If the model cited an id not in context, degrade to plain text — never a
  // dead chip (part of the anti-hallucination guarantee at the UI layer).
  if (!match) return <>{label}</>;
  const Icon = match.entity_type === "startup" ? Building2 : Landmark;
  return (
    <button
      type="button"
      onClick={() => onCite(match)}
      className="mx-0.5 inline-flex translate-y-[1px] items-center gap-1 rounded-md border border-[#7C8967]/25 bg-[#7C8967]/10 px-1.5 py-0.5 align-baseline text-[13px] font-semibold text-[#4B5741] transition-colors hover:border-[#7C8967]/50 hover:bg-[#7C8967]/15"
    >
      <Icon className="h-3 w-3 flex-none" />
      {label}
    </button>
  );
}

// ── Result group (Companies / Investors) ─────────────────────────────────────
function ResultGroup({
  icon: Icon, title, items, onOpen,
}: {
  icon: React.ElementType; title: string; items: SemanticMatch[]; onOpen: (m: SemanticMatch) => void;
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#0F172A]/60" />
        <h3 className="text-sm font-bold text-[#0F172A]">{title}</h3>
      </div>
      <div className="space-y-2">
        {items.map((m) => <ResultRow key={`${m.entity_type}-${m.id}`} match={m} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

// ── Single result row ────────────────────────────────────────────────────────
function metadataChips(match: SemanticMatch): string[] {
  const chips: string[] = [];
  const md = match.metadata;
  if (match.entity_type === "startup") {
    const industry = str(md.industry);
    if (industry) chips.push(industry);
    const loc = [str(md.city), str(md.country)].filter(Boolean).join(", ");
    if (loc) chips.push(loc);
  } else {
    const ft = str(md.firm_type);
    if (ft) chips.push(FIRM_TYPE_LABEL[ft] ?? ft.toUpperCase());
    const hq = str(md.headquarters);
    if (hq) chips.push(hq);
    const fund = str(md.fund_size);
    if (fund) chips.push(fund);
  }
  return chips;
}

function ResultRow({ match, onOpen }: { match: SemanticMatch; onOpen: (m: SemanticMatch) => void }) {
  const isCompany = match.entity_type === "startup";
  const website = str(match.metadata.website);
  const pct = Math.round((match.similarity ?? 0) * 100);
  const chips = metadataChips(match);

  return (
    <button
      type="button"
      onClick={() => onOpen(match)}
      className="group flex w-full items-start gap-3 rounded-[8px] border border-gray-100 bg-white p-3.5 text-left transition-all hover:border-gray-300 hover:shadow-[0_8px_30px_rgba(15,23,42,0.05)]"
    >
      <CompanyLogo name={match.name ?? "—"} website={website} size={40} rounded="rounded-[8px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h4 className="truncate text-sm font-bold text-[#0F172A]">{match.name ?? "—"}</h4>
          <span className="flex-none rounded-full bg-[#7C8967]/10 px-2 py-0.5 text-[10px] font-bold text-[#5C6A4C]">
            {pct}% match
          </span>
        </div>
        {match.description && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">{match.description}</p>
        )}
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-gray-400">
            {chips.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {i === 0 ? (isCompany ? <TrendingUp className="h-3 w-3" /> : <Landmark className="h-3 w-3" />) : <MapPin className="h-3 w-3" />}
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

// ── Citation / result tearsheet modal ────────────────────────────────────────
function CitationModal({ match, onClose }: { match: SemanticMatch; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isCompany = match.entity_type === "startup";
  const website = str(match.metadata.website);
  const chips = metadataChips(match);

  // Best-effort redirect into the relevant directory page.
  const dir = isCompany
    ? { label: "Startups", path: "/startups" }
    : str(match.metadata.firm_type) === "pe"
      ? { label: "Private Equity", path: "/private-equity" }
      : { label: "VCs", path: "/vcs" };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(6,13,25,0.55)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-[10px] border border-gray-100 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 px-6 pt-6" style={{ background: "#B8C9D1" }}>
          <div className="pb-5">
            <CompanyLogo name={match.name ?? "—"} website={website} size={52} rounded="rounded-lg" />
          </div>
          <div className="min-w-0 flex-1 pb-5 pt-0.5">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-black tracking-tight text-[#0F172A]">{match.name ?? "—"}</h2>
              <span className="flex-none rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold text-[#0F172A]" style={{ border: "1px solid rgba(15,23,42,0.12)" }}>
                {isCompany ? "Company" : (FIRM_TYPE_LABEL[str(match.metadata.firm_type) ?? "vc"] ?? "Investor")}
              </span>
            </div>
            {chips.length > 0 && (
              <p className="mt-1 truncate text-xs font-medium text-[#0F172A]/60">{chips.join(" · ")}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-[#0F172A]/50 transition-colors hover:bg-white/40 hover:text-[#0F172A]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          {match.description ? (
            <p className="text-sm leading-relaxed text-gray-600">{match.description}</p>
          ) : (
            <p className="text-sm text-gray-400">No description on file for this record yet.</p>
          )}

          <div className="mt-5 flex items-center gap-2.5">
            <button
              onClick={() => { onClose(); navigate(dir.path); }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-[#0F172A] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-900"
            >
              View in {dir.label}
              <ArrowRight className="h-4 w-4" />
            </button>
            {website && (
              <a
                href={website.startsWith("http") ? website : `https://${website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-[8px] border border-gray-200 px-4 py-2.5 text-sm font-semibold text-[#0F172A] transition-colors hover:bg-gray-50"
              >{t("common.website")}<ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Empty / error state ──────────────────────────────────────────────────────
function StatePanel({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center rounded-[10px] border border-gray-100 bg-gray-50/60 px-6 py-10 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white">
        {icon}
      </div>
      <p className="text-sm font-semibold text-[#0F172A]">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-gray-500">{body}</p>
    </div>
  );
}
