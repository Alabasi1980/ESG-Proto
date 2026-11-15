# TASK-PROTO-H07c — إرجاع قيمة الحقول المعتمدة من المالك

> **الحالة:** Assigned → ui-designer · **Session:** NEW
> **السبب:** H07b عدّل `--surface-2` إلى `#EBEED9` بينما المالك ثبّتها `#F7F8E3` (D-H06-02). الخطأ في عقد H07b (قيد تباين من عندي) — قيمة المالك تسود دائماً.

## 1. الهدف (واحد)

إرجاع `--surface-2` = **`#F7F8E3`** حرفياً في كتلة lime + تحديث مواصفة الثيم. لا شيء آخر يتغير (الخلفية `#EDF0DA` تبقى من H07b).

## 2. ملاحظة مقصودة (لا تُعالَج)

الحقول ستكون أفتح من الخلفية بـ~3 درجات L — هذا مقصود لأنه قيمة المالك. قيد «≤1 L» في H07b **ملغى**.

## 3. Allowed Write Targets (حصري)

- `D:\Teranoo Work\Client01\prototype-app\src\styles\themes.css` (سطر `--surface-2` في كتلة lime فقط)
- `D:\Teranoo Work\Client01\prototype-app\project-control\tasks\TASK-PROTO-H05a\THEME_03_LIME.md` (v4.1)

## 4. ممنوعات

أي ملف آخر · أي توكن غير `--surface-2` · كتلتا ge/abyss · تغيير `#038947`/`#152331`/`#E4EDB8`/`#EDF0DA` · عدد/أسماء التوكنز.

## 5. معايير القبول

| # | المعيار | الدليل |
|---|---|---|
| 1 | `#F7F8E3` مرة واحدة في كتلة lime · `#EBEED9` = 0 | STATIC (Tera) |
| 2 | باقي القيم بلا تغيير · build يمر | LIVE (Tera) |

**Owner Approval Required: No** (تصحيح مطابقة لقرار مالك قائم).

## 6. البوابات
توكنز → ui-designer · SDA N/A · Security Low · QA_REQUIRED (Tera) · Auditor NOT_REQUIRED · Pre-Execution Gate: **PASS**.
