# TASK-PROTO-H10-3a — ترحيل ServicesManage (المكوّن المُضمَّن في الإعدادات)

> **الحالة:** Assigned → engineering-agent-typescript · **Session:** NEW
> **الأولوية:** عالية — المالك أرسل صورة: حقول بيضاء ونص باهت داخل «Services» في الإعدادات.
> **المرجع:** `project-control/STYLE_CONTRACT.md`

## 1. الهدف
ترحيل ألوان `ServicesManage.tsx` (128 كلاساً حرفياً / 61 `dark:` / 404 سطراً).

## 2. Allowed Write Targets
```text
src\views\ServicesManage.tsx
```

## 3. قواعد (من العقد)
- الأدوار: بطاقة `bg-surface-2` · حقل/صف غائر `bg-surface-3` · فاصل `border-border` · حد قوي `border-border-strong`.
- الحقول: `bg-surface-3 border border-border-strong text-text placeholder-muted focus:ring-2 focus:ring-focus-ring/20`.
- الأزرار الأساسية: `bg-brand text-brand-ink hover:bg-brand-strong`.
- حذف كل `dark:*` · صفر `bg-white|slate|gray|zinc|neutral|stone|#hex` · صفر عائلات خارج التوكنز.
- **لا تغيير منطق/نصوص/JSX/ترتيب** · عدد الأسطر ±0 · نمط بلا تطابق → STOP واسأل.

## 4. القبول (Tera)
صفر ممنوعات · ±0 · lint+227+build · تدقيق تباين آلي على الصفحة × 3 ثيمات = صفر <4.5.

## 5. البوابات
FAST_PATH · Low · QA_REQUIRED · Auditor NOT_REQUIRED · Pre-Execution Gate: **PASS**.
