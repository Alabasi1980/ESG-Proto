# TASK-PROTO-H11b — Initiatives Library

> **الحالة:** Assigned → engineering-agent-typescript · **Session:** NEW · **متوازٍ مع H11a**
> **المرجع الملزم:** `project-control/STYLE_CONTRACT.md`

## 1. الهدف
ترحيل ألوان `InitiativesView.tsx` (~99 كلاساً / 51 `dark:`).

## 2. Allowed Write Targets
```text
src\views\InitiativesView.tsx
```
**لا تلمس الحارس** (يملكه H11a) ولا أي ملف آخر.

## 3. القواعد
- أدوار: صفحة `bg-surface` · بطاقة `bg-surface-2` · غائر/حقل `bg-surface-3` · `border-border`/`border-border-strong` · `text-text`/`text-muted`.
- دلالات كنص: `text-success-text` · `text-warning-text` · `text-danger` · `text-info`.
- هوية كنص/أيقونة: `text-brand-text`.
- حذف كل `dark:*` · صفر `bg-white|slate|gray|zinc|neutral|stone|#hex` · صفر عائلات خارج التوكنز.
- لا تغيير منطق/نصوص/JSX/ترتيب · عدد الأسطر ±0 · غموض → STOP.

## 4. القبول (Tera)
صفر ممنوعات · ±0 · lint+227+build · تدقيق تباين ×3.

## 5. البوابات
FAST_PATH · Low · QA_REQUIRED · Auditor NOT_REQUIRED · Pre-Execution Gate: **PASS**.
