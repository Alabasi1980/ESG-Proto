# QA Report — TASK-PROTO-H13

| البند | القيمة |
|---|---|
| المهمة | TASK-PROTO-H13 — application-wide theme setting (platform) + ISS-005 |
| الوضع | QA Agent — Execution Mode (مستقل، scratch خاص) |
| الجلسة | NEW — 2026-11-16 |
| الأساس | `f85b3a5` (تم التحقق فعلياً بـ`git rev-parse HEAD`، فرع `main`) |
| العميل | `D:\Teranoo Work\Client01\prototype-app` |
| البيئة | Windows 11 · Node 22.22.2 · PowerShell 5.1 · Docker · `postgres:18` = **PostgreSQL 18.6** (نفس digest الحاوية الحيّة `sha256:e3d24f69…`، مستخدمة لحاوياتي المؤقتة فقط) |
| القاعدة المشتركة الحيّة | **لم تُلمس** — لم أتصل بـ`127.0.0.1:55432` إطلاقاً؛ DSNs الخاصة بي `127.0.0.1:55471` و`:55481` داخل `b17-h13-qa-pg` و`b17-h13-qa-probe` (حُذفت الحاويتان بعد التشغيل) |
| نوع الأدلة | مستقلة (قياس فعلي) — تصريحات المنفذ لم تُستخدم كدليل |

## 1. القرار

❌ **FAIL** — معايير المنتج (1–7) كلها PASS بدليل تنفيذي، لكن **بوابة الاختبارات ليست خضراء**:
`npm test` = **245 tests / 244 pass / 1 fail** (exit 1). الفشل الوحيد هو pin النطاق:
`not ok 72 - G1 protected policies, route keys, auth/lifecycle and capabilities are byte-unchanged`,
`error: 'Unapproved write: project-control/prototypes/task-proto-h13/settings-app-theme.png'`.
إضافةً إلى ذلك اكتُشف **إضعاف ممرّض (narrow) لـpin محتوى `b17-content.sql`** (QAF-02).
لا يوجد أي عيب وظيفي في الكود المُنفَّذ.

## 2. الأوامر والنتائج (كما نُفِّذت)

| # | الأمر | النتيجة |
|---|---|---|
| 1 | `npm run lint` (= `tsc --noEmit`, TypeScript 7.0.2 native) | exit 0 — 0 errors |
| 2 | `npm run build` (vite 8.3.7) | exit 0 — 1691 modules، `dist/` كُتب |
| 3 | `npm test` | exit 1 — **245 tests، 244 pass، 1 fail** (pin النطاق) |
| 4 | `npx tsx --test src/lib/appTheme.test.ts` | 11 tests، 11 pass، 0 fail |
| 5 | `npx tsx --test src/lib/capabilities.test.ts` | 5/5 pass |
| 6 | `npx tsx --test src/lib/domainAccess.test.ts` | 8/8 pass |
| 7 | harness مستقل (tsx) على scratch PG18 | كل خطوات S1–S5e PASS — أدناه |

## 3. Scratch مستقل (schema → U1 → content) — الثوابت الثلاثة

حاوية `postgres:18` جديدة، دور `b17h13qaowner` (NOSUPERUSER/NOBYPASSRLS)، قاعدة خاصة، كلمة مرور مولّدة محلياً (غير مذكورة هنا).

| # | الفحص | النتيجة |
|---|---|---|
| S1 | `PREDECESSOR_SHAPE` = مقيس schema-only (schema.sql كما يطبّقه التطبيق عبر `runMigrations`) | PASS — `62e7586e86f7b2fe7035e7992279a613` |
| S2 | `B17_SHAPE` = مقيس بعد `applyB17Offline` (U1) | PASS — `bbcb018ee1d1655b36c3a0745e3536ae` |
| S3 | `B17_CONTENT_SHAPE` = مقيس بعد content (U2D) + `verifyB17Content` | PASS — `5def29de961f3ee64a783e65f9c1501b` |
| S3' | sha256 لـ`b17-content.sql` (LF-normalized، مطابق لـ`b17ContentSource`) = `checksum` في السجل | PASS — `dd9d580d428f8c4a476ef66518c469683c2279222e291a6256c6516100501ccc` |
| S5a | إسقاط `app_settings` يغيّر الثابت (مساهمة الجدول مؤكدة) | PASS — `36a1e193282cd0cc7653f63ea062a317` |
| S5b | إعادة DDL الجدول تعيد `5def29de…` | PASS |
| S5c | عكس **الحُزمتين معاً** (إسقاط الجدول + إعادة قائمة التدقيق الأصلية) ⇒ ثابت H12 | PASS — `cf79a6a3827ab6037a28f629e4cbdb17` |
| S5d | الإعادة للأمام ⇒ `5def29de…` مجدداً | PASS |
| S5e | checksum السجل مربوط بالمصدر؛ مصدر f85b3a5 يعطي `0c7df814…` (مختلف) | PASS |

ملاحظة منهجية (ليست عيباً): قياس schema-only بمصدر **مُطبَّع CRLF→LF** يعطي `d89e7737…` لأن أجسام دوال plpgsql تُخزَّن حرفياً — يجب تطبيق `schema.sql` كما يقرأه التطبيق (`runMigrations`, بلا تطبيع). بعد التصحيح تطابقت الثوابت الثلاثة تماماً.

## 4. السلوك الفعلي لـ`app_settings` (نفس الـscratch)

| # | الفحص | النتيجة |
|---|---|---|
| S4a | `relrowsecurity`+`relforcerowsecurity` = true | PASS |
| S4b | بعد `b17.sql` (يمسح كل السياسات) + إعادة التأكيد من content: **3 سياسات فقط** (`read` SELECT USING(true) / `insert` INSERT WITH CHECK purpose / `update` UPDATE USING+WITH CHECK purpose) | PASS |
| S4c | صف غائب ⇒ SELECT مفتوح و0 صفوف (auto) | PASS |
| S4d | INSERT بلا `app.current_purpose='platform.config'` | PASS — **42501** |
| S4e | INSERT تحت purpose | PASS |
| S4f | صف ثانٍ (id=2) مرفوض | PASS — **23514** |
| S4g | تعديل id=1→2 مرفوض (single-row invariant) | PASS — **23514** |
| S4h | UPDATE بلا purpose: الصف غير مرئي (0 rows) والقيمة لم تتغير | PASS |
| S4i | UPDATE شرعي (upsert path) | PASS |
| S4j | تدقيق `APP_THEME_UPDATED` على فرع NULL-target/platform.config | PASS (مقبول) |
| S4k | نفس التدقيق على فرع target-bound | PASS — **42501** |
| S4l | `loadAppTheme` يقرأ الثيم العام (`dark`) | PASS |
| S4m | `resolveAppTheme(global='dark', tenant='lime') = 'dark'` (global يغلب) | PASS |
| S4n | auto(NULL) ⇒ ثيم المستأجر (`lime`)؛ بلا مستأجر ⇒ `ge` | PASS |

## 5. الفحص الساكن لكل معيار

1. **التخزين**: `schema.sql` يضيف `app_settings` (`id SMALLINT PK DEFAULT 1 CHECK(id=1)`, `theme TEXT` بلا CHECK، `updated_at`)، `ENABLE`+`FORCE RLS`، 3 سياسات، بلا أي seed. `b17-content.sql` = **حرفان فقط**: (أ) `APP_THEME_UPDATED` داخل قائمة NULL-target فقط، (ب) إعادة تأكيد 3 سياسات (DROP IF EXISTS + CREATE). `git diff -U0` = 3 hunks إدراج/سطر واحد فقط. PASS.
2. **الحل**: `auth.ts` (`resolveAppTheme` = global ?? tenant ?? 'ge'، `loadAppTheme`، `normalizeAppThemeOption`) + `session.ts` (login و`withSession`) — ge_admin (بلا client) يحصل على العام (`theme:'ge'` كأساس)، والموظف يرث ثيم المستأجر عندما يكون العام NULL. PASS.
3. **API**: `PUT` يتحقق من enum قبل أي معاملة ⇒ `400 {code:'settings.theme_invalid'}`؛ `auto`⇒NULL عبر `appThemeStorageValue`؛ upsert صف واحد؛ تدقيق `APP_THEME_UPDATED {theme}` مع `clientId: null`؛ GET/PUT نفس الشكل (`res.json({theme})` ×2). P-only عبر `platformConfigContext` (mode='platform' + ge_admin ⇒ purpose='platform.config') + matrix `P`. تحقق 403 لـC/W/E تم على مستوى الموزّع/المصفوفة (منفّذ)، لا HTTP حقيقي.
4. **سياسة التدقيق**: `APP_THEME_UPDATED` يظهر **مرة واحدة** فقط في فرع `target_id IS NULL`؛ لا تغيير سياسة/إجراء آخر؛ **لا definer جديد** (`SANCTIONED_DEFINER_FUNCTIONS` غير ممسوسة؛ لا `CREATE FUNCTION`/`SECURITY DEFINER` في الـdiff). PASS.
5. **السجل/المصفوفة**: إعلانان جديدان فقط، كلاهما `P` (GET/PUT `/settings`, activation U1)؛ 95→97 (LEGACY)، 99→101 (ACCESS_REGISTRY)، 87→89 (FLIPPED)، census 81→83 (+3 ⇒ 86)، `allowed.size` 54→63 (+9 مسمّاة)، sha256 pins ×3 **مطابقة فعلياً للملفات**. **QAF-02 أدناه** (إضعاف ممرّض).
6. **الواجهة**: قسم «ثيم التطبيق» داخل `{isGeAdmin && …}` فقط؛ 4 خيارات `auto|ge|lime|dark` مربوطة بـ`GET /settings` والحفظ `PUT` ثم `await refreshUser()`؛ ISS-005 في المواضع الخمسة (`SettingsView` ×3 + `App.tsx` spinner + `SetupView` radio) و`text-brand` كنص **صفر** في الملفات الثلاثة؛ صفر ألوان حرفية (`#hex`/`rgb()`/`bg-white`/`text-black`/`slate|gray|zinc|neutral|stone`/`dark:`) في `SettingsView.tsx`/`App.tsx`/`SetupView.tsx`؛ القسم الجديد يستخدم `text-start` فقط (لا `pl-/pr-/ml-/mr-/left-/right-`). PASS.
7. **الثوابت**: انظر §3 (كلها PASS على scratch خاص، مع falsifiability في الاتجاهين).
8. **البوابات**: lint 0 · build 0 · tests 244/245 (**FAIL**) — التفصيل في §6.

## 6. الملاحظات (Findings)

| المعرّف | الخطورة | الوصف |
|---|---|---|
| **QAF-01** | **MEDIUM — بوابة حمراء** | `project-control/prototypes/task-proto-h13/settings-app-theme.png` غير مُدرَج في `allowed`/`reviewerReports`/`controlInputs` في pin النطاق، وهو كذلك **خارج §3 Allowed write targets** للمهمة ⇒ `npm test` = 244/245 (exit 1). المصنّف بجانبه: `security-reports/TASK-PROTO-H13-fix-review.md` (تقرير Shield — من فئة «known reviewer artifact» التي نبّه التفويض إليها، لكن قائمة استثناء H13 لم تُحدَّث بعد). إصلاحه قرار Tera (إدراج مسارَين بالضبط في pin، أو نقل/حذف الأثر) — **لن أُضعف الـpin بنفسي**. |
| **QAF-02** | **LOW–MEDIUM — إضعاف pin** | استُبدل «byte-compare» الصارم لـ`b17-content.sql` بفحص «احذف الحزمتين وقارن». التنفيذ `contentNow.slice(0, contentCut + 1)` **يُسقط كل ما بعد آخر لافتة `-- TASK-PROTO-H13`**، فأي تعديل ثالث **داخل كتلة الذيل أو بعدها** لا يُكتشف — خلافاً لتعليق الاختبار نفسه («a third unreviewed edit still fails here»). أُثبت ذلك محلياً: إدراج سطر/سياسة في الذيل ⇒ المقارنة تبقى متساوية. التخفيف الوحيد: ثابت الكتالوج `5def29de…` + `verifyB17` يكتشفان الانحراف **عند إعادة القياس فقط**. الصياغة السابقة (byte-identity) كانت تسدّ هذه الثغرة. |
| **QAF-03** | **LOW — تجميلي** | أُزيل BOM من السطر الأول في `src/lib/capabilities.test.ts` كتغيير بايت غير مصرّح به نصّاً (الملف داخل allowed؛ لا أثر سلوكي). |
| **QAF-04** | **INFO — حوكمة** | §3 في ملف المهمة يمنع تعديل `b17-content.sql`، والـdiff يعدّله (حرفان). التفويض (Tera) أقرّه صراحةً («Tera-authorized second append»)، لكن ملف المهمة/الوثائق التحكّمية ملك Tera ولم تُحدَّث. |

## 7. ما نُفّذ / ما كان ساكناً / ما لم يُتحقق

- **Executed**: الثوابت الثلاثة + sha256 المحتوى؛ RLS/FORCE؛ السياسات الثلاث بعد المسح؛ single-row؛ auto=NULL؛ 403/42501/23514؛ التدقيق (قبول/رفض)؛ مصفوفة الأسبقية؛ falsifiability؛ lint/build/tests؛ اختبارات matrix/dispatcher.
- **Static**: الحرفان في content؛ ISS-005؛ الألوان الحرفية؛ RTL؛ ربط UI؛ تعديلات pins؛ قوائم الاستثناء.
- **NOT VERIFIED / غير مُنفَّذ (مُعلَن)**: (أ) نداء HTTP حقيقي `GET/PUT /settings` بدور C/W/E (يتطلب bootstrap جلسات/workspace على scratch خارج نطاق التفويض — تم بدلاً منه تنفيذ مسار المصفوفة/الموزّع الحقيقي)؛ (ب) Playwright/axe — لا harness في المستودع والتفويض يمنع أي تثبيت؛ (ج) semgrep/gitleaks (ليست ضمن تفويضي، وShield يغطيها).

## 8. الحياد

كل النتائج أعلاه قابلة للفشل: الثوابت قيست من كتالوج PG18 حقيقي (لا من السجل)، والسلوك من استعلامات فعلية، والبوابة من تشغيل فعلي للأوامر. لم أقرأ `.env`، ولم أتصل بالقاعدة الحيّة، ولم أعدّل أي مصدر/إعداد/ملف تحكّمي.

## 9. التوقيع

QA Agent — Execution Mode — 2026-11-16

---

# RECHECK (round 2) — 2026-11-16

النطاق: التحقق من ثلاثة إصلاحات فقط (R1/R2/R3) + إعادة البوابات. القاعدة الحيّة لم تُلمس (لم أتصل بـ55432؛ scratch خاص على 55491 داخل `b17-h13-r2-pg` ثم حُذفت الحاوية).

## R2.1 الحكم لكل إصلاح

| الإصلاح | الحكم | الدليل |
|---|---|---|
| **R1** مسارات الاستثناء الدقيقة | ✅ PASS | 7 مسارات حرفية فقط (منها الثلاثة الجديدة: تقرير QA، تقرير Shield، `project-control/prototypes/task-proto-h13/settings-app-theme.png`)؛ لا `startsWith/endsWith/includes(RegExp)/globs` في منطقة الاستثناء؛ `allowed.size` ما زال **63**. التحدي: ملف مؤقت غير مُستثنى ⇒ رُفض فعلياً ثم حُذف. |
| **R2** pin محتوى صارم | ✅ PASS | `const h13ContentSha256='dd9d580d…'` = sha256 للملف كاملاً (LF) **مطابق للواقع**؛ منطق «حذف الحزمتين» (`contentStripped`/`h13TailBanner`/`contentCut`) **اختفى**. قلب بايت واحد بعد كتلة H13 ⇒ فشل الـpin؛ ثم استُعيد الملف بايت-ببايت. |
| **R3** دفاع الملكية | ✅ PASS | `assertAppSettingsOwnership` مُضافة ومُستدعاة في `verifyB17` بعد `assertRuntimeRole`؛ no-op عند غياب الجدول؛ `b17.ownership_drift` عند مالك خاطئ؛ `STRUCTURE_SQL` مطابق حرفياً للأساس G2؛ الثوابت الثلاثة دون تغيير ومُعاد قياسها. |

## R2.2 البوابات (تشغيل فعلي هذه الجولة)

| الأمر | النتيجة |
|---|---|
| `tsc --noEmit -p tsconfig.json` (TS 7.0.2) | exit 0 — 0 errors |
| `npm test` | **245 tests / 245 pass / 0 fail** — exit 0 |
| `npm run build` (vite 8.3.7) | exit 0 — `✓ built in 781ms` |

## R2.3 تفاصيل الأدلة

**R1** — مجموعة الاستثناءات نصّها:
`B17-U2G-QA.md` · `B17-U2G-fix-review.md` · `TASK-PROTO-H12-QA.md` · `TASK-PROTO-H12-fix-review.md` · `TASK-PROTO-H13-QA.md` · `TASK-PROTO-H13-fix-review.md` · `project-control/prototypes/task-proto-h13/settings-app-theme.png` — كلها سلاسل حرفية، والفلترة `!set.has(file)` حصراً.
تحدٍّ مستقل: أُنشئ `project-control/qa-reports/H13-R1-PROBE.tmp` (غير مُستثنى) ⇒ `error: 'Unapproved write: project-control/qa-reports/H13-R1-PROBE.tmp'` (5 tests: 4 pass / 1 fail)؛ ثم حُذف الملف وتأكد أن `git status` **مطابق تماماً** لما قبل الفحص.

**R2** — قبل الفحص: `sha256(LF)=dd9d580d…`، حجم 70736 بايت. أُضيف حرف واحد في نهاية الملف خارج الكتلة ⇒
`src/db/b17-content.sql drifted from its deliberate, task-approved POST-H12/H13 bytes (SHIELD-H12-01 pin)` (4 pass / 1 fail).
الاستعادة من نسخة بايتية: `sha256(LF)=dd9d580d…` مجدداً، و`git diff --stat` للملف بلا تغيير (`30 insertions(+), 1 deletion(-)` — نفس ما قبل الفحص).

**R3** — على scratch PG 18.6 خاص:
- `PREDECESSOR_SHAPE` = `62e7586e86f7b2fe7035e7992279a613` ✓ · `B17_SHAPE` = `bbcb018ee1d1655b36c3a0745e3536ae` ✓ · `B17_CONTENT_SHAPE` = `5def29de961f3ee64a783e65f9c1501b` ✓ (كلها مُعاد قياسها).
- مع الجدول موجوداً: `verifyB17`/`verifyB17Content` خضراء (فحص الملكية يمرّ).
- إسقاط الجدول ⇒ `verifyB17` يرمي **`b17.schema_drift`** (لا `ownership_drift`) ⇒ no-op مؤكد؛ وبعد إعادة DDL ⇒ خضراء.
- `ALTER TABLE public.app_settings OWNER TO qa_h13_other` ⇒ **`b17.ownership_drift`**؛ وبعد إعادة الملكية ⇒ خضراء (الثابت لم يتغير بالملكية).
- `STRUCTURE_SQL`: مقارنة نصية حرفية مع `048a6f25…:src/db/b17Readiness.ts` ⇒ **متطابق** (لا تغيير في الاستعلام ولا في الثوابت).

## R2.4 حالة الملاحظات السابقة

| المعرّف | الحالة | ملاحظة |
|---|---|---|
| QAF-01 (بوابة حمراء — الأثر خارج النطاق) | ✅ **RESOLVED** | المسارات الثلاثة مُستثناة حرفياً؛ `npm test` 245/245. |
| QAF-02 (إضعاف pin المحتوى) | ✅ **RESOLVED** | sha256 للملف كاملاً + إثبات أن تعديلاً واحداً يُفشِله. |
| QAF-03 (BOM في capabilities.test.ts) | INFO قائمة | تجميلي؛ لم يُمَس هذه الجولة. |
| QAF-04 (§3 يمنع b17-content.sql) | INFO قائمة | وثيقة المهمة ملك Tera. |

ملاحظة جديدة (ليست ضعفاً): `b17Readiness.ts` انتقل من «مقارنة أسطر الكود بالأساس» إلى **sha256 للملف كاملاً** (`01b3ab8c…`) — أشدّ لا أضعف: أي تعديل مستقبلي (بما فيه حارس الملكية) يجب أن يُحرّك الـpin بقرار مُعلن.

## R2.5 المتبقي

لا شيء يمنع القبول بعد الإصلاحات الثلاثة. لم يُكتب في المستودع سوى هذا التقرير (append)؛ كل artifacts الفحص في `%TEMP%\opencode\b17-h13-qa-tools\`؛ الحاوية المؤقتة حُذفت.

QA Agent — Execution Mode — 2026-11-16 (round 2)
