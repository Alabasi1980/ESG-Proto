# TASK-PROTO-H10a — ترحيل لوحات المتابعة (عامل 1) + توسيع الحارس

> **الحالة:** Assigned → engineering-agent-typescript
> **Session:** NEW · **جزء من دفعة متوازية**: H10a وH10b — **لا تلمس ملفات H10b**
> **المرجع الملزم:** `project-control/STYLE_CONTRACT.md` (اقرأه أولاً — هو الحاكم)

## 1. الهدف (واحد)
ترحيل ألوان `DashboardView.tsx` و`ClientDashboardView.tsx` إلى التوكنز + توسيع حارس النطاق للمسارات الأربعة للدفعة (أنت الكاتب الوحيد للحارس).

## 2. Allowed Write Targets (حصري)
```text
src\views\DashboardView.tsx
src\views\ClientDashboardView.tsx
src\lib\b17TransactionInventory.test.ts   ← توسيع +4 مسارات مسمّاة + assert.size 26→30 + تعليق D-H01-07
```

## 3. القواعد (من العقد — بلا اجتهاد)
- الأدوار: صفحة `bg-surface` · بطاقة `bg-surface-2` · حقل/صف غائر `bg-surface-3`.
- ممنوع بعد الترحيل: `bg-white` · `text-black` · أي `slate|gray|zinc|neutral|stone` · أي `dark:` · أي `#hex` داخل className.
- **ممنوع تغيير المنطق**: لا hooks، لا state، لا handlers، لا نصوص، لا ترتيب JSX، لا props. **ترحيل لوني فقط.**
- أي لون/نمط لا تجد له تطابقاً واضحاً في العقد → STOP واسأل. لا تخترع.
- إن وُجد نمط تصميمي رديء (تباين ضعيف/سطح أبيض في الداكن) — أصلحه ضمن الألوان المسموحة واذكره في الـhandback.

## 4. معايير القبول (Tera)
| # | المعيار | الدليل |
|---|---|---|
| 1 | صفر مطابقة للممنوعات في الملفين | STATIC (Tera) |
| 2 | عدد الأسطر ±0 وعدم لمس منطق | STATIC (diff) |
| 3 | lint + 227 tests + build | LIVE (Tera) |
| 4 | لقطات الشاشتين × 3 ثيمات | VISUAL (Tera) |

## 5. البوابات
FAST_PATH · Security Low · QA_REQUIRED (Tera) · Auditor NOT_REQUIRED · Pre-Execution Gate: **PASS**.

## 6. التفويض
اقرأ الملفين + العقد قبل أي تعديل · جراحي · Handback ≤80 سطراً بلا diffs · أداة خارج صلاحياتك: توقف واطلبها · لا تشغّل lint/tests/build (على Tera).
