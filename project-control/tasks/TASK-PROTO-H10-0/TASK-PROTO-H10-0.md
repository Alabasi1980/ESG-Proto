# TASK-PROTO-H10-0 — توحيد أدوار التوكنز (prerequisite for all migration)

> **الحالة:** Assigned → engineering-agent-typescript (mechanical, documented)
> **Session:** NEW · **السبب:** خلل معماري: البطاقة = `surface-3` في Lime لكن `surface-2` في dark/ge. الترحيل فوقه يبثّ التعارض.
> **القيم لا تتغير — الأسماء تتبادل فقط.** ألوان المالك محفوظة حرفياً.

## 1. الهدف (واحد)

توحيد الأدوار: `surface` = صفحة · `surface-2` = بطاقة · `surface-3` = حقل/صف غائر — في الثلاثة.

## 2. التعديلات المطلوبة حرفياً

### (أ) `src/styles/themes.css` — كتلة `[data-theme="lime"]` فقط
```text
--surface-2: #F7F8E3;   →   --surface-2: #E4EDB8;   /* البطاقة (قيمة المالك نفسها، دورها صار بطاقة) */
--surface-3: #E4EDB8;   →   --surface-3: #F7F8E3;   /* الحقل (قيمة المالك نفسها، دورها صار حقلاً) */
```
- لا تمسّ أي توكن آخر، ولا كتلتَي `ge`/`dark`.
- أضف تعليق WHY: «H10-0: role normalization — card=surface-2, inset=surface-3; owner colours unchanged».

### (ب) `src/views/LoginView.tsx` — تبديل دورين فقط
```text
bg-surface-3  (بطاقة الدخول، السطر ~107)      →  bg-surface-2
bg-surface-2  (الحقلان: بريد + كلمة مرور)     →  bg-surface-3
bg-surface-2  (صندوق تنبيه DB الداخلي ~110)   →  bg-surface-3   (غائر داخل البطاقة)
```
- إن وُجد `bg-surface-2` آخر في الملف بمعنى بطاقة/سطح مرتفع، اتركه واذكره في الـhandback.
- بلا أي تغيير آخر (لا منطق، لا نصوص، لا ترتيب).

## 3. Allowed Write Targets (حصري)

```text
D:\Teranoo Work\Client01\prototype-app\src\styles\themes.css   (كتلة lime فقط)
D:\Teranoo Work\Client01\prototype-app\src\views\LoginView.tsx (كلاسات الأدوار فقط)
```

## 4. ممنوعات
أي ملف آخر · كتلتا ge/dark · أسماء/عدد التوكنز · منطق/نصوص/JSX · مكتبات · أسرار · `dark:`.

## 5. معايير القبول (Tera)
| # | المعيار | الدليل |
|---|---|---|
| 1 | lime: `surface-2=#E4EDB8` · `surface-3=#F7F8E3` · بقية القيم كما هي | STATIC |
| 2 | LoginView: البطاقة `bg-surface-2` · الحقول `bg-surface-3` | STATIC |
| 3 | lint + tests 227 + build | LIVE |
| 4 | الدخول بثيم lime: البطاقة `rgb(228,237,184)` والحقول `rgb(247,248,227)` (ألوان بلا تغيير) | LIVE |

**Owner Approval Required: No** (تصحيح أدوار؛ الألوان المعتمدة محفوظة).

## 6. البوابات
TS/CSS → المتخصص · SDA `FAST_PATH` · Security `Low` · QA_REQUIRED (Tera) · Auditor NOT_REQUIRED · Pre-Execution Gate: **PASS**.

## 7. التفويض
جراحي · اقرأ الملفين أولاً · Handback ≤60 سطراً بلا diffs · أداة خارج صلاحياتك: توقف واطلبها.
