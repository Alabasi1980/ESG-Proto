# TASK-PROTO-H11a — GapAnalysis + Standards (+ الحارس)

> **الحالة:** Assigned → engineering-agent-typescript · **Session:** NEW · **متوازٍ مع H11b**
> **المرجع الملزم:** `project-control/STYLE_CONTRACT.md` (اقرأه أولاً)

## 1. الهدف
ترحيل ألوان `GapAnalysisView.tsx` (~88 كلاساً) و`StandardsView.tsx` (~85) + توسيع الحارس بمسارات الدفعة الثلاثة.

## 2. Allowed Write Targets
```text
src\views\GapAnalysisView.tsx
src\views\StandardsView.tsx
src\lib\b17TransactionInventory.test.ts   (+3 مسارات مسمّاة · العدد الحقيقي · تعليق H11)
```

## 3. القواعد
- أدوار: صفحة `bg-surface` · بطاقة `bg-surface-2` · غائر/حقل `bg-surface-3` · `border-border` / `border-border-strong` · `text-text` / `text-muted`.
- **الدلالات كنص**: `text-success-text` · `text-warning-text` · `text-danger` · `text-info` (لا `text-success`/`text-warning`).
- **الهوية كنص/أيقونة**: `text-brand-text` (لا `text-brand`).
- حذف كل `dark:*` · صفر `bg-white|slate|gray|zinc|neutral|stone|#hex` · صفر عائلات خارج التوكنز (indigo/violet/amber/emerald… حسب جدول العقد).
- **ممنوع تغيير المنطق/النصوص/JSX/الترتيب** · عدد الأسطر ±0 · نمط بلا تطابق → STOP.

## 4. القبول (Tera)
صفر ممنوعات · ±0 · lint+227+build · تدقيق تباين ×3 ثيمات.

## 5. البوابات
FAST_PATH · Low · QA_REQUIRED · Auditor NOT_REQUIRED · Pre-Execution Gate: **PASS**.
