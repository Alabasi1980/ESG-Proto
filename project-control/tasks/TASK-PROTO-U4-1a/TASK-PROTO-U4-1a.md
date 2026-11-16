# TASK-PROTO-U4-1a — service model extension: item attachment flag, service settings, client field mask (DB + config APIs)

Status: AUTHORISED — OD-11 (owner, 2026-11-16). Base: expect `0edf250`.
Governing: `B17_TECHNICAL_SPEC.md` §7.1 (versioned additive changes), OD-07 (one generic model), OD-11 (roles/link/posture), `STYLE_CONTRACT.md` (no UI in this unit).

## 1. Model (additive, idempotent `IF NOT EXISTS` DO-blocks)
1. `items.attachment_required BOOLEAN NOT NULL DEFAULT false` — mandatory attachment for non-`file` answers (consumed by U4-1b rules; model only here).
2. `services.settings JSONB NOT NULL DEFAULT '{}'::jsonb` — per-service rules/settings container (handler size cap 8 KB; no deep schema).
3. `client_services.client_field_mask JSONB NULL` — array of field names hidden from the CLIENT (C) for that client-service; allowed values whitelist: `hint, priority, weight, esg_class, reference, topic, objective, sort_order`.
**Fingerprint discipline:** the three structure constants are re-measured on own fresh scratch after the columns exist (falsifiability: dropping them restores the previous md5). Tera runs the live one-transaction migration + ledger updates.

## 2. APIs
- `PATCH /services/:id` (existing P route): accepts `settings` (plain object; reject non-object/serialized size > 8 KB → 400 `service.settings_invalid`); existing audit stays.
- `PATCH /clients/:id/services/:serviceId` (existing P@T row): accepts `clientFieldMask` (array of whitelist values; unknown/dupes rejected → 400 `service.mask_invalid`); audited.
- **NEW** `PATCH /workspace/services/:serviceId/visibility` — **W only** (consultant bound to A): validates the service is linked to A; same mask validation; audit `CLIENT_SERVICE_VISIBILITY_UPDATED`; registry +1 declaration (W). No P/C/E.
- **C-read masking (server-enforced):** every C-context item projection strips masked fields for that client-service (a single helper; enumerate the endpoints you cover — at minimum `GET /items` and any queue/evaluation item projections — and state them). Masked fields never leave the server for C. E and W unaffected; P unaffected.
- `attachment_required` is returned in item projections (P/W/E); C may show it unless masked? — treat as maskable? Decision: **not maskable** (it is a work requirement, not an internal scoring column).

## 3. Targets
`src/db/schema.sql` · `src/db/b17Readiness.ts` (3 constants) · `src/server/taxonomy.ts` (settings on PATCH service) · `src/server/routes/adminClients.ts` (P mask field) · **new** `src/server/routes/serviceVisibility.ts` (W route) · `src/server/routes.ts` (mount) · `src/server/accessRegistry.ts` (1 W declaration) · `src/server/scope.ts` or a small helper for masking · `src/lib/*.test.ts` (new tests + enumerated pins) · `scripts/u41-*.ts` (own scratch proof, optional). Forbidden: styles/UI/views, other routes beyond the masking application points you enumerate, b17.sql, b17ContentMigration.ts, deps, `.env`, live DB, control docs.

## 4. Evidence
Unit + scratch: mask normalization/whitelist, W route link-check + 403s, P route validation, C redaction on every enumerated projection (assert stripped), settings cap, defaults, fingerprint falsifiability. lint/tests/build. `git status` = ratified set. Tera: live migration + boot + live checks (W sets mask → C sees stripped fields; P unaffected).
## 5. Reviews
QA (execution) + Shield (visibility redaction is security-relevant) after landing. Rounds 2.
## 6. فهم القرار
فهمي: نوسّع النموذج العام بثلاث إضافات فقط؛ المستشار يضبط ما يراه العميل، والعميل لا يستلم أصلاً ما مُنع عنه.
الافتراضات: النموذج العام (OD-07) كافٍ؛ لا جداول لكل خدمة؛ القناع خدمي بحت.
ما سيكشفه القبول: أن التحكم في الأعمدة حقيقي على الخادم لا تجميلي، وأن النموذج يقبل إلزامية المرفق وإعدادات الخدمة.

## 7. COMPLETE — accepted for local integration (2026-11-16)
- Round 1+2: three additive columns (items.attachment_required, services.settings, client_services.client_field_mask), constants re-measured with falsifiability, PATCH /services/:id settings (≤8KB), P@T mask writer, **W-only visibility route** (PATCH /workspace/services/:serviceId/visibility, exact-body {clientFieldMask}, handler is the column guard), ONE narrow policy (17_consultant_service_visibility), and **server-side C redaction** across every enumerated item projection. Round 2 closed QA FAIL (links projection missing ttachment_required; masked keys now deleted not null) and Shield fail-open (malformed mask ⇒ hide ALL maskable).
- **Live migration (Tera), two attempts — lesson recorded:** attempt 1 rolled back cleanly because (a) ledger UPDATE is INSERT-only policy + needs superuser (RLS blocked app role → 0 rows), and (b) the supplied policy-count postcondition (5) was an unmeasured assumption (live had 7). Attempt 2 ran as superuser: columns added, policy created, ledger = U1 structure 99455c0b…, U2D structure 6f67b44d… + checksum 2e07a7c1…; boot green. **Rule:** live DDL/ledger runs as superuser; owner-guard blocks only owner-role runs; never assert object counts without measuring them.
- **Live proof:** W sets mask [weight,esg_class] → C GET /items returns WITHOUT those keys; P unaffected; mask reset via P → keys return; C 403 on the W route; stale generation refused (409) as designed.
- **QA: FAIL → PASS (recheck, mutants detected)** · **Shield: 0 High / 0 Medium / 3 Low** (all closed or recorded).
- Accepted residuals: 422 incomplete-index path carries no maskable field today (revisit when reports gain service columns); ttachment_required snake_case inside links payload (consistent with /items); dedupe of stored mask duplicates is harmless. Deferred by design: ttachment_required writer + submit rules = U4-1b.
- Round cap 2 used. No push.
