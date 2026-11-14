/**
 * lib/enrichment/sectorDefinitions.ts — one line for every sub-sector: what belongs in it and how it differs from the
 * nearest one (owner, 2026-11-10, taxonomy review). The lines go into the classification prompt (sectorGuidance), so the
 * model chooses by a definition, not by a name.
 */
export const SECTOR_DEFINITIONS: Record<string, string> = {
  // AI & ML
  "AI / General": "AI is the product but no narrower AI sub-sector fits.",
  "LLMs": "builds or serves large language models themselves (foundation-model labs, model APIs); not a product that merely uses one — that is Generative AI or AI Agents.",
  "Generative AI": "products whose output is generated content (text, image, audio, video, code) for end users; not the model lab itself (LLMs) and not autonomous task-doers (AI Agents).",
  "Computer Vision": "the product analyzes the content of images or video with machine vision (inspection, imaging analysis, object detection); video or images as a medium for selling, advertising or entertainment is not Computer Vision; never for speech or text.",
  "NLP / Speech": "text and language understanding as the core technology (classification, extraction, search over text); voice products go to Voice & Speech AI.",
  "AI Agents": "agents sold as the product for any customer, carrying out multi-step tasks autonomously on a user's behalf; an agent built for one industry (HR, finance, health, security) belongs to that industry; not a chatbot or a content generator.",
  "MLOps": "tools to train, deploy, monitor and govern machine-learning models for other teams; not the AI hardware or cloud (AI Infrastructure).",
  "AI Infrastructure": "compute, chips-as-a-service, inference platforms and data-center software for running AI; not the tooling teams use on top of it (MLOps).",
  "Voice & Speech AI": "the product is speech: recognition, transcription, captioning, dubbing, voice agents or synthesis; text-only language AI is NLP / Speech.",
  // Fintech
  "Fintech / General": "a financial product that fits no narrower fintech sub-sector.",
  "Payments": "moves money for merchants or consumers: payment acceptance and terminals (POS swipe machines, card readers), acquiring, cross-border transfers, wallets; not the bank or lender behind it.",
  "Banking / Neobanking": "a bank, neobank or banking-as-a-service front end holding customer accounts; not payments processing alone.",
  "Insurance / Insurtech": "sells, underwrites or administers insurance with technology (car, health, claims software for insurers).",
  "Lending": "originates, scores or services loans and credit (BNPL, SME lending, mortgages); not deposit accounts.",
  "Crypto / Web3": "blockchain, tokens, digital-asset custody or exchanges.",
  "WealthTech": "investing, savings, trading, portfolio and pension tools for individuals or advisers.",
  "RegTech": "software that checks a business against regulation or policy (compliance monitoring, KYC/AML, review of marketing or communications); not security tooling.",
  "Fintech Infrastructure": "banking as a service, card issuing, ledgers and financial APIs that banks and fintech builders build on; not payment acceptance (Payments) and not finance software a company's own finance team uses (ERP / Finance): subscription billing and revenue-management software is ERP / Finance even when it calls itself infrastructure.",
  // Cybersecurity
  "Cybersecurity / General": "security is the product but no narrower security sub-sector fits.",
  "Identity & Access": "who may log in or act: authentication, SSO, passwordless, privileged access.",
  "Endpoint Security": "protects laptops, servers and devices (EDR, antivirus, device control).",
  "Cloud Security": "the product secures cloud workloads and configurations (CSPM, CNAPP); a product that merely runs in the cloud is not Cloud Security.",
  "Threat Intelligence": "collects and analyzes information on attackers, malware and exposures to inform defenders.",
  "Zero Trust": "network and access architecture that verifies every request (ZTNA, micro-segmentation).",
  "Data Security": "protects data itself: DLP, encryption, tokenization, data-privacy controls.",
  "Security Testing": "tests defenses by attacking them: pentesting, breach and attack simulation, security validation; finding and ranking weaknesses in existing assets is Vulnerability Management.",
  "Vulnerability Management": "finds, prioritizes and remediates weaknesses across assets and code; differs from Security Testing, which simulates attacks to check whether defenses hold.",
  "Application & API Security": "protects applications and APIs: API discovery and testing, WAF, code and runtime protection.",
  "Fraud & Abuse Prevention": "detects fraudulent users, bots, account takeover and abuse in applications; not network security.",
  "Managed Security Services": "a provider that runs security for customers as a service: managed detection and response (MDR), MSSP, security consulting, incident response; differs from the product categories above, which sell software.",
  "Email Security": "protects mailboxes and content channels from phishing, malware and business email compromise.",
  // SaaS & Dev Tools
  "SaaS / General": "business software with no narrower fit and no single customer industry; never a default for a product that has a clear category.",
  "Developer Tools": "software developers or product teams use to build, ship and document software (SDKs, changelogs, testing, code hosting).",
  "DevOps / CI-CD": "build, release and infrastructure automation (CI/CD, build systems, deployment, infrastructure as code).",
  "API Platforms": "APIs sold as the product (telephony, maps, messaging, identity as an API) for developers to embed.",
  "Low-Code / No-Code": "lets non-programmers build applications and workflows visually.",
  "Data Infrastructure": "databases, warehouses, pipelines and streaming platforms.",
  "Observability & Monitoring": "watches systems, metrics and business KPIs for anomalies and incidents (logs, traces, anomaly detection); not security monitoring.",
  "Vertical SaaS": "software built for one industry's workflows; the sector is the customer's industry and this is added as a tag.",
  // E-commerce & Retail
  "E-commerce / General": "online selling with no narrower fit.",
  "D2C": "a brand that sells its own products directly to consumers.",
  "Marketplaces": "a platform matching many sellers and buyers.",
  "Logistics / Supply Chain": "moves, stores or tracks goods (freight, warehousing, last mile, supply-chain visibility).",
  "Retail Tech": "technology for physical stores (smart carts, in-store analytics, shelf monitoring, POS software).",
  // Health & Life Sciences
  "Digital Health": "care delivered or supported by software for patients and clinicians (telehealth, remote monitoring).",
  "MedTech": "medical devices and clinical diagnostics, including AI-based diagnostic tools: software that analyses images or samples to grade, diagnose or screen (embryo grading, AI diagnostics) is MedTech even when clinics buy it as a platform.",
  "Biotech / Genomics": "biotech and pharma: drug discovery, therapeutics, synthetic biology and the biological manufacturing of pharmaceutical ingredients (engineered microbes, fermentation), genomics; food made by cells is FoodTech.",
  "Mental Health": "mental-health care, therapy and wellbeing programs.",
  "Healthcare SaaS": "clinical and patient-facing software sold to providers (patient engagement, clinical workflow, decision support); practice management, EHR, billing and authorization are Healthcare IT & Administration; software that analyses images or samples to diagnose or grade is MedTech.",
  "Healthcare IT & Administration": "the administrative and operating side of healthcare organizations: practice management, EHR, scheduling, billing, coding, claims, prior authorization, for providers, payers and pharmacies; clinical and patient-facing software is Healthcare SaaS.",
  // Climate & Energy
  "CleanTech": "technology that cuts emissions or resource use (solar, storage, recycling, materials from waste).",
  "EnergyTech": "software and hardware for producing, trading or managing energy (grid, EV charging, utilities).",
  "Carbon Markets": "carbon credits, accounting and offsets.",
  "Sustainability": "reporting, measurement and improvement of environmental and social performance.",
  // Enterprise Software
  "Enterprise / General": "software for large organizations with no narrower fit.",
  "CRM": "manages customer relationships and sales pipelines; revenue-process tools such as quoting are Sales Tech.",
  "HR Tech": "hiring, onboarding, payroll, talent and workforce planning, internal mobility and talent matching (including agentic HR), freelancer and contingent-workforce management and talent marketplaces for work.",
  "ERP / Finance": "finance software for a company's own finance team: accounting, FP&A, budgeting, planning and consolidation, procurement and spend management, billing, invoicing and subscription revenue operations.",
  "Analytics / BI": "dashboards, reporting and data analysis for business users, including market-data products.",
  "Sales Tech": "helps sales teams sell: quoting and CPQ, revenue operations, sales engagement; differs from CRM, which stores the relationship.",
  "Productivity & Collaboration": "tools for personal and team work: email, docs, meetings, notes, task management; engineering and product-lifecycle tools for hardware teams are Advanced Manufacturing.",
  "Customer Support & CX": "customer service desks, support automation and customer-experience measurement.",
  "Marketing Tech": "marketing automation, content, attribution and customer-engagement software; media buying is AdTech.",
  "Legal & Compliance Software": "contracts, e-discovery, legal operations and corporate compliance workflow for in-house and law-firm teams.",
  // Consumer & Media
  "Consumer / General": "a consumer product with no narrower fit.",
  "Social Media": "social networks and communities.",
  "Gaming": "video games and game platforms; tools for game developers are Developer Tools.",
  "EdTech": "learning, training and education products.",
  "Travel & Hospitality": "booking, hotels, restaurants and tourism services.",
  "Media / Content": "publishing, streaming, creator platforms and content production.",
  "AdTech": "buying, selling, measuring or serving advertising, including in-game and out-of-home advertising.",
  "Travel Tech": "technology for the travel journey itself: airline and airport systems, booking engines, self-service kiosks; differs from Travel & Hospitality, which sells the stay or trip.",
  // DeepTech
  "DeepTech / General": "hard-science or hardware company with no narrower fit; never for software.",
  "Quantum Computing": "quantum hardware, software or sensing.",
  "Robotics": "robots and autonomous machines as the product when the robot is the research or general-purpose product; mobile robots (AMR, AGV), cobots and pickers that automate factory or warehouse work are Industrial Automation (Robotics is then a tag).",
  "Space Tech": "space and defense: rockets and launch vehicles, satellites, missiles, rocket motors and propellants, defense systems; a company that builds rockets or missile propulsion is Space Tech even when it 3D-prints its engines or manufactures the parts.",
  "Semiconductors": "chips and chip design, including photonic and AI accelerators.",
  "Advanced Materials": "new materials as the product (polymers, composites, materials made from waste).",
  "IoT & Connectivity": "connected devices, sensors and the networks that link them (telematics, LPWAN, satellite IoT).",
  // Industrial & Manufacturing
  "Industrial / General": "industrial company with no narrower fit.",
  "Industrial Automation": "automation, control and machine-vision systems on production lines, and mobile robots (AMR, AGV), cobots and pickers that automate factory and warehouse work.",
  "Advanced Manufacturing": "the product IS manufacturing technology: engineering and production software for hardware makers (BOM, ECO, PLM, MES), process digital twins, 3D printers and printing services, factory production optimization; a company that makes a product in another category (rockets, drugs, food, chips) is classified by that product, never by how it is made.",
  "Construction Tech": "software and tools for building and contracting (roofing, estimating, project management for construction trades).",
  // Food & Agriculture
  "FoodTech": "food production and food products made with technology (cultivated meat, alternative protein, food automation).",
  "AgTech": "farming technology: crops, orchards, yield forecasting, agricultural data and inputs.",
  // Automotive & Mobility
  "Automotive / General": "automotive company with no narrower fit.",
  "Vehicle Security": "protects vehicles and connected-car data and fleets from attack; the sector is Automotive & Mobility, not Cybersecurity.",
  "Autonomous Driving": "self-driving software, sensors and teleoperation.",
  "Mobility Services": "ride, fleet, scooter, parking and car-sharing services.",
  // Real Estate
  "PropTech": "technology for property: rental management, listings, mortgages, building operations.",
};

/** Words too common to show that a description is about a sub-sector. */
const GENERIC = new Set(["software", "platform", "technology", "product", "products", "company", "companies", "services", "service", "business", "businesses", "tools", "systems", "system", "data", "solutions", "customers", "teams", "management", "operations", "enterprise", "digital", "online", "provides", "that", "with", "from", "their", "which", "also", "used", "into", "over", "across"]);
const stems = (t: string) => new Set((t.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !GENERIC.has(w)).map((w) => w.slice(0, 5)));

/**
 * Whether the description is about the sub-sector at all: it shares a content word with the sub-sector's name or definition
 * (owner, 2026-11-10, review 9: a rocket maker came back as PropTech). "... / General" fits anything and is not checked.
 */
export function definitionSupports(sub: string | undefined, description: string): boolean {
  if (!sub || /\/\s*general$/i.test(sub)) return true;
  const def = SECTOR_DEFINITIONS[sub];
  if (!def) return true;
  const have = stems(description);
  // The part of the definition that says what belongs, not the part that says what does not ("never …", "differs from …").
  const positive = def.split(/;|\bdiffers\b|\bnever\b|\bnot a\b/i)[0];
  for (const w of stems(`${sub} ${positive}`)) if (have.has(w)) return true;
  return false;
}

export const SECTOR_RULES = `RULES FOR THE SECTOR
- The sector is the MARKET the company serves. AI, vision, speech and agents are technologies: a company that applies them for an industry (HR, finance, health, security, manufacturing, retail) belongs to that industry, and the AI sub-sector goes among the other fields (tags). Use an AI & ML sub-sector only when the company sells the technology itself (models, AI infrastructure, MLOps, a speech or vision engine as the product).
- ONE main sector and sub-sector: the most specific one that fits what the verified description says the company sells.
- A "… / General" sub-sector only when no other sub-sector fits at all.
- Software for one industry's customers: the sector is the CUSTOMER'S industry (roofing contractors → Industrial & Manufacturing › Construction Tech; landlords → Real Estate › PropTech; therapists and prior-authorization teams → Health & Life Sciences › Healthcare IT & Administration); list "Vertical SaaS" among the other fields.
- Other fields the company operates in go in sub_sector_names (tags), not in the main sector.
- "… / General" is a last resort: before using it, check every specific sub-sector of every sector against what the description says the company sells.
- Computer Vision only when the product processes images or video. A product that runs in the cloud is not Cloud Security.`;

/** The classification guidance for the prompt: each sub-sector with its definition, limited to those the database knows. */
export function sectorGuidance(known?: readonly string[]): string {
  const names = Object.keys(SECTOR_DEFINITIONS).filter((n) => !known?.length || known.includes(n));
  return `SUB-SECTOR DEFINITIONS (choose by the definition, not the name):\n${names.map((n) => `- ${n}: ${SECTOR_DEFINITIONS[n]}`).join("\n")}\n\n${SECTOR_RULES}`;
}
