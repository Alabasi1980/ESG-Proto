# TASK-PROTO-H10-3b — توكنات النص الدلالي + Header + الحارس

> **الحالة:** Assigned → engineering-agent-typescript · **Session:** NEW
> **يعتمد على قرار المالك: (أ) توكنات نص دلالية** — لأنه لم يوافق على تجاوز 3.85.
> **المرجع:** `STYLE_CONTRACT.md` + `ISSUES_AND_GAPS.md` (ISS-001/ISS-005)

## 1. الهدف (ثلاثة مترابطة)
1. إضافة `--success-text` و`--warning-text` (نصّان دلاليان يمرّان AA على الأسطح الغائرة).
2. إصلاح شارة RLS في `Header.tsx` (`text-brand` → `text-brand-text`).
3. توسيع حارس النطاق بالمسارات الجديدة للدفعة (كاتب واحد = أنت).

## 2. Allowed Write Targets
```text
src\styles\tokens.css            (+ @theme default + @theme inline aliases)
src\styles\themes.css            (3 كتل: سطر لكل توكن)
src\components\Header.tsx        (شارتا text-brand فقط)
src\views\LoginView.tsx          (text-success/text-warning → -text)
src\views\DashboardView.tsx      (نفسها)
src\views\GeOverviewView.tsx     (نفسها)
src\views\EsgProfileView.tsx     (نفسها)
src\views\SettingsView.tsx       (نفسها)
src\views\StaffListsView.tsx     (نفسها)
src\lib\b17TransactionInventory.test.ts   (+5 مسارات مسمّاة · 31→36 · تعليق H10-3)
```

## 3. القيم (محسوبة مسبقاً — لا تُعدَّل)
```text
--success-text :  ge #026B38 · lime #026B38 · dark #69D59A
--warning-text :  ge #8A4109 · lime #8A4109 · dark #FBBF24
```
أضف في `tokens.css` داخل `@theme`: القيمتان بقيم ge، وداخل `@theme inline`:
`--color-success-text: var(--success-text);` و`--color-warning-text: var(--warning-text);`
**لا تلمس** `--success`/`--warning` (تبقى للتعبئة/الشارات) ولا أي توكن آخر.

## 4. قاعدة الاستبدال (حصراً حيث العنصر نص/أيقونة على سطح)
```text
text-success  → text-success-text      (يبقى bg-success-soft كما هو)
text-warning  → text-warning-text      (يبقى bg-warning-soft كما هو)
```
لا تلمس `bg-success*` / `border-success*` / `bg-warning*` / `border-warning*`.

## 5. الحارس (مسارات الدفعة)
أضف بالاسم: `src/views/SettingsView.tsx`, `src/views/StaffListsView.tsx`, `src/views/ServicesManage.tsx`, `src/views/GeOverviewView.tsx`, `src/views/EsgProfileView.tsx` — وتحقّق أولاً أيها موجود فعلاً في القائمة قبل الإضافة (تجنّب التكرار)، ثم اضبط `assert.equal(allowed.size, N)` على العدد الحقيقي مع تعليق `+ H10-3`.

## 6. القبول (Tera)
القيم مطابقة · lint+227+build · شارة RLS ≥ 4.5 في الثلاثة · صفر `text-success`/`text-warning` بلا `-text` في الملفات الستة.

## 7. البوابات
FAST_PATH · Low · QA_REQUIRED · Auditor NOT_REQUIRED · Pre-Execution Gate: **PASS**.
