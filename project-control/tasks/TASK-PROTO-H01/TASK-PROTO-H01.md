# TASK-PROTO-H01 — اشتقاق ثيمتين من هوية GE + مخطط التوكنز الموحد

> **المسار:** `TASK-PROTO-H*` (تقسية بروتو — تحت `T-003`، لا Gate 7 ولا Build Mode)
> **الحالة:** Assigned → in progress (مفوَّضة إلى ui-designer)
> **ClientAppPath (مرحلي معرّف):** `D:\Teranoo Work\Client01\prototype-app`
> **Session:** NEW — نطاق تصميمي جديد، لا جلسة سابقة

## 1. الهدف (واحد فقط)

إنتاج **تعريف تصميمي معتمد-قابل للاعتماد** لثلاث ثيمات: (1) GE الأساسية من صورتها الرسمية + (2) ثيمتان مشتقتان متنوعتان، فوق **مخطط توكنز دلالي موحد** يصلح للتنفيذ لاحقاً على React 19 + Tailwind v4. **بلا أي كود في `src/`** — مخرجات هذه المهمة وثائق ومواصفات فقط.

## 2. المدخلات المثبتة (قرارات المالك — تُقرأ ولا تُناقش)

- **D-H01-01:** الثيم يفرضه **مدير GE لكل عميل** — لا يملك المستخدم ولا العميل التبديل. مصدر الحقيقة خادمي (خاصية المستأجر) → يُبث في الجلسة → يُطبق عند التحميل. لا واجهة اختيار للمستخدم.
- **D-H01-02:** مركز الثيمات هو **أول دفعة تقسية** — كل عمل لاحق يُبنى فوق التوكنز.
- **D-H01-03:** المسار (ب): ui-designer يشتق الثيمتين، والمالك يعتمد قبل التنفيذ.
- **D-H01-04:** التخطيط واحد لكل الثيمات — التوكنز تتغير فقط (قاعدة ضبط الكلفة). الطباعة/PDF ثابتة. ألوان الحالات الدلالية (نجاح/خطر/تحذير) تبقى مميزة في كل ثيم.

## 3. المصادر المسموحة (قراءة فقط — ممنوع الكتابة خارج مجلد المهمة)

- `C:\Users\Fares\Downloads\GE_GRI_Dashboard_Design_01.html` (مرجع بصري 1 — غير ملزم)
- `C:\Users\Fares\Downloads\GE_GRI_Dashboard_Design_02.html` (مرجع بصري 2 — غير ملزم)
- `C:\Users\Fares\Downloads\GE_GRI_Dashboard_Design_03.html` (مرجع بصري 3 — غير ملزم)
- `D:\Teranoo Work\Client01\Idea files\Asset 2@4x (1).png` (هوية GE: `#F16B3B` · `#AFD139` · `#038947` · `#152331` — **ملزمة**)
- `D:\Teranoo Work\Client01\prototype-app\src\index.css` (قراءة البنية الحالية — 27 سطراً، بلا توكنز)
- `D:\Teranoo Work\Client01\prototype-app\src\components\Sidebar.tsx` + `Header.tsx` (عينة قراءة فقط لفهم الاستخدام)
- `D:\Teranoo Work\Client01\clients\CLIENT-GE\applications\APP-ESG-PLATFORM\project-preparation\28_UI_UX_GUIDELINES.md` (الهوية المعتمدة)
- بحث الويب الخاص بالمصمم (Dribbble/Awwwards/Behance — إلزامي حسب ملفه)

## 4. Allowed Write Targets (حصري — غيرها = فشل المهمة)

```text
D:\Teranoo Work\Client01\prototype-app\project-control\tasks\TASK-PROTO-H01\
```

## 5. ممنوعات صريحة

- أي كتابة في `src/` أو أي مسار خارج مجلد المهمة (تشمل `design-source/` الجذري — البديل المعتمد: `REFERENCES.md` **داخل مجلد المهمة**).
- إنشاء/تعديد أي `.html`/`.css` تنفيذي — المخرجات `.md` فقط (+ جداول/لوحات داخلها).
- تغيير الهوية الأساسية (الألوان الأربعة) أو اقتراح هوية بديلة.
- تخطيطات بديلة لكل ثيم (ممنوع — التخطيط واحد).
- أي secret/مفتاح/مسار حساس في المخرجات.

## 6. المخرجات المطلوبة (كلها داخل مجلد المهمة)

1. `THEME_TOKENS.md` — مخطط التوكنز الموحد (~25 متغيراً دلالياً: `surface/surface-2/border/text/muted/brand/brand-strong/sidebar-bg/sidebar-active/radius/shadow…`) + قاعدة التسمية + توافق Tailwind v4 (`@theme`) + ملاحظة RTL.
2. `THEME_01_GE.md` — الثيم الأساسي من الألوان الأربعة الملزمة (قيم + استخدام كل لون + تباينات).
3. `THEME_02_*.md` + `THEME_03_*.md` — ثيمتان مشتقتان متنوعتان (مقترح: داكن كحلي عميق / فاتح محايد — للمصمم حرية الاتجاه مع التبرير) + سبب التسمية والاشتقاق.
4. `TOKEN_MAPPING.md` — جدول: كلاس Tailwind حرفي مستخدم حالياً (من جرد `src/`) ← التوكن المقابل. (الجرد قراءة فقط عبر grep.)
5. `REFERENCES.md` — 3–5 مراجع بصرية + «ما سأستلهمه/ما سأتجنبه» من كل مرجع (إلزامي من ملف المصمم).
6. قسم «نموذج الفرض» — كيف يُبث ثيم المستأجر من الخادم ويُطبق عند التحميل بلا اختيار المستخدم (فقرة معمارية، لا كود).

## 7. معايير القبول (كل معيار بنوع دليله)

| # | المعيار | نوع الدليل |
|---|---|---|
| 1 | مخطط توكنز واحد يغطي كل المتغيرات الدلالية بلا ازدواج أسماء | STATIC (ملف) |
| 2 | الثيم 1 يطابق الألوان الأربعة الملزمة حرفياً | STATIC + بصري المالك |
| 3 | الثيمتان 2 و3 متنوعتان فعلاً عن 1 وعن بعضهما + مبرر اشتقاق مكتوب | STATIC + **اعتماد المالك (إلزامي)** |
| 4 | الحالات الدلالية مميزة في الثيمات الثلاثة + الطباعة مستثناة صراحة | STATIC |
| 5 | `REFERENCES.md` موثق (3–5 مراجع + استلهام/تجنب) | STATIC |
| 6 | لا كتابة خارج مجلد المهمة + لا أسرار + لا تخطيطات بديلة | STATIC (فحص Tera) |

**Owner Approval Required: Yes** (المالك يعتمد الثيمتين قبل أي تنفيذ) → بعد الـhandback: `READY FOR OWNER ACCEPTANCE` — لا `Accepted`.

## 8. البوابات المسجلة

- **Orchestration Decision Matrix:** `COMPLEXITY_SIGNAL` → `ui-designer` (توكنز/قواعد بصرية). لا بديل — المهمة تصميم خالص.
- **SDA Classification:** `NOT_APPLICABLE` — مهمة تعريف تصميمي، بلا DB/API/auth/migration/cross-module تنفيذي.
- **Security Sensitivity:** `Low` — لا auth/API/secrets. `SecurityAgent` غير مطلوب (السبب مسجل).
- **QA Classification:** `QA_NOT_REQUIRED` — المخرج وثائق؛ القبول = اعتماد المالك + فحص Tera. تنفيذ QA يأتي في دفعات الترحيل.
- **Auditor Classification:** `NOT_REQUIRED` — لا diff كود. (عدّاد العينات: المهمة 1 — لا عينة مستحقة.)
- **Model Capability Gate:** `Current model sufficient` — تعقيد Medium / خطر Low / تحقق STATIC سهل.
- **Pre-Execution Gate Result: PASS** — هدف واحد · أصغر وحدة · بلا UI/API/Auth/Schema تنفيذي · بلا أسرار · أهداف كتابة ضيقة · قبول قابل للاختبار (اعتماد مالك) · بلا آثار CLI.
- **Technology Profile:** المرصود (React 19 + Vite 8 + Tailwind v4 + Express + pg) — الاختيار الرسمي مؤجل لدفعة التنفيذ الأولى (T-004 معلق).

## 9. بروتوكول التفويض (يُقرأ مع الحزمة)

- إن احتجت أداة خارج صلاحياتك: **توقف واطلبها مني** — لا تُكمل بأدلة ناقصة صامتة، ولا ترحّل الفجوة للمالك.
- الـhandback **≤80 سطراً — بلا full diffs** (الملفات على القرص تكفي).
- بوابات المصمم غير المنطبقة هنا (مهمة تعريف بلا كود): Vitality Self-Check / SEMGREP / Playwright = `N/A` — السبب: لا واجهة منفذة في هذه المهمة. بوابة البحث الإلزامي تبقى سارية (`REFERENCES.md`).
- أي غموض في الهوية أو النطاق = STOP + سؤال صريح — لا تخمين.

## 10. Handback المطلوب (≤80 سطراً)

Status · Task ID · Files created (داخل المجلد فقط) · ملخص الثيمات الثلاثة · الافتراضات · المخاطر/الفجوات · ما يحتاج قرار المالك · Recommendation.

## 11. Tera Post-Execution Review (2026-11-15 — فحص الملفات الفعلية)

| Check | Result | Notes |
|---|---|---|
| Changed files within Allowed Write Targets | PASS | 6 ملفات `.md` داخل المجلد فقط — `git status` نظيف عداها |
| No unauthorized files/deleted | PASS | — |
| No unauthorized packages | PASS | مهمة تعريفية — بلا كود |
| No secrets in outputs | PASS | — |
| UI Acceptance Gate | N/A | مهمة تعريف بلا واجهة منفذة — السبب مسجل |
| Acceptance criteria (§7) | 5/6 PASS + 1 بيد المالك | #3 (اعتماد الثيمتين) = قرارك أدناه |
| Independent review decision | ProjectControlAgent: Not Required · SecurityAgent: Not Required (Low) · qa-agent: Not Required (وثائق — QA في الترحيل) · Auditor: NOT_REQUIRED (بلا diff — المهمة 1، لا عينة مستحقة) | الأسباب مسجلة في §8 |
| Constraints D-H01-01..04 | PASS | فرض خادمي بلا مبدل مستخدم ✓ · تخطيط واحد ✓ · طباعة مستثناة ✓ · دلالات مميزة ✓ |
| ملاحظتان للترحيل (ليستا رفضاً) | Stone كسر حرفية البرتقالي (`#C2571F` بدل `#F16B3B` — موثق بسبب تباين) · Abyss يستخدم شفافيات للـsoft — يُتحقق عند التنفيذ | تُعرضان على المالك مع الاعتماد |

Gate Status: **PASS** (بشرط اعتماد المالك للثيمتين)

Final Tera Decision: **READY FOR OWNER ACCEPTANCE**
Owner Approval Required: **Yes** — Owner Approval Status: **Approved** (D-H01-05, 2026-11-15 — يشمل كسر البرتقالي في Stone)
Task Status: **Accepted → Closed** (2026-11-15)
Knowledge Gate: لا تحديث `project-knowledge/` — المهمة وثائق تصميمية، لم تمس كوداً تشغيلياً (§20.3 يُعفى: لا عنصر متأثر).

## 12. Compliance Record

| # | Check | Result | Verified By |
|---|---|---|---|
| 1 | Pre-Execution Gate: PASS documented | PASS | Tera |
| 2 | Allowed Write Targets respected | PASS | Tera (`git status`) |
| 3 | No secrets in outputs | PASS | Tera |
| 4 | Design Source Decision documented | PASS | مرجع العميل + صورة الهوية (§3) |
| 5 | Post-Execution Review: PASS | PASS | Tera |
| 6 | PROJECT_ACTIVITY_LOG.md updated | PASS | Tera |
| 7 | Handback recorded in TASK-ID file | PASS | Tera (≤80 سطراً، بلا full diffs ✓) |
| 8 | Git diff matches Handback | PASS | Tera (6 ملفات مطابقة للتقرير) |
| 9 | CLI/commands documented | N/A | بلا أوامر في المهمة |
| 10 | Owner Approval recorded before CLOSED | PASS | D-H01-05 (Task + DECISIONS_LOG + AUDIT_TRAIL) |
| 11 | Cross-Record Consistency | PASS | Task / Activity / Audit متسقة |

Compliance Status: **COMPLIANT** (اكتمل الاعتماد — D-H01-05)
