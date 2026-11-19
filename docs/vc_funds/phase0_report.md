# AlphaMap Funds — דוח סבב ראשון

תאריך: 2026-11-19 · ענף: `claude/vc-funds` (מקומי, לא נדחף) · מצב: קריאה בלבד, שום דבר לא נכתב ל-DB.

## 0. מה לא הצלחתי לעשות, לפני הכול

**אין לי גישה ל-Supabase מהסביבה הזו.** אין בה משתני חיבור, ולכן **מספרי שורות, אחוזי מילוי, דוגמאות של 5 שורות ותוצאות שלב 0 עדיין חסרים.** הדוח מתבסס על המיגרציות, הסקריפטים, הממשק והמסמכים בריפו. מה שנכתב כאן על הסכמה מדויק לפי הקוד. מה שנכתב על תוכן הטבלאות הוא מסקנה מהקוד, לא מדידה.

כדי לסגור את החסר הכנתי שני כלים, שניהם קריאה בלבד:
- `scripts/sql/vc_funds_audit_readonly.sql`: 9 בלוקי SELECT. אביב מריץ אותם ב-SQL Editor ושולח חזרה את התוצאות. הם מחזירים רשימת טבלאות, עמודות, ספירות, אחוזי מילוי, מצב provenance, קישור ל-startups ו-5 שורות לדוגמה מכל טבלה.
- `scripts/vc_funds_stage0.ts`: שלב 0 (שמות משקיעים ← נרמול ← כיסוי מול הרשימה). הוא כותב CSV ל-`cache/vc_funds/` (בתיקייה שכבר ב-gitignore).

```bash
source ~/start.sh
INPUT=funds_input.csv npx tsx scripts/vc_funds_stage0.ts
```

אם תרצה שאריץ בעצמי, אפשר לתת חיבור קריאה בלבד דרך הטופס המאובטח (`request_credential`). אני ממליץ על role קריאה בלבד ולא על service key. בלי מפתחות בצ'אט.

שני ממצאי תשתית שדורשים החלטה (פירוט בסעיף 4):
1. **קוד v2 המשותף לא נמצא ב-`main`.** ענף `claude/alphamap-project-setup-wocluk` מקדים את main ב-99 קומיטים (182 קבצים). שם נמצאים: זיכרון מקורות, תרגום, שער רגרסיה, acceptance ו-`registries_plan.md`. קראתי אותו דרך `git fetch` בלבד. לא עשיתי merge.
2. **ענף `claude/vc-funds` נפתח מ-`main`** כפי שהוראת, ולכן אינו רואה את המודולים האלה. ראה שאלה 1 בסוף.

---

## 1. מלאי: מה כבר קיים בנושא משקיעים וקרנות

### 1.1 טבלאות ו-views

| שם | עמודות עיקריות | מקור הנתונים | מקור וציטוט? | קישור ל-startups |
|---|---|---|---|---|
| **`investors`** (טבלה; `20260617000001` ואחריה `…02`, `20260618…`, `20260701…`, `20260720000000`, `20260720000100`) | `name`, `slug`, `description`, `thesis`, `founded_year`, `headquarters`, `fund_size` (טקסט חופשי "$85B+"), `typical_check_size`, `portfolio_size`, `stages[]`, `sector_allocation` jsonb, `notable_investments[]`, `website`, `tier`, `firm_type` (`vc`/`pe`/`growth`), `leadership` jsonb, `last_enriched_at`, `enrichment_confidence`, `is_manually_verified` | `agent_vcs.ts` (פרופילים שנכתבו ביד), `agent_vcs_scraper.ts` (רשימת ויקיפדיה), `enrich_investors.ts` (חיפוש + מודל) | **לא.** אין provenance ואין ציטוט. יש רק `enrichment_confidence` שהמודל נתן לעצמו | **אין מפתח.** ההצלבה היא לפי שם: `lower(trim(name))` מול `funding_rounds.lead_investor` ו-`investors[]` |
| **`funding_rounds`** (העמודות של משקיעים בלבד) | `lead_investor text` (אחד), `investors text[]`, `investor_amounts jsonb`, `source_url` | v1, ועכשיו v2 | **חלקי.** שורות שנכתבו ב-v2 יש להן `field_provenance`. שורות v1 אין | `startup_id` (FK). זה ה"גשר" האמיתי היחיד |
| **`deals`** (`20260614000001`) | `company_name`, `startup_id`, `investors text[]` ("named lead investors", ריק ב-Form D), `deal_type`, `source_url`, `amount_raised`, `target_amount` | `fetch_sec_deals.ts`, edge function `ingest-sec-form-d` | יש `source_url`. אין ציטוט | `startup_id` נקבע לפי התאמת שם |
| **`vc_fund_filings`** (`20260726130000`) | `fund_name` (כפי שהוגש), `firm_name` (נגזר), `fund_series`, `fund_type`, `filing_date`, `year_of_inc`, `total_offering`, `total_sold`, `managers` jsonb, `investor_id` | SEC Form D, רק קרנות. נכתב דרך `record_fund_filing()` | **מקור כן, רמת רשם:** `accession_number` + `cik`. אין ציטוט (ה-`raw_payload` הוא הראיה) | `investor_id` אל `investors` כשהשם מתאים בדיוק. **לא נוצר אוטומטית.** אין קשר ל-startups |
| **`vc_fund_firms`** (view) | קיבוץ של `vc_fund_filings` לפי מנהל: `total_raised` (מ-`total_sold`), `largest_target`, `latest_series`, `managers`, `is_linked` | נגזר | נגזר | דרך `investor_id` |
| **`raw_gov_filings`** (`20260726110000`) | Form D של **חברות** (לא קרנות), `officers` | `ingest-sec-form-d` | מקור כן (accession) | `startup_id` |
| `watchlist_items` | `entity_type` (מכיל investor), `entity_id` | פעולת משתמש | לא רלוונטי | לא רלוונטי |
| `field_provenance`, `field_changes`, `enrichment_runs`, `enrichment_evidence`, `data_hints` | תשתית v2 | v2 | זה מנגנון ה-provenance | `startup_id` **NOT NULL** (חשוב לסכמה, ראה 3) |

### 1.2 פונקציות

`pe_firms_directory()`, `pe_firm_portfolio(name)`, `pe_firm_transactions(name)` (`20260720…`): נגזרות מסבבי `PE Buyout`, ‏`Secondary` ו-`Debt` עם התאמת שם `lower(trim())`. `investor_facts(names[])` (`20261023000000`, רק service role): ספירת חברות, סבבים והובלות לכל שם, בהתאמה **מדויקת** של שם. הקובץ מציין במפורש ש-"Sequoia" ו-"Sequoia Capital" הם שמות שונים. `fund_firm_name()`, `fund_series_number()` ו-`record_fund_filing()` הן הפרסור של שם קרן ל-firm ולמספר סדרה. `fund_series_number` כבר מטפל ב-Roman וב-"Fund N". מומלץ ללמוד ממנה, לא לכתוב מאפס.

### 1.3 סקריפטים וממשק

- `scripts/agent_vcs.ts`: פרופילים ידניים. מתוך הקוד אפשר לראות **5 קרנות בלבד לפי מה שנראה בקוד** (Sequoia, a16z, Accel, Lightspeed, Benchmark). הוא מערבב 70% בסיס ידני עם 30% מ-`deals`. לא מתאים לנו כמקור, כי הערכים לא מגיעים עם ציטוט.
- `scripts/agent_vcs_scraper.ts`: ויקיפדיה כמקור המוני. נתון בלי ציטוט ברמת הערך.
- `scripts/enrich_investors.ts`: הקרוב ביותר לרעיון שלנו (Serper + אתר הקרן + מודל, fill-null, סף ביטחון), אבל **בלי verbatim quote ובלי בדיקת נושא המשפט.** לכן הוא לא עומד בעיקרון המקור והציטוט.
- `fetch_sec_deals.ts` ו-`supabase/functions/ingest-sec-form-d`: איסוף Form D. הקרנות כבר נאספות ל-`vc_fund_filings` (**זה נכס שלא ידעתי שקיים, והוא מקצר את שלב 3**).
- `src/app/pages/VCs.tsx` והמודל שלו: לפי `docs/field_coverage_map.md §4`, הטאבים **Syndicate Intel, Exits ו-Fund Performance מנוצרים ב-client מ-hash של שם הקרן.** אין מאחוריהם נתון. כולל "MOIC", שנת אקזיט וציוני ביצועים.

> **שים לב.** ב-UI קיימים היום "ביצועי קרן" מומצאים. זה סותר את העיקרון המרכזי ואת הערך של benchmark אמיתי. לא נגעתי בזה. מומלץ להחליט (שאלה 5) אם להסתיר את הטאבים האלה לפני שמשתמשי קרנות רואים אותם.

### 1.4 מה עוד חסר בטבלאות הקיימות

- אין קשר ישיר בין `investors.id` ל-`startups.id`. ההצלבה היא לפי שם בלבד, בניגוד לכלל 7 (דומיין, או שם מלא ועיר).
- אין הבחנה בין חברת ניהול לקרן. `fund_size` הוא "AUM כטקסט חופשי" שיכול להיות גודל קרן או AUM, והעמודה לא מבדילה. זו בדיוק הערבוביה שהבריף מזהיר ממנה.
- `investors.tier` נגזר מ-`portfolio_size` (NTILE), לא מביצועים. המיגרציה עצמה מכנה אותו "mock".
- בטבלה `funding_rounds` אין תפקיד `co_lead` או `participant`. יש רק מוביל אחד ורשימה. כלל 2 ("Unknown אלא אם נאמר במפורש") לא נאכף שם. מוביל שנכתב ב-v1 עלול להיות ניחוש של מודל.
- `field_provenance.source_type` נגבל ב-CHECK ל-7 ערכים, **ללא `legacy`**. ההוראה "legacy" דורשת הרחבת ה-CHECK בטבלה משותפת, או טבלת provenance נפרדת (ההצעה שלי).

### 1.5 נתונים ישנים בלי מקור: לא נמחקים, מסומנים legacy

כל שורה ב-`investors` נחשבת legacy (אין להן מקור). ההצעה: היא נשארת כמו שהיא ו-`fund_firms.legacy_investor_id` מצביע עליה. ערך מ-`investors` נכנס ל-`fund_provenance` עם `source_type='legacy'` רק בצורה של ערך לאימות מחדש, ולא מוצג כמאומת עד שה-pipeline מצא לו מקור וציטוט.

---

## 2. מיפוי מול המודל המוצע

| קיים | יעד | החלטה |
|---|---|---|
| `investors.name`, `website` | `fund_firms.name`, `website` | **מועבר.** הדומיין הוא המפתח (כבר קיים `uq_investors_website`) |
| `investors.firm_type` (vc/pe/growth) | `fund_firms.investor_type` | **מורחב.** שבעה סוגים + שמירת ההכרעה. הערך הקיים נשאר רמז בלבד |
| `investors.description`, `thesis`, `founded_year`, `headquarters`, `stages`, `leadership` | אותם שדות ב-`fund_firms`/`fund_people` | **מועבר כ-legacy** ומאומת מחדש. `leadership` מפוצל ל-`fund_people` עם `role_class` (כלל 4) |
| `investors.fund_size` | `fund_firms.aum_text` + `aum_as_of` | **מועבר, עם החסר:** חסר תאריך מקור, וחסרה הבחנה בינו לבין גודל קרן. נשאר legacy עד שיש תאריך |
| `investors.typical_check_size` | `check_size_text` | מועבר כמו שנכתב. בשלות חלשה |
| `investors.sector_allocation`, `tier`, `notable_investments`, `portfolio_size` | — | **לא רלוונטי כמקור.** נגזר או בלי מקור. נשאר בטבלה הישנה ולא מועבר |
| `vc_fund_filings` | `fund_vehicles` | **מועבר.** `size_final`=`total_sold`, `target_size`=`total_offering`, `vintage_year` מתאריך המכירה הראשונה, `form_d_accession` מקור כן. קישור דרך `vc_fund_filing_id` |
| `vc_fund_filings.managers` | `fund_people` (כרמז) | **רמז בלבד.** Related persons ב-Form D אינם בהכרח Partners (כלל 4) |
| `funding_rounds.lead_investor` / `investors[]` | `fund_investments` (direction=`from_company_round`) | **מועבר, והוא הליבה.** מוביל ← `lead`. רשימה ← `unknown` ולא `participant`, אלא אם הציטוט אומר "with participation from". מוביל שנכתב ב-v1 ללא provenance נחשב legacy |
| `funding_rounds.investor_amounts` | — | נשאר בטבלת הסבבים. לא מעתיקים |
| `deals.investors` | `fund_investments` (כרמז) | **רמז.** "לידים מוצהרים" בלבד, בלי ציטוט |
| `pe_firms_*`, `investor_facts` | — | **נשארים.** משרתים את האפליקציה. אפשר להשתמש בהם לבדיקה צולבת |
| — | `fund_vehicles` (גודל, target, first close, vintage, סטטוס), `fund_lps`, `fund_performance`, `fund_investments` (role/status/waitlist), `fund_name_aliases`, `fund_metrics` | **חסר, ונוסיף** |
| — | רשם שותפויות ישראלי, Companies House (LP), Form ADV, דוחות קרנות פנסיה | **מקורות חדשים.** בשלב 3 וב-5 |

---

## 3. הצעת סכמה ו-migration (לא הורצה)

הקובץ המלא: `docs/vc_funds/proposed_migration.sql`. הוא **לא** בתיקיית `supabase/migrations/`, כדי שלא יורץ בטעות.

**ההמלצה: טבלאות נפרדות עם קידומת `fund_`, ולא טבלה משותפת עם `entity_type`.**
- **תוספת בלבד.** אין DROP/DELETE/ALTER לטבלה קיימת. `investors` ו-`field_provenance` לא נוגעים. כך v2 והאפליקציה לא יכולים להישבר.
- **`fund_provenance` נפרדת.** העמודות זהות ל-`field_provenance` (כולל `quote_original`/`quote_translated`), אבל הישות פולימורפית (`entity_type`+`entity_id`). הסיבה: `field_provenance.startup_id` הוא `NOT NULL` ו-FK, ויש בו CHECK בלי `legacy`. שינוי טבלה משותפת = שינוי קוד משותף = שער רגרסיה על מקבצים 5–7.
- **שתי רמות.** `fund_firms` (דומיין הוא המפתח, `UNIQUE`) ו-`fund_vehicles` (גודל, target ו-first close בשלוש עמודות נפרדות, vintage). כך גודל קרן לא מתערבב עם AUM.
- **כללים כ-CHECK.** `role` נקבע מראש ל-`lead`/`co_lead`/`participant`/`unknown`, ברירת מחדל `unknown` (כלל 2). `fund_performance` דורש `reporting_lp`, ‏`report_url` ו-`as_of` כ-NOT NULL (כלל 6). שורה עם `startup_id` חייבת `match_basis` (כלל 7).
- **`fund_waitlist`** לחברות שלא נמצאו או שההתאמה לא חד-משמעית. אחרי החלטה 3 היא מתחברת ל-`startups`.
- **`fund_metrics`** שומרת `n_points`, ‏`numerator` ו-`denominator` ו-`definition_version` לכל מדד.
- **גישה:** RLS פעיל, ללא policy, `service_role` בלבד (כמו `data_hints`). המקור והציטוט לא מוצגים בממשק.
- **Rollback:** מצורף בהערה בראש הקובץ. ה-DROP חל רק על טבלאות חדשות.

שתי נקודות שמצריכות אישור:
- **(א)** `run_id` ב-`fund_provenance` הוא כרגע בלי FK. כדי להצמיד אותו ל-`enrichment_runs` צריך להרחיב את ה-CHECK של `pipeline` (היום `'v1'`/`'v2'`) ל-`'funds'`. זה שינוי בטבלה משותפת, ולכן עובר את שער הרגרסיה. אם לא רוצים, נשאר בלי FK.
- **(ב)** הסכמה מניחה החלטה 1 = "כן". אם התשובה "לא", צריך לאחד את `fund_firms` ו-`fund_vehicles` ולהפריד בדרך אחרת.

---

## 4. מה משתמשים בו מ-v2, ומה יוצא למודול משותף

> זה מבוסס על כותרות הקבצים ועל `docs/process.md` בענף v2. **לא קראתי כל מודול עד הסוף.** לפני ההוצאה למודול משותף צריך לקרוא כל אחד ולבדוק איפה `startup_id` מקודד קשיח.

**כמו שהוא (אין תלות בסוג הישות):** `searchCache` ו-`recorder` (REPLAY), `models` (עלויות ותמחור), `translate`, `sitemap`, `sourceTypes`, `evidence` (verbatim quote), `regressionGate`, `acceptance`, `domainResolve`/`ownDomain` (domain_unresolved / repurposed), `people` (ניתוח תפקידים, לשותפים), `localSearch`, `aliases`, `nameCase`, והסקריפטים verify_batch, report_lint, compare_dry, show_report, rejected_review.

**למודול משותף (צריך הכללה מ-`startup_id` ל-entity):**
- `write.ts`/`writeCompany.ts`: כתיבה עם provenance. היום כותבת ל-`field_provenance` עם `startup_id`.
- `knownSources`/`knownGaps`: מפתח היום "company, field". צריך `entity_type`+`entity_id`.
- `subject.ts`: בדיקת נושא המשפט. נכתבה לישות אחת. לקרנות נדרש חילוץ **לכל קרן במשפט** (ראה "מה חדש").
- `techGate`/`techOverrides` ← שער סוג משקיע עם `investor_overrides` ושמירת ההכרעה.
- `undo_run`/`undo_value`/`batchProvenance`: מניחים `startup_id`.
- `sources.ts`: להוסיף ל-`REGISTRY_HOSTS` את IAPD ואת אתרי קרנות הפנסיה, ולהגדיר מה נחשב עיתונות VC מהימנה. SEC עצמו כבר ברשימה.

**חדש לקרנות (אין שימוש חוזר):** שער סיווג שבעת סוגי המשקיע; חילוץ תפקיד לכל קרן במשפט ("Led by X with participation from Y and Z"); פרסור שמות קרנות; אספני Form D (כבר קיים חלקית ב-`vc_fund_filings`) ו-Form ADV (IAPD); פרסור דוחות פנסיה; קריאת עמוד פורטפוליו (כולל alt text, שם קובץ וקישור ללוגואים); חישוב המדדים.

כלל עבודה: כל שינוי בקוד המשותף עובר את שער הרגרסיה של v2 על מקבצים 5–7 לפני merge.

---

## 5. פורמט קובץ הקלט

`docs/vc_funds/funds_input.example.csv`:

```csv
name,website
Index Ventures,https://www.indexventures.com
Accel,https://www.accel.com
```

חובה: `name`, ‏`website`. הדומיין הוא מפתח הזיהוי (כלל 7). אם אביב רוצה לעזור בהפרדה, מומלץ להוסיף עמודה אופציונלית `hq_city`. היא לא נאספת מאביב (הבריף אומר שם ואתר בלבד), אלא משמשת כרמז להתאמת שם מלא ועיר בלבד ולא נכתבת. לפיילוט (שלב 1) מומלץ לצרף עמודות `region` (US/IL/EU/ASIA_LATAM) ו-`size_band`, כדי שהמדגם יהיה מרובד כמבוקש (10/5/5/5).

---

## 6. שלב 0: תוצאות

**ממתין לגישת DB** (ראה סעיף 0). מה כן נעשה:

- `lib/funds/investorNames.ts`: נרמול שמות עם **שני מפתחות**. `exact_key` מסיר רק צורת תאגיד (L.P., LLC, Ltd) ואת מספר הקרן. `loose_key` מסיר גם Capital/Ventures/Partners, **ומשמש רק לגילוי אשכולות לבדיקה אנושית, לעולם לא למיזוג.** הסיבה: בבריף "Index", ‏"Index Ventures" ו-"Index Capital" הן ישויות שונות. נרמול אגרסיבי יאחד אותן ויעוות את הספירה.
- בדיקות: 9 בדיקות עוברות (`vitest`). הן מכסות בין היתר את המקרה Index/Index Ventures/Index Capital, `Index Ventures Growth VI L.P.` ← מספר סדרה 6, ו-"IV" ו-"Ltd" כשם שלם.
- `scripts/vc_funds_stage0.ts`: מייצר את הדוחות המבוקשים, וההתאמה לרשימה של אביב היא **לפי דומיין** (דרך `investors.website`). התאמת שם בלבד מסומנת `name_only_estimate` ולא נספרת כהתאמה.

פלט שישלח אחרי ההרצה: `investor_names.csv`, ‏`ambiguous_clusters.csv`, ‏`list_coverage.csv`, ‏`frequent_not_in_list.csv`.

---

## 7. הערכת עלות לפיילוט של 25 קרנות

**זו הערכה מהנחות, לא מדידה.** מחירי המודלים לקוחים מ-`models.ts` בענף v2: ‏Haiku 4.5 ב-$1 / $5 למיליון טוקנים, ו-Haiku 5.5 ב-$0.10 / $0.50. מחיר החיפוש (Serper/Tavily) לא נבדק ולכן לא נכלל.

| רכיב | הנחה | Haiku 4.5 | Haiku 5.5 |
|---|---|---|---|
| חילוץ מודל | ~6 קריאות לקרן (פרופיל, צוות, פורטפוליו ×3, חדשות), ~25K קלט + 3K פלט כל אחת | ~$0.24 לקרן | ~$0.025 לקרן |
| 25 קרנות | | **~$6** | **~$0.6** |
| תרגום, ניסיון חוזר, אימות | +50% | ~$9 | ~$1 |
| חיפוש | ~12 שאילתות לקרן. מחיר לשאילתה לא נבדק | להוסיף | להוסיף |
| Form D, ADV, EDGAR, קרנות פנסיה, אתר הקרן | חינמי | $0 | $0 |
| ריצה רטובה (REPLAY) | אפס | $0 | $0 |

**טווח מעשי: כ-$10–15 על Haiku 4.5, או כ-$1–3 על Haiku 5.5, בלי חיפוש.** `MAX_ARTICLES=8` נשמר. לפני ריצה בתשלום ארוץ ריצה יבשה על 3 קרנות, אמדוד עלות אמיתית לקרן ואציג מספר מעודכן לאישורך.

---

## 8. מה נוצר בענף (לא קומיט, לא נדחף)

- `lib/funds/investorNames.ts` + `investorNames.test.ts`
- `scripts/vc_funds_stage0.ts` (קריאה בלבד)
- `scripts/sql/vc_funds_audit_readonly.sql` (SELECT בלבד)
- `docs/vc_funds/` (דוח זה, `proposed_migration.sql`, `funds_input.example.csv`)

## 9. שאלות שמחכות לאביב

1. **ענף וקוד משותף.** האם לפתוח את `claude/vc-funds` מתוך ענף v2 (נראה לי נכון, כי שם המודולים המשותפים), או להמתין שיעשה merge ל-`main`? **ההמלצה: מענף v2, ולבצע rebase אחרי ה-merge.** כדי לא לעבור על הכלל "אם git מתפצל אני עוצר", לא עשיתי merge או rebase בעצמי.
2. **גישת DB לקריאה בלבד.** להריץ את ה-SQL בעצמך, או לתת role קריאה בלבד דרך הטופס המאובטח.
3. **הקומיט והדחיפה.** האם לעשות commit לקבצים ולדחוף ענף `claude/vc-funds` ל-mirror, כדי שתפתח MR ב-GitLab.
4. **ארבע החלטות פתוחות מהבריף.** (1) firms/funds נפרדות, ההמלצה כן. (2) ישות שאינה VC, ההמלצה לדלג ולרשום כמו בחברות, וסוג המשקיע נשמר, כך שאפשר להפעיל אותה בהמשך. (3) חברה בפורטפוליו שלא נמצאת במאגר, ההמלצה **לרשום ב-`fund_waitlist` ולא להוסיף ל-`startups`** בשלב הפיילוט, כדי לא לזהם את v2 ולא להעמיס עליו חברות שלא עברו שער טק. (4) הרצה במקביל ל-v2, ההמלצה **לא במקביל לריצות רטובות.** שלבים 0–2 (קריאה, ריצה יבשה) אפשריים עכשיו. כתיבה אחרי שמקבצי החברות רצים בתהליך החדש.
5. **טאבי "ביצועי קרן" המומצאים ב-VCs.** להסתיר אותם בממשק? זה לא בהיקף הסבב הזה, אבל הם סותרים את העיקרון המרכזי.
