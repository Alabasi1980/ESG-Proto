# P3 — ترحيل الإجراءات والإشعارات والتقارير وسجل التدقيق + إصلاح TENANT

> **المرجع الملزم:** `project-control/STYLE_CONTRACT.md` — بما فيه: **لا ستايل محلي** · **قاعدة التركيب** · أسبقية الدور.

## الحالة (جرد آلي)
```text
ActionsView      lit=170 dark=87  wb=9
NotificationsView lit=32 dark=11  wb=3
ReportsView      lit=257 dark=138 wb=21
AuditLogView     lit=49  dark=24  wb=7
Sidebar          نظيف — لكن علامة TENANT تباينها 4.23 (عالمية)
```
لا تضمينات بين هذه الملفات (تحقّق قبل البدء — إن وجدت مُضمَّناً خاماً أبلغني).

## المهام
| المهمة | الملفات |
|---|---|
| **P3a** | `ActionsView.tsx` + `NotificationsView.tsx` + `Sidebar.tsx` (علامة TENANT فقط) |
| **P3b** | `ReportsView.tsx` + `AuditLogView.tsx` + **الحارس** |

## القواعد
- أدوار: صفحة `bg-surface` · بطاقة `bg-surface-2` · غائر/حقل `bg-surface-3` · `border-border`/`border-border-strong` · `text-text`/`text-muted`.
- دلالات كنص: `text-success-text` · `text-warning-text` · `text-danger` · `text-info` · هوية كنص/أيقونة: `text-brand-text`.
- **التقارير**: الطباعة/PDF خارج الثيم — لا تلمس كتلة `renderPrint` أو أنماط الطباعة.
- حذف كل `dark:*` · صفر `bg-white|slate|gray|zinc|neutral|stone|#hex` · صفر عائلات خارج التوكنز.
- **ممنوع** `style={{color|background|border|fill|stroke}}` أو CSS محلّي؛ الأبعاد الديناميكية مسموحة.
- **ممنوع** تغيير منطق/نصوص/JSX/ترتيب · عدد الأسطر ±0 · غموض → STOP.

## إصلاح TENANT (P3a)
في `Sidebar.tsx`: علامة `TENANT` (uppercase) تُبدَّل من لونها الحالي إلى `text-text` أو `text-sidebar-text` بحيث يتجاوز 4.5:1 في الثلاثة. لا تلمس بقية الشريط.

## الحارس (P3b — كاتب واحد)
أضف الناقص فعلياً من: `ActionsView.tsx`, `NotificationsView.tsx`, `ReportsView.tsx`, `AuditLogView.tsx` · اضبط `assert.equal(allowed.size, العدد الحقيقي)` · تعليق `+ P3`.

## القبول (Tera)
صفر مخالفات · ±0 · lint+227+build · تدقيق تباين ×3 ثيمات على الشاشات الأربع · صفر أسطح بيضاء · TENANT ≥ 4.5.
