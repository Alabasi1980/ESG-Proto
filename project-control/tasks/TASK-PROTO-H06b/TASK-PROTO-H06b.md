# TASK-PROTO-H06b — تطبيق صقل Lime على المكوّنات

> **الحالة:** Assigned → engineering-agent-typescript
> **Session:** NEW
> **يعتمد على:** H06a (توكنز v2 + `CLASS_SPEC.md`)

## 1. الهدف (واحد)

تطبيق `CLASS_SPEC.md` على `LoginView.tsx` و`DemoBanner.tsx` — كلاسات فقط، بلا أي مساس بمنطق أو بنية.

## 2. Allowed Write Targets (حصري)

```text
D:\Teranoo Work\Client01\prototype-app\src\views\LoginView.tsx
D:\Teranoo Work\Client01\prototype-app\src\components\DemoBanner.tsx
```

## 3. استثناء واحد عن CLASS_SPEC (قرار Tera موثق)

مواصفة المصمم تقترح تحويل شريط الديمو إلى «حبة» عائمة وحذف الشريط بعرض كامل. **مرفوض:** `DemoBanner` يُركَّب في 3 مواضع — أحدها داخل الهيدر الملتصق (`Header.tsx:62`) حيث العوم يخرّب التخطيط.
**التنفيذ المعتمد:** يبقى بعرض كامل، وتُطبَّق عليه الخلفية الخوخية (`bg-accent-soft`) ونص `text-text` بلا `ring`، مع `border-b` خفيف جداً (`border-accent/15`) — وهذا هو البديل الذي منحه المالك صراحة («أو بخلفية خوخية فاتحة مشتقة من البرتقالي»). الباقي من صفوف `CLASS_SPEC` لـLoginView يُطبَّق كما هي.

## 4. ممنوعات

- أي ملف آخر (لا `Header.tsx` · لا `themes.css` · لا شاشات أخرى) · أي تغيير في JSX structure/منطق/نصوص · props جديدة · مكتبات · `dark:` · أسرار.

## 5. معايير القبول

| # | المعيار | الدليل |
|---|---|---|
| 1 | `lint` + `tests 227` + `build` (Tera) | LIVE |
| 2 | `git diff` = ملفان فقط · بلا كلاس حرفي متبقٍّ | LIVE/STATIC (Tera) |
| 3 | الظل الأخضر يظهر على البطاقة فعلياً (قياس computed) | LIVE (Tera) |
| 4 | الشريط خوخي وليس كهرمانياً (قياس computed) | LIVE (Tera) |

**Owner Approval Required: Yes** (بصري بعد المعاينة).

## 6. البوابات

Matrix: React/TS → المتخصص · SDA: `FAST_PATH` (توكنز مثبتة + مواصفة جاهزة) · Security: `Low` · QA: `QA_REQUIRED` (Tera) · Auditor: `NOT_REQUIRED` · Model: sufficient · Pre-Execution Gate: **PASS**.

## 7. بروتوكول التفويض

- [Engineering File Quality]: اقرأ الملفين أولاً · جراحي · بلا إعادة تنسيق · تعليقات WHY فقط عند اللزوم.
- إن احتجت أداة خارج صلاحياتك: توقف واطلبها. Handback ≤80 سطراً بلا diffs. أي غموض = STOP.

## 8. Tera Post-Execution Review (2026-11-15 — قياس حي + لقطات)

| Check | Result | Evidence |
|---|---|---|
| Allowed Write Targets | PASS | `git status -- src/` = LoginView + DemoBanner فقط (زائد ملفات الدفعة السابقة) |
| literals/dark/shadow-xl | PASS | العدّ = 0 في الملفين |
| lint / tests / build (Tera) | PASS | 0 · 227/227 · 0 |
| #1 بطاقة أغمق + ظل أخضر بلا حدود داكنة | PASS | page `rgb(242,244,235)` · card `rgb(228,232,211)` · shadow `rgba(20,46,30,.10/.16)` — بلا `border` |
| #2 حقول كريمية بإطار أخضر هادئ | PASS | input `rgb(237,241,223)` · border `rgb(73,141,107)` = `#498D6B` — وأفتح من البطاقة |
| #3 كحلي للنصوص | PASS | `rgb(21,35,49)` في الصفحة والعناوين; الأخضر محصور في brand/interactive |
| #4 تخفيف الشريط البرتقالي | PASS | `rgb(248,236,226)` خوخي + نص كحلي (كان `warning-soft` كهرماني) |
| #5 ليموني مساعد | PASS | S للأسطح −44% إلى −57% مقابل v1 (قياس H06a) |
| Deviation موثق | DemoBanner بقي بعرض كامل (3 مواضع تركيب منها الهيدر الملتصق) — بديل المالك المسموح | §3 |

Gate Status: **PASS** — Final Decision: **READY FOR OWNER ACCEPTANCE** (Owner Approval Required: Yes — بصري)
ملاحظة صادقة: Lime أصبح أقرب إلى **ge** (كلاهما فاتح) — الفصل الآن في دفء/كريمية الأسطح وإطار الحقول الأخضر، وليس في الدرجة. لو رآهما المالك متطابقين، الرافعة الآمنة: رفع تشبّع `border`/`surface-3` في Lime فقط.

## 9. Compliance Record

Pre-Execution PASS · Allowed Targets PASS · No secrets PASS · Design Source D-H06-01 · Review PASS · Activity PASS · Handback PASS · Diff matches PASS · CLI done · Owner Approval = PENDING (بصري) · Cross-Record PASS.
Compliance Status: **PENDING_OWNER_APPROVAL**
