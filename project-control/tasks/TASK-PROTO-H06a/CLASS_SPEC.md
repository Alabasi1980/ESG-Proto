# CLASS_SPEC.md — TASK-PROTO-H06a (D-H06-01 تطبيق بصري)

> **من يطبّق:** `engineering-agent-typescript` في `TASK-PROTO-H06b`. **المصمم لا يعدّل كود المكوّنات** — هذه مواصفة نصية فقط.
> **الأساس:** توكنز Lime v2 في `src/styles/themes.css` (كتلة `[data-theme="lime"]`) + `THEME_03_LIME.md` §2.
> **القاعدة:** الطبقة (tone) + الظل الأخضر يفصلان، لا الحدود الداكنة (D-H06-01 #1). الأخضر للأفعال فقط (#3). اللايم مسند (#5).
> **كل كلاس أدناه مأخوذ حرفياً من الملفين الحاليين** — إن اختلف نص «الحالي» عند التنفيذ، توقف وابتّ (الملف تغيّر بعد هذه المواصفة).

## 1. `src/views/LoginView.tsx`

| # | السطر | الحالي | الجديد | WHY |
|---|-------|--------|--------|-----|
| 1 | 87 (زر اللغة) | `flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-3 border border-border text-xs font-semibold text-muted hover:text-text hover:bg-surface-3 transition-colors` | `flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-3 border border-border text-xs font-semibold text-muted hover:text-text hover:border-border-strong transition-colors` | `hover:bg-surface-3` = نفس الخلفية (hover ميت). الاستبدال: الإطار يخضرّ عند التفاعل — إشارة تفاعل بلا لون ثابت |
| 2 | 95 (شارة GE) | `inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand text-brand-ink shadow-lg shadow-brand/30 mb-4` | `inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand text-brand-ink shadow-[var(--shadow)] mb-4` | مصدر ضوء واحد: نفس الظل المخضرّ لكل المرتفعات (Refactoring UI — العمق)؛ إزالة توهّج أخضر ثانٍ ينافس البطاقة (#5) |
| 3 | 107 (**البطاقة**) | `bg-surface-3 py-8 px-6 sm:px-10 shadow-xl rounded-2xl border border-border-strong` | `bg-surface-3 py-8 px-6 sm:px-10 shadow-[var(--shadow)] rounded-2xl` | **#1:** لا حد داكن إطلاقاً — الفصل من `--surface-3` (أغمق 7 L) + `--shadow` المخضرّ. `border-border-strong` هنا كان يسحب انتباهًا يوازي زر الدخول |
| 4 | 123 (لوحة التهيئة) | `mb-6 p-4 rounded-xl bg-brand-soft border border-brand text-brand text-xs` | `mb-6 p-4 rounded-xl bg-brand-soft text-xs` | **#3:** حذف `text-brand` عن النص الثابت والحذف المتكرر للإطار الأخضر؛ التمييز يأتي من خلفية `--brand-soft` الناعمة (13.73:1 مع الكحلي) |
| 5 | 124 (عنوان اللوحة) | `font-bold mb-1 flex items-center gap-1.5 text-brand` | `font-bold mb-1 flex items-center gap-1.5 text-text` | **#3:** الكحلي يقرأ. الأخضر محصور في الزر داخل اللوحة |
| 6 | 128 (نص اللوحة) | `text-[11px] text-brand leading-relaxed mb-3` | `text-[11px] text-muted leading-relaxed mb-3` | **#3:** نص ثابت → `--muted` الكحلي (5.53:1 على `--surface-2`) |
| 7 | 163 (حقل البريد) | `w-full ps-9 pe-4 py-2.5 rounded-xl text-xs bg-surface-2 border border-border text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/30 focus:border-focus-ring` | `w-full ps-9 pe-4 py-2.5 rounded-xl text-xs bg-surface-2 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/30 focus:border-focus-ring` | **#2:** إطار أخضر هادئ (3.44:1) يفصل الحقل الكريمي عن البطاقة؛ الحلقة تبقى `focus-ring` = `--brand` من التوكن |
| 8 | 180 (حقل كلمة المرور) | (نفس نص السطر 163 حرفياً) | (نفس تحويل #7 حرفياً) | **#2:** الحقلان يجب أن يتطابقا |
| 9 | 196 (فاصل أسفل البطاقة) | `mt-6 pt-4 border-t border-border-strong text-center` | `mt-6 pt-4 border-t border-border text-center` | `--border-strong` صار إطار حقول أخضر؛ الفاصل الزخرفي يأخذ `--border` الناعم |
| 10 | 200 (رابط التهيئة) | `text-xs text-brand hover:text-brand-strong font-semibold` | `text-xs text-brand-strong font-semibold hover:underline` | `--brand` على البطاقة = 4.18:1 (دون AA لنص صغير)؛ `--brand-strong` = 5.31:1 ✓. hover يصبح خطاً سفلياً بدل تفتيح اللون |

**عدد `border-border-strong` المتبقي في الملف بعد التنفيذ = 2 (السطران 163 و180 فقط).** أي زيادة = مخالفة.

## 2. `src/components/DemoBanner.tsx` (المكوّن مشترك — ثلاثة مواضع تركيب)

| # | السطر | الحالي | الجديد | WHY |
|---|-------|--------|--------|-----|
| 11 | 17 (الحاوية) | `w-full border-b border-warning/30 bg-warning-soft px-4 py-1.5 text-center` | `mx-auto mt-3 mb-2 w-fit max-w-[calc(100%_-_2rem)] rounded-full bg-accent-soft px-4 py-1.5 text-center ring-1 ring-accent/20` | **#4:** شريط بعرض الشاشة + كهرماني مشبع = يسحب الانتباه من الدخول. الآن حاوية خوخية بحواف كاملة بعرض المحتوى. `ring-accent/20` ضروري لأن تباين الخوخي على اللوحة = 1.05:1 (بلا إطار يذوب الحبّة) |
| 12 | 19 (النص) | `text-[11px] font-semibold tracking-wide text-warning` | `text-[11px] font-semibold text-text` | **#4:** حبر `--text` الكحلي (13.74:1 على الخوخي). حذف `tracking-wide` لأن تباعد الحروف يقطع اتصال الحروف العربية |

**ماذا نفعل بالشريط الكامل (`w-full border-b …`)؟** يُحذف كلياً ولا يُعوَّض بغلاف: الحاوية تصبح كبسولة ذاتية التمركز (`mx-auto w-fit`)، فتعمل في المواضع الثلاثة كما هي دون لمس `LoginView:82` أو `SetupView:72` أو `Header:62`. `role="note"` و`aria-live="polite"` يبقيان كما هما.

## 3. لم يُغيَّر عمداً (تحقق من الاكتمال)

| الموضع | الكلاس/السبب |
|---|---|
| LoginView:81 (الجذر) | `bg-surface` — التوكن وحده يغيّر اللوحة |
| LoginView:89 (أيقونة الكرة) | `text-brand` — عنصر تفاعلي، الأخضر مسموح (#3) |
| LoginView:98 (العنوان) | `text-text` — كحلي أصلاً ✓ |
| LoginView:101 (العنوان الفرعي) | `text-muted` — صار كحلياً من التوكن |
| LoginView:110-118 (تنبيه قاعدة البيانات) | لوحة داخلية لا حقل: `bg-surface-2 border border-border` تبقى؛ `text-warning` دلالي |
| LoginView:134 (زر التهيئة) · 186 (زر الدخول) | `bg-brand … text-brand-ink` — الإجراء الأخضر الوحيد في الشاشة |
| LoginView:143 (الخطأ) | `danger` دلالي |
| LoginView:151-155 (التسمية/الأيقونة) | `text-muted` — كحلي من التوكن |
| DemoBanner:14-16 (الدور/الوصف) | بنيوي، لا علاقة باللون |

## 4. ملاحظات للمنفّذ (H06b)

1. `shadow-[var(--shadow)]` هي الصيغة المطلوبة؛ المكافئ `shadow-(--shadow)` مقبول. **إن فسّرها المحرّك كلون لا كظل** (احتمال ضئيل لأن القيمة var عديمة النوع)، فالبديل المضمون: `[box-shadow:var(--shadow)]`. لا تُعدّل `tokens.css` ولا `@theme`.
2. لا `dark:` ولا `!important` ولا مكتبة جديدة. لا تعدّل `[data-theme="ge"]` أو `[data-theme="abyss"]` (الكتلة اللايمية محدّثة بالفعل).
3. حافظ على ترتيب الكلاسات الداخلي كما في الملف؛ لا تعيد ترتيب كلاس لم يُذكر أعلاه.
4. تحقق بعد التنفيذ: (أ) البطاقة بلا `border`، (ب) `border-border-strong` مرتان فقط، (ج) `shadow-xl` و`shadow-lg` لم تبقيا في `LoginView`، (د) لا كلاس لوني خام (`bg-[#…]`) في الملفين.
5. المتوقع بصرياً في الثيم اللايمي: بطاقة أغمق من اللوحة بـ7 L، وحقول أفتح من البطاقة بـ4.1 L بإطار أخضر — إن لم يظهر الفرق فالسبب توكن لم يُطبّق لا كلاس.

## 5. خارج النطاق — يُبلَّغ لـTera

- `Header.tsx:61` (غلاف `sticky top-0 z-30`) بلا خلفية: الكبسولة الجديدة تترك هامشاً شفافاً فوق الشريط في شاشات التطبيق. الإصلاح المقترح لاحقاً: `bg-surface` على الغلاف — `Header.tsx` ليس هدف كتابة هنا.
- `SetupView.tsx` كامل على كلاسات `slate/emerald` ثابتة (خارج الثيمات) — لا يزال غير ممتد على التوكنز، ودمج `DemoBanner` فيه سيظهر كبسولة خوخية على خلفية `slate-900` حتى يُحوَّل للتوكنز.
