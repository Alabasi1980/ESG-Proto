# Shield defensive review — TASK-PROTO-U4-1c-PROTECT-SEC2 (round-3 archive-flag revision)

Mode: Preventive Review (static + source reasoning; NO live DB, NO scratch execution, no secrets).
Session NEW independent reviewer. Conduct gate: `tera-system/TERA_AGENT_CONDUCT.md` read and passed.
Inputs: task `TASK-PROTO-U4-1c.md` §§7–21 + delta `B17_U41C_PROTECT_TECHNICAL_DELTA.md` §§1–8;
`prototype/TECHNOLOGY_PROFILE_DRAFT.md`; `prototype/OWNER_DECISIONS.md` OD-07/11/12
(OD-13 still absent on disk — reference gap only, no verdict impact);
working-tree diff vs HEAD `4eb36e9` read directly (no test/DB run by this reviewer).
Prior: SEC1 (round 2 SET NULL), QA `TASK-PROTO-U4-1c-PROTECT-QA.md` (describes SUPERSEDED round-2
SET NULL + 409 `initiatives.unselected` — stale vs current tree, see S-01), AUD01 CONDITIONAL PASS (round 1/2 basis).

## Verdict summary

RISK_SIGNAL maintained. 0 High · 1 Medium · 3 Low · S-01 process flag. No PASS issued (auditor owns the gate).
Round 3 (owner §20 archive-flag + §21 single UPDATE policy) resolves SEC1 H-01 (no detached rows:
link back to NOT NULL + named RESTRICT; unselect archives in place; lists re-list archived with history).
Residual: evidence upload/delete do NOT check the archived flag (M-01). Version/conflict, wording,
audit, and grant boundaries verified statically as sound within stated bounds.

## Findings

### M-01 — Evidence upload/delete ignore the archived flag (status PATCH refuses, evidence does not) [MEDIUM]
- Evidence: `documents.ts` upload (~420–441) and delete (~508–528) resolve `evidenceAnchor` and
  `loadEvidenceParent` with NO `archived_at IS NULL` predicate, while status PATCH
  (`departmentInitiatives.ts` pre-lock + post-lock reread) binds `archived_at IS NULL` and fails closed 404.
  An E can therefore append/delete (unsubmitted) proof against an archived selection whose status row
  itself is read-only. Tenant + own-department + uploader + submitted-lock checks stay intact, so blast
  radius is own-dept integrity only (appended proof reconnects on reselect — no loss, no exfil).
- Suggested: Tera/Majed decision — either add the same active-selection predicate to the evidence
  anchor/reread (preferred, no new wording: existing 404), or explicitly accept append-on-archived
  as intended. Do not silently leave the two writers inconsistent.

### L-01 — Version-shape checked before role gate (fail-closed, pre-existing pattern) [LOW]
- Evidence: both PATCH routes run `validateSubmissionPatch`/`parseExpectedVersion` BEFORE
  `ownEmployeeDepartment` inside the transaction. A denied role (W/C/P) sending a malformed version
  gets 400 `version.required` instead of 403. Conflict fields are null; no data disclosed; direction safe.
- Suggested: accept as-is (matches SEC1 P-01 disposition), or reorder role-check first — STOP for decision
  since it touches both routes.

### L-02 — No freeze check on status/submission/evidence writes (pre-existing, unchanged) [LOW]
- Evidence: `isFrozenScope` gates POST/DELETE select (`initiatives.ts`) but no check exists in either
  PATCH or evidence paths — identical in HEAD baseline, no round-3 widening.
- Suggested: state freeze boundary explicitly (selection-level only) or open a separate unit.

### L-03 — RESTRICT backstop is selection-link-only; ancestor cascades remain [LOW]
- Evidence: `schema.sql` named `initiative_department_status_selection_restrict` + NOT NULL; client/library/
  department-level `ON DELETE CASCADE` paths untouched (delta §4 admits). No code claims otherwise.
- Suggested: keep as stated scope; ancestor-delete inventory stays a later-activation obligation.

### S-01 — PROCESS FLAG (not a code finding): QA PROTECT-QA report describes superseded round-2 behavior
- Evidence: `TASK-PROTO-U4-1c-PROTECT-QA.md` criteria assert SET NULL + 409 `initiatives.unselected`;
  current tree archives in place, asserts the notice text ABSENT, and returns baseline 404.
  Round-3 code therefore has NO matching independent QA execution on record.
- Suggested: fresh QA execution against the round-3 tree before any acceptance; do not cite the old PASS.

## Explicit judgments requested

(a) Authorization boundaries unchanged except approved scope: YES. `accessRegistry.ts` zero diff;
  `b17-content.sql` carries ONLY the §21-approved `b17_selection_update` hunk, USING/WITH CHECK
  textually identical in scope to `b17_selection_delete` (W-consultant + own-tenant + linked service).
  `ownEmployeeDepartment` refuses W/C/P with zero writes on all three write surfaces; tenant proved via
  server-bound `domainTenant`/joins, never request-derived.
(b) FK RESTRICT/SET NULL backstop + ancestor-delete limits: SOUND AS SCOPED. Link is NOT NULL + RESTRICT;
  round-2 SET NULL name dropped where present; fresh/upgrade converge in one guarded DO-block. Ancestor
  (client/library/department) deletes NOT covered — explicitly out of scope, no finding beyond L-03.
(c) Advisory anchor ownership/key normalization: SOUND. `u41cProtectKey` (`initiativeScope.ts`) validates
  both UUIDs via case-insensitive `scopeId`, lowercases, fixed `u41c-protect:v1:<kind>:<tenant>:<resource>`
  with closed kind set; resource is library-initiative or requirement ID — never selection-row/service/
  user/department ID. POST select, unselect, status, evidence share the one anchor; post-lock rereads bind
  the SAME original selection ID + tenant + library ID (ABA-safe, no redirect).
(d) Version/conflict, no silent overwrite/retry: SOUND STATICALLY. Missing/non-integer/negative/overflow
  → 400 `version.required` (baseline evaluations wording); mismatch → conditional single-row UPDATE,
  loser sees zero rows → 409 `version.conflict` with approved Arabic + numeric-only conflict payload after
  full authorization. `api.ts` retries ONLY `workspace.stale/invalid` once — never `version.conflict`.
  Evidence mutations still carry no revision (delta §4 boundary, accepted as design — no silent overwrite).
(e) Exact approved wording, no foreign-data/SQL leakage: SOUND. Stale message byte-identical to §13 in both
  PATCH routes; missing-version baseline exact. Round-2 `initiatives.unselected` notice retired per owner
  §20 (archive/refresh replaces it) — tests assert absence; no new user-visible text introduced.
  `domainFailure`/`writeFailure` strip SQLSTATE/diagnostics; conflict payloads carry revision numbers only.
(f) Audit integrity: SOUND. All state changes audit in-transaction with expected/current versions;
  refusals (403/409) write no audit (no phantom trail); idempotent already-archived unselect returns 200
  with no audit (documented, no state change). No orphan-count claims.
(g) No new grants/privileges/bypass: CONFIRMED STATICALLY except the one §21-approved UPDATE policy.
  No bypass-RLS, no definer change, no new dependency, no secret in diff.

## Positive controls (verified statically)

- Tenant-bound evidence parent (selection + department joins); download stays tenant/dept-gated by file row.
- Pre-lock liveness + post-lock same-ID revalidation on both PATCH routes; reselect reactivates SAME ID.
- `archived`/`ownVersion`/`version` list exposure is tenant-scoped; W/C/P never receive another dept's ownVersion.

## UNVERIFIED items (explicit — no live run by this reviewer)

Runtime race outcomes; real-router ABA under separate sessions; deployed-role/ACL equivalence (surrogate-role
evidence only); installed/live orphans; fresh-vs-upgrade migration + ledger parity; pool-max-5 deadlock;
silent-200-without-archive runtime proof (§21 obligation); UI display of `archived` flag + refresh behavior;
evidence-on-archived runtime interleave; hash-collision behavior; MIME/5 MB exhaustive; performance.
QA staleness (S-01) means round-3 behavioral claims currently rest on pins + static reasoning only.

## STOP / ASK (needs Tera/Majed decision)

1. M-01: refuse evidence writes on archived selections (one-predicate change) or accept append-on-archived — blocks acceptance.
2. S-01: order FRESH QA execution on the round-3 tree; do not accept on the superseded round-2 QA PASS.
3. L-02: confirm freeze stays selection-level-only, or open a separate freeze-extension unit.
4. Confirm idempotent already-archived unselect (200, no audit) is the intended serial semantic.
5. No parent acceptance issued; no live migration, cleanup, commit, deployment, or push authorized by this review.

Artifacts: this file only (`security-reports/TASK-PROTO-U4-1c-PROTECT-SEC2.md`). No source/test/control edits.
