# TASK-PROTO-H09b — ربط المفتاح `dark` + تجاوز معاينة `?theme=` + توسيع الحارس

> **الحالة:** Assigned (بعد H09a) → engineering-agent-typescript
> **Session:** NEW · **يعتمد على:** H09a مقبولة
> **السياق:** آلية الاختيار الحالية ثابتة (`TENANT_THEME='ge'`) والـunion يحوي مفتاحاً ميتاً (`stone`) ويفتقد (`lime`,`dark`).

## 1. الهدف (واحد)

تحديث `ThemeContext.tsx`: الـunion يصبح `'ge' | 'lime' | 'dark'` + قراءة تجاوز `?theme=` للمعاينة. **لا توسيع حارس في هذه المهمة** — `ThemeContext.tsx` و`themes.css` موجودان أصلاً في allowed-set (سطر 124، size=26)؛ تصحيح خطأ عقد (كان يطلب مسارين غير مسمّيين).

## 2. القواعد الملزمة (آلية Tera — ليست سلوك منتج)

```tsx
// TEMPORARY preview override (prototype only — removed at transfer; server session takes over per D-H01-01)
const PARAM = new URLSearchParams(window.location.search).get('theme');
const TENANT_THEME: TenantTheme = 'ge';   // unchanged default
const theme = (PARAM === 'ge' || PARAM === 'lime' || PARAM === 'dark') ? PARAM : TENANT_THEME;
```
- `data-theme` يُضبط قبل أول رسم (كما هو) — بلا واجهة اختيار، بلا localStorage، بلا fetch، بلا أسرار.
- أي قيمة `?theme=` غير معروفة = تجاهل صامت والرجوع للافتراضي.

## 3. Allowed Write Targets (حصري)

```text
D:\Teranoo Work\Client01\prototype-app\src\context\ThemeContext.tsx
```

**ملاحظة الحارس:** لا تعديل على ملف الاختبار — المساران مغطّيان مسبقاً (size=26).

## 4. ممنوعات

- أي ملف آخر · أي منطق غير المذكور · تغيير قيم التوكنز · مكتبات · أسرار/env · `dark:` (يقصد CSS variant — لا علاقة له باسم الثيم).

## 5. معايير القبول

| # | المعيار | الدليل |
|---|---|---|
| 1 | `lint` + `tests 227` + `build` (Tera) | LIVE |
| 2 | `?theme=lime\|dark\|ge` يبدّل فعلياً + قيمة مجهولة = ge (Tera: فحص متصفح) | LIVE |
| 3 | `git diff` = ملف واحد فقط | LIVE (Tera) |

**Owner Approval Required: No** (آلية معتمدة مسبقاً في خطة H09).

## 6. البوابات

Matrix: TS/React → المتخصص · SDA: `FAST_PATH` (آلية مثبتة، ملفان، قابل للعكس) · Security: `Low` (قراءة query-string فقط؛ ممنوع env/fetch) · QA: `QA_REQUIRED` (Tera) · Auditor: `NOT_REQUIRED` (العداد 2) · Model: sufficient · Pre-Execution Gate: **PASS**.

## 7. التفويض

- [Engineering File Quality]: اقرأ الملفين أولاً · جراحي · WHY موجز · بلا كود ميت.
- أداة خارج صلاحياتك: توقف واطلبها. Handback ≤80 سطراً بلا diffs. أي غموض = STOP.
