# STYLE_HANDOFF.md — تسليم طبقة الستايل لأي جلسة تعمل على التطبيق

> **الحالة:** مُعتمد من المالك 2026-11-15 (معاينة مشتركة + قبول صريح).
> **المرجع الحاكم:** `project-control/STYLE_CONTRACT.md` — **اقرأه قبل أي تعديل UI.**
> **القيم التنفيذية:** `src/styles/tokens.css` + `src/styles/themes.css`.

## 1. ما هو معتمد الآن

| البند | الحالة |
|---|---|
| ثلاث ثيمات: `ge` (افتراضي) · `lime` · `dark` | ✅ تعمل عبر `data-theme` على `<html>` |
| طبقة توكنز مركزية (30 توكن) | ✅ لا ألوان حرفية في أي شاشة |
| ترحيل كل الشاشات والمكوّنات (22 ملفاً) | ✅ صفر `bg-white|slate|dark:|#hex` |
| استثناء الطباعة/PDF | ✅ يبقى بهوية GE الثابتة (لا يُلوَّن) |
| الثيم | ✅ من الخادم: `clients.theme` يُبثّ في الجلسة (`login`/`auth/me`) ويطبّقه `ThemeContext` — **لا معامل URL** (D-H01-01 / TASK-PROTO-H12) |

## 2. قواعد إلزامية لأي جلسة

```text
1) لا لون حرفي: ممنوع bg-white · text-black · slate/gray/zinc/neutral/stone · dark:* · #hex
2) لا ستايل محلي: ممنوع style={{color|background|border|fill|stroke}} أو CSS خاص بصفحة
   (الأبعاد الديناميكية width/height/transform مسموحة)
3) الأدوار ثابتة: صفحة bg-surface · بطاقة bg-surface-2 · غائر/حقل bg-surface-3
4) النصوص الملوّنة: text-brand-text · text-success-text · text-warning-text · text-accent-text · text-danger
   (ممنوع text-brand/text-success/text-warning/text-accent كنص)
5) داخل الشريط الجانبي: sidebar-text/sidebar-muted/on-rail-danger فقط — لا توكنات صفحات
6) الدلالات للحالات فقط (نجاح/تحذير/خطر/معلومة) — لا تُستخدم كهوية
7) الطباعة/PDF خارج الثيم — لا تلمس renderPrint أو print:*
8) الحالات تُفصل بـ HTML (bg-surface-* / border-*) لا بـ CSS مخصص
```

## 3. تحقق قبل أي تسليم (انسخ واللصق)

```powershell
# 1) لا مخالفات
Select-String -Path src\views\*.tsx,src\components\*.tsx -Pattern 'bg-white|text-black|slate-|gray-|zinc-|neutral-|stone-|dark:|#[0-9a-fA-F]{6}'
# 2) البوابات
npm run lint ; npm run test ; npm run build
```

## 4. إضافة أي لون/توكن جديد

```text
1) لا تُضِف لوناً في صفحة. أضفه كتوكن مركزي:
   tokens.css  (@theme + @theme inline alias)  →  themes.css (3 كتل)  →  STYLE_CONTRACT §1
2) أعلن المقاسات (تباين ≥ 4.5 للنص · ≥ 3 للأيقونات) في سجل المهمة.
3) التوكنات النصية الحالية مثال يُحتذى: --brand-text · --success-text · --warning-text · --accent-text · --on-rail-danger
```

## 5. الحالة الفنية

```text
lint 0 · tests 227/227 · build 0
dark: صفر عيوب تباين · صفر أسطح بيضاء
ge  : 3 عناصر عند 4.49 (سقف الأبيض على #038947 — استثناء معتمد GAP-002)
```

## 6. مفتوح (لا يخصّ الستايل)

| البند | النوع |
|---|---|
| ISS-006 «tables created» بلا رقم | بيانات/جلسة (`workspace.invalid`) |
| ISS-004 لوحة الموظف «لا بيانات» مع 541 بنداً | منطق/صلاحيات |
| ISS-003 `&` خام في DashboardView:145 | تحسين تقني |
| ~~ربط الثيم بالمستأجر من الخادم~~ | ✅ أُنجز (TASK-PROTO-H12) |

## 7. أين السجلات

```text
project-control/STYLE_CONTRACT.md      ← العقد الحاكم
project-control/ISSUES_AND_GAPS.md     ← ISS-001…010
project-control/tasks/TASK-PROTO-H*/   ← عقود المهام وتقاريرها
project-control/prototypes/h10-preview/ ← لقطات المعاينة
project-control/TERA_AUDIT_TRAIL.md    ← سجل الأحداث
```
