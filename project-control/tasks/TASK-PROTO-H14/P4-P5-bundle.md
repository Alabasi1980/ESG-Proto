# P4/P5 — آخر ثلاثة ملفات خام + إغلاق ISS-007

> **المرجع:** `STYLE_CONTRACT.md` (بما فيه: استثناء الطباعة · لا ستايل محلي · قاعدة التركيب).

## الحالة
```text
ClientDetailView  lit=63  dark=24  wb=6
SetupView         lit=52  dark=0   wb=0
ImportGRIView     lit=211 dark=105 wb=6   ← حساس: استيراد ملفات GRI
Sidebar           ISS-007: بانر المستأجر شفاف → سطر القسم 3.44 في ge
```

## المهام
| المهمة | الملفات |
|---|---|
| **P4** | `ClientDetailView.tsx` + `SetupView.tsx` + `Sidebar.tsx` (ISS-007 فقط) |
| **P5** | `ImportGRIView.tsx` + **الحارس** |

## ISS-007 (P4 — سطر واحد)
`Sidebar.tsx`: بانر المستأجر `bg-surface-3/80` → `bg-surface-3` (معتم). لا شيء غيره.

## قواعد الترحيل
- أدوار: صفحة `bg-surface` · بطاقة `bg-surface-2` · غائر/حقل `bg-surface-3` · `border-border`/`border-border-strong` · `text-text`/`text-muted`.
- دلالات كنص: `text-success-text` · `text-warning-text` · `text-danger` · `text-info` · هوية: `text-brand-text`.
- **ImportGRI**: شريط التقدّم ورسائل الاستيراد تبقى دلالية؛ لا تغيير في منطق الرفع/التحقق إطلاقاً.
- حذف كل `dark:*` · صفر `bg-white|slate|gray|zinc|neutral|stone|#hex` · صفر عائلات خارج التوكنز.
- ممنوع `style={{color|background|border|fill|stroke}}` · ممنوع تغيير منطق/نصوص/JSX · عدد الأسطر ±0 · غموض → STOP.

## الحارس (P5 — كاتب واحد)
أضف الناقص من: `ClientDetailView.tsx`, `SetupView.tsx`, `ImportGRIView.tsx` · اضبط العدد الحقيقي · تعليق `+ P4/P5`.

## القبول (Tera)
صفر مخالفات · ±0 · lint+227+build · تدقيق تباين ×3 على الشاشات الثلاث · ISS-007 مُغلق (سطر القسم ≥4.5 في ge).
