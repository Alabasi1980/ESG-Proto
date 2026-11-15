# TASK-PROTO-H08a — معاينة مستقلة للثيم الداكن قبل اعتماده

- الحالة: Approved for isolated preview; dark theme itself **not approved** and no app implementation delegated.
- المرحلة: تقسية بروتوتايب، Plan/Preview فقط؛ ليس `TASK-COD-*` ولا تغييراً لتطبيق العميل.
- ClientAppPath: `D:\Teranoo Work\Client01\prototype-app`.
- Session: NEW؛ Activation Trigger: `COMPLEXITY_SIGNAL` (اتجاه بصري جديد قائم على هوية GE) → `ui-designer`.
- قرار المالك D-H08-02: معاينة مستقلة، ولو في HTML منفصل، بمحتوى شاشة الدخول الحالي، لاعتماد ثيم Abyss وقواعده **قبل** إدخاله للتطبيق. قرار D-H03-01 باقٍ: الدخول الفعلي GE افتراضياً قبل المصادقة؛ هذه معاينة فقط.

## هدف واحد

أنتج صفحة دخول **ساكنة، مستقلة، غير قابلة للتسليم** لمراجعة الثيم الداكن المقترح ومواصفة توكنز/تباين قابلة للنقل لاحقاً. لا تُعدّل التطبيق الحالي أو قرارات الثيمات المعتمدة. المراجع الرسمية: اقتراح المالك (الخلفية `#152331`؛ البطاقة `#1D3029`؛ الحقول `#263B33`؛ الحدود `#456347`؛ النص `#F1F6D6`؛ الثانوي `#CAD6AE`؛ اللمسات `#AFD139`؛ التحذير `#F16B3B`) + صورة هوية GE + `project-preparation/28_UI_UX_GUIDELINES.md`.

### مصادر قراءة محددة

- `D:\Teranoo Work\Client01\prototype-app\src\views\LoginView.tsx`، `src/components/DemoBanner.tsx`، والمفاتيح ذات الصلة فقط في `src/i18n/translations.ts` (النصوص الحالية AR/EN، الحالات المرئية، دون نسخ منطق auth).
- `D:\Teranoo Work\Client01\prototype-app\project-control\tasks\TASK-PROTO-H01\THEME_TOKENS.md` + `THEME_02_ABYSS.md` + `REFERENCES.md` (مراجع شكلية؛ لا تعتمد ألوان Abyss القديمة على حساب اقتراح المالك).
- `D:\Teranoo Work\Client01\clients\CLIENT-GE\applications\APP-ESG-PLATFORM\project-preparation\28_UI_UX_GUIDELINES.md` و`07_SCREENS_AND_UI_STRUCTURE.md` (مصدر الهيكل/RTL).
- `D:\Teranoo Work\Client01\Idea files\Asset 2@4x (1).png` (هوية GE). مراجع ويب بصرية محددة 3–5 للبحث الإلزامي، توثق داخل مجلد المعاينة، لا تستبدل قرار المالك.

### Allowed Write Targets (فقط)

داخل `D:\Teranoo Work\Client01\prototype-app\project-control\prototypes\TASK-PROTO-H08a\`:

- `GE_DARK_LOGIN_PREVIEW.html` — ملف HTML واحد مستقل (CSS داخلي؛ لا حزم أو ملفات تصميم أخرى).
- `DARK_THEME_RULES.md` — 27 توكناً دلالياً وفق مخطط H01، قاعدة استخدام الهوية والدلالات، نتائج قياس تباين فعلية والحالات الخاصة (البطاقة/الحقل/الزر/الشعار/التنبيه/التركيز).
- `REFERENCES.md` — 3–5 مراجع بصرية مع ما يُستلهم وما يُتجنب، قبل كتابة HTML.

لا يكتب المصمم أي ملف أو صورة خارج الثلاثة. لقطات التحقق يحفظها Tera منفصلاً في مجلد المهمة، ويرسلها للمصمم عند حاجته إلى أداة المتصفح (GAP-013).

**معالجة STOP الأول:** أنشأ Tera المجلد الأب ومجلد المعاينة بملف `README.md` تعريفياً (ليس هدف كتابة للمصمم). المصمم يقرأه فقط ثم يكتب الملفات الثلاثة المحددة. إذا حُجبت بعض صفحات Dribbble/Behance، يجوز الرجوع إلى ملاحظات H01 الموثقة بشرط التصريح بأنها ملاحظات سابقة وليست معاينة حية؛ يوثّق ما أمكن الوصول إليه الآن بصدق، ولا يتجاوز بوابة البحث.

### قواعد المعاينة

- نفس **النصوص الظاهرة** في شاشة الدخول الحالية، باللغتين من الترجمة الموجودة؛ العربية RTL وفق baseline، والإنجليزية LTR. وسيلة العرض/التبديل في HTML تجريبية محلية فقط، بلا اتصال API أو تسجيل دخول حقيقي؛ لا تُخترَع حقول أو وظائف منتج. الإشارة إلى حالة DB تظهر فقط بصفتها حالة عرض مطابقة، لا ادعاء اتصال حقيقي.
- مقترحات المالك الثمانية هي المرجع الأول. إن استوجب التباين تغيير قيمة مقترحة، اعرض القيمة الأصلية وبديلها وسبب التغيير **ولا تدّع اعتماد البديل**؛ إن تعذر تحقيق المقروئية داخل النطاق: STOP واطلب قراراً.
- الشعار أخضر، التنبيه أرضيته بنية داكنة هادئة مشتقة من هوية الكحلي/البرتقالي مع عنوان/أيقونة/حد برتقالي. زر الدخول أخضر ونصه فاتح **مع قياس التباين عند حجم النص الفعلي**؛ لا تَصف 4.49:1 بأنها AA للخط الصغير.
- توكنات اللون فقط تتغير في التصميم؛ التخطيط من شاشة الدخول الحالية، لا نسخة من صفحات جديدة. ركّز على المقروئية وتباين الحواف/حالة التركيز في الوضع الداكن. الطباعة/PDF خارج الثيم.
- حيوية النموذج الساكن: hover/focus/disabled/error states قابلة للمعاينة في HTML دون API أو بيانات حقيقية؛ Skeleton/Search/Numeric KPI غير منطبقة على صفحة دخول، اذكر السبب.

### معايير القبول

| # | المعيار | Required Evidence Type |
|---|---|---|
| 1 | HTML مستقل يعكس محتوى شاشة الدخول الحالي (AR RTL وEN LTR) ولا يغيّر ملفات `src/` أو الخادم | STATIC + VISUAL |
| 2 | الألوان المقترحة ممثلة بصدق، مع مواصفة توكنز وقياسات تباين وتحذير من أي تغيير لازم للإتاحة | STATIC |
| 3 | معاينة فعلية للمكتب والهاتف مع أدلة صور؛ لا نص منخفض التباين أو overflow أو ادعاء login فعلي | VISUAL (Tera ثم DesignReviewer مستقل) |
| 4 | مراجعة DesignReviewer المستقلة قبل العرض على المالك (حياد المراجع: مواصفات ومصادر فقط) | STATIC + VISUAL |

Owner Approval Required: **Yes** — اعتماد الثيم الداكن وقواعده مرئيّاً لاحقاً، لا يتضمن موافقة على إدخاله للتطبيق تلقائياً.

### بوابات التفويض

- Orchestration Matrix: ui-designer للتصميم/HTML العرضي؛ DesignReviewer بعد المعاينة (Trigger `PHASE_GATE` لـTASK-PROTO + `REVIEW_NEEDED`). لا وكيل TypeScript لأن React/login functional code خارج النطاق.
- Active Technology Profile: N/A لمعاينة HTML منفصلة لا تدخل `src/`؛ لا اختيار stack إنتاجي جديد.
- SDA: NOT_APPLICABLE للمعاينة التصميمية المستقلة، بلا DB/API/auth/migration.
- Security: Low، بلا أسرار أو مصادقة أو API فعلي. QA: REQUIRED؛ Tera يجري المعاينة المباشرة (ثم ناقد مستقل)، بسبب عدم توفر أداة متصفح ضمن تفويض المصمم عند الحاجة.
- Auditor: NOT_REQUIRED للمخرج المعزول غير التسليمي؛ `AGENT_ACTIVATION_MATRIX.md` §2.1 بدون `RISK_SIGNAL` أو تغيير التطبيق. Sampling debt السابق لا يُدّعى حسمه بهذا التصنيف.
- Model Gate: current model sufficient لمعاينة محصورة وقابلة للتصوير.
- Pre-Execution Gate: PASS بعد حل STOP المجلد المفقود — مصدر التصميم والكتابة والعرض والقبول محددة؛ لا Build Mode لتطبيق العميل. إذا طلب المصمم تغيير سلوك منتج أو تعديلات خارج المسار → STOP.

### Handback

Status · Task ID · الملفات · وصف المعاينة والقيم · قياسات التباين · تحقق/غير متحقق · مخاطر وSTOP/ASK. ≤80 سطراً بلا full diffs. إن احتجت أداة خارج صلاحياتك: توقف واطلبها من Tera؛ لا تسلّم حكماً بصرياً بلا دليل.

## Sub-Agent Handback (موجز — التفاصيل في `prototypes/TASK-PROTO-H08a/`)

- ui-designer سلّم: HTML مستقل + مواصفة 27 توكن + مراجع؛ انحرافان موثقان بانتظار المالك (`#026F39` بدل `#038947` للزر/الشعار، `#93A987` حداً للحقول).
- Tera تحقّق: القيم حرفياً + 4 لقطات (مكتب AR/EN/خطأ + هاتف AR) + semgrep 0 نتائج.
- DesignReviewer مستقل: **Prototype PASS** (قياس 22/22، cross-check، حياد كامل)؛ الانحرافان مبرَّران تقنياً؛ القراران للمالك حصراً.

## Tera Post-Execution Review

Gate Status: **PASS** — Final Decision: **READY FOR OWNER ACCEPTANCE** (اعتماد الثيم الداكن وقواعده بصرياً).
Owner Approval Required: **Yes** — Status: **Pending**. لا Accept/Close ولا دمج في التطبيق قبل موافقة صريحة.
Compliance: **PENDING_OWNER_APPROVAL**.

## Tera Closure (2026-11-15)

Final Decision: **Accepted → Closed** (D-H08-03). Owner Approval: **Approved** (بصري — الثيم الداكن وقواعده كما في المعاينة B+B).
Scope note: الاعتماد للمواصفة فقط — لا دمج في `src/` بعد؛ الدمج دفعات لاحقة.
Compliance: **COMPLIANT** (عقد + مواصفة + مراجع + handback + مراجعة مستقلة PASS + سجلات).
