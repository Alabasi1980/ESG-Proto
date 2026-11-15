# TASK-PROTO-H10-2a — ترحيل SettingsView (أولوية المالك)

> **الحالة:** Assigned → engineering-agent-typescript · **Session:** NEW
> **الأولوية:** عالية — المالك رأى الصفحة مكسورة في الثيم الداكن (نص أبيض على أبيض 1.05:1).
> **المرجع الملزم:** `project-control/STYLE_CONTRACT.md`

## 1. الهدف
ترحيل ألوان `SettingsView.tsx` فقط (826 سطراً / 310 كلاساً حرفياً / 151 `dark:`).

## 2. Allowed Write Targets
```text
src\views\SettingsView.tsx
```
**لا تعدّل ملف الحارس** (مسارات H10-2 مضافة بقرار الدفعة التالية عبر كاتب واحد — إن احتجت ذلك STOP وأبلغني).

## 3. القواعد
- الأدوار: صفحة `bg-surface` · بطاقة `bg-surface-2` · حقل/صندوق غائر `bg-surface-3`.
- حذف **كل** `dark:*` (الثيم الداكن ثيم كامل).
- صفر: `bg-white` · `text-black` · `slate|gray|zinc|neutral|stone` · `#hex` في className.
- بطاقات الإحصاء (DATABASE STATUS / CONFIGURATION / ACTIVE DATABASE TABLES) = `bg-surface-3` + عنوان `text-muted` + قيمة `text-text`؛ «Connected» أخضر دلالي `text-success`؛ «8 tables created» `text-text` (كان أبيض على أبيض).
- الحقول: `bg-surface-3 border-border-strong text-text placeholder-muted`.
- **ممنوع تغيير المنطق**: لا hooks/state/handlers/نصوص/ترتيب/معرّفات. عدد الأسطر ±0.
- نمط لا تجد له تطابقاً في العقد → STOP واسأل.

## 4. القبول (Tera)
صفر ممنوعات · ±0 سطر · lint+227+build · **تدقيق تباين آلي بعد الترحيل: صفر نص < 4.5:1 في الصفحة × 3 ثيمات**.

## 5. البوابات
FAST_PATH · Security Low · QA_REQUIRED (Tera) · Auditor NOT_REQUIRED · Pre-Execution Gate: **PASS**.
