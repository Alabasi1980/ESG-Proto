# FINAL-1 — إصلاح ISS-003 (نصّ JSX خام)

> **الحالة:** Assigned → engineering-agent-typescript · Session: NEW
> **السبب:** `DashboardView.tsx:145` يحتوي `&` خاماً في JSX → تحذير PartialParsing في Semgrep.

## الهدف
استبدال `&` الخام في النص المرئي بـ `&amp;` **دون تغيير النص المعروض** (سيُعرض كما هو `&`).

## Allowed Write Targets
```text
src\views\DashboardView.tsx   (السطر 145 فقط)
```

## القيود
- لا تغيير آخر · نفس عدد الأسطر · لا لمس كلاسات أو منطق.
- إن كان `&` داخل تعبير JS (string literal) وليس JSX text → STOP وأبلغني (لا تُعدّل).

## القبول (Tera)
lint+build+227 · النص المعروض ما زال `GRI 2 & 200 Series…` · تحذير PartialParsing يختفي.
