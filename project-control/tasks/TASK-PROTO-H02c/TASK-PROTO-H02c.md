# TASK-PROTO-H02c — توسيع allowed-set حارس النطاق (D-H01-06)

> **المسار:** `TASK-PROTO-H*` — تفويض (أ) من المالك
> **الحالة:** Assigned → مفوَّضة إلى engineering-agent-typescript
> **ClientAppPath (مرحلي):** `D:\Teranoo Work\Client01\prototype-app`
> **Session:** NEW — عميل ونطاق جديدان
> **السياق:** حارس `b17TransactionInventory.test.ts` (النافذة المجمدة) يرفض كتابة H02a/H02b المصرّح بها مالكياً (`Unapproved write: src/App.tsx`). التوسيع مصرّح به صراحة (D-H01-06) — والتنفيذ عبر المتخصص حصراً (حدّ Tera الصلب).

## 1. الهدف (واحد فقط)

إضافة مسارات الثيمات الثمانية إلى مجموعة `allowed` في الاختبار + تحديث `assert.equal(allowed.size,16)` إلى `24` — مع تعليق D-H01-06. **بلا أي تغيير آخر في المنطق.**

## 2. المصادر (قراءة فقط)

- `src/lib/b17TransactionInventory.test.ts` (اقرأه أولاً — التعديل جراحي في مقطعين فقط)
- `tasks/TASK-PROTO-H02a/TASK-PROTO-H02a.md` + `tasks/TASK-PROTO-H02b/TASK-PROTO-H02b.md` (إثبات المسارات الثمانية)

## 3. Allowed Write Targets (حصري)

```text
D:\Teranoo Work\Client01\prototype-app\src\lib\b17TransactionInventory.test.ts
```

## 4. التعديل المطلوب حرفياً

1. في تعريف `allowed`: أضف بعد `'src/db/b17Readiness.ts',` سطر تعليق + سطرين بالقيم الثمانية:
   `src/App.tsx`, `src/components/Header.tsx`, `src/components/Sidebar.tsx`, `src/index.css`, `src/main.tsx`, `src/context/ThemeContext.tsx`, `src/styles/tokens.css`, `src/styles/themes.css`
   مع التعليق: `// D-H01-06 (2026-11-15, owner-authorized): theme-center track H02a/H02b — 8 paths only.`
2. غيّر `assert.equal(allowed.size,16);` إلى `assert.equal(allowed.size,24); // 16 (G2 base) + 8 (D-H01-06 theme track)`

## 5. ممنوعات

- أي ملف آخر · أي تغيير في منطق الحارس (asserts أخرى، الـinventory، الـmasking) · إضعاف أي فحص · أسرار.

## 6. معايير القبول (نوع الدليل)

| # | المعيار | الدليل |
|---|---|---|
| 1 | المجموعة الكاملة 227/227 خضراء (أشغّلها بنفسي) | LIVE (تنفيذ Tera) |
| 2 | `git diff` = هذا الملف فقط، والمقطعان فقط | LIVE (فحص Tera) |

**Owner Approval Required: No** (التوسيع نفسه مصرّح به D-H01-06 — القبول بقرار Tera بعد البوابات).

## 7. البوابات

- **Matrix:** تعديل TypeScript (اختبار) → المتخصص.
- **SDA:** `NOT_APPLICABLE` — تغيير بيانات اختبار، بلا أثر معماري.
- **Security:** `Low` — ملف اختبار، بلا كود إنتاجي.
- **QA:** `QA_REQUIRED` — أشغّل المجموعة كاملة بنفسي.
- **Auditor:** `NOT_REQUIRED`. (العداد: NOT_REQUIRED مكتملة = 2.)
- **Model Gate:** `Current model sufficient`.
- **Pre-Execution Gate: PASS**.

## 8. بروتوكول التفويض

- [Engineering File Quality]: تعديل جراحي — لا إعادة تنسيق، لا تغيير خارج المقطعين.
- اقرأ الملف من القرص أولاً.
- إن احتجت أداة خارج صلاحياتك: **توقف واطلبها مني**.
- الـhandback **≤80 سطراً — بلا full diffs**. أي غموض = STOP + سؤال.

## 9. Tera Post-Execution Review (2026-11-15)

| Check | Result | Notes |
|---|---|---|
| Allowed Write Targets | PASS | `git diff` = ملف الاختبار فقط، مقطعان فقط (تحقق Tera قبل الالتزام) |
| Suite 227/227 (تنفيذ Tera) | PASS | بعد التوسيع: البقية كانت سجلات الحوكمة غير المتتبعةة → حُفظت كنقطة تفتيش محلية `f38af55` (بلا دفع) → المجموعة خضراء كاملة |
| Guard logic intact | PASS | الـinventory والـmasking وبقية الـasserts بلا مساس — التوسيع 8 مسارات دقيقةية فقط |
| File Quality | PASS | تعليق D-H01-06 · بلا إعادة تنسيق |

Gate Status: **PASS** — Final Decision: **Accepted → Closed** (Owner Approval Required: No)

## 10. Compliance Record

| # | Check | Result | Verified By |
|---|---|---|---|
| 1 | Pre-Execution Gate PASS documented | PASS | Tera |
| 2 | Allowed Write Targets respected | PASS | Tera |
| 3 | No secrets | PASS | Tera |
| 4 | Design Source documented | PASS | D-H01-06 |
| 5 | Post-Execution Review PASS | PASS | Tera |
| 6 | Activity log updated | PASS | Tera |
| 7 | Handback recorded (≤80) | PASS | Tera |
| 8 | Diff matches handback | PASS | Tera |
| 9 | CLI documented | Done | tests (Tera) |
| 10 | Owner Approval | N/A | التوسيع مصرّح به سلفاً |
| 11 | Cross-Record Consistency | PASS | Task / Activity / Audit |

Compliance Status: **COMPLIANT**

- [Engineering File Quality]: تعديل جراحي — لا إعادة تنسيق، لا تغيير خارج المقطعين.
- اقرأ الملف من القرص أولاً.
- إن احتجت أداة خارج صلاحياتك: **توقف واطلبها مني**.
- الـhandback **≤80 سطراً — بلا full diffs**. أي غموض = STOP + سؤال.
