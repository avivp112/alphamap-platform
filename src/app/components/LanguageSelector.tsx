import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown } from "lucide-react";
import { LANGUAGES, persistLanguage, type SupportedLanguage } from "../../lib/i18n";

export function LanguageSelector() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const active = LANGUAGES.find((l) => l.code === i18n.resolvedLanguage) ?? LANGUAGES[0];

  // Same dismissal contract as the account menu next to it: outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function choose(code: SupportedLanguage) {
    i18n.changeLanguage(code);
    persistLanguage(code);
    setOpen(false);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={t("language.select")}
        title={t("language.select")}
        className="flex items-center gap-1.5 rounded-full border border-gray-200 py-1.5 pl-2.5 pr-2 hover:bg-gray-50 transition-colors"
      >
        {/* The emoji carries no meaning for assistive tech — the label above does. */}
        <span className="text-base leading-none" aria-hidden="true">{active.flag}</span>
        <span className="hidden sm:block text-sm font-medium text-[#111827]">{active.nativeName}</span>
        <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-none" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("language.label")}
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-44 rounded-lg border border-gray-100 bg-white py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.12)]"
        >
          {LANGUAGES.map((lang) => {
            const selected = lang.code === active.code;
            return (
              <button
                key={lang.code}
                role="option"
                aria-selected={selected}
                onClick={() => choose(lang.code)}
                // lang= lets the browser pick the correct CJK font per row, so
                // 中文 and 日本語 render in their own typefaces side by side.
                lang={lang.code}
                className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-sm transition-colors hover:bg-gray-50 ${
                  selected ? "font-semibold text-[#111827]" : "text-gray-600"
                }`}
              >
                <span className="text-base leading-none" aria-hidden="true">{lang.flag}</span>
                <span className="flex-1 text-left">{lang.nativeName}</span>
                {selected && <Check className="h-3.5 w-3.5 text-[#0F172A] flex-none" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
