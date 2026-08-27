import React from "react";
import { useTranslation } from "react-i18next";
import { localeFor } from "../../lib/i18n";
import { Layout } from "../components/Layout";

// DELIBERATELY NOT LOCALISED, same reasoning as TERMS_SECTIONS in lib/legal.ts:
// terms like "personal information," "service provider," and data-subject
// rights carry statutory meaning that differs by jurisdiction (GDPR vs. CCPA
// vs. others). Translating without counsel review would misstate what's
// actually being promised. Only the page chrome is translated.
//
// This describes what AlphaMap actually does today: Supabase for auth,
// database, and session storage; Google/LinkedIn as optional OAuth sign-in
// providers; Anthropic's Claude models for AI-assisted search and company-data
// enrichment; Resend for delivering Contact Us submissions by email. Update
// this list if a new data processor is added.
const PRIVACY_SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: "1. Scope",
    body: [
      "This Privacy Policy describes how AlphaMap (\"we,\" \"us\") collects, uses, and discloses information in connection with the AlphaMap platform (the \"Service\"). It applies to visitors, registered users, and anyone who contacts us. It should be read alongside our Terms of Use, which governs your use of the Service.",
    ],
  },
  {
    heading: "2. Information We Collect",
    body: [
      "Account information: when you register, we collect your name, email address, and password (handled by our authentication provider, Supabase, and never stored by us in plain text). If you sign in with Google or LinkedIn, we receive the basic profile information those providers share with us (typically your name and email address).",
      "Usage information: we collect information about how you use the Service, including pages visited, features used, and search queries you submit (including natural-language queries to the AI-assisted search tool), so the Service can return results and we can maintain and improve it.",
      "Contact form submissions: if you use the Contact Us form, we collect your name, email address, selected topic, and message so we can respond to you.",
      "We do not knowingly collect sensitive personal information (such as government ID numbers, health data, or precise geolocation), and we ask that you not include it in free-text fields like search queries or contact messages.",
    ],
  },
  {
    heading: "3. How We Use Information",
    body: [
      "We use the information above to: operate, maintain, and secure the Service; authenticate you and keep you signed in; respond to support, partnership, press, and sales inquiries submitted through the Contact Us form; monitor and improve the Service's performance, features, and data quality; and comply with legal obligations.",
      "We do not use your account information to serve third-party advertising, and we do not sell your personal information.",
    ],
  },
  {
    heading: "4. AI-Assisted Features",
    body: [
      "Certain features, including natural-language search and company-data enrichment, are powered by third-party AI models (currently Anthropic's Claude). Query text and related context are sent to that provider to generate a response. We do not knowingly send account credentials or payment information to an AI provider, and query data is used to return your result, not to build an advertising profile of you.",
    ],
  },
  {
    heading: "5. Cookies and Local Storage",
    body: [
      "The Service uses browser local storage to keep you signed in between visits (so you don't have to log in every time) and to remember basic preferences such as your selected language. We do not currently use third-party advertising or cross-site tracking cookies.",
    ],
  },
  {
    heading: "6. How We Share Information",
    body: [
      "We share information with the service providers that operate the platform on our behalf, each acting under its own data-processing terms: Supabase (authentication, database, and hosting infrastructure), Anthropic (AI-assisted search and data enrichment), Resend (delivering Contact Us email notifications), and our hosting/deployment provider.",
      "We may also disclose information if required to do so by law, or if we reasonably believe disclosure is necessary to protect the rights, property, or safety of AlphaMap, our users, or the public.",
      "We do not sell personal information to third parties, and we do not share it for third-party marketing purposes.",
    ],
  },
  {
    heading: "7. Data Retention",
    body: [
      "We retain account information for as long as your account is active. If you close your account, we delete or anonymize your personal information within a reasonable period, except where we are required to retain it for legal, security, or legitimate business purposes (such as resolving disputes or enforcing our agreements). Contact form submissions are retained only as long as needed to address the inquiry.",
    ],
  },
  {
    heading: "8. Your Rights and Choices",
    body: [
      "Depending on where you live, you may have the right to access, correct, export, or delete the personal information we hold about you, or to object to or restrict certain processing. You can update your account details from your profile settings, or reach us through the Contact Us page to exercise any of these rights.",
      "You may close your account at any time; see our Terms of Use for details.",
    ],
  },
  {
    heading: "9. Data Security",
    body: [
      "We rely on our infrastructure providers' security controls (encryption in transit, access controls, and monitoring) to protect information, and we limit access to personal information to what is needed to operate the Service. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.",
    ],
  },
  {
    heading: "10. Children's Privacy",
    body: [
      "The Service is not directed to individuals under 18, consistent with the eligibility requirement in our Terms of Use, and we do not knowingly collect personal information from children.",
    ],
  },
  {
    heading: "11. International Data Transfers",
    body: [
      "Our service providers may process and store information in countries other than your own. Where this occurs, we rely on our providers' appropriate safeguards for cross-border data transfer.",
    ],
  },
  {
    heading: "12. Changes to This Policy",
    body: [
      "We may update this Privacy Policy from time to time to reflect changes to the Service or applicable law. If we make material changes, we will provide reasonable notice, such as an update to the \"last updated\" date below. Continued use of the Service after changes take effect constitutes acceptance of the revised policy.",
    ],
  },
  {
    heading: "13. Contact Us",
    body: [
      "Questions about this Privacy Policy, or requests relating to your personal information, can be sent through the Contact Us page.",
    ],
  },
];

export function PrivacyPolicy() {
  const { t, i18n } = useTranslation();

  return (
    <Layout>
      <div className="mx-auto max-w-[820px] px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <h1
          className="text-3xl sm:text-4xl font-normal tracking-tight text-[#0F172A] mb-2"
          style={{ fontFamily: "'Playfair Display', serif" }}
        >
          {t("landing.footer.privacy")}
        </h1>
        <p className="text-xs text-gray-400 mb-10">
          {t("auth.signup.lastUpdated", {
            date: new Date().toLocaleDateString(localeFor(i18n.resolvedLanguage ?? "en"), { month: "long", year: "numeric" }),
          })}
        </p>

        <div className="rounded-[10px] border border-gray-100 bg-white p-7 sm:p-9 shadow-[0_4px_20px_rgba(0,0,0,0.02)] space-y-7">
          {PRIVACY_SECTIONS.map((s) => (
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
