# TASK-PROTO-H09a — إحلال الثيم الداكن المعتمد محل كتلة abyss القديمة

> **الحالة:** Assigned → ui-designer
> **Session:** NEW · **يعتمد على:** D-H08-03 (اعتماد الثيم الداكن) + DARK_THEME_RULES.md (المواصفة)
> **السياق:** `themes.css` يحوي كتلة `[data-theme="abyss"]` قديمة من H01 تجاوزتها المواصفة المعتمدة. هذه المهمة تستبدلها كلياً — بلا مساس بـge/lime.

## 1. الهدف (واحد)

استبدال كتلة `[data-theme="abyss"]` بكتلة `[data-theme="dark"]` تحمل القيم الـ27 حرفياً من `DARK_THEME_RULES.md` §2 (بما فيها `--sidebar-*` و`--focus-ring`) + تعليق WHY يوثق المصدر (المواصفة المعتمدة D-H08-03).

**توضيح ملزم (بعد STOP الجولة 1): كتلة `dark` = 27 سطراً فقط، بلا سطر `--shadow`** — الظل المحايد من `tokens.css` يُورَّث كما في `abyss` الأصلية. أي ذكر للظل الأخضر في نص التفويض الشفهي لاغٍ أمام هذا النص.

## 2. المصادر (قراءة فقط)

- `project-control/prototypes/TASK-PROTO-H08a/DARK_THEME_RULES.md` §2 (القيم ملزمة حرفياً)
- `src/styles/themes.css` (البنية الحالية — ge/lime للمرجع فقط، لا تُلمس)

## 3. Allowed Write Targets (حصري)

```text
D:\Teranoo Work\Client01\prototype-app\src\styles\themes.css   (استبدال كتلة abyss بكتلة dark فقط)
```

## 4. ممنوعات

- أي ملف آخر (لا ThemeContext — مهمة H09b · لا tokens.css · لا شاشات) · تغيير ge/lime حرفاً واحداً · تغيير أسماء/عدد التوكنز · القيم خارج المواصفة · `#C2571F` · مكتبات/أسرار/`dark:`.

## 5. ملاحظة صريحة (سجّلها في الـhandback)

- `--brand: #026F39` + `--brand-ink: #F1F6D6` = **5.664:1** (موثق في المواصفة §قياس) — هذا هو الخيار B المعتمد من المالك، لا `#038947`.
- `--sidebar-active-text` = `#F1F6D6` على `#026F39`.

## 6. معايير القبول

| # | المعيار | الدليل |
|---|---|---|
| 1 | 27 قيمةة مطابقة حرفياً للمواصفة | STATIC (Tera: مقارنة آلية) |
| 2 | لا `abyss` ولا `stone` في الملف · ge/lime بايت-مطابق | STATIC (Tera) |
| 3 | `build` يمر | LIVE (Tera) |

**Owner Approval Required: No** (تنفيذ مواصفة معتمدة D-H08-03).

## 7. البوابات

Matrix: توكنز → ui-designer · SDA: `NOT_APPLICABLE` · Security: `Low` · QA: `QA_REQUIRED` (Tera) · Auditor: `NOT_REQUIRED` (العداد 2) · Model: sufficient · Pre-Execution Gate: **PASS**.

## 8. التفويض

- [Engineering File Quality]: نفس ترتيب/تنسيق الكتل · تعليق WHY · بلا تكرار.
- N/A: بحث/Vitality/Semgrep/Playwright (كتلة CSS — اذكر السبب).
- أداة خارج صلاحياتك: توقف واطلبها. Handback ≤80 سطراً بلا diffs. أي غموض = STOP.

## 9. Tera Post-Execution Review (2026-11-15)

| Check | Result | Notes |
|---|---|---|
| Allowed Write Targets | PASS | themes.css فقط (كتلة dark بدل abyss) |
| Values verbatim | PASS | 27/27 مطابقة للمواصفة (فحص Tera للكتلة) |
| No abyss/stone selectors | PASS | العدّ = 0 (كلمتا تاريخ في تعليقين فقط) |
| ge/lime untouched | PASS | بلا تغيير |
| lint / build | PASS | 0 / 0 |

Gate Status: **PASS** — Final Decision: **Accepted → Closed** (Owner Approval Required: No).
Compliance: **COMPLIANT**.
