# TASK-PROTO-H10-2b — StaffLists + توكن `--brand-text` + إصلاح ISS-001

> **الحالة:** Assigned → engineering-agent-typescript · **Session:** NEW
> **المرجع:** `project-control/STYLE_CONTRACT.md` + `ISSUES_AND_GAPS.md` (ISS-001)

## 1. الهدف (اثنان مترابطان)
1. ترحيل `StaffListsView.tsx` (حقول بيضاء بنص فاتح حالياً).
2. إضافة توكن `--brand-text` وإصلاح كل مواضع `text-brand`/`text-brand-strong` المستخدمة **كنص/أيقونة** في الملفات المُرحّلة (ISS-001).

## 2. Allowed Write Targets
```text
src\views\StaffListsView.tsx
src\styles\tokens.css           (تعريف @theme + alias)
src\styles\themes.css           (3 كتل: ge · lime · dark — إضافة سطر واحد لكل)
src\views\LoginView.tsx         (مواضع text-brand كأيقونة/نص فقط)
src\views\DashboardView.tsx     (نفسها)
src\views\GeOverviewView.tsx    (نفسها)
src\views\EsgProfileView.tsx    (نفسها)
```

## 3. القيم (محسوبة — لا تغيير)
```text
--brand-text :  ge #026B38  · lime #026B38  · dark #86DCA8
```
أضِف alias في `tokens.css`: `--color-brand-text: var(--brand-text);` داخل `@theme inline` (بجانب بقية الألوان).
**لا تغيّر** `--brand` (تعبئة الزر المعتمدة `#026F39` في الداكن) ولا أي توكن آخر.

## 4. قاعدة الاستبدال
```text
text-brand  أو text-brand-strong  ← حين يكون العنصر نصاً أو أيقونة (لا تعبئة)
      ⇒  text-brand-text
bg-brand / bg-brand-strong / hover:bg-brand-strong  ⇒ تبقى كما هي
```

## 5. قواعد الترحيل (StaffLists)
نفس عقد H10-2a: أدوار التوكنز · حذف كل `dark:*` · صفر `bg-white/slate/#hex` · حقول `bg-surface-3 border-border-strong text-text placeholder-muted` · زر الحذف `text-danger border-danger` على `bg-surface-3` · عدد الأسطر ±0 · لا منطق.

## 6. القبول (Tera)
صفر ممنوعات في الملفات السبعة · `--brand-text` موجود في الكتل الثلاث · lint+227+build · **تدقيق تباين: صفر <4.5:1** في Staff lists والداشبورد × 3 ثيمات (شارة RLS ≥ 4.5).

## 7. البوابات
FAST_PATH · Security Low · QA_REQUIRED (Tera) · Auditor NOT_REQUIRED · Pre-Execution Gate: **PASS**.
