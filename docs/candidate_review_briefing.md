# תדריך לסוכן: שיפור תהליך אישור מועמדים (Company Candidates) ב-AlphaMap

מטרה: כשמנהל המחקר מקבל חברה לאישור, שיראה מספיק מידע כדי להחליט. היום הוא רואה בעיקר שם ומיקום. הנתונים כאן נלקחו מהקוד בריפו (נבדק ב-2026-11-18). מה שלא נבדק מסומן "לא נבדק".

## 1. הבעיה

מועמד מגיע לתור האישור כמעט בלי הקשר. אין אתר, אין תיאור של מה החברה עושה, ואין אימות שהיא חברה אמיתית ולא shell, קבלן עצמאי או סוכנות. לכן אי אפשר להבדיל בין חברת טכנולוגיה לבין חברה שרשמה קוד SIC של תוכנה "ליתר ביטחון".

**הסיבה המבנית:** ההחלטה מתקבלת לפני ההעשרה. מנגנון ה-enrichment (`worker/`, שלבים עד Stage 10) רץ רק על חברות שכבר נמצאות ב-`startups`, כלומר אחרי אישור. מועמד ממתין להחלטה בלי שום חיפוש אתר או אימות.

## 2. איך זה עובד היום

### 2.1 איסוף (Supabase Edge Functions, `supabase/functions/`)

| מקור | פונקציה | תזמון | מה נשמר |
|---|---|---|---|
| UK Companies House | `ingest-uk-companies-house` | הקמות של אתמול | מספר חברה, שם, תאריך הקמה, סטטוס, סוג חברה, קודי SIC, `locality` של הכתובת הרשומה (עיר בלבד), דירקטורים (שם ותפקיד, אחרי קריאה נפרדת לכל חברה) |
| SEC Form D | `ingest-sec-form-d` | pg_cron כל 10 דקות, 04:00-13:50 UTC | שם, CIK, `industryGroupType`, שנת הקמה, jurisdiction, related persons (שם ותפקיד), `totalOfferingAmount`, `totalAmountSold` |
| EPO patents | `ingest-epo-ops` | | שם מבקש הפטנט, כותרת, תקציר, קודי CPC |
| GitHub / Hugging Face | `ingest-github-velocity`, `ingest-huggingface` | | פרויקטים וארגונים עם דף בית משלהם |

קרנות (Form D עם `investmentFundInfo`) לא הופכות למועמדים. הן נשמרות ב-`vc_fund_filings`.

### 2.2 סינון אוטומטי (Quality Gate, `supabase/functions/_shared/company-gate.ts`)

הפונקציה מחזירה לכל רשומה אחד משלושה פסקי דין. הכלל הוא "Missing is better than wrong": בספק, דוחים.

- `reject`: לא נוצר מועמד. הסיבות נשמרות ב-`raw_gov_filings.gate_reasons`.
- `queue`: מועמד לתור האישור, בלי התראה למשתמשים.
- `alert`: מועמד לתור האישור וגם התראה מיידית למשתמשים.

כללי UK (`gateUkCompany`):
- סוג חברה חייב להיות ltd, plc או private-unlimited.
- חייב קוד SIC של מוצר (62011, 62012, 63110, 63120, 72110, 72190, חומרה 26xxx, תקשורת 61xxx). קודי שירות בלבד (62020, 62030, 62090, 63990) נדחים.
- נדחים sectors חסומים: אחזקות, השקעות, נדל"ן, ייעוץ, גיוס, פרסום, קמעונאות ועוד.
- נדחים שמות עם מילים כמו holdings, group, consulting, services, capital.
- נדרשים לפחות 2 דירקטורים (אנשים, לא corporate או nominee). דירקטור יחיד או היעדר מידע על דירקטורים הם סיבת דחייה.

כללי SEC (`gateFormD`):
- קבוצת תעשייה "core" (technology, computers, telecommunications, other technology, biotechnology) מקבלת `alert`, אם החברה חדשה (עד 5 שנים).
- קבוצות "adjacent" (pharma, manufacturing, business services, other ועוד) מתקבלות רק אם השם מכיל מילת deep-tech, ומקבלות `queue`.
- נדחים שמות של כלי השקעה (fund, SPV, series, L.P., holdings).

### 2.3 יצירת המועמד (`ingest_gov_entity_filing`, migration `20261016000000`)

1. ניסיון התאמה לחברה קיימת לפי CIK, מספר Companies House, דומיין, שם+מדינה ו-slug. אם נמצאה, הרשומה מקושרת אליה ואין מה לאשר.
2. אם לא נמצאה ו-gate אינו `reject`, נוצרת שורה ב-`company_candidates` (מפתח ייחודי: `source` + `candidate_key`).
3. עמודת `website` קיימת בטבלה, אבל `ingest-uk-companies-house` ו-`ingest-sec-form-d` לא ממלאים אותה. לכן לכל מועמד כאלה אין אתר.
4. כל מה שיש על החברה נשמר ב-`evidence` (jsonb).

### 2.4 מה המנהל רואה (`/admin/review`, `src/app/pages/AdminReview.tsx`, `src/lib/candidateReview.ts`)

הכרטיס בנוי מ-`evidenceLines()`. ל-SEC: Industry, Raising, Codes, Related people, Jurisdiction, Founded, Country, Filed. ל-UK: SIC codes, Directors, Company type, Founded, Country, Filed. יש גם קישור לרשומה הרשמית (`registryUrl`: EDGAR או find-and-update.company-information.service.gov.uk).

אין: אתר, תיאור פעילות, אימות שהאתר שייך לחברה, כתובת מלאה, הקשר בין הדירקטורים לחברות אחרות, וסיכום או המלצה.

פעולות: Approve (יוצר שורה ב-`startups` דרך `approve_company_candidate`), Reject עם הערה (נשאר נדחה לצמיתות ולא יוצע שוב), פעולות מרובות, סינון לפי source ו-status. התראות: פעמון יומי ומייל שבועי (`admin-review-digest`).

### 2.5 מה שקורה אחרי האישור

מנגנון enrichment v2 (`worker/identify.ts`, `search.ts`, `enrich.ts`, `promote.ts`, מפרט ב-`docs/enrichment_v2_spec.md`) מחפש אתר, מזהה, אוסף ומעשיר. ב-`worker/deepen.ts` יש גם "Deepen this profile". כלומר רכיבי זיהוי וחיפוש אתר קיימים כבר, אבל הם רצים רק אחרי ההחלטה. לא קראתי את `identify.ts` ו-`search.ts` לעומק (לא נבדק): אילו מנועי חיפוש, מה העלות לשאילתה, ומה בדיקת ההתאמה שהם עושים.

## 3. הכיוון המוצע: העשרה לפני ההחלטה

להוסיף שלב **pre-review enrichment** על מועמדים במצב `pending`, שמכין לכל אחד כרטיס החלטה. הכרטיס מבוסס על הפורמט שהוגדר לאנליסט:

1. **אתר רשמי מאומת**, או "לא נמצאה זהות דיגיטלית מאומתת".
2. **הצלבת זהות (Entity Matching)**: האתר נחשב שייך לחברה רק אם יש התאמה של שם דירקטור או מייסד, מיקום, או תאריך הקמה. להציג גם את סימני ההתאמה עצמם.
3. **תיאור פעילות בשורה אחת**, עובדתי, מתוך האתר או הטופס. בלי ניחוש לפי השם.
4. **סיגנלים מהטופס** (הרחבה בסעיף 4).
5. **המלצה**: מומלץ לאישור, גבולי או לדחייה, עם נימוק קצר.
6. **קישורים למקורות**.

כללי המקורות: אתר החברה הרשמי, טפסים רגולטוריים, הודעות לעיתונות ועיתונות טכנולוגית/עסקית מוכרת. לא להסתמך על Crunchbase, PitchBook, Dealroom, ויקיפדיה או פורומים. כל גישה לאתרים צריכה לציית ל-`docs/crawl-policy.md` (User-Agent כן, robots.txt, אחסון מינימלי, opt-out).

אפשרויות מימוש:
- **שדות חדשים ב-`company_candidates`** (או תחת `evidence.enrichment`): `website_verified`, `description`, `match_signals`, `recommendation`, `recommendation_reasons`, `source_urls`, `enriched_at`.
- **הצגה ב-`evidenceLines()`/AdminReview**, ומיון התור כך שהמומלצים לאישור יהיו ראשונים והדחויים נדחסים או נסגרים אוטומטית.
- **דחייה אוטומטית** של מועמדים שכל הסימנים מצביעים על רעש (שימו לב: לשקול דחייה "רכה" שניתנת לביטול, כי הכלל הקיים הוא שדחייה אינה הפיכה).

## 4. מידע נוסף שאפשר לשלוף מהמקורות הקיימים

כל הפריטים כאן הם מידע שקיים במקור. **לא נבדק** מה מהם כבר מנותח על ידי הקוד הנוכחי.

**Companies House (API רשמי):**
- כתובת רשומה מלאה (היום נשמרת רק העיר).
- `persons-with-significant-control`: בעלי שליטה.
- ההיסטוריה של הדירקטורים: מינויים אחרים, כלומר מייסד סדרתי, וחברות אחרות שלהם. הצלבה עם חברות מוכרות במאגר.
- `filing-history`: האם הוגשו הקצאות מניות (סימן לגיוס), ואיזה סוג חשבונות (micro-entity מעיד על פעילות קטנה).
- תאריך הקמה והגיל של החברה.

**SEC Form D:**
- כתובת המקום העיקרי של הפעילות וטלפון.
- Related persons עם תפקידים וכתובות.
- Issuer size (טווח הכנסות), תאריך המכירה הראשונה, מספר המשקיעים, סכום מינימלי להשקעה, פטורי רגולציה.
- Sales compensation (מתווכים): סימן לגיוס מסודר.
- Form D קודמים של אותו CIK (היסטוריית גיוס).

**ישות אחת ומקורות שונים:** אותה חברה יכולה להופיע גם ב-EPO (פטנטים) וב-GitHub/HF. הצלבה בין מועמדים או מול `company_identifiers` נותנת סיגנל חזק.

## 5. הרחבת מקורות (השלב הבא, לא עכשיו)

המבנה הקיים מאפשר הוספת מקור חדש בשלושה חלקים: Edge Function בשם `ingest-<source>`, פונקציית gate ב-`company-gate.ts`, והוספת ה-source ל-`SOURCE_LABEL`, `registryUrl` ו-`evidenceLines`. מקורות מועמדים: רשמי חברות בעולם (למשל אירלנד CRO, צרפת INPI/Sirene, גרמניה Handelsregister, קנדה, אוסטרליה ASIC, ישראל רשם החברות), טפסי גיוס נוספים, מאגרי מענקים (Innovate UK, Horizon/CORDIS, SBIR) ופטנטים (USPTO קיים כ-`ingest-uspto-patents`). בכל מקור יש לבדוק רישוי, API או bulk, וקצב מותר.

## 6. שאלות פתוחות להחלטה

1. תקציב ועלות: כמה שאילתות חיפוש ל-pending candidate מקובל? (יש כמה עשרות מועמדים ביום.)
2. האם ההעשרה רצה ב-worker הקיים (Fly.io/Railway, `worker/`) או כ-Edge Function?
3. האם להשתמש ב-LLM לסיכום (יש `_shared/llm-client.ts`), ואיך מבטיחים "אפס ניחושים" (למשל, חובה לצטט משפט מהאתר)?
4. האם דחייה אוטומטית מותרת, או רק סימון והמלצה לדחייה?
5. אם לא נמצא אתר, האם המועמד מוסתר, יורד בדירוג, או נשאר גלוי עם סימון "לא נמצאה זהות דיגיטלית מאומתת"?

## 7. קבצים רלוונטיים

- `supabase/functions/_shared/company-gate.ts` (כללי הסינון)
- `supabase/functions/ingest-uk-companies-house/index.ts`, `ingest-sec-form-d/index.ts`
- `supabase/migrations/20261016000000_company_candidates_review_queue.sql` (הטבלה, ה-RPC והאישור)
- `src/lib/candidateReview.ts`, `src/app/pages/AdminReview.tsx`, `src/app/pages/CandidatePreview.tsx` (ממשק האישור)
- `worker/identify.ts`, `worker/search.ts`, `worker/deepen.ts`, `docs/enrichment_v2_spec.md` (העשרה קיימת)
- `docs/crawl-policy.md` (כללי גישה לאתרים)
