# ISSUES_AND_GAPS.md — prototype-app (مسار التقسية)

| ID | Date | Severity | Issue | Evidence | Owner | Status |
|---|---|---|---|---|---|---|
| ISS-001 | 2026-11-15 | High | **`--brand` كمؤشّر نص/أيقونة في الثيم الداكن يفشل التباين**: `--brand` = `#026F39` (تعبئة معتمدة للزر بنص فاتح) لكنه يُستخدم أيضاً كلون أيقونة/نص → على `--brand-soft` (`#294834`) ≈ **1.6:1** وعلى `--surface-2` (`#1D3029`) ≈ **2.2:1**. لا يوجد بديل داخل التوكنز الحالية (brand/brand-strong كلاهما فاشل هناك). | H10a handback + حساب WCAG؛ نفس النمط موجود في `LoginView` (H03) و`GeOverviewView` (H10b) | Tera + ui-designer | **Open** — يحتاج توكن مخصص `--brand-text` (ge/lime `#026B38` · dark `#86DCA8` ≈ 6.2:1) ثم مسح رابع (contrast pass) |
| ISS-002 | 2026-11-15 | Medium | عدة شاشات غير مرّحلة بعد (19 ملفاً / ~2200 كلاس حرفي) → الثيم الداكن يظهر ناقصاً (بطاقات بيضاء) | جرد H10 | Tera | In Progress — دفعات H11–H17 |
| ISS-003 | 2026-11-15 | Low | `DashboardView.tsx:145` نص يحتوي `&` خام في JSX → تحذير PartialParsing في Semgrep (سابق، ليس انحداراً) | semgrep | — | Open (تحسين لاحق، خارج نطاق الترحيل اللوني) |
| ISS-004 | 2026-11-15 | Low | الموظف يرى «No Sustainability Data Imported Yet» مع وجود 541 بنداً — قد يكون سلوكاً صحيحاً (قيود دور) أو خللاً | لقطة h10-env-check | Tera | Open — تحقق عند ترحيل لوحات المتابعة (سلوك ≠ نطاق الستايل) |
