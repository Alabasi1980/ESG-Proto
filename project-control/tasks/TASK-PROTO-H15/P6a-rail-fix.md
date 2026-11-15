# P6a — إصلاح تباين الشريط الجانبي في الثيم الافتراضي (ge)

> **الأولوية:** عالية — الثيم الافتراضي، يظهر في كل صفحة.
> **الدليل المقيس (Tera):** «العربية» 2.3:1 · «Sign Out» 2.5:1 داخل الشريط الداكن في ge.

## 1. السبب
- زر اللغة يستخدم `bg-surface-3` (توكن **سطح صفحة** = فاتح في ge) فوق شريط داكن، ونصّه `text-sidebar-muted` → رمادي فاتح على فاتح.
- زر الخروج يستخدم `text-danger` (#BE123C) على كحلي داكن = 2.5. الأحمر الدلالي مُصمَّم للأسطح الفاتحة.

## 2. Allowed Write Targets
```text
src\styles\tokens.css     (+ @theme default + @theme inline alias)
src\styles\themes.css     (3 كتل — سطر لكل ثيم)
src\components\Sidebar.tsx (زر اللغة + زر الخروج فقط)
```

## 3. التعديلات (حرفية)
1. توكن جديد `--on-rail-danger`:
   ```text
   ge   #FF8D79     lime  #BE123C     dark  #FF8D79
   ```
   في `tokens.css`: `@theme { --on-rail-danger: #FF8D79; }` + `@theme inline { --color-on-rail-danger: var(--on-rail-danger); }`
2. `Sidebar.tsx` — زر اللغة: أزل `bg-surface-3` واستخدم خلفية شفافة مع إطار الشريط:
   ```text
   border border-sidebar-muted/40 text-sidebar-text   (بدل bg-surface-3 text-sidebar-muted)
   ```
3. `Sidebar.tsx` — زر الخروج: `text-danger` → `text-on-rail-danger` (الأيقونة والنص).

## 4. ممنوعات
أي ملف آخر · تغيير منطق/نصوص/ترتيب · بقية الشريط · `dark:` · hex داخل className.

## 5. القبول (Tera)
lint+227+build · قياس DOM: «العربية» ≥4.5 و«Sign Out» ≥4.5 في الثلاثة (ge/lime/dark) · عدد الأسطر ±0.
