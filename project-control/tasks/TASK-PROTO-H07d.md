# TASK-PROTO-H07d — تصحيح خلفية GE Lime بعد المعاينة

- الحالة: **Accepted → Closed** (اعتماد بصري صريح من المالك 2026-11-15؛ D-H07-03). هذا إغلاق تصحيح الخلفية فقط، لا اعتماد التطبيق أو الثيم الداكن.
- المرحلة: تقسية البروتوتايب، بلا نقل إلى التطبيق الرئيسي أو تفعيل للعملاء.
- ClientAppPath: `D:\Teranoo Work\Client01\prototype-app`.
- Session: NEW؛ التصحيح ناتج عن معاينة مالك جديدة، وليس جولة تحسين صامتة.
- Activation Trigger: `COMPLEXITY_SIGNAL` (اشتقاق لون واجهة من مصدر تصميم العميل) → `ui-designer`.

## الهدف والمرجع

تعديل **خلفية ثيم Lime فقط** لتكون أقل اصفراراً من v3 (`#F1F6D6`) ولكن أوضح انتماءً لليموني من v4.1 (`#EDF0DA`) الذي رآه المالك باهتاً في المعاينة. هذه استجابة لتوجيه المالك الأخير؛ **لا يُختَرع معيار رقمي ملزم** يناقض وصف «قليلاً». قارن لوناً مرشحاً بـv3 وv4.1 وبثيم GE قبل تثبيته، واشرح اختيارك. لا تُحسم نتيجة القبول بصرياً إلا بعد معاينة Tera والمالك.

مصادر القراءة المسموحة: هذا العقد؛ `src/styles/themes.css`؛ `project-control/tasks/TASK-PROTO-H05a/THEME_03_LIME.md`؛ `project-control/tasks/TASK-PROTO-H07b/TASK-PROTO-H07b.md`؛ `project-control/tasks/TASK-PROTO-H01/REFERENCES.md`؛ `project-control/DECISIONS_LOG.md` (D-H06-02 / D-H07-01)؛ صورة الهوية `D:\Teranoo Work\Client01\Idea files\Asset 2@4x (1).png`؛ 3–5 مراجع بصرية خارجية للبحث الإلزامي فقط، دون تحويلها إلى ألوان أو نطاق جديد. ابدأ من الملفات الحالية على القرص؛ العمل السابق في `themes.css` غير مثبّت في Git، فلا تستعده من HEAD.

## Allowed Write Targets (حصراً)

- `D:\Teranoo Work\Client01\prototype-app\src\styles\themes.css`: قيمة `--surface` في كتلة `[data-theme="lime"]`، وتعليق WHY داخل الكتلة إن كان قديماً أو متناقضاً؛ لا تمسّ كتلتَي ge/abyss ولا أي توكن آخر.
- `D:\Teranoo Work\Client01\prototype-app\project-control\tasks\TASK-PROTO-H05a\THEME_03_LIME.md`: تحديث **الوصف الحالي فقط** للقيمة الجديدة وحساباتها؛ أبقِ تاريخ النسخ السابقة واضحاً ولا تنسب لها قيمة جديدة.
- `D:\Teranoo Work\Client01\prototype-app\project-control\tasks\TASK-PROTO-H07d\REFERENCES.md`: توثيق بحث المصمم الإلزامي (3–5 روابط مع ما يُستلهم وما يُتجنّب)، قبل تعديل اللون؛ لا ملفات أخرى في المجلد من طرف المصمم.

ثوابت لا تتغير: البطاقة `--surface-3: #E4EDB8`؛ الحقول `--surface-2: #F7F8E3`؛ الزر/الشعار `--brand: #038947`؛ النص `--text: #152331`؛ البرتقالي `--accent: #F16B3B`؛ الظل الأخضر؛ دلالات الحالات؛ عدد التوكنز وأسماؤها. موضع `DemoBanner` وفراغ أعلى الدخول **خارج المهمة** (ملاحظة للمراجعة المستقبلية لا تعديل الآن).

## معايير القبول والدليل

| # | المعيار | Required Evidence Type |
|---|---|---|
| 1 | خلفية Lime أكثر هدوءاً من v3 وأكثر ليمونية من v4.1، والبطاقة أغمق بوضوح | VISUAL (سطح مكتب وهاتف، مقارنة قبل/بعد من Tera، اعتماد المالك للنتيجة) |
| 2 | ثوابت المالك أعلاه وكل توكن عدا `--surface` لم تتغير | STATIC (قراءة القيم وdiff داخل كتلة Lime) |
| 3 | التعليق والمواصفة يصفان اللون الحالي بصدق، بلا رقم أو شرط قديم مضلل | STATIC |
| 4 | `npm run lint` و`npm run build` لا ينكسران؛ الاختبارات تُشغّل ويُصنّف أي فشل متعلق بحارس الشجرة بصدق | LIVE (Tera) |

Owner Approval Required: **Yes** — مرئي؛ لا Accepted/Closed قبل موافقته.

## بوابات ما قبل التنفيذ

- Engineering File Quality: تعديل مركز؛ لا ملفات/مجلدات عامة، ولا كود ميت، وتعليقات WHY فقط.
- Design Source Decision: هوية GE المعتمدة + D-H01-08؛ لا تغيير تخطيط أو سلوك.
- SDA Classification: `FAST_PATH` — قيمة توكن واحدة مع تعليق/توثيق، بلا DB/API/auth/migration أو أثر عابر للوحدات جديد؛ قابل للعكس.
- Security Sensitivity: Low (CSS فقط). لا سرّ ولا تغيير صلاحيات.
- QA Classification: `QA_REQUIRED` (مراجعة بصرية مباشرة من Tera على عرضين + build).
- Auditor Classification: `NOT_REQUIRED` لهذا التعديل البصري المحدود؛ المرجع `AGENT_ACTIVATION_MATRIX.md` §2.1 (`TASK_COMPLETED` بلا `RISK_SIGNAL`/`QUALITY_SIGNAL`)؛ مراجعة عينات المهام السابقة شأن مستقل، ولا يُدّعى إنجازها هنا.
- Model Capability Gate: current model sufficient لتصحيح بصري محصور وقابل للتحقق.
- Pre-Execution Gate: **PASS بعد تصحيح STOP الجولة الأولى** — أُضيف هدف كتابة `REFERENCES.md` المفقود دون توسيع كود التطبيق؛ لا تفويض ثانٍ ولا تعديل كود من Tera.

### معالجة STOP الأول (GAP-013)

- المصمم قرأ العقد وأوقف الكتابة قبل التنفيذ: بحث 3–5 مراجع إلزامي ولا يملك هدف كتابة له. توسعة التوثيق أعلاه تحل التعارض؛ لا تُعفَى بوابة البحث.
- Playwright/اللقطات: Tera يشغّل المتصفح ويحفظ أدلة المعاينة في مسار تحقق المهمة، ثم يعيد النتيجة للمصمم عند الحاجة لاستكمال Handback؛ المصمم لا يدّعي اختباراً لم ينفذه. لا يُطلب منه إنشاء ملفات اختبار أو تعديل مكوّنات.

## Handback

Status · Task ID · الملفات المعدلة · اللون السابق/الجديد ومبرر بصري/رقمي موجز · التحقق الذاتي · ما لم يُتحقق منه · المخاطر/STOP. ≤80 سطراً، بلا full diff. إذا احتجت أداة خارج صلاحياتك: توقف واطلبها من Tera.

## أدلة Tera للمعاينة (قراءة مسموحة للمصمم؛ لم يكتبها)

- `D:\Teranoo Work\Client01\prototype-app\project-control\tasks\TASK-PROTO-H07d\lime-desktop.png` (1440×900، أُعيد التقاطها دون حواف بيضاء اصطناعية)؛ `lime-mobile.png` (390×844)؛ `ge-mobile-comparison.png` (390×844) — لقطات من preview مبني بعد التعديل، Lime فُعّل مؤقتاً عبر المتصفح؛ قبل الدخول التطبيق يختار GE افتراضياً حسب D-H03-01.
- القيم المحسوبة على desktop: الصفحة `rgb(238,244,215)` = `#EEF4D7`؛ البطاقة `rgb(228,237,184)` = `#E4EDB8`؛ الحقول `rgb(247,248,227)` = `#F7F8E3`؛ الشريط الخوخي `rgb(248,236,226)`؛ الظل أخضر `rgba(20,46,30,.10/.16)`.
- `npm run lint` exit 0؛ `npm run build` exit 0 مع تحذير حجم الحزمة الحالي. `npm test`: 226/227؛ الفاشل الوحيد اختبار حارس الشجرة `b17TransactionInventory.test.ts`، سببه المحدد `Unapproved write: project-control/DECISIONS_LOG.md` (سجل غير مثبّت، لا انحدار لون). لا تدّعِ 227/227 PASS.
- القيد: المعاينة لشاشة الدخول فقط (لا جلسة DB موثقة)؛ الفراغ فوق `DemoBanner` ما زال قائماً وخارج هذا التعديل. راجع اللقطات وصرّح بملاحظتك، بلا أي كتابة جديدة.

## Sub-Agent Handback (ثلاث جولات ضمن السقف)

- Status: STOP before writes (نقص هدف المراجع) → NEEDS_REVIEW after implementation → NEEDS_OWNER_REVIEW after inspecting Tera browser evidence. Task ID: TASK-PROTO-H07d.
- Files changed by designer: `src/styles/themes.css` (Lime `--surface` + WHY comment only)؛ `project-control/tasks/TASK-PROTO-H05a/THEME_03_LIME.md` (القيمة الحالية وقياسها)؛ `tasks/TASK-PROTO-H07d/REFERENCES.md` (4 مراجع موثقة، بعض روابط Dribbble لم تُفتح مباشرة ونُسبت ملاحظاتها إلى H01 بصدق).
- Behavior: no new app behavior, only background token `#EDF0DA` → `#EEF4D7`. Verification by agent: fresh reads, HSL and diff check. Unverified by agent: running build/tests/preview; Tera did them separately. Risks/STOP: no active STOP؛ owner visual decision pending؛ no authenticated views checked.

## Post-Execution Review (Tera)

| Criterion | Result | Evidence |
|---|---|---|
| More clearly Lime than v4.1 but calmer than v3, card darker | PASS for presentation; owner visual approval pending | Same-viewport desktop captures: `compare-v3-desktop.png` (temporary DOM override `#F1F6D6`), `compare-v4.1-desktop.png` (override `#EDF0DA`), `lime-desktop.png` (current `#EEF4D7`). Mobile Lime vs GE screenshots. Card remains `#E4EDB8`; green shadow unchanged. |
| Fixed owner values and narrow change | PASS | Fresh read of current Lime block: inputs `#F7F8E3`, brand `#038947`, text `#152331`, accent `#F16B3B`; ge/abyss unchanged. Existing worktree had other H03/H06/H07 edits before this task; not attributed to the designer. |
| Documentation truthful | PASS | v4.2 value/measurements and current WHY comment no longer say inputs are near page tone. |
| Lint/build and test classification | Lint/build PASS; full suite **FAIL 226/227** | `npm run lint` exit 0; `npm run build` exit 0 (bundle-size and future Vite-config warnings). Only failed test: G1 tree guard, `Unapproved write: project-control/DECISIONS_LOG.md` from uncommitted governance files. This is not recorded as tests PASS or as an app-code regression. No commit/push performed to hide the failure. |
| Screenshot white edge | capture artifact resolved | First full-page capture with devicePixelRatio 0.9 produced white right/bottom strips; DOM app covers both edge coordinates with Lime background. `lime-desktop.png` was recaptured as viewport screenshot at 1440×900 with no white edge. |

Post-Execution Gate: **PASS for the contracted color change**, with a separately documented non-green full-suite guard. Independent QA: Tera direct visual + lint/build; no logged-in flows (DB unavailable). Auditor: NOT_REQUIRED per classification; historical sample owed is not represented as completed.
Final Task Decision: **Accepted → Closed** لنطاق لون الخلفية فقط. Owner Approval Status: **Approved** (قول المالك «اعتمد الثيم الفاتح هكذا»؛ D-H07-03). UI Acceptance: فحص لون التغيير المكتبي/الهاتفي واجتاز اعتماد المالك؛ لا يُدّعى اعتماد التطبيق كله.

## Compliance Record (pre-closure)

Pre-Execution PASS after STOP correction · Allowed Write Targets respected · No secrets · Design Source D-H01-08/D-H07-02 · Handback recorded · Actual files and CLI effects checked · Post-Execution scope PASS with suite exception clearly stated · Activity Log and Audit Trail paired · Owner Approval **Approved** D-H07-03.
Compliance Status: **COMPLIANT for the scoped visual correction**؛ يبقى الاختبار الشامل 226/227 (الحارس على ملفات governance غير المثبّتة) **غير ناجح**، ولا يُعرض كـPASS. لا إغلاق Batch/Phase أو قبول تشغيل/تسليم التطبيق.

## UI Acceptance Gate — فحص نطاق التغيير فقط (قبل قبول المالك)

- UI Source: `INTERNAL_TERA_KIT` + لوحة GE بحسب `project-preparation/28_UI_UX_GUIDELINES.md` §1 وقرار المالك D-H07-02؛ PASS.
- الألوان/المكونات/التخطيط: قيمة `--surface` مشتقة من عائلة Lime وحدها؛ لا تغيير مكونات، لا تخطيط مستحدث، ge/abyss كما هما؛ PASS.
- RTL/LTR والتجاوب: توكن اللون محايد اتجاهياً؛ لقطة 390×844 بلا تمرير أفقي، ولا سلوك اتجاهي تغيّر؛ PASS لنطاق H07d. **ملاحظة تطبيق مستقلة:** `src/i18n/LanguageContext.tsx:16` يجعل الإنجليزية افتراضية عند غياب تفضيل محفوظ، بينما 28 §2 يطلب العربية افتراضياً. لا يُدّعى إغلاق هذا الاختلاف ولا يُعدل ضمن H07d.
- الإتاحة: تباين النصوص/الحقول لم يتغير؛ استثناء الزر الأبيض على أخضر GE (4.49:1) السابق GAP-002 ما زال قائماً؛ لم يُدخل هذا التعديل عيب إتاحة جديداً.
- Design Gap: لا فجوة لونية في نطاق H07d؛ فراغ ما فوق DemoBanner ومعاينة الشاشات بعد الدخول خارج النطاق.
- **UI Acceptance Gate لثيم Lime في نطاق هذا التصحيح: PASS** بعد حكم المالك D-H07-03 على اللقطات؛ التغييرات الأخرى (العربية الافتراضية، حارس الشجرة، تباين الزر المعروف GAP-002) متابعات مستقلة وليست ادعاء قبول التطبيق ككل.
