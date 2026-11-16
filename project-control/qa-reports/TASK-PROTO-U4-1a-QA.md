# QA Report — TASK-PROTO-U4-1a

| البند | القيمة |
|---|---|
| المهمة | TASK-PROTO-U4-1a — service model extension: `items.attachment_required`, `services.settings`, `client_services.client_field_mask` (DB + config APIs + C redaction) |
| الوكيل | QA Agent — Execution Mode (جلسة جديدة، مستقلة) |
| الأساس | `0edf250a45a5b883587413cf248ee8f6a0021f8c` (`main`) |
| البيئة | Windows 11 · Node 22.22.2 · TypeScript 7.0.2 · vite 8 · PowerShell 5.1 |
| قاعدة البيانات | **سكراتش خاص فقط**: `postgres:18-alpine` = PostgreSQL 18.6 على `127.0.0.1:55441`، حاوية `u41a-qa-pg`، قواعد `basedb/basedb2/basedb3/appdb/appdb2/falsidb`، دور `app` (NOSUPERUSER/NOBYPASSRLS). **قاعدة Tera الحيّة لم تُلمس** (.env / DATABASE_URL لم يُقرأ ولم يُستخدم) |
| المصادر | عقد المهمة، OD-07/OD-11، `B17_TECHNICAL_SPEC.md` §7.1 — أي تصريح من المنفذ اعتُبر Context فقط |
| القيود المحترمة | كتابة واحدة: هذا التقرير. كل الأدلة الأخرى في `%TEMP%\opencode\u41a-qa-*`. لا تعديل مصدر/إعداد/تحكم، لا تثبيتات، لا commits، لا subagents |

## 1. الحكم — FAIL

- المعايير 1، 2، 3، 5، 6: **PASS** بأدلة منفّذة (scratch DB + تشغيل).
- المعيار 4 (C redaction): **FAIL** — «الحقول المقنّعة غائبة من الـ payload» غير متحقق في `GET /items/:id/links`: `weight` يصل للعميل كـ `null` (المفتاح موجود)، و`attachment_required` **لا يُعاد أصلاً** في هذا الإسقاط رغم اختياره في SQL.
- **لا يوجد أي تسريب لقيمة مقنّعة** عبر أي endpoint (لم تُرصد قيمة `hint/priority/weight/esg_class/reference/topic/objective` للعميل عند قنعها). العيبان في دالة إسقاط واحدة (`taxonomy.ts` روابط البنود) وإصلاحهما ~3 أسطر.

## 2. النطاق — مكتشف ذاتياً (Independent Evidence)

`git status --porcelain` = لتغيير 13 ملفاً معروفاً + 8 مسارات غير متعقبة (5 ملفات مصدر/اختبار جديدة، سكربت scratch، مجلد العقد، وتقرير Shield). `git diff --stat 0edf250` = **13 ملفاً، +255 سطراً / -36**.

- داخل §3 Targets: `schema.sql` · `b17Readiness.ts` · `taxonomy.ts` · `adminClients.ts` · `routes/serviceVisibility.ts` (جديد) · `routes.ts` · `accessRegistry.ts` · `scope.ts` · `src/lib/*.test.ts` · `scripts/u41-mask-scratch.ts`.
- نقاط تطبيق التقنيع (`evaluations.ts`, `reports.ts`) مسموحة عبر بند §3: «other routes beyond the masking application points you enumerate».
- خارج تعداد §3 لكنه مطلوب للمعيار 5: `src/db/b17-content.sql` (سياسة واحدة) — انظر QAF-04.

## 3. أدلة منفّذة (Executed)

| # | الأمر/الفحص | النتيجة |
|---|---|---|
| 1 | `npm run lint` (`tsc --noEmit`) | **PASS** — exit 0، 0 أخطاء |
| 2 | `npm test` (`tsx --test src/**/*.test.ts`) | **PASS** — **333 tests / 333 pass / 0 fail** (exit 0) — مقاساً **قبل** كتابة هذا التقرير. بعده: 332/333 وفشل واحد فقط هو حارس النطاق الذي يشير إلى ملف هذا التقرير (QAF-08) |
| 3 | `npm run build` (vite) | **PASS** — exit 0؛ تحذير واحد chunk>500 kB (غير مانع) |
| 4 | قياس البصمات على scratch (9 قياسات، §4) | **PASS** — الثوابت الثلاثة القديمة والجديدة كلها مطابقة |
| 5 | قابلية التكذيب: إسقاط الأعمدة ثم إعادتها | **PASS** — `d093f472… → 62e7586e… → d093f472…` و`6f67b44d… → 811b4674… → 6f67b44d…` |
| 6 | سلوك القيم الافتراضية (INSERT ثم ROLLBACK، superuser) | **PASS** — `false` / `'{}'::jsonb` / SQL NULL |
| 7 | فرق الكتالوج بين حالة HEAD وحالة U4-1a | **PASS** — +3 أعمدة، +2 قيد NOT NULL (كتالوج PG18)، +1 سياسة؛ الجداول/الدوال/الفهارس/المشغلات **متطابقة** |
| 8 | بروبات RLS على السياسة الجديدة (دور `app` + FORCE RLS) | **PASS** — W مالك-المستأجر فقط، و0 صفوف لكل من: مستأجر أجنبي، C، E، platform، consultant+role غير ge_admin، purpose≠work |
| 9 | تنفيذ فعلي لـ `maskedItemFields`/`serviceFieldMask` على بيانات حقيقية | **PASS** — اتحاد fail-closed عبر خدمتين، وعزل لكل مستأجر |
| 10 | تنفيذ فعلي للمدققات (8KB, whitelist, body) | **PASS** — حدود دقيقة (8192 ok / 8193 مرفوض / 8198 متعدد البايت مرفوض) |

## 4. إثبات البصمات وقابلية التكذيب (scratch)

| # | الحالة المقاسة | المقاس | المتوقع (ثابت) | الحكم |
|---|---|---|---|---|
| S1 | `schema.sql@HEAD` (خام CRLF) | `62e7586e86f7b2fe7035e7992279a613` | `PREDECESSOR_SHAPE` القديم | PASS |
| S2 | S1 + `b17.sql` | `bbcb018ee1d1655b36c3a0745e3536ae` | `B17_SHAPE` القديم | PASS |
| S3 | S2 + `b17-content.sql@HEAD` (LF كما في `b17ContentSource`) | `5def29de961f3ee64a783e65f9c1501b` | `B17_CONTENT_SHAPE` القديم | PASS |
| S4 | `schema.sql@U4-1a` | `d093f4720020a9f496a230e02dc6e573` | `PREDECESSOR_SHAPE` جديد | PASS |
| S5 | S4 + `b17.sql` | `99455c0b7408fe8f5b204e44fc242649` | `B17_SHAPE` جديد | PASS |
| S6 | S5 + `b17-content.sql@U4-1a` (LF) | `6f67b44de1e2620fdb711ef9175fb6f5` | `B17_CONTENT_SHAPE` جديد | PASS |
| S7 | S4 ثم إسقاط الأعمدة الثلاثة ثم إعادتها | `d093f472…` → **`62e7586e…`** → `d093f472…` | يعود للـ md5 السابق حرفياً | PASS |
| S8 | S6 ثم إسقاط الأعمدة الثلاثة ثم إعادتها | `6f67b44d…` → **`811b4674816cfd6b6983e0b0a3a80413`** → `6f67b44d…` | أوراكل «السياسة فقط» (`811b4674…`) | PASS |
| S9 | `sha256` لـ `b17-content.sql` بعد CRLF→LF | `2e07a7c14934aaebde24a145be6a4912530db9e160d74544d36b2d66912f3f45` | تعليق المنفذ + pin الاختبار | PASS |

ملاحظة إعادة القياس (QAF-06): الأرقام تُعاد فقط إذا استُخدمت نفس بايتات المسار الحقيقي — `schema.sql` يُطبَّق خاماً (CRLF في working tree) بينما `b17-content.sql` يُطبَّق بعد CRLF→LF داخل `b17ContentSource()`. تطبيق `schema.sql` بنسخة LF يعطي `d89e77371e4f3303016fcaf71b97f153` ويُوهم بالانحراف.

## 5. المعيار 1 — الأعمدة والافتراضيات وغياب CHECK

| العمود | التعريف الفعلي (information_schema) | القيمة الافتراضية سلوكياً (INSERT ثم ROLLBACK) |
|---|---|---|
| `items.attachment_required` | `boolean`, NOT NULL, default `false` | **`false`** |
| `services.settings` | `jsonb`, NOT NULL, default `'{}'::jsonb` | **`{}`** |
| `client_services.client_field_mask` | `jsonb`, NULL, بلا default | **SQL NULL** |

قيود CHECK على الجداول الثلاثة: أربعة قيود **سابقة** فقط على `items` (`esg_class`, `priority`, `weight`, `baseline_gap_percent`)؛ لا CHECK على `settings` ولا `client_field_mask` ولا `attachment_required`؛ `services`/`client_services` بلا أي CHECK. فرق الكتالوج أضاف فقط قيدي NOT NULL اللذين يسجّلهما PG18 تلقائياً.

## 6. المعيار 2 — مدققات الكتابة

- `parseServiceSettings`: كائن فقط (`null`/`[]`/نص مرفوضة)، السقف يقاس بـ `Buffer.byteLength` بعد `JSON.stringify`: **8192 بايت = مقبول، 8193 = مرفوض**، و8198 بايت متعدد البايت = مرفوض. كود الرفض `service.settings_invalid` (400) قبل أي كتابة (`taxonomy.ts`, `PATCH /services/:id`).
- `parseClientFieldMask`: قائمة بيضاء دقيقة (8 قيم)، **مكرر مرفوض**، **غير معروف مرفوض**، **`attachment_required` مرفوض**، سلسلة/مسافة بادئة/أكثر من 8 مرفوضة. كود الرفض `service.mask_invalid` (400) قبل `domainTransaction` (`adminClients.ts`, `PATCH /clients/:id/services/:serviceId`, مصفوفة `P@T` فقط — مثبتة في `domainAccess.test.ts`).
- القراءة الدفاعية لمخزون فاسد: كائن غير مصفوفة → «لا شيء مخفي»؛ مصفوفة قديمة `["attachment_required","secret","hint","hint"]` → تُطبَّق `{hint}` فقط (مُنفّذ).

## 7. المعيار 3 — مسار W الجديد

- تصريح واحد مطابق حرفياً: `PATCH /workspace/services/:serviceId/visibility|W#...` (`accessRegistry.ts`)، ومثبت في `domainAccess.test.ts` — لا P/C/E في المصفوفة، و`assertRouteContext` يعيد 403 `workspace.mode_mismatch`، ويوجد حارس صريح إضافي (`mode==='consultant' && role==='ge_admin'`).
- الجسم: `parseVisibilityBody` يقبل **مفتاحاً واحداً فقط** `clientFieldMask`؛ مفتاح إضافي/مفقود/جسم مصفوفة/null → 400 قبل أي كتابة (البروب R5 أثبت أن الصف لم يتغير).
- فحص الربط: `resolveLinkedService` (مستأجر الخادم فقط) + `WHERE client_id=$tenant AND service_id=$service`.
- التدقيق: `CLIENT_SERVICE_VISIBILITY_UPDATED` مع `entityType='client_services'`؛ سياسة `b17_audit_insert` تقبل فرع `b17_work_tenant(client_id)` ⇒ الكتابة مسموحة لهذا السياق.
- إثبات RLS المنفّذ (§3 الجدول 8) يؤكد أن الكتابة ممكنة فقط لسياق W/عمل/مستأجر-الذات.

## 8. المعيار 4 — التقنيع للعميل (FAIL)

الإسقاطات المغطاة (مُعدَّدة): `GET /items` · `GET /items/:id/links` · `GET /queue` · `GET /evaluations` (رأس تاريخ البند) · `GET /reports/index` و`GET /reports/export` (عبر `report()` المشترك). فحصتُ بقية مسارات C التي تعيد بنوداً فوجدتها لا تحمل أي حقل من القائمة البيضاء: `GET /client-review`, `GET /assignments`, `GET /actions`, `GET /dashboard/stats`, `GET /client/dashboard`, `GET /standards`, `GET /disclosures`, `GET /services`, `GET /clients`, `GET /clients/:id`, `GET /clients/:id/services`, `GET /esg-profile`, `GET /answers/:id/attachments`, `GET /storage/usage`, `GET /notifications`.

مؤكد بالتنفيذ:
- الاتحاد fail-closed: بند ينتمي لخدمتين لدى العميل A، إحداهما بلا قناع والأخرى `["hint","weight"]` ⇒ القناع `{hint, weight}`.
- عزل المستأجر: العميل B (خدمة واحدة بقناع `["hint"]`) يرى `{hint}` للبند نفسه.
- `attachment_required` غير قابل للتقنيع مطلقاً (لا في القائمة البيضاء، ولا حتى من بيانات مخزنة فاسدة).
- W: `maskedItemFields` يعيد خريطة فارغة، و`serviceFieldMask` يعيد مجموعة فارغة (E/P بالمثل عبر نفس الفرع).
- `stripMaskedFields` يحذف المفاتيح فعلياً (لا إخفاء عرضي).

العيوب (مفصّلة في §10): في `GET /items/:id/links` يصل `weight` كـ `null` (المفتاح موجود)، و`attachment_required` غير موجود إطلاقاً في الرد.

## 9. المعيار 5 — السياسة ومحتوى الملف

نص السياسة كما في `pg_policies` (منفّذ):
- `USING` = `current_purpose='work' AND current_mode='consultant' AND client_id::text = current_tenant_id`
- `WITH CHECK` = `client_id::text = current_tenant_id`
- `cmd=UPDATE`, `roles={public}` (نمط الجداول الأخرى هنا)، على `client_services` فقط.

فرق الكتالوج بين HEAD وU4-1a: الجداول متطابقة، الدوال (بما فيها كل `b17_*` DEFINER) متطابقة، الفهارس متطابقة، المشغلات متطابقة، السياسات **+1 فقط** بلا أي تعديل سياسة قائمة. `git diff` لـ `b17-content.sql` = **+11 سطراً** (تعليق + `CREATE POLICY` واحد) بلا أي حذف.

## 10. العيوب (Findings)

| المعرف | الخطورة | الوصف | الدليل | الموقع |
|---|---|---|---|---|
| QAF-01 | **MEDIUM** | `attachment_required` **لا يُعاد** في `GET /items/:id/links` رغم اختياره في SQL: الرد يبني `otherItem` بحقول صريحة دون الحقل. يخالف §2 «attachment_required is returned in item projections (P/W/E)»، وسيحتاجه U4-1b. اختبار التثبيت يتأكد من نص SQL فقط فلا يكشف النقص. | مقارنة `SELECT … o.attachment_required AS other_attachment_required` مع كتلة `otherItem`؛ وتنفيذ محاكاة: `attachment flag present: false` في الوضعين | `src/server/taxonomy.ts:1068` مقابل `1116–1130`؛ `src/lib/clientFieldMask.test.ts:106` |
| QAF-02 | LOW | الحقل المقنّع `weight` يصل للعميل كـ `weight: null` بدل غيابه (بسبب `Number(undefined)` → `NaN` → `null`)، بخلاف بقية الحقول المقنّعة التي تُحذف فعلياً. لا يكشف القيمة، لكنه يخالف «absent from payload» نصاً. | محاكاة الإسقاط بعد `stripMaskedFields(..., 'other_')`: المفاتيح المخدومة = `answerType,code,disclosureCode,disclosureTitle,id,requirement,standardCode,weight` و`weight=null`؛ الضابط غير المقنّع `weight=3` | `src/server/taxonomy.ts:1122` |
| QAF-03 | LOW (كامن) | مسار 422 `reports.index_incomplete` يرمي من `buildReportPayload` **قبل** تنفيذ حجب التقنيع في `reports.ts`، فيعود `err.index` بلا حجب. لا يوجد حالياً أي حقل قابل للتقنيع في `DisclosureIndexRow`، لذا لا تسريب فعلي — لكن الضمانة غير محكمة الترتيب. | قراءة تدفق الاستثناء + شكل `DisclosureIndexRow` | `src/server/routes/reportData.ts:51-54` / `reports.ts:25-29` |
| QAF-04 | INFO | `src/db/b17-content.sql` خارج تعداد §3 Targets (السياسة أُضيفت في الجولة 2 «Option A»). مطلوبة للمعيار 5 ومطبّقة حياً، لكن التصديق النهائي لـ Tera. | `git status` + `git diff` | — |
| QAF-05 | INFO | لا يوجد مسار قراءة لـ W يجلب القناع المخزّن (`GET /clients/:id/services` لا يعيد `client_field_mask`) — واجهة U4 ستحتاج عرض الحالة الحالية. | قراءة الإسقاط | `adminClients.ts:342` |
| QAF-06 | INFO | الثوابت حساسة لبايتات المسار (schema خام CRLF مقابل content بعد LF). إعادة القياس بأي تطبيع آخر تعطي رقماً مختلفاً وتُوهم بانحراف. | S1 مقابل قياس LF (`d89e7737…`) | `b17Readiness.ts` |
| QAF-08 | LOW (إجرائي) | مسار تقرير QA الإلزامي `project-control/qa-reports/TASK-PROTO-U4-1a-QA.md` غير مُدرج في تجاوز `reviewerReports` (مطابقة مسار دقيقة) داخل حارس النطاق، فبعد كتابة التقرير يصبح `npm test` = 332/333 وفشل واحد باسم هذا الملف. ليس عيباً في كود المنفذ (نفس سابقة H13/U3A/U3B2) لكنه يتطلب من المنفذ إضافة المسار الدقيق مع مسار تقرير Shield في جولة الإصلاح. | `not ok 4 … Unapproved write: project-control/qa-reports/TASK-PROTO-U4-1a-QA.md` (`npx tsx --test src/lib/b17TransactionInventory.test.ts` = 4/5) | `src/lib/b17TransactionInventory.test.ts` (`reviewerReports`) |
| QAF-07 | INFO | RLS صفّي لا عمودي: أي معالج مستقبلي ينفّذ `UPDATE client_services` في سياق W سيستطيع تعديل `show_gap/show_corrective`. اليوم لا يوجد سوى هذا المعالج (استُخرجت كل تعليمات UPDATE) — والسطر `P@T` ممنوع على W بالمصفوفة. | `grep UPDATE client_services` | — |

## 11. المعيار 6 — التثبيتات (Pins) وتقييم الإضعاف

| التثبيت | القيمة | التحقق المستقل |
|---|---|---|
| `h13AuthSha256` | `5848271d…c978dde` (بلا تغيير) | أعدتُ حساب sha256 بعد LF: **مطابق** |
| `h13RoutesSha256` | `b72f5b5f…719935cb` | **مطابق** للحساب المستقل |
| `h13AccessRegistrySha256` | `d19d4630…32735c0a2` | **مطابق** |
| `h13ContentSha256` | `2e07a7c1…12f3f45` | **مطابق** (ويساوي `checksum` الذي سيُسجَّل في ledger) |
| `h13ReadinessSha256` | `f712295e…07cc23d0` | **مطابق** |
| أعداد المسارات | 97→98 · U1 97→98 · FLIPPED 89→90 · REGISTRY 101→102 | حسابية متسقة مع إضافة تصريح واحد |
| مواقع المعاملات | total 83→84 · work 37→38 · total+3 86→87 | مسار عمل واحد جديد (`serviceVisibility`) — متسق |
| `allowed.size` | 72→79 | 7 مسارات دقيقة (بلا globs) = الملفات الجديدة فعلاً |
| `newFiles` / `controlInputs` | إضافة 6 ملفات ≤500 سطر + ملف العقد | مطابق لـ `git status` |

الحكم: **لا إضعاف** — لم يُحذف أي تأكيد، ولم يُحوَّل أي pin إلى نمط أوسع، وأرقام العدّ حُدِّثت حسابياً فقط، و`h13AuthSha256` بقي ثابتاً. الملاحظة الوحيدة أن اختبارات U4-1a الجديدة **نصية** (substring) وليست سلوكية، ولهذا مرّ QAF-01 دون كشف.

## 12. غير متحقق (NOT VERIFIED)

- سلوك HTTP الكامل للمسار الجديد (403 لـ C/E/P، و400 قبل الكتابة عبر Express) — أُثبت **ستاتيكياً** (المصفوفة + `access.ts` + أوراكل الاختبار) و**على طبقة DB**، لا عبر طلب HTTP فعلي. لا يمكن ترقيته إلى PASS بدون ذلك.
- حالة قاعدة Tera الحيّة (ممنوعة بالتكليف) — لم تُفحص.

## 13. توصية

1) QAF-01 + QAF-02 في `taxonomy.ts`: إضافة `attachmentRequired: r.other_attachment_required` إلى `otherItem`، وتجنّب `Number(undefined)` عند غياب `other_weight` (حذف المفتاح بدل `null`). 2) QAF-08: إضافة المسارين الدقيقين `project-control/qa-reports/TASK-PROTO-U4-1a-QA.md` و`security-reports/TASK-PROTO-U4-1a-fix-review.md` إلى `reviewerReports`. 3) QAF-03 (اختياري): تنفيذ الحجب داخل `buildReportPayload` أو حجب `err.index` في `failure`. بعدها `npm test` المتوقع 333/333 ومراجعة سريعة.

## 14. توقيع الوكيل

QA Agent — Execution Mode · 2026-11-16 · scratch: `u41a-qa-pg` (الحاوية stopped للتحقق وإعادة الإنتاج، وتُزال بعد المراجعة)
---

# RECHECK — Round 2 (2026-11-16)

| البند | القيمة |
|---|---|
| النطاق | إعادة تحقق من R1–R4 فقط بعد جولة الإصلاح — لا إعادة مراجعة كاملة |
| الأساس | `0edf250a45a5b883587413cf248ee8f6a0021f8c` (نفسه) |
| قاعدة البيانات | **لم تُستخدم** — لا سكراتش هذه المرة (كل R1–R4 قابلة للحسم بلا DB) |
| حاوية السكراتش | `u41a-qa-pg` **أُزيلت** بـ `docker rm -f` — `docker ps -a` لا يعرض أي `u41a` (تأكيد) |
| قاعدة Tera الحيّة | لم تُلمس |
| ما تغيّر منذ تقريري الأول | `taxonomy.ts` (استخراج `linkOtherItem` نقي + خريطة عمود→مفتاح)، `scope.ts` (قراءة fail-closed)، `clientFieldMask.ts` (`ALL_CLIENT_FIELD_MASK`)، `clientFieldMask.test.ts` (اختبار سلوكي)، `b17TransactionInventory.test.ts` (مسارا تقرير) |

## R1 — `otherItem.attachment_required` — **PASS** (سلوكي، وقابل للكسر)

المنفذ صدّر `linkOtherItem(row, mask?)` كدالة نقية في `taxonomy.ts`، والمسار يستخدمها: `otherItem: linkOtherItem(r, maskByItem?.get(...))`.

دليل تنفيذي (استيراد الوحدة الحقيقية عبر tsx، لا محاكاة):

| الفحص | النتيجة |
|---|---|
| `linkOtherItem(row)` → `attachment_required` | **`true`** (والقيمة `false` تبقى `false`) |
| `weight` غير مقنّع | **`3`** (رقم) |
| الكائن يبني `attachment_required` من `row.other_attachment_required === true` | مؤكد بالتنفيذ |

**قابلية الكسر (falsifiability):** نسختان mutant في `%TEMP%` بُنيتا من نفس بايتات الملف واستُخرجت منهما الدالة نصياً ثم نُفّذت:
- **M1** (حذف سطر `attachment_required`) ⇒ هارنسي **FAIL** (`value=undefined`) ⇒ **مُكتشف**.
- **M2** (إعادة `weight` بلا حذف) ⇒ هارنسي **FAIL** (`present=["weight"]`) ⇒ **مُكتشف**.
⇒ الاختبار ليس نصياً: يكسر عند كسر التعيين فعلاً.

أوراكل الاختبار أيضاً سلوكي: `clientFieldMask.test.ts:18` يستورد `linkOtherItem` من الإنتاج ويؤكد `attachment_required === true` و`!(key in masked)` (السطور 67–89). تثبيت SQL النصي بقي عند السطر 141 كطبقة إضافية فقط.

## R2 — غياب الحقول المقنّعة (لا مفاتيح null) — **PASS**

| الفحص (تنفيذ فعلي) | النتيجة |
|---|---|
| قناع كامل (8 حقول) على إسقاط الروابط | المفاتيح المخدومة = `id, code, requirement, answerType, attachment_required, disclosureCode, disclosureTitle, standardCode` — **لا `weight` ولا أي حقل مقنّع** |
| هل `weight` موجود كـ null؟ | **لا** — المفتاح غائب تماماً (`'weight' in masked === false`) |
| `attachment_required` تحت القناع الكامل | **يبقى ظاهراً** (غير قابل للتقنيع) |
| قناع جزئي (`esg_class`, `sort_order`, `hint`) | `esgClass`/`hint` محذوفان، `weight` ما زال `3` |
| قناع فارغ | لا حجب |
| الإسقاطات الخام (`GET /items`, `/queue`, `/evaluations`) تحت القناع الكامل | الحقول الثمانية محذوفة فعلياً، `attachment_required` باقٍ (تنفيذ `stripMaskedFields`) |
| مسارات التقارير | `payload.index` مكوّن من `DisclosureIndexRow` — لا يحوي أي حقل من القائمة البيضاء أصلاً (لا تسريب ولا مفاتيح null) |

آلية الإصلاح صحيحة بالتصميم: الكائن يُبنى أولاً ثم تُحذف المفاتيح بعد البناء (`delete otherItem[LINK_FIELD_KEYS[field] ?? field]`) ⇒ لا مجال لتحويل `undefined` إلى `null` كما في الجولة 1.

## R3 — القناع المخزّن الفاسد fail-closed — **PASS**

تنفيذ `storedClientFieldMask` على 14 حالة (كلها PASS):

| المدخل | الناتج |
|---|---|
| `null` / `undefined` / `[]` | مجموعة فارغة (لا حجب) — **السلوك القديم محفوظ** |
| `["hint"]` / `["hint","weight"]` | بالضبط تلك الحقول — **محفوظ** |
| `{}` / `{hint:true}` / `"hint"` / `5` / `true` | **الحقول الثمانية كلها** |
| `["hint","secret"]` / `[1]` / `["hint",null]` / `["attachment_required"]` | **الحقول الثمانية كلها** |
| `["hint","hint"]` | `{hint}` (إزالة تكرار لا تُخفي أقل مما وُصف — انظر R-F3) |

`ALL_CLIENT_FIELD_MASK` = القائمة البيضاء الثمانية حصراً و**لا تحتوي** `attachment_required` ⇒ «إخفاء الكل» لا يخفي إلزامية المرفق أبداً.

خط المسار المزدوج موحّد: `maskedItemFields` صار يقرأ القيمة **الخام** (`cs.client_field_mask AS mask`) ويُمرّرها إلى `storedClientFieldMask` — أُزيل توسيع `jsonb_array_elements_text` الذي كان يحوّل قيمة فاسدة إلى «صفر صفوف» = إظهار كل شيء. `serviceFieldMask` يستخدم نفس المدقق (صف مفقود → `EMPTY`).

## R4 — مسارا التقرير + عدم تحرّك أي pin — **PASS**

| البند | النتيجة |
|---|---|
| `reviewerReports` | أُضيف المساران **كنصّين دقيقين**: `project-control/qa-reports/TASK-PROTO-U4-1a-QA.md` و`security-reports/TASK-PROTO-U4-1a-fix-review.md` — **لا globs/بادئات** (فحص `*`: صفر) ولم يُحذف أي مسار سابق |
| `allowed.size` | **79** (بلا تغيير عن الجولة 1) |
| مواقع المعاملات | `total=84`, `work=38`, `total+3=87` (بلا تغيير) |
| `newFiles` / `controlInputs` | بلا تغيير (6 ملفات + `serviceVisibility.ts` + ملف العقد) |
| `h13AuthSha256` | `5848271d…` — أعدتُ حسابه: مطابق (غير متحرك) |
| `h13RoutesSha256` | `b72f5b5f…` — مطابق |
| `h13AccessRegistrySha256` | `d19d4630…` — مطابق |
| `h13ContentSha256` | `2e07a7c1…` — مطابق |
| `h13ReadinessSha256` | `f712295e…` — مطابق |

⇒ لم يتحرك أي pin حجمي أو تجزئي؛ الإضافة الوحيدة هي تجاوز المسارين الدقيقين (وهو ما طلبه QAF-08).

## أوامر الجولة الثانية ونتائجها

| الأمر | النتيجة |
|---|---|
| `npm run lint` | exit 0 — 0 أخطاء |
| `npm test` | **334 tests / 334 pass / 0 fail** (exit 0) — بوجود تقريري هذا في الشجرة (أي أن QAF-08 مغلق فعلياً) |
| `npm run build` | exit 0 — تحذير حجم chunk واحد فقط (غير مانع) |
| هارنس سلوكي (tsx) على `linkOtherItem` + mutantان | 10/10 PASS على الحقيقي، واكتشاف كلا الكسرين |
| هارنس سلوكي على `storedClientFieldMask` | 14/14 PASS |

## ملاحظات متبقية (لا تحجب)

| المعرف | الخطورة | الوصف |
|---|---|---|
| R-F1 | LOW (كامن — لم يُعالج في هذه الجولة) | **QAF-03 باقٍ**: مسار 422 `reports.index_incomplete` يرمي من `buildReportPayload` قبل تنفيذ الحجب في `reports.ts`، فيعود `err.index` غير محجوب. لا أثر فعلي لأن `DisclosureIndexRow` لا يحوي أي حقل قابل للتقنيع — لكن الضمانة غير محكمة الترتيب. |
| R-F2 | INFO | `attachment_required` يظهر في `otherItem` بصيغة snake_case بينما بقية مفاتيح الإسقاط camelCase (`answerType`, `esgClass`)؛ متسق مع `GET /items`/`/queue` الخام، وغير متسق مع جيرانه. |
| R-F3 | INFO | مصفوفة مخزّنة فيها تكرار (`["hint","hint"]`) تُقرأ كـ `{hint}` لا كـ «إخفاء الكل». لا تُخفي أقل مما وُصف (كل عضو مذكور يبقى مخفياً)، لذلك لا خرق لـ fail-closed؛ أُدوّن التفسير فقط. |
| R-F4 | INFO | QAF-06 (حساسية الثوابت لبايتات المسار) باقٍ كما هو — لم تُعَد القياسات هذه الجولة لأن `b17Readiness.ts` لم يتغيّر (تجزئته مطابقة). |
| R-F5 | INFO | QAF-04 (موقع `b17-content.sql` خارج تعداد §3) باقٍ كسؤال تصديق لـ Tera. |

## حكم الجولة الثانية

**PASS** — R1 PASS · R2 PASS · R3 PASS · R4 PASS. لا انحدار: 334/334، lint/build نظيفان، ولا مسار مقنّع يُعيد مفاتيح null. QAF-01 وQAF-02 **مغلقان** بأدلة سلوكية قابلة للكسر، وQAF-08 مغلق. يبقى R-F1 (كامن، لا أثر حالي) وبعض الملاحظات المعلوماتية.