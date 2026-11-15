# TASK-PROTO-H07 — Lime v3: الدرجات المعتمدة نصّاً من المالك

> **الحالة:** Assigned → ui-designer
> **Session:** NEW
> **يسود على:** D-H01-09 (كان يقترح `#037D40` للوصول AA) — المالك حسم `#038947` حرفياً (D-H06-02)

## 1. الهدف (واحد)

تحديث كتلة `[data-theme="lime"]` ومواصفتها إلى القيم التي أعطاها المالك حرفياً — بلا أي تغيير في المكوّنات.

## 2. القيم الملزمة (نصّاً)

| العنصر | القيمة |
|---|---|
| الخلفية (`--surface`) | `#F1F6D6` |
| بطاقة الدخول (`--surface-3`) | `#E4EDB8` |
| الحقول (`--surface-2`) | `#F7F8E3` |
| الزر والشعار (`--brand`) | `#038947` |
| النصوص والعناوين (`--text`) | `#152331` |
| التنبيه العلوي | برتقالي (`--accent`/`--accent-soft`) — يبقى |

## 3. ما يُشتق (بنفس اللوحة فقط)

- `--brand-strong` = ظلّ من `#038947` (hover)
- `--brand-ink` = `#FFFFFF` (**تنبيه:** تباين 4.49 — هامشي؛ D-H06-02 يقبله موثقاً)
- `--border` / `--border-strong` = مشتقات لايم/أخضر (الحدود لا رمادية ولا سوداء)
- `--sidebar-*` = عائلة اللايم نفسها (شريط أعمق من الخلفية بقليل) + `--sidebar-active` = `#038947` + نصه أبيض
- `--muted` / `--sidebar-muted` = كحلي مخفّف (لا رمادي محايد)
- `--shadow` = يبقى مخضرّاً
- الدلالات الثمانية تبقى كما هي (success = `#038947`)

## 4. Allowed Write Targets (حصري)

```text
D:\Teranoo Work\Client01\prototype-app\project-control\tasks\TASK-PROTO-H05a\THEME_03_LIME.md
D:\Teranoo Work\Client01\prototype-app\src\styles\themes.css          (كتلة lime + --shadow فقط)
```

## 5. ممنوعات

- أي ملف `src` آخر · مساس بكتلتي ge/abyss · تغيير أسماء/عدد التوكنز · رمادي محايد (S=0) · `#C2571F` · مكتبات/أسرار/`dark:`.

## 6. معايير القبول

| # | المعيار | الدليل |
|---|---|---|
| 1 | الخمسة المعطاة مطابقة حرفياً | STATIC + قياس حي (Tera) |
| 2 | 20 توكن هوية من اللوحة · الدلالات وحدها خارجها | STATIC (Tera) |
| 3 | ge/abyss بلا مساس · `build` يمر | LIVE (Tera) |
| 4 | لقطة Lime تُظهر أسطحاً ليمونية واضحة ومختلفة عن ge | VISUAL (Tera) |

**Owner Approval Required: Yes** (بصري).

## 7. البوابات

Matrix: توكنز → `ui-designer` · SDA: `NOT_APPLICABLE` · Security: `Low` · QA: `QA_REQUIRED` (Tera) · Auditor: `NOT_REQUIRED` · Model: sufficient · Pre-Execution Gate: **PASS**.

## 8. بروتوكول التفويض

- تنسيق مطابق للكتل المجاورة · تعليقات WHY · بلا تكرار · N/A للبحث/Vitality/Semgrep/Playwright (توكنز فقط — اذكر السبب).
- أداة خارج صلاحياتك: توقف واطلبها. Handback ≤80 سطراً بلا diffs. أي غموض = STOP.
