# P1/P2 — ترحيل مكوّنات الصفحات الناقصة (ثلاث مهام متوازية)

> **المرجع الملزم:** `project-control/STYLE_CONTRACT.md` (بما فيه: قاعدة «لا ستايل محلي» + قاعدة التركيب).
> **القاعدة:** لا تُعدّ الصفحة مكتملة إلا إذا نُظِّف ملفها **وكل مُضمَّناته**.

## الحالة الحقيقية (جرد آلي)
```text
Gap Analysis  = GapAnalysisView(نظيف) + EvaluationPanel(278) + ClientReviewView(108) + GeFinalView(116)
Standards     = StandardsView(نظيف)  + TaxonomyManage(151)
```

## المهام (ملفات متباعدة — كتابة متوازية آمنة)

| المهمة | الملف | الحجم |
|---|---|---|
| **P1a** | `src\views\EvaluationPanel.tsx` | 278 · 142 dark · 12 bg-white |
| **P1b** | `src\views\ClientReviewView.tsx` + `src\views\GeFinalView.tsx` + **الحارس** | 108 + 116 |
| **P2** | `src\views\TaxonomyManage.tsx` | 151 · 67 dark |

## القواعد (مختصرة — التفصيل في العقد)
- أدوار: صفحة `bg-surface` · بطاقة `bg-surface-2` · غائر/حقل `bg-surface-3` · `border-border`/`border-border-strong` · `text-text`/`text-muted`.
- دلالات كنص: `text-success-text` · `text-warning-text` · `text-danger` · `text-info` — الهوية كنص/أيقونة: `text-brand-text`.
- حذف كل `dark:*` · صفر `bg-white|slate|gray|zinc|neutral|stone|#hex` · صفر عائلات خارج التوكنز.
- **ممنوع** أي `style={{color|background|border|fill|stroke}}` أو CSS محلّي. الأبعاد الديناميكية (`width: %`) مسموحة.
- **ممنوع** تغيير منطق/نصوص/JSX/ترتيب · عدد الأسطر ±0 · غموض → STOP.

## الحارس (P1b فقط — كاتب واحد)
أضف المسارات الناقصة فعلياً من: `EvaluationPanel.tsx`, `ClientReviewView.tsx`, `GeFinalView.tsx`, `TaxonomyManage.tsx` · اضبط `assert.equal(allowed.size, العدد الحقيقي)` · تعليق `+ P1/P2`.

## القبول (Tera)
صفر مخالفات · ±0 سطر · lint+227+build · تدقيق تباين ×3 ثيمات على **الصفحتين كاملتين** · صفر أسطح بيضاء.
