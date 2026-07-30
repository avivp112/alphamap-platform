import React from "react";
import { useTranslation } from "react-i18next";
import { localeFor } from "../../lib/i18n";
import { TERMS_SECTIONS } from "../../lib/legal";
import { Layout } from "../components/Layout";

// Same TERMS_SECTIONS the signup-flow modal shows (see lib/legal.ts) — kept
// in one place so the binding text never drifts between the two surfaces.
export function TermsOfUse() {
  const { t, i18n } = useTranslation();

  return (
    <Layout>
      <div className="mx-auto max-w-[820px] px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <h1
          className="text-3xl sm:text-4xl font-normal tracking-tight text-[#0F172A] mb-2"
          style={{ fontFamily: "'Playfair Display', serif" }}
        >
          {t("auth.signup.termsTitle")}
        </h1>
        <p className="text-xs text-gray-400 mb-10">
          {t("auth.signup.lastUpdated", {
            date: new Date().toLocaleDateString(localeFor(i18n.resolvedLanguage ?? "en"), { month: "long", year: "numeric" }),
          })}
        </p>

        <div className="rounded-[28px] border border-gray-100 bg-white p-7 sm:p-9 shadow-[0_4px_20px_rgba(0,0,0,0.02)] space-y-7">
          {TERMS_SECTIONS.map((s) => (
            <div key={s.heading}>
              <h2 className="text-base font-bold text-[#0F172A] mb-2">{s.heading}</h2>
              {s.body.map((p, i) => (
                <p key={i} className="text-sm text-gray-600 leading-relaxed mb-2.5 last:mb-0">{p}</p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
