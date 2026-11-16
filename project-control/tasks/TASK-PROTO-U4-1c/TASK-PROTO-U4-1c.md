# TASK-PROTO-U4-1c — documents, department initiatives, general bucket, indicator & tags (model + APIs)

Status: AUTHORISED — OD-12 §3–8. Base: expect `5efb0c8`.
Governing: OD-07 (one generic model), OD-12, OD-11 (roles), `B17_TECHNICAL_SPEC.md` §7.1, existing attachment caps (5 MB, MIME allowlist).

## 1. Model (additive; IF-NOT-EXISTS DO-blocks; no business CHECKs — handler validation)
1. `items.indicator_code TEXT NULL` (e.g. `c (i)`), `items.tags TEXT[] NOT NULL DEFAULT '{}'`.
2. **General bucket per service** (no schema change): helper `ensureGeneralBucket(serviceId)` creates/ensures
   standard `GENERAL-<SANITIZED_CODE>` (title «عام / General», category `general`) + disclosure `GENERAL`
   («أسئلة عامة / General questions») + `service_standards` mapping. Called on service create/duplicate and
   idempotently backfilled for existing services. Items there use `esg_class='general'`.
3. `document_requirements(id, service_id NOT NULL FK, department_id NULL FK, title NOT NULL, description NULL,
   required BOOLEAN DEFAULT true, sort_order INT DEFAULT 0, tags TEXT[] DEFAULT '{}', created_at)`
   — department_id NULL = applies to all departments of the client.
4. `document_submissions(id, client_id, department_id, requirement_id, provided BOOLEAN DEFAULT false,
   note TEXT NULL, tag TEXT NULL, submitted_by NULL, submitted_at NULL, UNIQUE(client_id, department_id, requirement_id))`.
5. `initiative_department_status(id, client_initiative_id FK, department_id FK, performed BOOLEAN DEFAULT false,
   note TEXT NULL, submitted_by NULL, submitted_at NULL, UNIQUE(client_initiative_id, department_id))`.
6. **Unified evidence files** for documents/initiatives:
   `evidence_files(id, client_id NOT NULL, department_id NULL, entity_type TEXT NOT NULL, entity_id UUID NOT NULL,
   filename TEXT NOT NULL, mime TEXT NOT NULL, size_bytes INT NOT NULL, content BYTEA NOT NULL, uploaded_by NOT NULL,
   created_at)` — 5 MB + MIME allowlist mirrored from existing attachments; `entity_type` validated in handler
   (`document_submission` | `initiative_status`). Answer attachments stay as they are.

## 2. APIs (matrix additions allowed; enumerate every declaration + pin update)
- **P:** requirements CRUD under a service (`GET/POST/PATCH/DELETE /services/:id/documents`), P@T explicit target where tenant-bearing; item `indicatorCode`/`tags` accepted by existing item create/update routes.
- **E:** `GET /requirements` (own department: requirement + submission state + files), `PATCH /requirements/:id` (provided/note/tag, department-owned only), file upload/download/delete (`/requirements/:id/files`).
- **E:** `GET /initiatives/department` (own dept rows from client's selected initiatives + status + files), `PATCH /initiatives/department/:id` (performed/note), proof upload/download/delete.
- **W/C:** read-only views of the same two lists for their scope (W = A, C = own company). **No writes.** P may read (T).
- All writes gated like existing: matrix context, fresh identity, department scoping, freeze rules where applicable, zero-write refusals, own-code envelopes, audit for submits/status changes.
- Evidence rules: file delete locked once a submission `submitted_at` is set (mirror U4-1b evidence lock); append allowed; 5 MB/MIME enforced; downloads only in scope.

## 3. Targets
`src/db/schema.sql` · `src/db/b17Readiness.ts` (3 constants) · **new** `src/lib/generalBucket.ts`, `src/lib/documents.ts`, `src/lib/departmentInitiatives.ts` (+tests) · **new** `src/server/routes/documents.ts`, `src/server/routes/departmentInitiatives.ts` · `src/server/routes.ts` (mounts) · `src/server/accessRegistry.ts` (declarations+matrix) · `src/server/taxonomy.ts` (indicatorCode/tags + bucket on create/duplicate) · `src/server/scope.ts` (helpers) · `src/lib/*.test.ts` (+ enumerated pins) · `scripts/u41c-*.ts` (own scratch proof). Forbidden: UI/views, b17.sql, b17ContentMigration.ts, deps, `.env`, live DB, control docs.

## 4. Evidence
Unit + scratch: bucket idempotence (create/duplicate/existing/backfill), requirements CRUD validation, submission scoping (E own dept only; W/C 403 on writes), initiative status scoping, file caps/MIME/lock, downloads scoped, matrix 403s, audit rows, fingerprint falsifiability (drop new columns/tables → previous md5). lint/tests/build. Hand Tera one-transaction live SQL (tables/columns/ledger). Tera runs live + verifies E flows.

## 5. Reviews
QA execution + Shield (file access + department scoping is security-relevant). Rounds 2.
## 6. فهم القرار
فهمي: للقسم ثلاثة عوالم: بنود الخدمة (إجابات)، مستندات مستقلة (تقديم + ملفات)، ومبادرات (نُفِّذت + إثبات) — وكلها تُرسل للاستشاري ويقرأها العميل.
الافتراضات: النموذج العام يكفي؛ الحاوية العامة عام واحد لكل خدمة؛ الدليل لا يُحذف بعد التقديم.
ما سيكشفه القبول: أن المحضر اليدوي (3 أوراق) صار يعمل داخل التطبيق بدور كل جهة.
