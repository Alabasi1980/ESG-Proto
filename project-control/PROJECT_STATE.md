# PROJECT_STATE.md — prototype-app (مسار التقسية)

> **المالك:** TeraAgent · **آخر تحديث:** 2026-11-15 · **الحالة:** طبقة الستايل معتمدة (D-STYLE-01)
> **الغرض:** بوابة سياق لأي جلسة تعمل على التطبيق — اقرأها أولاً، ثم `STYLE_CONTRACT.md`.

## 1. الوضع الحالي

| البند | القيمة |
|---|---|
| المسار | `D:\Teranoo Work\Client01\prototype-app` (ClientAppPath مرحلي) |
| القاعدة | **مشتركة دائمة** `127.0.0.1:55432` / `b17_showcase` / حاوية `b17-showcase` / مجلد `b17-showcase-data` |
| التشغيل | `npm run showcase -- persistent` → يطبع `SHOWCASE_URL` (المنفذ يتغير) |
| الأسرار | `.env` فقط (`B17_DEMO_*`) — لا تُنسخ ولا تُطبع |
| الأدوار | `owner@teranoo.com` (ge_admin) · `majid.khaireddin@gmail.com` (client_admin) · `mjd.alabasi@gmail.com` (employee/Legal) |
| الحزم | React 19 · Vite 8 · TS · Express · PostgreSQL · Tailwind v4 |

## 2. حالة الستايل (مكتملة)

```text
ثلاث ثيمات: ge (افتراضي) · lime · dark   — عبر data-theme
توكنز مركزية: tokens.css (30) + themes.css (3 كتل)
ترحيل: 22 ملفاً — صفر ألوان حرفية · صفر dark: · صفر ستايل محلي
استثناءات معتمدة: الطباعة/PDF (لا تُلوَّن) · 4.49 لثلاثة عناصر (GAP-002)
بوابات: lint 0 · tests 227/227 · build 0
```

## 3. القيد الوظيفي المعروف

- ✅ **D-H01-01 أُنجز (TASK-PROTO-H12):** الثيم من الخادم — عمود `clients.theme` (افتراضي `ge`، الكاتب **المنصة فقط** عبر `PATCH /clients/:id`) يُبثّ في `login`/`auth/me` ويطبّقه `ThemeContext`؛ **لا معامل URL**.
- بعض العمليات ترجع `workspace.invalid` (سلطة الـworkspace غير مكتملة في الجلسة الوظيفية) — ليست عيب ستايل.

## 4. الخطوة التالية

1. **الجلسة الوظيفية:** استئناف العمل على المنطق/الوظائف ملتزمةً بالعقد.
2. النقل للتطبيق الرئيسي (يستلزم Gate 7 + قرار المالك).

## 5. ملفات الحكم

```text
STYLE_CONTRACT.md · STYLE_HANDOFF.md · ISSUES_AND_GAPS.md · DECISIONS_LOG.md
PROJECT_ACTIVITY_LOG.md · TERA_AUDIT_TRAIL.md · TASK_REGISTRY.md · tasks/
```
