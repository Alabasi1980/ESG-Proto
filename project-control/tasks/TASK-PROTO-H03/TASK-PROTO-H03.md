# TASK-PROTO-H03 — ترحيل شاشة الدخول + شريط الديمو إلى التوكنز

> **المسار:** `TASK-PROTO-H*` — دفعة ترحيل الشاشات (أولى دفعات H03)
> **الحالة:** Assigned → مفوَّضة إلى engineering-agent-typescript
> **ClientAppPath (مرحلي):** `D:\Teranoo Work\Client01\prototype-app`
> **Session:** NEW

## 1. الهدف (واحد فقط)

ترحيل `LoginView.tsx` + `DemoBanner.tsx` من الألوان الحرفية إلى التوكنز حسب `TOKEN_MAPPING.md` — فتصبح شاشة الدخول (أول ما يراه المستخدم) متوافقة مع الثيمات الثلاثة، ويُغلق نقص الدليل البصري المسجل في H02b.

## 2. سبب اختيار هذه الدفعة أولاً

- `LoginView` هو الشاشة التي **تحجب** التحقق البصري الحالي: يفرض `bg-slate-900` على كامل الشاشة فيغطي الثيم (المسجل في H02b §10).
- أصغر ملفين: `LoginView` 210 سطراً / 46 كلاساً حرفياً (منها 4 درجات غير قياسية `slate-750/850`) · `DemoBanner` 24 سطراً / 6 كلاسات + 3 `dark:`.
- **خطورة منخفضة:** بلا منطق مصادقة — كلاسات فقط.

## 3. 🔴 قرار مالك مطلوب قبل التنفيذ — D-H03-01: ثيم شاشة الدخول

النموذج المعتمد (D-H01-01): الثيم خاصية مستأجر يُبثّ **بعد** المصادقة. لكن شاشة الدخول **قبل** معرفة المستأجر. إذن: أي ثيم ترتديه؟

| الخيار | الأثر |
|---|---|
| **(أ) GE الافتراضي** — الدخول بهوية GE دائماً، والثيم يتبدل لحظة الدخول | أبسط، بلا نطاق جديد. **توصيتي** |
| **(ب) ثيم محايد خاص بلاشاشة الدخول** | يخالف مبدأ «تخطيط واحد/توكنز موحدة» ويحتاج توكنز رابعة |
| **(ج) هوية المستأجر قبل الدخول** (نطاق فرعي أو اختيار مستأجر) | سلوك منتج جديد + نطاق + تسعير — قرار TCEA/المالك |

**محسوم — D-H03-01 (2026-11-15): الخيار (أ) — الدخول بهوية GE الافتراضية دائماً، والثيم يتبدل لحظة الدخول.** (قرار المالك؛ يُوضع `data-theme` قبل الدخول = `ge` ثم يُعاد ضبطه من الجلسة بعد المصادقة.)

## 4. قرار حوكمة مطلوب — D-H01-07: توسيع الحارس لكل دفعة

كل دفعة ترحيل تمس ملفات `src` جديدة ⇒ الحارس (`b17TransactionInventory`) يرفضها ⇒ محتاج قرار مالك لكل دفعة (كما في H02c). المقترح: **تفويض قائم** إلى نهاية مسار الثيمات:

```text
توسيع allowed-set مسموح تلقائياً لكل ملف يرد بالاسم في عقد دفعة معتمد من المالك —
لا globs، لا مسارات ضمنية، وزيادة assert.size بعددها — ويُوثّق في كل مهمة.
```

بهذا لا أزعجك بقرار متكرر، ويبقى الحارس دقيقاً على المسارات المسمّاة.

## 5. Allowed Write Targets

```text
D:\Teranoo Work\Client01\prototype-app\src\views\LoginView.tsx
D:\Teranoo Work\Client01\prototype-app\src\components\DemoBanner.tsx
D:\Teranoo Work\Client01\prototype-app\src\lib\b17TransactionInventory.test.ts   (توسيع +2 مسار فقط، بشرط D-H01-07)
```

## 6. ممنوعات

- أي منطق/سلوك في الدخول (المصادقة، الرسائل، التدفق) — كلاسات فقط.
- أي ملف آخر · أي قيمة توكن جديدة · أسرار · قراءة env.

## 7. معايير القبول

| # | المعيار | الدليل |
|---|---|---|
| 1 | `lint` + `tests 227` + `build` خضراء (Tera) | LIVE |
| 2 | صفر كلاس حرفي + صفر `dark:` في الملفين (Tera) | STATIC |
| 3 | لقطات الدخول ×3 ثيمات **مختلفة بصرياً** (Tera — تغلق نقص H02b) | VISUAL |
| 4 | `git diff` = 3 ملفات فقط | LIVE |

## 8. البوابات

- Matrix: TS/React → `engineering-agent-typescript` · SDA: `FAST_PATH` (نمط مثبت من H02، ملفان، قابل للعكس) · Security: `Low` · QA: `QA_REQUIRED` (تنفيذ Tera) · Auditor: `NOT_REQUIRED` (العداد 2) · Model: sufficient.
- Pre-Execution Gate: **PASS** (D-H03-01 + D-H01-07 محسومان 2026-11-15)

## 9. Tera Post-Execution Review (2026-11-15 — فحص فعلي + تنفيذ مباشر)

| Check | Result | Notes |
|---|---|---|
| Files within Allowed Write Targets | PASS | `git diff --stat -- src/` = LoginView(50) + DemoBanner(4) + guard(5) — لا شيء غيرهما |
| Zero literals / zero `dark:` in 2 files | PASS | `literals=0` · `dark=0` · `slate-750/850` المتكررة = 0 (فحص Tera المباشر) |
| `lint` + `tests` + `build` (تنفيذ Tera) | PASS | lint exit 0 · **227/227** · build exit 0 (تحذير الـchunk السابق نفسه) |
| Visual ×3 (تنفيذ Tera: preview + computed + لقطات) | **PASS** | الدخول صار يتبع الثيم: ge `rgb(244,246,244)` · abyss `rgb(11,19,25)` · stone `rgb(247,246,243)` — 3 لقطات مختلفة الأحجام (44/47/46KB) محفوظة في مجلد المهمة. **نقص H02b البصري مغلق** |
| Contrast (Abyss) | PASS | التسميات `text-muted` = `#9DB0BC` على `#1D2D3A` ≈ 5.9:1 (AA) |
| Guard extension | PASS | مساران مسمّيان فقط · `assert.size` 24→26 · تعليقان (D-H01-07 + D-H03-01) · منطق الحارس بلا مساس |
| Behavior unchanged | PASS | 227 اختباراً خضراء + صفر تغيير في hooks/state/handlers |
| File Quality | PASS | جراحي · بلا إعادة تنسيق · بلا كود ميت |

**ملاحظتان للبوليش (ليستا رفضاً):** (1) شريط `DemoBanner` في Abyss يقرأ بدرجة زيتونية (شفافية `warning-soft` فوق الداكن) — مقروء لكنه ليس مثالياً بصرياً؛ يُحسَّن في جولة بوليش. (2) `hover:bg-surface-3` على زر اللغة = base نفسه (hover ميت) — نتيجة mapping حرفي؛ يُنظَّف مع بقية الهوامش لاحقاً.

Gate Status: **PASS** — Final Decision: **Accepted → Closed** (Owner Approval Required: No)
Knowledge Gate: DEFERRED-TO-TRANSFER (سياسة نطاق الوكيل نفسها في H02b).

## 10. Compliance Record

| # | Check | Result | Verified By |
|---|---|---|---|
| 1 | Pre-Execution Gate PASS documented | PASS | Tera |
| 2 | Allowed Write Targets respected | PASS | Tera |
| 3 | No secrets | PASS | Tera |
| 4 | Design Source documented | PASS | H01 المعتمد + D-H03-01 |
| 5 | Post-Execution Review PASS | PASS | Tera |
| 6 | Activity log updated | PASS | Tera |
| 7 | Handback recorded (≤80, بلا diffs) | PASS | Tera |
| 8 | Diff matches handback | PASS | Tera (3 ملفات) |
| 9 | CLI documented | Done | lint + tests + build + preview/Playwright (Tera) |
| 10 | Owner Approval | N/A | قرارات D-H03-01/D-H01-07 سابقة للتنفيذ |
| 11 | Cross-Record Consistency | PASS | Task / Activity / Audit |

Compliance Status: **COMPLIANT**
