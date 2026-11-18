import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Building2, History, Landmark, Loader2, Search, X, Handshake } from "lucide-react";

const CATEGORIES = [
  { id: "companies", Icon: Building2, prompts: [
    "European Series A cybersecurity startups with stable headcount",
    "AI infrastructure companies scaling fast",
    "Climate hardware startups founded after 2020",
  ] },
  { id: "investors", Icon: Landmark, prompts: [
    "Growth-stage fintech investors in the US",
    "Which VCs have an open fund offering?",
    "Seed investors writing $1-3M checks",
  ] },
  { id: "deals", Icon: Handshake, prompts: [
    "Largest company filings in the last 30 days",
    "Rounds that are still open to investors",
    "New funds filed this quarter",
  ] },
] as const;

const LABEL: Record<string, string> = { companies: "Companies", investors: "Investors", deals: "Deals" };

/** The empty state of Home (?ui=2): one question box, what you asked before, and what is worth asking. */
export function HomeStart({ input, onInput, inputRef, onAsk, sending, recent, onClearRecent }: {
  input: string;
  onInput: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onAsk: (q: string) => void;
  sending: boolean;
  recent: string[];
  onClearRecent: () => void;
}) {
  const { t } = useTranslation();
  const tt = (k: string, d: string) => t(`home.v2.${k}`, { defaultValue: d }) as string;
  return (
    <section className="mx-auto w-full max-w-[880px] px-1 pt-10 pb-12 sm:pt-16">
      <h1 className="text-center text-[28px] font-bold leading-[1.12] tracking-tight text-am-ink sm:text-[40px]">{t("aiSearch.askAnything")}</h1>

      <form onSubmit={(e) => { e.preventDefault(); onAsk(input); }} className="mt-7">
        <div className="flex items-center gap-3 rounded-2xl border border-am-line bg-am-surface py-2.5 pl-5 pr-2.5 shadow-[0_8px_30px_rgba(15,23,42,0.06)] transition-shadow focus-within:border-am-ink-3 focus-within:shadow-[0_12px_40px_rgba(15,23,42,0.10)]">
          <Search className="h-5 w-5 flex-none text-am-ink-3" aria-hidden="true" />
          <label htmlFor="home-ask" className="sr-only">{tt("askLabel", "Ask AlphaMap")}</label>
          <input id="home-ask" ref={inputRef} type="text" value={input} onChange={(e) => onInput(e.target.value)} autoComplete="off" spellCheck={false}
            placeholder={t("aiSearch.examplePrompt") as string}
            className="h-11 min-w-0 flex-1 bg-transparent text-[16px] text-am-ink placeholder:text-am-ink-3 focus:outline-none sm:text-[17px]" />
          {input && (
            <button type="button" onClick={() => { onInput(""); inputRef.current?.focus(); }} aria-label={t("aiSearch.clearSearch") as string}
              className="flex-none rounded-full p-1.5 text-am-ink-3 hover:bg-am-canvas hover:text-am-ink"><X className="h-4 w-4" aria-hidden="true" /></button>
          )}
          <button type="submit" disabled={!input.trim() || sending}
            className="flex h-11 flex-none items-center gap-1.5 rounded-[10px] bg-am-ink px-5 text-[14px] font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <><span className="hidden sm:inline">{tt("ask", "Ask")}</span><ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
          </button>
        </div>
        <p className="mt-3 text-center text-am-caption text-am-ink-3">{tt("grounded", "Answered strictly from the AlphaMap database. Sources open from every answer.")}</p>
      </form>

      {recent.length > 0 && (
        <div className="mt-10 overflow-hidden rounded-[14px] border border-am-line bg-am-surface">
          <div className="flex items-center px-5 py-3.5">
            <h2 className="flex-1 text-[14px] font-semibold text-am-ink">{tt("recent", "Pick up where you left off")}</h2>
            <button type="button" onClick={onClearRecent} className="text-am-caption text-am-ink-3 hover:text-am-ink">{tt("clearRecent", "Clear")}</button>
          </div>
          <ul>
            {recent.map((q) => (
              <li key={q} className="border-t border-am-line-soft">
                <button type="button" onClick={() => onAsk(q)} className="flex w-full items-center gap-3 px-5 py-3 text-left text-[14px] text-am-ink hover:bg-am-canvas">
                  <History className="h-4 w-4 flex-none text-am-ink-3" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{q}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="border-t border-am-line-soft px-5 py-2 text-am-caption text-am-ink-3">{tt("onDevice", "Kept on this device")}</p>
        </div>
      )}

      <div className="mt-10 grid gap-3.5 md:grid-cols-3">
        {CATEGORIES.map(({ id, Icon, prompts }) => (
          <div key={id} className="rounded-[14px] border border-am-line bg-am-surface px-5 pb-2 pt-4 shadow-am-1">
            <div className="mb-2 flex items-center gap-2.5">
              <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-am-accent-soft text-am-accent"><Icon className="h-4 w-4" aria-hidden="true" /></span>
              <h2 className="text-[14px] font-semibold text-am-ink">{tt(`cat_${id}`, LABEL[id])}</h2>
            </div>
            {prompts.map((p, i) => (
              <button key={p} type="button" onClick={() => onAsk(tt(`p_${id}_${i}`, p))}
                className="block w-full border-t border-am-line-soft py-2.5 text-left text-[14px] text-am-ink-2 transition-colors hover:text-am-ink">
                {tt(`p_${id}_${i}`, p)}
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
