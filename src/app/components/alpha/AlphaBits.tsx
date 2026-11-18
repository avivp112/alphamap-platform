import React from "react";
import { Loader2 } from "lucide-react";
import { CONVICTION_MAX } from "../../../lib/alpha";
import { crmStageTone } from "./tones";
import { useAlphaT } from "./useAlphaT";

export function Spinner({ label }: { label: string }) {
  return <div className="flex items-center justify-center gap-2 py-16 text-am-body text-am-ink-3"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />{label}</div>;
}

export function ErrorLine({ message }: { message: string }) {
  return <p role="alert" className="rounded-am-ctl border border-am-line bg-am-surface px-4 py-3 text-am-body text-am-neg break-words">{message}</p>;
}

export function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center rounded-am-card border border-dashed border-am-line bg-am-surface px-6 py-14">
      <div className="text-am-ink-3 mb-3" aria-hidden="true">{icon}</div>
      <p className="text-am-title font-semibold text-am-ink">{title}</p>
      {body && <p className="mt-1 max-w-md text-am-body text-am-ink-3">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** One to five dots. With `onChange` it is a radio group; clicking the current value clears it. */
export function ConvictionDots({ value, onChange, label }: { value: number | null; onChange?: (v: number | null) => void; label: string }) {
  const tt = useAlphaT();
  const dots = Array.from({ length: CONVICTION_MAX }, (_, i) => i + 1);
  return (
    <span role={onChange ? "radiogroup" : "img"} aria-label={`${label}: ${value ?? tt("notRated", "not rated")}`} className="inline-flex items-center gap-1">
      {dots.map((n) => {
        const on = value != null && n <= value;
        const dot = <i className={`block w-[9px] h-[9px] rounded-full ${on ? "bg-am-ink" : "bg-am-line"}`} />;
        return onChange ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n}`} onClick={() => onChange(value === n ? null : n)}
            className="grid place-items-center w-5 h-5 -m-0.5 rounded-full hover:bg-am-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-am-accent/40">{dot}</button>
        ) : <span key={n}>{dot}</span>;
      })}
    </span>
  );
}

export function StageChip({ stage, label }: { stage: string; label: string }) {
  const tone = crmStageTone(stage);
  return <span className={`inline-flex items-center h-[22px] px-2.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${tone}`}>{label}</span>;
}

export function Pulse({ tone = "accent" }: { tone?: "accent" | "pos" | "warn" | "neg" }) {
  const c = { accent: "bg-am-accent shadow-[0_0_0_4px_var(--am-accent-soft)]", pos: "bg-am-pos shadow-[0_0_0_4px_#E7F6EF]", warn: "bg-am-warn shadow-[0_0_0_4px_#FFF4DD]", neg: "bg-am-neg shadow-[0_0_0_4px_#FBEAEC]" }[tone];
  return <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full flex-none ${c}`} />;
}
