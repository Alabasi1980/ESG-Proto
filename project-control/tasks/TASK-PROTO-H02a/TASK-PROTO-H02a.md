# TASK-PROTO-H02a — ملفا التوكنز + ربط الاستيراد (آلية الثيم)

> **المسار:** `TASK-PROTO-H*` (تقسية بروتو — تحت `T-003`)
> **الحالة:** Assigned → مفوَّضة إلى ui-designer
> **ClientAppPath (مرحلي):** `D:\Teranoo Work\Client01\prototype-app`
> **Session:** NEW — نطاق تنفيذي جديد (كتابة CSS في `src/`)، لا صلة بجلسة H01 التعريفية
> **التسلسل:** H02a ← مراجعة Tera ← H02b (عميل واحد يكتب في كل مرة)

## 1. الهدف (واحد فقط)

إنشاء طبقة التوكنز التنفيذية **بالقيم الحرفية** من مواصفة H01 المعتمدة (D-H01-05): ملفَا CSS جديدان + سطر استيراد واحد في `index.css`. **بلا أي تغيير آخر في `src/`.**

## 2. المصادر المسموحة (قراءة فقط)

- `tasks/TASK-PROTO-H01/THEME_TOKENS.md` (§2 الجدول + §3 مذكرة `@theme` — **البنية ملزمة**)
- `tasks/TASK-PROTO-H01/THEME_01_GE.md` + `THEME_02_ABYSS.md` + `THEME_03_STONE.md` (**القيم ملزمة حرفياً**)
- `tasks/TASK-PROTO-H01/TOKEN_MAPPING.md` (سياق فقط)
- `src/index.css` الحالي (لإضافة سطر الاستيراد في الموضع الصحيح)

## 3. Allowed Write Targets (حصرية — مطلقة)

```text
D:\Teranoo Work\Client01\prototype-app\src\styles\tokens.css      (جديد)
D:\Teranoo Work\Client01\prototype-app\src\styles\themes.css       (جديد)
D:\Teranoo Work\Client01\prototype-app\src\index.css               (تعديل: سطر استيراد واحد فقط)
```

## 4. ممنوعات صريحة

- أي ملف/سطر آخر في `src/` (تشمل المكونات والشاشات والسياقات).
- تغيير أي قيمة عن H01 (بما فيها `#C2571F` في Stone — معتمد كما هو) أو إضافة توكن جديد.
- أي `dark:` جديد، أي secret، أي مكتبة.

## 5. المخرج المطلوب

- `tokens.css`: الـ27 توكن + الثابتان (`--radius: 10px` + `--shadow`) عبر `@theme` حسب مذكرة H01 §3.
- `themes.css`: 3 كتل `[data-theme="ge"|"abyss"|"stone"]` تعيد تعريف نفس المتغيرات — بناء واحد، تبديل لحظي.
- `index.css`: سطر `@import "./styles/tokens.css";` (وما يلزم لـ`themes.css`) — لا شيء غيره.

## 6. معايير القبول (نوع الدليل)

| # | المعيار | الدليل |
|---|---|---|
| 1 | كل قيمة مطابقة حرفياً لملفات H01 (سأقارن آلياً) | STATIC (فحص Tera) |
| 2 | `tsc --noEmit` + `vite build` يمران (أشغّلهما بنفسي) | LIVE (تنفيذ Tera) |
| 3 | `git diff` يُظهر الملفات الثلاثة فقط | LIVE (فحص Tera) |
| 4 | Engineering File Quality: توكنز مرتبة + تعليقات WHY مختصرة + بلا تكرار | STATIC (فحص Tera) |

**Owner Approval Required: No** (تنفيذ لمواصفة معتمدة — القبول بقرار Tera بعد البوابات).

## 7. البوابات المسجلة

- **Matrix:** `COMPLEXITY_SIGNAL` (توكنز/قواعد بصرية) → `ui-designer` — التوكنز ملك المصمم حسب حدود React (§9 تمنع كتابة المزوّد/المنطق).
- **SDA:** `FAST_PATH` — السبب: الآلية محددة كاملة في H01 (§3+§5) · النطاق 3 ملفات · قابل للعكس · بلا DB/auth/API · تحقق كامل (build + مقارنة قيم).
- **Security:** `Low` — CSS ثابت بلا منطق. `SecurityAgent` غير مطلوب.
- **QA:** `QA_REQUIRED` — أتحقق مباشرة (دفعة صغيرة محصورة — السبب موثق): build + مقارنة القيم + diff.
- **Auditor:** `NOT_REQUIRED` — ملفات جديدة صغيرة + تحقق Tera كامل. (العداد: مهمة مكتملة واحدة NOT_REQUIRED — العينة التالية عند الخامسة.)
- **Model Gate:** `Current model sufficient` — تعقيد Low/Medium · خطر Low.
- **Pre-Execution Gate: PASS** — هدف واحد · أصغر وحدة · بلا UI/API/Auth/Schema تنفيذي جديد · بلا أسرار · أهداف ضيقة · قبول قابل للاختبار · CLI = قراءة فقط (grep) + كتابة ملفين.

## 8. بروتوكول التفويض

- [Engineering File Quality — إلزامي] اتبع بنية المشروع واصطلاحاته · الملفان في `src/styles/` فقط · تعليقات WHY لا WHAT · لا كود ميت ولا تكرار · التزام حدود React: توكنز وستايل فقط، بلا منطق/سياقات.
- إن احتجت أداة خارج صلاحياتك: **توقف واطلبها مني** — لا تُكمل بأدلة ناقصة صامتة.
- الـhandback **≤80 سطراً — بلا full diffs**.
- بوابات ملفك غير المنطبقة هنا: البحث الإلزامي = N/A (القيم ثابتة من H01 المعتمد — لا بحث جديد) · Vitality/SEMGREP/Playwright = N/A (CSS توكنز بلا واجهة مرئية بعد — التحقق البصري في H02b).
- أي غموض = STOP + سؤال — لا تخمين. (تذكير: `TERA_CONTINUOUS_IMPROVEMENT_POLICY.md` + `AGENT_GAPS_LOG.md` — أبلغ عن أي فجوة نظامية في الـhandback.)

## 10. Tera Post-Execution Review (2026-11-15 — فحص فعلي + تنفيذ مباشر)

| Check | Result | Notes |
|---|---|---|
| Files within Allowed Write Targets | PASS | `git status/diff`: تعديل `index.css` (+2 فقط) + ملفان جديدان — لا شيء غيرهما |
| Values match H01 verbatim | PASS | عدّ القيم المميزة: `#46B275`×3 (brand/success/active) · `#052E1C`×2 · `#C2571F` قيمة+تعليق · `dark:` مرة واحدة في تعليق فقط · 3 كتل `[data-theme]` |
| `tsc --noEmit` + `vite build` (تنفيذ Tera) | PASS | exit 0 كلاهما (تحذير الـchunk السابق نفسه — بلا تغيير) |
| File Quality | PASS | تعليقات WHY · ترتيب = مخطط H01 · بلا تكرار |
| QA / Auditor / Security | QA_REQUIRED (نُفذ مباشرة — السبب موثق) · Auditor NOT_REQUIRED · Security Low | (العداد: NOT_REQUIRED مكتملة = 2 — العينة عند الخامسة) |

Gate Status: **PASS** — Final Decision: **Accepted → Closed** (Owner Approval Required: No)
Knowledge Gate: مؤجل لـH02b — لا سلوك تغيّر بعد (CSS غير مربوط).

## 11. Compliance Record

| # | Check | Result | Verified By |
|---|---|---|---|
| 1 | Pre-Execution Gate PASS documented | PASS | Tera |
| 2 | Allowed Write Targets respected | PASS | Tera (`git diff --stat`) |
| 3 | No secrets | PASS | Tera |
| 4 | Design Source documented | PASS | H01 المعتمد |
| 5 | Post-Execution Review PASS | PASS | Tera |
| 6 | Activity log updated | PASS | Tera |
| 7 | Handback recorded (≤80, بلا diffs) | PASS | Tera |
| 8 | Diff matches handback | PASS | Tera (3 ملفات) |
| 9 | CLI documented | Done | lint + build (Tera) |
| 10 | Owner Approval | N/A | تنفيذ لمواصفة معتمدة |
| 11 | Cross-Record Consistency | PASS | Task / Activity / Audit |

Compliance Status: **COMPLIANT**
