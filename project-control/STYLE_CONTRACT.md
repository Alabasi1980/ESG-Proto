# STYLE_CONTRACT.md — العقد المركزي للستايل (ملزم لكل جلسة تعمل على التطبيق)

> **المالك:** TeraAgent · **الاعتماد:** D-H01-08 (غلبة الهوية) + D-H06-02 + D-H08-03 (الثيم الداكن)
> **الحالة:** ساري — أي شاشة جديدة أو معدّلة تلتزم به. المرجع التنفيذي للقيم: `src/styles/themes.css`.
> **النطاق:** طبقة العرض فقط. **ممنوع** تغيير منطق/سلوك أي شاشة بموجب هذا العقد.

## 1. أدوار التوكنز (موحّدة للثيمات الثلاثة — لا تُخالَف)

| الدور | التوكن | ge | lime | dark |
|---|---|---|---|---|
| خلفية الصفحة | `--surface` → `bg-surface` | #F4F6F4 | #EEF4D7 | #152331 |
| **البطاقة/اللوحة المرتفعة** | `--surface-2` → `bg-surface-2` | #FFFFFF | #E4EDB8 | #1D3029 |
| **الحقل/الصف الغائر** | `--surface-3` → `bg-surface-3` | #E9EFEA | #F7F8E3 | #263B33 |
| فاصل ناعم | `--border` → `border-border` | #DDE5DE | #CBD79B | #456347 |
| حد تأكيدي (حقول/عناصر) | `--border-strong` → `border-border-strong` | #B9C7BC | #498D6B | #93A987 |
| نص أساسي | `--text` → `text-text` | #152331 | #152331 | #F1F6D6 |
| نص ثانوي | `--muted` → `text-muted` | #55666F | #4C6176 | #CAD6AE |
| إجراء أساسي | `--brand` → `bg-brand` / `text-brand` | #038947 | #038947 | #026F39 |
| hover إجراء | `--brand-strong` | #026B38 | #026B38 | #027B40 |
| خلفية ملوّنة بالهوية | `--brand-soft` | #E2F1E7 | #E4F1EB | #294834 |
| **نص فوق `--brand`** | `--brand-ink` → `text-brand-ink` | #FFFFFF | #FFFFFF | #F1F6D6 |
| تمييز/لمسة | `--accent` / `--accent-soft` | #F16B3B / #FCE8D9 | نفسه | #F16B3B / #303F27 |
| دلالات | `--success` `--warning` `--danger` `--info` (+ `-soft`) | — | — | — |
| حلقة التركيز | `--focus-ring` → `ring-focus-ring` / `border-focus-ring` | #038947 | #038947 | #AFD139 |

> **قاعدة الأدوار الثلاثة:** خلفية الصفحة `surface` · البطاقة `surface-2` · الحقل والصفوف الغائرة `surface-3`. **ثابتة في الثلاثة** — لا اجتهاد لكل ثيم.

## 2. جدول التحويل (الكلاس الحرفي ← بديله المعتمد)

### الخلفيات
| ممنوع | استخدم |
|---|---|
| `bg-white`, `bg-slate-50`, `bg-slate-100` | `bg-surface-2` (بطاقة) أو `bg-surface` (صفحة) |
| `bg-slate-200`, `bg-slate-750/850` (غير قياسية) | `bg-surface-3` |
| `bg-emerald-600/700` | `bg-brand` |
| `bg-emerald-50/100`, `bg-emerald-950/*` | `bg-brand-soft` |
| `bg-amber-50/100`, `bg-amber-950/*` | `bg-warning-soft` |
| `bg-rose-50/100`, `bg-rose-950/*` | `bg-danger-soft` |
| `bg-sky-50`, `bg-blue-50` | `bg-info-soft` |
| `bg-black/50` (overlay) | يُبقى كما هو (بنيوي) |

### النصوص
| ممنوع | استخدم |
|---|---|
| `text-slate-900/800`, `text-white` (على سطح) | `text-text` |
| `text-slate-500/600/700` | `text-muted` |
| `text-white` **فوق تعبئة brand** | `text-brand-ink` |
| `text-emerald-*` | `text-brand` أو `text-brand-strong` |
| `text-amber-*` | `text-warning` |
| `text-rose-*`, `text-red-*` | `text-danger` |
| `text-sky-*`, `text-blue-*` | `text-info` |

### الحدود والحلقات
| ممنوع | استخدم |
|---|---|
| `border-slate-200`, `border-slate-700/800` | `border-border` |
| `border-slate-300`, `border-slate-600` | `border-border-strong` |
| `border-emerald-*` | `border-brand` |
| `ring-emerald-500` | `ring-focus-ring` |
| `divide-slate-*` | `divide-border` |

### ممنوعات مطلقة في ملفات الشاشات
```text
✗ أي لون سداسي داخل className أو style (#xxxxxx)
✗ أي dark:*  (الوضع الداكن ثيم كامل، لا متغيّر فرعي)
✗ bg-white / text-black / أي عائلة slate|gray|zinc|neutral|stone
✗ عائلات ملوّنة خارج: brand/accent/success/warning/danger/info
✗ تغيير منطق/حالة/نصوص/ترتيب JSX — الترحيل لوني فقط
```

## 3. أنماط المكوّنات المرجعية (Copy من هنا)

```text
بطاقة:        bg-surface-2 border border-border rounded-2xl
بطاقة مرتفعة: bg-surface-2 border border-border rounded-2xl shadow-[var(--shadow)]
حقل إدخال:    bg-surface-3 border border-border-strong rounded-xl text-text placeholder-muted
              focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/30
زر أساسي:     bg-brand text-brand-ink hover:bg-brand-strong
زر ثانوي:     bg-surface-2 border border-border-strong text-text hover:bg-surface-3
شارة نجاح:    bg-success-soft text-success    (مع أيقونة + نص دائماً)
شارة تحذير:   bg-warning-soft text-warning
شارة خطر:     bg-danger-soft  text-danger
شارة معلومة:  bg-info-soft    text-info
صف جدول:      border-t border-border hover:bg-surface-3
رأس جدول:     bg-surface-3 text-muted
```

## 4. قواعد RTL والعربية
- خصائص منطقية فقط: `ps-/pe-/ms-/me-/start-/end-` — لا `pl-/pr-/ml-/mr-/left-/right-`.
- الحقول التقنية (بريد/هاتف/URL/أكواد) `dir="ltr"` صريح.
- لا `letter-spacing` مع العربية؛ `line-height` ≥ 1.6 للنص العربي.

## 5. بوابة القبول لكل مهمة ترحيل (تُنفّذها Tera)
```text
[ ] صفر مطابقة لـ: (bg-white|text-black|slate-|gray-|zinc-|neutral-|stone-|dark:|#[0-9a-fA-F]{6})
    في الملفات المستهدفة
[ ] lint + tests + build  — خضراء
[ ] بلا تغيير في المنطق: مقارنة عدد الأسطر ±0 وعدم لمس hooks/state/handlers
[ ] لقطات: الشاشة × 3 ثيمات (ge/lime/dark) وبأدوارها الصحيحة
[ ] لا نص باهت أو سطح أبيض داخل الثيم الداكن
```

## 6. مرجع تنفيذي
- القيم: `src/styles/themes.css` · `src/styles/tokens.css`
- الخريطة التاريخية التفصيلية: `project-control/tasks/TASK-PROTO-H01/TOKEN_MAPPING.md`
- مواصفة الثيم الداكن المعتمدة: `project-control/prototypes/TASK-PROTO-H08a/DARK_THEME_RULES.md`
