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
