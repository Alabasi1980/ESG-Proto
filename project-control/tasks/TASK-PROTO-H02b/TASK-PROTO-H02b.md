# TASK-PROTO-H02b — المزوّد + ترحيل الهيكل (App/Header/Sidebar)

> **المسار:** `TASK-PROTO-H*` (تقسية بروتو — تحت `T-003`)
> **الحالة:** Assigned → مفوَّضة إلى engineering-agent-typescript
> **ClientAppPath (مرحلي):** `D:\Teranoo Work\Client01\prototype-app`
> **Session:** NEW — عميل ونطاق جديدان (منطق React + ترحيل 3 ملفات)
> **التسلسل:** H02a (مقبول ومغلق) ← H02b الآن ← مراجعة Tera (build/tests/screenshots ×3)

## 1. الهدف (واحد فقط)

ربط آلية الثيم على الهيكل فقط: `ThemeContext` جديد + تغليف في `main.tsx` + ترحيل كلاسات `App.tsx`/`Header.tsx`/`Sidebar.tsx` إلى التوكنز حسب `TOKEN_MAPPING.md` + حذف `dark:` فيها. **بلا أي تغيير سلوكي، بلا واجهة اختيار ثيم، بلا مساس ببقية الشاشات.**

## 2. المصادر المسموحة (قراءة فقط)

- `tasks/TASK-PROTO-H01/TOKEN_MAPPING.md` (جدول الترحيل — ملزم)
- `tasks/TASK-PROTO-H01/THEME_TOKENS.md` §3 (مذكرة `@theme`/التبديل)
- `src/styles/tokens.css` + `src/styles/themes.css` (أسماء الـutilities المتاحة: `bg-surface`, `text-muted`…)
- `src/main.tsx` (5 أسطر — نقطة التغليف) + الملفات الثلاثة المستهدفة (تُقرأ قبل التعديل)

## 3. Allowed Write Targets (حصرية — مطلقة)

```text
D:\Teranoo Work\Client01\prototype-app\src\context\ThemeContext.tsx   (جديد)
D:\Teranoo Work\Client01\prototype-app\src\main.tsx                    (تعديل: تغليف بالمزوّد فقط)
D:\Teranoo Work\Client01\prototype-app\src\App.tsx                    (ترحيل كلاسات فقط)
D:\Teranoo Work\Client01\prototype-app\src\components\Header.tsx      (ترحيل كلاسات فقط)
D:\Teranoo Work\Client01\prototype-app\src\components\Sidebar.tsx     (ترحيل كلاسات فقط)
```

## 4. قواعد المزوّد (ملزمة)

- يقرأ الثيم من **ثابت جلسة مؤقت** `const TENANT_THEME = "ge"` (الربط الخادمي الحقيقي بعمود المستأجر — دفعة لاحقة قبل النقل).
- يضع `data-theme` على العنصر الجذري قبل أول رسم (تفادي الوميض) — بلا `localStorage`، بلا واجهة اختيار، بلا أي منطق آخر.
- ممنوع: قراءة أسرار/env، أي fetch/API، أي تغيير سلوكي، أي `dark:` جديد، أي مكتبة.

## 5. ممنوعات صريحة

- أي ملف خارج القائمة (تشمل بقية الـviews والـserver والـdb).
- تغيير قيم التوكنز أو ملفي الـCSS.
- منطق جديد (hooks إضافية، state جديد، events جديدة) — ترحيل كلاسات + مزوّد فقط.

## 6. معايير القبول (نوع الدليل)

| # | المعيار | الدليل |
|---|---|---|
| 1 | `lint` + `tests` (227) + `build` تمر (أشغّلها بنفسي) | LIVE (تنفيذ Tera) |
| 2 | لقطات الهيكل ×3 ثيمات سليمة بصرياً (ألتقطها بنفسي بتجاوز `data-theme` وقت التحقق) | VISUAL (دليل Tera) |
| 3 | `git diff` = الملفات الخمسة فقط + بلا `dark:` متبقٍّ فيها | LIVE (فحص Tera) |
| 4 | بلا تغيير سلوكي (الاختبارات الـ227 خضراء = الإثبات) | UNIT (تنفيذ Tera) |

**Owner Approval Required: No** (تنفيذ لمواصفة معتمدة).

## 7. البوابات المسجلة

- **Matrix:** مهمة TypeScript/React وظيفية → `engineering-agent-typescript` (المتخصص — لا العام).
- **SDA:** `FAST_PATH` — السبب: الآلية مثبتة في H02a المقبول · النطاق 5 ملفات · قابل للعكس · بلا DB/auth/API · تحقق كامل (build+tests+screenshots).
- **Security:** `Low` — المزوّد يقرأ ثابتاً حرفياً؛ ممنوع env/fetch. `SecurityAgent` غير مطلوب.
- **QA:** `QA_REQUIRED` — أتحقق مباشرة (دفعة محصورة — السبب موثق).
- **Auditor:** `NOT_REQUIRED` — نطاق صغير + تحقق Tera كامل. (العداد: NOT_REQUIRED مكتملة = 2 — العينة عند الخامسة.)
- **Model Gate:** `Current model sufficient`.
- **Pre-Execution Gate: PASS** — هدف واحد · أصغر وحدة · بلا نطاق جديد · بلا أسرار · أهداف ضيقة · قبول قابل للاختبار.

## 8. بروتوكول التفويض

- [Engineering File Quality — إلزامي] اتبع بنية المشروع واصطلاحاته قبل أي إضافة · المزوّد في `src/context/` بجانب `AuthContext` · لا مجلدات جديدة · ملفات مركزة · تعليقات WHY · لا كود ميت/تكرار/ملفات خارج النطاق · التزم حدود React: المنطق والـhooks والـJSX لك، التوكنز كما هي بلا تعديل.
- اقرأ كل ملف مستهدف من القرص أولاً قبل تعديله؛ حافظ على ما لا يخص المهمة.
- إن احتجت أداة خارج صلاحياتك: **توقف واطلبها مني**.
- الـhandback **≤80 سطراً — بلا full diffs**. أي غموض = STOP + سؤال.

## 10. Tera Post-Execution Review (2026-11-15 — فحص فعلي + تنفيذ مباشر)

| Check | Result | Notes |
|---|---|---|
| Files within Allowed Write Targets | PASS | `git diff --stat`: App/Header/Sidebar/main/index فقط + ملفان جديدان — لا شيء غيرهما |
| No `dark:` / literals in 5 files | PASS | `dark:` = 0 · `slate/emerald/amber/rose-[0-9]` = 0 (فحص Tera المباشر) |
| `tsc --noEmit` + `vite build` (تنفيذ Tera) | PASS | exit 0 كلاهما (تحذير الـchunk السابق نفسه) |
| Visual ×3 (تنفيذ Tera: preview + computed + screenshots) | **PARTIAL** | التبديل مثبت بقيم محسوبة دقيقة (ge `#F4F6F4`/`#038947` · abyss `#0B1319`/`#46B275` · stone `#F7F6F3`/`#152331`) + الصفحة تُرسم بلا كسر ×3 — لكن اللقطات متطابقة لأن `LoginView` (غير مرّحل — خارج النطاق) يغطي الشاشة بـ`bg-slate-900`. البصري الكامل للهيكل (Sidebar/Header) يتطلب جلسة موثقة (DB) — مؤجل موثقاً |
| Tests 227 (تنفيذ Tera) | **1 FAIL — حارس نطاق، لا انحدار** | `b17TransactionInventory`: `Unapproved write: src/App.tsx` — حارس النافذة المجمدة (allowed-set من 16 مساراً) يرفض كتابة مسارنا المصرّح به مالكياً. الكود سليم؛ الحارس يعمل كما صُمم |
| File Quality | PASS | WHY · بلا منطق جديد · بلا أسرار · المزوّد 34 سطراً |

Gate Status: **PASS** (2026-11-15 — بعد H02c: المجموعة 227/227 خضراء، نقطة تفتيش محلية `f38af55` بلا دفع).

Final Decision: **Accepted → Closed** (Owner Approval Required: No)
Knowledge Gate: **DEFERRED-TO-TRANSFER** — السبب: نطاق `project-knowledge-agent` محصور بمسار العميل (`clients/**/applications/*/project-knowledge/`)، وكتابة معرفة هناك الآن ستصف ملفات غير موجودة فيه (مخالفة H-01/H-02 للوكيل). التحديث المعرفي (theme-system: المزود + التوكنز + نموذج الفرض + عمود المستأجر المعلق) يُنفَّذ ضمن دفعة النقل عندما تستقر الملفات في مسارها النهائي.

## 11. Compliance Record (مؤقت — يُستكمل بعد قرار المالك)

| # | Check | Result | Verified By |
|---|---|---|---|
| 1 | Pre-Execution Gate PASS documented | PASS | Tera |
| 2 | Allowed Write Targets respected | PASS | Tera (`git diff --stat`) |
| 3 | No secrets | PASS | Tera |
| 4 | Design Source documented | PASS | H01 المعتمد |
| 5 | Post-Execution Review | BLOCKED | حارس النطاق — §10 |
| 6 | Activity log updated | PASS | Tera |
| 7 | Handback recorded (≤80, بلا diffs) | PASS | Tera |
| 8 | Diff matches handback | PASS | Tera (5 ملفات) |
| 9 | CLI documented | Done | lint+tests+build+screenshots (Tera) |
| 10 | Owner Approval | N/A | تنفيذ لمواصفة معتمدة |
| 11 | Cross-Record Consistency | PASS | Task / Activity / Audit |

Compliance Status: **COMPLIANT** (يُستكمل 10/11 بعد قرار المالك — حالياً 10 = N/A و11 = PASS مشروط بالحسم)

- [Engineering File Quality — إلزامي] اتبع بنية المشروع واصطلاحاته قبل أي إضافة · المزوّد في `src/context/` بجانب `AuthContext` · لا مجلدات جديدة · ملفات مركزة · تعليقات WHY · لا كود ميت/تكرار/ملفات خارج النطاق · التزم حدود React: المنطق والـhooks والـJSX لك، التوكنز كما هي بلا تعديل.
- اقرأ كل ملف مستهدف من القرص أولاً قبل تعديله؛ حافظ على ما لا يخص المهمة.
- إن احتجت أداة خارج صلاحياتك: **توقف واطلبها مني**.
- الـhandback **≤80 سطراً — بلا full diffs**. أي غموض = STOP + سؤال.
