import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

export interface TourStep {
  /** CSS selector for the element to spotlight, e.g. '[data-tour="search-input"]'. */
  target: string;
  icon: React.ElementType;
  title: string;
  description: string;
}

interface Rect { top: number; left: number; width: number; height: number }

// Padding around the real element so the spotlight ring doesn't hug it too tightly.
const SPOTLIGHT_PAD = 8;

function measure(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null; // hidden/unmounted
  return {
    top: r.top - SPOTLIGHT_PAD,
    left: r.left - SPOTLIGHT_PAD,
    width: r.width + SPOTLIGHT_PAD * 2,
    height: r.height + SPOTLIGHT_PAD * 2,
  };
}

/**
 * A guided, step-by-step spotlight tour: dims the page except the current
 * target element and shows an explanatory card in a fixed spot near the top
 * of the viewport — the card never moves or resizes-around content, only
 * the spotlight does, so it can never end up off-screen or unreachable no
 * matter how the page is laid out. Meant for a one-time first-visit
 * walkthrough plus an on-demand replay trigger — the host page owns `open`
 * state and persistence (e.g. a localStorage "seen" flag), this component
 * only handles the spotlight/navigation.
 */
export function ProductTour({
  steps, open, onClose,
}: {
  steps: TourStep[];
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[index];

  const reposition = useCallback(() => {
    if (!step) return;
    setRect(measure(step.target));
  }, [step]);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open || !step) return;
    const el = document.querySelector(step.target);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    reposition();
    const settle = setTimeout(reposition, 320); // after the scroll animation settles
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      clearTimeout(settle);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, step, reposition]);

  function next() {
    if (index < steps.length - 1) setIndex((i) => i + 1);
    else onClose();
  }
  function back() {
    setIndex((i) => Math.max(0, i - 1));
  }

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, steps.length]);

  if (!open || !step) return null;

  const Icon = step.icon;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Product tour">
      {/* Spotlight: a box-shadow with a huge spread paints the whole screen
          except this element's own box, which is transparent — the "hole". */}
      <div
        className="fixed rounded-2xl transition-all duration-300 ease-out"
        style={{
          top: rect?.top ?? 0, left: rect?.left ?? 0,
          width: rect?.width ?? 0, height: rect?.height ?? 0,
          background: rect ? "transparent" : "rgba(15,23,42,0.55)",
          boxShadow: rect ? "0 0 0 9999px rgba(15,23,42,0.55)" : "none",
          outline: rect ? "2px solid rgba(255,255,255,0.9)" : "none",
          outlineOffset: 2,
        }}
      />
      {/* Blocks interaction with the rest of the page while the tour runs. */}
      <div className="fixed inset-0" />

      {/* Explanation card: always fixed near the top of the viewport, same
          spot for every step — only the spotlight above moves. */}
      <div
        className="fixed top-5 left-1/2 -translate-x-1/2 z-[101] rounded-[20px] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.22)] border border-gray-100 p-5"
        style={{ width: "min(440px, calc(100vw - 32px))" }}
      >
        <button
          onClick={onClose}
          aria-label={t("tour.closeTour")}
          className="absolute top-3.5 right-3.5 text-gray-300 hover:text-gray-500 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-3.5">
          <div className="flex-none w-10 h-10 rounded-[12px] bg-gray-50 border border-gray-100 flex items-center justify-center">
            <Icon className="w-5 h-5 text-[#0F172A]" />
          </div>
          <div className="flex-1 min-w-0 pr-5">
            <h3 className="text-[15px] font-bold text-[#0F172A] mb-1">{step.title}</h3>
            <p className="text-sm text-gray-500 leading-relaxed">{step.description}</p>
          </div>
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-200 ${i === index ? "w-4 bg-[#0F172A]" : "w-1.5 bg-gray-200"}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-3">
            {index > 0 && (
              <button onClick={back} className="text-xs font-semibold text-gray-400 hover:text-[#0F172A] transition-colors">
                {t("common.back")}
              </button>
            )}
            <button
              onClick={next}
              className="rounded-full bg-[#0F172A] hover:bg-gray-900 px-4 py-2 text-xs font-bold text-white transition-colors"
            >
              {index === steps.length - 1 ? t("tour.done") : t("common.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
