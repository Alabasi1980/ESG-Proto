# TASK_REGISTRY.md — prototype-app

| ID | الموضوع | الحالة | النتيجة |
|---|---|---|---|
| TASK-PROTO-H01 | تعريف 3 ثيمات + مخطط توكنز | Closed | معتمد D-H01-05 |
| TASK-PROTO-H02a | ملفا التوكنز + الاستيراد | Closed | COMPLIANT |
| TASK-PROTO-H02b | المزوّد + ترحيل الهيكل | Closed | COMPLIANT |
| TASK-PROTO-H02c | توسيع حارس النطاق | Closed | COMPLIANT |
| TASK-PROTO-H03 | ترحيل الدخول + شريط الديمو | Closed | COMPLIANT |
| TASK-PROTO-H05a | Lime (بديل Stone) | Closed | معتمد D-H01-08 |
| TASK-PROTO-H06a/b | صقل Lime + مواصفة كلاسات | Closed | معتمد |
| TASK-PROTO-H07 / H07b / H07c / H07d | قيم المالك + تخفيف الخلفية + إرجاع الحقول | Closed | معتمد D-H07-03 |
| TASK-PROTO-H08a | معاينة الثيم الداكن (HTML مستقل) | Closed | معتمد D-H08-03 · DesignReviewer PASS |
| TASK-PROTO-H09a / H09b | كتلة dark + ربط المفتاح و`?theme=` | Closed | COMPLIANT |
| TASK-PROTO-H10-0 | توحيد أدوار التوكنز | Closed | COMPLIANT |
| H10a / H10b | 4 شاشات (Dashboard · ClientDashboard · GeOverview · EsgProfile) | Closed | COMPLIANT |
| H10-2a / H10-2b | Settings + StaffLists + توكن `--brand-text` | Closed | COMPLIANT |
| H10-3a / H10-3b | ServicesManage + `--success-text`/`--warning-text` + Header | Closed | COMPLIANT |
| H11a / H11b | GapAnalysis · Standards · Initiatives | Closed | COMPLIANT |
| P1a / P1b / P2 | EvaluationPanel · ClientReview · GeFinal · Taxonomy | Closed | COMPLIANT |
| P3a / P3b | Actions · Notifications · Reports · AuditLog + TENANT | Closed | COMPLIANT |
| P4 / P5 | ClientDetail · Setup · ImportGRI + بانر المستأجر | Closed | COMPLIANT |
| P6a / P6b | إصلاح الشريط + توكن `--accent-text` | Closed | COMPLIANT |
| FINAL-1 / FINAL-2 | ISS-003 + صقل الشريط الجانبي | Closed | COMPLIANT |
| — | انتقال لقطة الثيم كلها | Accepted (D-STYLE-01) | 22 ملفاً نظيفاً |

## مفتوح (ليس ستايلاً)
ISS-004 (منطق/صلاحيات) · ISS-006 (بيانات/جلسة) · ISS-010 (استثناء معتمد) — انظر `ISSUES_AND_GAPS.md`.

## TASK-PROTO-H12 (D-H01-01) — الثيم من الخادم
- Closed (Accepted محلي) · COMPLIANT · 2026-11-16 · round 2/2 · 234/234 · لا نشر

## TASK-PROTO-H13 — ثيم التطبيق الموحّد (منصة)
- Closed (Accepted محلي) · COMPLIANT · 2026-11-16 · round 2/2 · 245/245 · لا نشر

## TASK-PROTO-U3-A — طبقة مساحة العمل في الواجهة
- Closed (Accepted محلي) · COMPLIANT · 2026-11-16 · round 2/2 · 271/271 · لا نشر

## TASK-PROTO-U3-B1 — هيكل السياقات (تنقل/هوية/حُرّاس)
- Closed (Accepted محلي) · COMPLIANT · 2026-11-16 · 282/282 · لا نشر

## TASK-PROTO-U3-B2 — صفحة العملاء + دورة مساحة العميل
- Closed (Accepted محلي) · COMPLIANT · 2026-11-16 · 3 rounds · 316/316 · لا نشر

## TASK-PROTO-U4-1a — نموذج الخدمة الموسّع (OD-11)
- Closed (Accepted محلي) · COMPLIANT · 2026-11-16 · round 2/2 · 334/334 · 3 أعمدة + مسار W + قناع C · لا نشر

## TASK-PROTO-U4-1b — الاجابة بنوعها + المرفق المستقل
- Closed (Accepted محلي) · COMPLIANT · 2026-11-16 · 3 rounds · 353/353 · لا نشر

## TASK-PROTO-U4-1c (+PROTECT) — حماية الربط/الأرشفة
- Parent: ESCALATED / NOT ACCEPTED (R3-03 bucket collision + R3-04 rebinding مفتوحتان) · PROTECT: وحدة مقبولة محلياً فقط (unit/local — QA3/SEC3/Auditor-FINAL) · لا إجراء حيّ خارج ترحيل PROTECT المطبق 2026-11-17 · لا نشر

## TASK-PROTO-U4-2 — شاشة الخدمات (P)
## TASK-PROTO-U4-2-FIX — تصحيح شاشة الخدمات (OD-13)
- Status: **Draft execution contract** — spec APPROVED_FOR_GATE · Pre-Execution Gate PASS · defaults approved 2026-11-17 · **pending Build Mode («ابدأ»)** · phases P1(DB) → P2(catalog API) → P3(import) → P4(history/copy) → P5(screen) · no live DB mutation without backup + separate approval · لا نشر
