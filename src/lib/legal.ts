// Shared legal copy — used by the signup-flow Terms of Use modal
// (SignUp.tsx) and the public /terms page (TermsOfUse.tsx) so the two never
// drift out of sync.
//
// DELIBERATELY NOT LOCALISED. This is a binding contract, and terms like
// "as is"/"as available", "merchantability" and "indemnify and hold
// harmless" carry statutory meanings that differ by jurisdiction — several
// have no clean civil-law equivalent. Translating them without counsel
// review would change what users are agreeing to. Localised terms should be
// produced by a legal translator and reviewed per jurisdiction before being
// shown as the binding version.
export const TERMS_SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: "1. Acceptance of Terms",
    body: [
      "These Terms of Use (\"Terms\") govern your access to and use of AlphaMap (the \"Service\"), a private-market intelligence platform. By creating an account, you confirm that you have read, understood, and agree to be bound by these Terms. If you do not agree, do not register for or use the Service.",
    ],
  },
  {
    heading: "2. Description of Service",
    body: [
      "AlphaMap aggregates, structures, and analyzes information about private companies, investors, and market activity, including funding history, cap tables, headcount trends, and comparative scoring. The Service may use automated tools, including AI-assisted research and search, to compile and summarize publicly available information.",
      "AlphaMap is under active development. Features, pricing, and data coverage may change, and some functionality described as \"beta\" may be incomplete, limited in accuracy, or modified without notice.",
    ],
  },
  {
    heading: "3. Eligibility and Account Registration",
    body: [
      "You must be at least 18 years old and capable of forming a binding contract to use the Service. You agree to provide accurate, current information when registering and to keep your account credentials confidential. You are responsible for all activity that occurs under your account.",
      "You agree to notify us promptly of any unauthorized use of your account or any other breach of security.",
    ],
  },
  {
    heading: "4. Subscriptions, Fees, and Beta Pricing",
    body: [
      "Certain features of the Service require a paid subscription. Prices, billing cycles, and available tiers (including any promotional or beta pricing) are displayed at the time of purchase and may change going forward; changes will not retroactively affect an active billing period without notice.",
      "Where a feature is explicitly marked as a beta or discounted offering, pricing may be temporary and subject to change once the underlying feature is generally available.",
    ],
  },
  {
    heading: "5. Acceptable Use",
    body: [
      "You agree not to: (a) scrape, harvest, or bulk-export data from the Service beyond what your plan permits; (b) reverse-engineer, decompile, or attempt to extract the Service's underlying models, scoring methods, or source code; (c) use the Service to build a competing product; (d) misrepresent your identity or affiliation; (e) use the Service for any unlawful purpose, including in a manner that infringes the rights of any third party; or (f) use any content, summaries, insights, or data obtained through the Service to train, fine-tune, or develop artificial intelligence, large language models, or machine learning models.",
      "We reserve the right to suspend or terminate accounts that violate this section or that we reasonably believe pose a security, legal, or operational risk to the Service or other users.",
    ],
  },
  {
    heading: "6. Not Investment Advice",
    body: [
      "AlphaMap provides information and analytical tools for general research purposes only. Nothing on the Service constitutes investment, legal, tax, or financial advice, and no content should be relied upon as a recommendation to buy, sell, hold, or otherwise transact in any security or private instrument.",
      "You acknowledge that the Service relies on automated artificial intelligence tools and large language models, which are inherently subject to limitations and may occasionally generate inaccurate, incomplete, misleading, or entirely fabricated information (commonly referred to as \"hallucinations\").",
      "Company and investor data, including AI-generated summaries, scores, and valuations, may be incomplete, estimated, delayed, or inaccurate. You are solely responsible for independently verifying any information before making financial, investment, or business decisions, and you should consult a licensed financial, legal, or tax professional as appropriate. AlphaMap and its data are not a substitute for professional due diligence.",
    ],
  },
  {
    heading: "7. Intellectual Property",
    body: [
      "The Service, including its design, software, scoring methodologies, and original written content, is owned by AlphaMap and protected by applicable intellectual property laws. Subject to your compliance with these Terms, we grant you a limited, non-exclusive, non-transferable license to access and use the Service for your own internal research purposes.",
      "Underlying facts about third-party companies and investors are not owned by AlphaMap; our compilation, structuring, and analysis of that information is.",
    ],
  },
  {
    heading: "8. Third-Party Data and Links",
    body: [
      "The Service may reference or link to third-party websites, data providers, or search results. AlphaMap does not control and is not responsible for the accuracy, completeness, or availability of third-party content, and inclusion of such content does not imply endorsement.",
    ],
  },
  {
    heading: "9. Privacy",
    body: [
      "Our collection and use of personal information in connection with the Service is described in our Privacy Policy. By using the Service, you consent to that collection and use.",
    ],
  },
  {
    heading: "10. Disclaimer of Warranties",
    body: [
      "The Service is provided \"as is\" and \"as available,\" without warranties of any kind, whether express, implied, or statutory, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or that data will be complete or accurate.",
      "You acknowledge that the Service depends on third-party infrastructure and API providers (including, but not limited to, artificial intelligence models, cloud infrastructure, and live search engines). We are not responsible or liable for any service interruptions, delays, data losses, or failures caused by these third-party providers.",
    ],
  },
  {
    heading: "11. Limitation of Liability",
    body: [
      "To the fullest extent permitted by law, AlphaMap, its individual creators, developers, owners, officers, employees, and affiliates will not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or business opportunity, arising from your use of or inability to use the Service, including any financial or investment decision made in reliance on information obtained through the Service.",
      "Our total aggregate liability for any claim arising from these Terms or the Service is limited to the amount you paid us, if any, in the twelve (12) months preceding the claim.",
    ],
  },
  {
    heading: "12. Indemnification",
    body: [
      "You agree to indemnify and hold AlphaMap, its creators, and affiliates harmless from any claims, damages, liabilities, and expenses (including reasonable legal fees) arising from your violation of these Terms or misuse of the Service.",
    ],
  },
  {
    heading: "13. Termination",
    body: [
      "You may stop using the Service and close your account at any time. We may suspend or terminate your access if we reasonably believe you have violated these Terms, with notice where practicable. Provisions that by their nature should survive termination (including intellectual property, disclaimers, and limitation of liability) will survive.",
    ],
  },
  {
    heading: "14. Governing Law and Disputes",
    body: [
      "These Terms are governed by and construed in accordance with the laws of the State of Israel, without regard to its conflict-of-laws principles. Any dispute, controversy, or claim arising from or relating to these Terms or the Service shall be subject to the exclusive jurisdiction of the competent courts in Tel Aviv, Israel, except where mandatory local consumer-protection law provides otherwise.",
    ],
  },
  {
    heading: "15. Changes to These Terms",
    body: [
      "We may update these Terms from time to time to reflect changes to the Service or applicable law. If we make material changes, we will provide reasonable notice, such as an in-app notice or an update to the \"last updated\" date below. Continued use of the Service after changes take effect constitutes acceptance of the revised Terms.",
    ],
  },
  {
    heading: "16. Severability, Assignment, and Entire Agreement",
    body: [
      "If any provision of these Terms is found unenforceable, the remaining provisions will remain in full force and effect, and the unenforceable provision will be modified only to the extent necessary to make it enforceable. Our failure to enforce any provision is not a waiver of our right to do so later.",
      "You may not assign or transfer these Terms, by operation of law or otherwise, without our prior written consent. We may assign these Terms without restriction, including in connection with a merger, acquisition, or sale of assets.",
      "These Terms, together with our Privacy Policy, constitute the entire agreement between you and AlphaMap regarding the Service and supersede any prior agreements on this subject.",
    ],
  },
  {
    heading: "17. Contact",
    body: [
      "Questions about these Terms can be directed to the support contact listed in your account settings or on the AlphaMap website.",
    ],
  },
];
