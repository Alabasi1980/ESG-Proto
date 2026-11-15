# TASK-PROTO-H05a — إعادة تصميم الثيم الثالث: GE Lime (بديل Stone)

> **المسار:** `TASK-PROTO-H*` — تصحيح هوية الثيم الثالث تحت D-H01-08
> **الحالة:** Assigned → مفوَّضة إلى ui-designer
> **ClientAppPath (مرحلي):** `D:\Teranoo Work\Client01\prototype-app`
> **Session:** NEW (نطاق تصميمي جديد — لا يستأنف جلسة H01)
> **السبب:** المالك رفض هوية Stone (رمادي حجري + تيل) — خارج غلبة هوية GE. D-H01-08 يعتمد القاعدة والبديل.

## 1. الهدف (واحد فقط)

استبدال الثيم الثالث بهوية **GE Lime** المبنية من اللوحة الأربعة، وتطبيق قيمه في `themes.css` مكان كتلة `stone`.

## 2. قاعدة D-H01-08 (ملزمة — فحصها آلي)

- **20 توكن هوية** (`surface/surface-2/surface-3`, `border`, `border-strong`, `text`, `muted`, `brand`, `brand-strong`, `brand-soft`, `brand-ink`, `accent`, `accent-soft`, `sidebar-*` ×6, `focus-ring`) — **كلها مشتقة من `#F16B3B` / `#AFD139` / `#038947` / `#152331`** (تدرّج داخل نفس العائلة).
- **8 توكن دلالة** (`success(-soft)`, `warning(-soft)`, `danger(-soft)`, `info(-soft)`) — يجوز أن تكون خارج اللوحة.
- **ممنوع** أي عائلة لون دخيلة كهوية (رمادي دافئ، تيل، بنفسجي، أزرق مؤسسي…).
- ممنوع `#C2571F` (البرتقالي المُعمَّق السابق) — البرتقالي يعود `#F16B3B` أو تدرّجاً منه فقط، ويُمنع النص الأبيض فوقه (استخدم `--text`).

## 3. المفهوم المطلوب

«ثيم فاتح تقوده اللايم»: أسطح لايم مخفّفة جداً (قريبة من الأبيض لكن مشبعة بدرجة اللايم)، شرائط/حدود لايم أعمق قليلاً، نصوص كحلي `#152331`، الإجراء الأساسي أخضر `#038947`، التمييز برتقالي `#F16B3B`. يجب أن يُقرأ **GE بوضوح** من أول نظرة — لا حياداً عاماً.

## 4. المصادر (قراءة فقط)

- `tasks/TASK-PROTO-H01/THEME_TOKENS.md` (§2 أسماء الـ27 — الأسماء ملزمة، لا تغيير)
- `tasks/TASK-PROTO-H01/THEME_02_ABYSS.md` (نموذج «تدرّج من عائلة واحدة» — مرجع أسلوبي)
- `src/styles/tokens.css` + `src/styles/themes.css` (بنية الكتل الحالية)
- `Idea files/Asset 2@4x (1).png` (اللوحة الملزمة)

## 5. Allowed Write Targets (حصري)

```text
D:\Teranoo Work\Client01\prototype-app\project-control\tasks\TASK-PROTO-H05a\THEME_03_LIME.md   (جديد)
D:\Teranoo Work\Client01\prototype-app\src\styles\themes.css                                  (استبدال كتلة stone بكتلة lime فقط)
```

## 6. ممنوعات

- أي ملف آخر (لا ThemeContext — تحديث الـtype مهمة H05b · لا tokens.css · لا شاشات).
- تغيير أسماء التوكنز أو عددها (27 + radius + shadow) · تغيير ثيمَي ge/abyss.
- إضافة مكتبات/أسرار · أي كلاس `dark:`.

## 7. معايير القبول

| # | المعيار | الدليل |
|---|---|---|
| 1 | كل توكنات الهوية (20) مشتقة من الأربعة بأثر مكتوب لكل قيمة | STATIC (Tera: فحص الجدول) |
| 2 | صفر عائلة دخيلة كهوية · الدلالات (8) وحدها خارجها | STATIC (Tera) |
| 3 | الكتلة في `themes.css` = `[data-theme="lime"]` وتطابق المواصفة حرفياً | STATIC (Tera: مقارنة آلية) |
| 4 | `build` يمر بعد H05b + لقطات ×3 مختلفة بصرياً | LIVE (Tera) |

**Owner Approval Required: Yes** — الهوية البصرية للثيم يعتمدها المالك بعد المعاينة (الدخول + الهيكل).

### 7.1 محسوم — D-H01-09 (2026-11-15): الخيار B — AA متسق للثيمات الثلاثة

- **الحكم:** `--brand` = `#037D40` (ظلّ من GE الأخضر) · `--brand-ink` = `#F7FBEC` (تدرّج لايم) → **4.98:1** ✓
- ينطبق على `--sidebar-active` / `--sidebar-active-text` في نفس الثيم بنفس القيم حيث ينطبق.
- **يُطبَّق على الثيمات الثلاثة** لا على Lime وحده (معيار واحد لكل التطبيق). **ge** يُصحَّح في مهمة لاحقة `H05c` (لا في هذه المهمة).
- `abyss` يحقق AA أصلاً (`#052E1C` فوق `#46B275` ≈ 6:1) → لا تغيير عليه.
- المرجع: GAP-002 في `project-control/AGENT_GAPS_LOG.md` (الادعاء القديم 5.0:1 كان خطأً؛ الفعلي 4.49).
- **الأثر على معيار القبول #1:** استثناء موثق واحد مقبول — `--brand-ink` قيمة تباين وظيفية مشتقة من اللايم، لا عائلة دخيلة.

## 8. البوابات

Matrix: توكنز/هوية بصرية → `ui-designer` · SDA: `NOT_APPLICABLE` (تعريف تصميمي + كتلة CSS) · Security: `Low` · QA: `QA_REQUIRED` (تنفيذ Tera) · Auditor: `NOT_REQUIRED` (العداد 2) · Model: sufficient · Pre-Execution Gate: **PASS**.

## 9. بروتوكول التفويض

- [Engineering File Quality]: ترتيب/تنسيق مطابق لبقية الكتل · تعليقات WHY موجزة · لا تكرار.
- البحث الإلزامي: N/A (الاشتقاق من لوحة ملزمة — لا مراجع خارجية جديدة) — اذكر السبب.
- Vitality/Semgrep/Playwright: N/A (CSS بلا واجهة منفذة) — اذكر السبب.
- إن احتجت أداة خارج صلاحياتك: توقف واطلبها. الـhandback ≤80 سطراً بلا diffs. أي غموض = STOP.

## 10. Tera Post-Execution Review (2026-11-15 — فحص فعلي + تنفيذ مباشر)

| Check | Result | Notes |
|---|---|---|
| Allowed Write Targets | PASS | `git diff` = `themes.css` (كتلة stone فقط، تبدأ سطر 68) + ملف المواصفة — لا شيء غيرهما |
| ge/abyss untouched | PASS | الفرق يبدأ عند كتلة stone؛ الكتلتان مطابقتان |
| stone/C2571F removed | PASS | عدّ `stone|C2571F` في الملف = 0 · المفاتيح الآن ge/abyss/lime |
| Spec ≡ CSS | PASS | القيم المقروءة من المتصفح: surface `#f5f8e7` · brand `#037d40` · rail `#eff5d8` · text `rgb(21,35,49)` |
| `lint` + `tests` + `build` (Tera) | PASS | lint 0 · **227/227** (بعد تثبيت سجلات الحوكمة) · build 0 |
| Visual | PASS | الدخول بثيم Lime مقروء ومتّسق: أسطح لايم، إجراء أخضر `#037D40`، نص كحلي، تحذير برتقالي — لقطة محفوظة `h05-lime-login.png` |
| D-H01-08 compliance | PASS | 20 توكن هوية مشتقة من الأربعة · 8 دلالات وحدها خارجها · صفر عائلة دخيلة |
| D-H01-09 compliance | PASS | brand `#037D40` + brand-ink `#F7FBEC` = 4.98:1 |

Gate Status: **PASS** — Final Decision: **READY FOR OWNER ACCEPTANCE**
Owner Approval Required: **Yes** — Owner Approval Status: **Pending** (هوية بصرية)
ملاحظة تشغيلية: `lime` غير قابل للوصول من الجلسة حتى `H05b` (تحديث `TenantTheme`) — مبني ومُتحقَّق لكنه غير مربوط.

## 11. Compliance Record

| # | Check | Result | Verified By |
|---|---|---|---|
| 1 | Pre-Execution Gate PASS | PASS | Tera |
| 2 | Allowed Write Targets respected | PASS | Tera |
| 3 | No secrets | PASS | Tera |
| 4 | Design Source documented | PASS | D-H01-08 + اللوحة الملزمة |
| 5 | Post-Execution Review PASS | PASS | Tera |
| 6 | Activity log updated | PASS | Tera |
| 7 | Handback recorded (≤80) | PASS | Tera |
| 8 | Diff matches handback | PASS | Tera |
| 9 | CLI documented | Done | lint/tests/build/preview (Tera) |
| 10 | Owner Approval before CLOSED | PENDING | بانتظار قبولك للهوية |
| 11 | Cross-Record Consistency | PASS | Task / Activity / Audit |

Compliance Status: **PENDING_OWNER_APPROVAL**
