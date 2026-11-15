# TOKEN_MAPPING.md — جرد الكلاسات الحرفية الحالية ← التوكن المقابل

> **المنهج (قراءة فقط):** مسح `src/*.tsx` + `src/components/*.tsx` + `src/views/*.tsx` بأنماط `bg-/text-/border-/ring-` — القائمة أدناه هي الخلاصة الدلالية (الدرجات المكررة دُمجت).

## 1. الخلفيات

| الكلاس الحالي | السياق المرصود | التوكن |
|---------------|----------------|--------|
| `bg-slate-900` | الشريط الجانبي، الهيدر (وضع داكن) | `--sidebar-bg` / `--surface-2` حسب السياق |
| `bg-slate-800/60`, `bg-slate-800/80`, `bg-slate-700` | hover nav، شارة المستأجر، avatar | `--surface-3` (تُشتق الشفافية من التوكن) |
| `bg-emerald-600` | عنصر nav النشط، شارة GE | `--sidebar-active` (Theme 1 = `#038947`) |
| `bg-emerald-50` / `bg-emerald-950/40` | شارة "متصل" | `--brand-soft` |
| `bg-amber-50` / `bg-amber-950/40` | شارة "غير متصل" | `--warning-soft` |
| `bg-rose-500` | عدّاد الإشعارات | `--danger` |
| `bg-rose-50`, `bg-rose-100` | خلفيات حذف/خطر | `--danger-soft` |
| `bg-emerald-100`, `bg-amber-100` | خلفيات badges | `--brand-soft` / `--warning-soft` |
| `bg-white`, `bg-slate-50`, `bg-slate-100`, `bg-slate-200` | أسطح فاتحة | `--surface-2` / `--surface` / `--surface-3` حسب الدور |
| `bg-black/50` | طبقة الـ overlay (جوال) | ثابت بنيوي (خارج التوكنز — يُبقى) |
| `bg-slate-950`, `bg-emerald-900/950`, `bg-rose-950`, `bg-amber-950` | أسطح الوضع الداكن الحالي | تُحذف — يحل محلها الثيم الداكن (Abyss) عبر نفس التوكنز |
| `bg-emerald-500/700/800`, `bg-amber-600/700`, `bg-rose-600/700` | حالات متنوعة | `--brand(-strong)` / `--warning` / `--danger` حسب المعنى لا الدرجة |

## 2. النصوص والحدود والحلقات

| الكلاس الحالي | التوكن |
|---------------|--------|
| `text-white`, `text-slate-100/200` على الداكن | `--sidebar-text` (في الشريط) / `--brand-ink` (فوق تعبئة ملوّنة) / `--text` (في Abyss) |
| `text-slate-900` | `--text` |
| `text-slate-300/400/500/600/700/800` | `--muted` (في الشريط: `300/400` ← `--sidebar-muted`) |
| `text-emerald-300/400` (على الداكن)، `text-emerald-600/700/800` (على الفاتح) | نص الهوية ← `brand` / `brand-strong` حسب الاتجاه |
| `text-amber-*`, `text-rose-*` | `--warning` / `--danger` (مع أيقونة دائماً) |
| `border-slate-200` (فاتح)، `border-slate-700/800` (داكن/شريط) | `--border` (فواصل الشريط: `sidebar-muted` بشفافية عبر `color-mix` — بلا توكن جديد) |
| `border-emerald-*`, `border-amber-*`, `border-rose-*` | حدود الحالات ← `brand` / `warning` / `danger` أو `-soft` للخلفيات |
| `ring-emerald-500` | `--focus-ring` |

## 3. ملاحظتان للترحيل (دفعة التنفيذ — ليست عمل هذه المهمة)

1. **درجات غير قياسية:** رُصد `bg-slate-750` و`bg-slate-850` و`border-slate-750` — لا وجود لها في Tailwind (تُتجاهل صامتة غالباً أو مولّدة من تخصيص مجهول) ← تُرحَّل إلى `--surface-3` / `--border-strong` ويُتحقق من مصدرها قبل الحذف.
2. **متغيرات `dark:`:** كل استخدامات `dark:bg-*`/`dark:text-*` في `Header` (وغيره) تُستبدل بالتوكن الواحد — الثيم الداكن يُدار بـ `data-theme="abyss"` لا بمتغير فرعي، فيُحذف كل `dark:` أثناء الترحيل.
