# TASK-PROTO-H10b — ترحيل نظرة GE وملف ESG (عامل 2)

> **الحالة:** Assigned → engineering-agent-typescript
> **Session:** NEW · **جزء من دفعة متوازية**: H10a وH10b — **لا تلمس** `DashboardView` أو `ClientDashboardView` أو ملف الحارس
> **المرجع الملزم:** `project-control/STYLE_CONTRACT.md` (اقرأه أولاً — هو الحاكم)

## 1. الهدف (واحد)
ترحيل ألوان `GeOverviewView.tsx` و`EsgProfileView.tsx` إلى التوكنز. **لا تعديل على الحارس** (H10a يملكه).

## 2. Allowed Write Targets (حصري)
```text
src\views\GeOverviewView.tsx
src\views\EsgProfileView.tsx
```

## 3. القواعد (من العقد — بلا اجتهاد)
- الأدوار: صفحة `bg-surface` · بطاقة `bg-surface-2` · حقل/صف غائر `bg-surface-3`.
- ممنوع بعد الترحيل: `bg-white` · `text-black` · `slate|gray|zinc|neutral|stone` · `dark:` · `#hex` في className.
- **ممنوع تغيير المنطق**: لا hooks/state/handlers/نصوص/ترتيب JSX/props — ترحيل لوني فقط.
- أي نمط بلا تطابق واضح في العقد → STOP واسأل.
- لاحظ: `EsgProfileView` يعرض تقييمات 0/100 — ألوان النجاح/الخطر تبقى دلالية (`success`/`danger`) لا هوية.

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
