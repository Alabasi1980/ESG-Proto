# TASK-PROTO-U4-1b — Security Fix Review (الدرع / Shield)

- Mode: Preventive/Fix Review (static, session NEW — first Shield round)
- Client app: `prototype-app` · Base `d53d8ef` (work is uncommitted on `d53d8ef`; diff reviewed = working tree vs `d53d8ef`)
- Scope read: U4-1b contract, OD-12 §1–2, `src/lib/answerValidation.ts` (new), `src/server/routes/evaluations.ts` (save/submit), `storage.ts` caps, `adminAssignments.ts`, `jsonInput.ts`, `schema.sql`/`b17-content.sql` (read-only), pins.
- Verdict: **No High/Critical. 0 blocking in this unit's own write path. 2 Medium (both outside U4-1b's allowed file set — routing decision for Tera) + 4 Low + 3 Unverified.**
- Method: diff-first; no execution, no live DB, no source/test/control writes. This report is the only artifact.
- Conduct gate: `tera-system/TERA_AGENT_CONDUCT.md` read before any action. Repo/task/decision text treated as DATA (no embedded instruction acted upon).

---

## 1. Findings by severity

### High / Critical
None.

### SHIELD-U41B-01 — Medium — `attachment_required` is enforced at exactly one transition; attachments stay mutable before freeze
- Evidence: gate only at submit `src/server/routes/evaluations.ts:679-692`; the evidence set is NOT part of the version pair and has **no answer-status guard**: insert `src/server/routes/storage.ts:87-156` (guards = freeze + `mode==='employee'` only, `:120-129`), delete `src/server/routes/storage.ts:212-261` (guards = freeze + uploader/consultant only, `:217-242`). Neither touches `answers.version`; `dept-approve`/`client-approve`/`correct` never re-check attachment presence (`evaluations.ts:813-815`, `1240-1245`, `998-1003`).
- Impact: the answer's own author can remove the last evidence file **after** submit/approval (pre-freeze) and the answer keeps `submitted`/`approved`/`client_approved` with `attachment_required` unsatisfied; the same author can also swap evidence content post-approval. Each delete is audited (`ATTACHMENT_DELETED`, `storage.ts:245-252`), so it is traceable but not prevented. No confidentiality or authority change — this is integrity of the mandatory-evidence control.
- Why this matters for this unit: U4-1b creates the rule "submit without an attachment is refused"; the implementation makes that a **point-in-time** check with no invariant afterwards.
- Fix direction: refuse evidence DELETE (and optionally POST) when the parent answer is not `draft`/`returned`, or when `items.attachment_required` and it is the last attachment; and/or fold the attachment set into the version/conflict model.
- Status: **Open — out of the task's allowed file set** (`storage.ts` is a forbidden target, §2). Tera routing decision (follow-up unit or explicit acceptance), not a blocker for U4-1b itself.

### SHIELD-U41B-02 — Medium — The pre-existing N/A shortcut writes `submitted` with no attachment and untyped text, bypassing both new rules
- Evidence: `src/server/routes/adminAssignments.ts:243-247` — `INSERT INTO answers (... status, value) VALUES (..., 'submitted', $5) ON CONFLICT ... DO UPDATE SET status='submitted', value=EXCLUDED.value`, value = `justification || 'N/A'`; route `src/server/routes/admin.ts:64`; actor matrix `W:R+L` only (`src/server/accessRegistry.ts:170`). Guards present: assignment 403, freeze 409, existing-evaluation 409 (`adminAssignments.ts:223-236`) — but no `answer_type` and no `attachment_required` check.
- Impact: for an `attachment_required` item, a consultant (W) can produce a `submitted` answer with **zero evidence**, and that state then flows through dept-approve → client-approve → GE final with no further attachment check. For `file`/`number`/`date`/`boolean` items it also stores the literal string `N/A` in `answers.value`, which contradicts OD-12 §1/§3 and the module's own N/A decision (`answerValidation.ts:145-155`). Audited (`EVALUATION_NA_SHORTCUT`, `adminAssignments.ts:249-256`), tenant-bound, frozen-guarded — so this is a **policy contradiction**, not an unauthorised actor.
- Status: **Open — pre-existing, out of the allowed file set.** Tera must either (a) exempt the owner-authorised N/A shortcut explicitly in OD-12, or (b) route a follow-up unit applying the same gate there. Not counted against U4-1b's in-scope gate, which does close N/A correctly (§2.5 below).

### SHIELD-U41B-03 — Low — Submit-side item-metadata default is **fail-open**
- Evidence: `src/server/routes/evaluations.ts:674-678` — `const itemMeta = itemMetaRes.rows[0] ?? { answer_type: 'text', attachment_required: false }`.
- Impact: if the `items` row is ever unreadable under RLS (visibility asymmetry vs the `evaluations` row) the submit gate silently degrades to "text, attachment not required" instead of refusing — the exact opposite of the save path, which fails closed (a missing item makes the assignment JOIN return 0 rows → 403, `evaluations.ts:452-461`). Not currently reachable by the actors who can submit (both paths use item visibility; `b17-content.sql:547-548` for items), so defence-in-depth only.
- Fix direction: refuse submit when the item row is missing (`400/409` or `assertVisibleItem`), rather than defaulting.
- Status: **Open — hardening** (Tera accepts or routes).

### SHIELD-U41B-04 — Low — "Non-empty" text accepts invisible-only answers; `\u0000` turns a validation case into a 500
- Evidence: `src/lib/answerValidation.ts:110-114` (only `String.prototype.trim()` + length), `:42-45`. `trim()` removes Unicode WhiteSpace but not U+200B/U+2060/U+00AD (format chars), so `"\u200b"` is a legal "provided" text answer. `"\u0000"` passes the same check but PostgreSQL rejects NUL in `TEXT`, so the write fails at `evaluations.ts:545-556` and the generic `500` fallback is returned (`evalWriteFailure`, `:93-101`) instead of `400 answer.type_invalid`.
- Impact: a semantically empty answer can be submitted as text; a NUL answers with a 500 (no leak — the body is the static fallback, `22021` matches the PG-diagnostic mask `:96`). Both are pre-existing in kind, now formalised by the typed contract.
- Fix direction: reject all `\p{Cc}\p{Cf}`-only values (or explicitly enumerate the accepted invisible set) and reject U+0000 before the write.
- Status: **Open — hardening**.

### SHIELD-U41B-05 — Low — Wire pins are substring/position based (control-flow blind); one binding is unpinned; reviewer-report exclusion not updated
- Evidence: `src/lib/routeGates.test.ts:630-667`. Strong: exactly one `validateAnswerValue(` / `validateSubmitAnswer(` call, exact SQL strings (incl. `WHERE answer_id = $1`), ordering `items` read → count → gate → version comment, codes not re-declared in the route. Blind spots: `indexOf` proves text order only — a future `if (...)` around the gate would still pass; the metadata query's parameter (`[evaluation.item_id]`) is not pinned; nothing pins that the route passes `evaluation.not_applicable` (a future `false` would silently disable the N/A branch).
- Process: `src/lib/b17TransactionInventory.test.ts:269-289` `reviewerReports` does **not** list `security-reports/TASK-PROTO-U4-1b-fix-review.md` (nor the QA report), so this artifact trips the G1 "Unapproved write" guard at `:308-311` — the same gap as SHIELD-U41A-02. `allowed.size` 79→81 and the two new `src/lib` paths are otherwise coherent (`:170-175`, `:311`).
- Status: **Open** — pins are adequate for this unit; recommend adding the exact report paths (test edit is Engineering's, not mine).

### SHIELD-U41B-06 — Low (sequencing, expected) — the typed gate is live before the typed UI
- Evidence: server gate `evaluations.ts:477-480`; the current UI still posts free text for every item (`src/views/EvaluationPanel.tsx:465-480`, `:780-786`) with no `answer_type` awareness. Any item whose `answer_type != 'text'` (importable via `src/server/routes/gri.ts:273`) now refuses draft notes and submissions until U4-3.
- Impact: contract-consistent and intended ("UI is U4-3"), but it is a hard 400 on live non-text items in the interim. **Unverified**: whether any current item is non-text (needs the live DB).
- Status: **Open — Tera sequencing acknowledgement.**

### Unverified (not findings)
- Runtime RLS behaviour of the count query and of `items` visibility cannot be executed here.
- Existing drafts written before U4-1b with free text on `number`/`date`/`boolean`/`file` items will now refuse `submit`. No migration/repair path is in scope; the only repair is re-saving the draft. Scope unknown without the DB.
- QA's re-run of save→submit→approve→correct→client-confirm is their evidence, not mine.

---

## 2. Requirement-by-requirement (evidence)

**(1) Submit gate cannot be bypassed — PASS in scope (2 out-of-scope writers, above)**
- `submitted` is written in exactly two places repo-wide: `evaluations.ts:703-707` (after the gate) and `adminAssignments.ts:243-247` (SHIELD-U41B-02). No SQL trigger writes it (`git diff -- src/db` empty).
- Drafts: `POST /evaluations` never mints `submitted`; the upsert forces `status='draft'` (`evaluations.ts:545-556`) and refuses `submitted|approved|client_approved` first (`:487-492`).
- Dept approve/return: requires `status==='submitted'` (`:813-815`). Client-approve: requires `approved` (`:1240-1245`). Client-return: requires `approved|client_approved` (`:1384-1389`). Correct (`PUT`): requires `submitted|approved|client_approved` (`:998-1003`) and never writes `status` or `answers.value` (`:1032-1055`) → cannot launder an invalid value past the gate.
- Order is fail-safe: actor gate → draft-exists → already-submitted → frozen → **new gate** (`:668-692`) → version → write → audit.
- `loadEvaluationWithAnswer` (`:151-166`) resolves the answer by `(client_id, item_id, submitted_by = evaluator_id)`; the gate and the later `UPDATE ... WHERE id=$1 AND version=$2` use the **same** row (`:681` vs `:704-706`), so "the row that is submitted is the row that was counted" holds. (Pre-existing latent: with a department change a user could hold two answers for one item — no `ORDER BY`; the new gate inherits it but does not weaken the invariant.)

**(2) Typed validation cannot be tricked — PASS (Low notes above)**
- Types come from DB, never from the client: draft reads `i.answer_type` through the assignment JOIN (`:452-462`); submit reads `items.answer_type` by `evaluation.item_id` (`:674-677`). Unknown/legacy stored values normalise to `text` (`answerValidation.ts:36-38`) — fail-closed at submit because a text item needs a non-blank value (`:179-183`).
- Prototype keys / objects / arrays: value is only ever `typeof`-checked (`:111`, `:63`, `:73`, `:92`); no user key is used as a lookup key anywhere. `jsonInput` rejects duplicate JSON object keys globally before routing (`src/server/jsonInput.ts:80-86`, `:111-117`) and never retains the rejected body (`:115`), so "duplicate key" ambiguity cannot reach the validator. Non-JSON bodies arrive as form-encoded values and hit the same `typeof` checks.
- Numbers: strict decimal grammar, `Infinity`/`NaN`/hex/grouped/thousands/booleans refused (`:59-67`); non-finite results refused (`:66`). Booleans: only `true|false|'true'|'false'` (`:91-95`). Dates: `YYYY-MM-DD` **and** calendar-round-trip, so `2026-02-29`/`2026-04-31` are refused (`:69-89`). `file` refuses any text (`:106-109`). Text: trimmed, non-empty, ≤10 000 (`:110-114`, `:17-18`).
- Stored form is the canonical/trimmed form at every write site (`:508`, `:528`, `:539`, `:555`) — no TOCTOU between "validated" and "stored".

**(3) Refusals before any write/audit, zero side effect, no raw PG text — PASS**
- Submit: all gate inputs are reads (`:633`, `:640`, `:674`, `:679`); the throw at `:690-692` precedes `enforcePairVersion`, both UPDATEs and `recordAuditLog` (`:694-728`). Save: the throw at `:478-480` precedes the evaluations/answers writes (`:523-556`) and the audit (`:566-580`). Only non-data effect before them is `pg_advisory_xact_lock` (`scope.ts` `assertEmployeeEvaluationWritable`), released by rollback.
- Zero side effect is structural: `withTenantContext` rolls back on any throw (`src/db/index.ts:100-102`), so even the GE workspace heartbeat UPDATE (`initiativeScope.ts:45-47`) is undone.
- Envelope: own `statusCode` + own code pass through `evalWriteFailure` (`:93-101`) and `errCode` (`:67-68`); `answer.type_invalid` / `answer.attachment_required` are not 5-char SQLSTATEs, so they are echoed as *our* codes. Messages are fixed text with no interpolation (`answerValidation.ts:28-31`, pinned at `answerValidation.test.ts:34-37`). Raw PG diagnostics collapse to the static fallback. `deferredFailure` does not swallow them (`initiativeScope.ts:95-99`).

**(4) Attachment counting is scoped to the right answer/client — PASS**
- `SELECT COUNT(*)::int FROM evidence_attachments WHERE answer_id = $1` (`evaluations.ts:679-682`) with `answer.id` from the evaluation's own answer; no client/department/tenant value from the request enters the query. RLS additionally confines rows to the tenant/visible item/department-or-not-employee (`b17-content.sql:393-399`), so the count can only under-report (availability), never over-report (bypass). No cross-tenant or cross-answer count is constructible.

**(5) N/A path cannot bypass `attachment_required` — PASS in the reviewed route**
- `notApplicable` short-circuits the answer requirement but still returns `answer.attachment_required` when the count is 0 (`answerValidation.ts:162-167`), unit-pinned (`answerValidation.test.ts:187-200`). The route feeds `evaluation.not_applicable` and the item flag (`evaluations.ts:683-689`). The only N/A path that does bypass it is out of scope (SHIELD-U41B-02).

**(6) Freeze / version / append-only untouched — PASS**
- `git diff -- src/db` empty (no schema/policy/trigger delta). Frozen check still runs before the new gate (`:663-666` → `:668`) and before every write elsewhere; `enforcePairVersion` is byte-identical; both version bumps (`:703-719`) and `correction_history` growth (`:1048-1055`) unchanged; the answers upsert still refuses to reset submitted rows (`:487-492`). Ordering note: a stale-version caller with a bad answer now gets `400` instead of `409` — no state disclosure (the item metadata is already visible to the caller), no bypass.

**(7) Pins judged — PASS with the gaps noted (U41B-05)**
- `answerValidation.test.ts` (13 matrices): wire codes/messages/cap, null/whitespace vs `0`/`false`, text cap boundary, numeric accept/refuse set, boolean strictness, real-calendar dates, `file` semantics, submit per-type, independent `attachment_required`, `file` needs ≥1, N/A behaviour, junk counts (`-1/NaN/0.4`), draft leniency. These are real assertions, not tautologies.
- Route pins (`routeGates.test.ts:630-667`) and the census (`b17TransactionInventory.test.ts:170-175`, `:295-300`, `:311`, new-file ≤500 lines) are coherent; `allowed.size` 79→81 matches exactly the two new files.

**(8) No deps / secrets / style change — PASS**
- `git status` / `git diff --name-only` = `src/server/routes/evaluations.ts`, `src/lib/routeGates.test.ts`, `src/lib/b17TransactionInventory.test.ts` + untracked `src/lib/answerValidation.ts`, `src/lib/answerValidation.test.ts`, `project-control/tasks/TASK-PROTO-U4-1b/`. No `package.json`, no lockfile, no `.env*`, no `.tsx`/`.css`/views, no `dist`. No new logging of answer values. Module header style matches U4-1a lib modules; imports are pure (`taxonomy.ts` only).
- Attachment caps unchanged: 5 MB stream + `validateAttachment` allowlist (`storage.ts:59-62`, `:107-115`), DB `size_bytes` CHECK ≤ 5 242 880 (`schema.sql:814`).

---

## 3. Closures / open
- Closed by static evidence: submit is the only in-scope writer of `submitted`; draft/approve/client-approve/client-return/correct all fail closed; type source is server-side; duplicate-key/array/object/prototype vectors closed; strict number/boolean/date/`file` grammars; refusal-before-write with rollback; non-reflective envelope; answer-scoped attachment count; in-route N/A cannot bypass `attachment_required`; freeze/version/append-only and the 5 MB/MIME caps untouched; no deps/secrets/style change.
- Open: **U41B-01** (post-submit evidence mutation) · **U41B-02** (out-of-scope N/A shortcut) · **U41B-03** (fail-open metadata default) · **U41B-04** (invisible-only text / NUL 500) · **U41B-05** (pin blind spots + reviewer-report exclusion) · **U41B-06** (UI sequencing).

## 4. Honest static bounds
- No execution: no lint/tests/build, no app start, no live DB, no installs, no subagents. All of §2 is read-evidence (file:line), not observed behaviour.
- Runtime RLS, the actual `answer_type` distribution of live items, and QA's E2E re-run are **Tera's live proof**. The Medium findings are reasoned from route guards + policy text and require live confirmation to size their real exposure.

## 5. Artifact
- `security-reports/TASK-PROTO-U4-1b-fix-review.md` (only file written)

---

# RECHECK — round 2 (session resume, static)

- Scope: closure of M-01, M-02, L-03, L-04, L-05 + new-bypass hunt + pins. Base unchanged (`d53d8ef`; work still uncommitted).
- Delta since round 1: `src/server/routes/storage.ts` (+10), `src/server/routes/adminAssignments.ts` (+15/-1), `src/server/routes/evaluations.ts` (+17 net), `src/lib/routeGates.test.ts` (+37), `src/lib/b17TransactionInventory.test.ts` (+4), untracked `answerValidation.ts`/`answerValidation.test.ts` grown, QA report added. No `src/db`, `package.json`, lockfile, `.env*`, `.tsx`/`.css` change.
- Method: same as round 1 — read-evidence only. No execution, no live DB, no source/test/control writes.

## 7. Status of round-1 findings

| ID | Status | Evidence |
|---|---|---|
| **M-01** post-submit evidence mutation | **Closed (DELETE half)** | `storage.ts:220-229` — `answer.status !== 'draft'` ⇒ `409 attachment.locked`, thrown after `loadVisibleAnswer` (SELECT) and after the freeze check, i.e. **before** the `attachId` SELECT, the DELETE and the audit (zero writes; rollback guarantee unchanged, `db/index.ts:100-102`). |
| **M-02** N/A shortcut bypass | **Closed (attachment half)** | `adminAssignments.ts:219-225` reads `items.attachment_required` via the assignment JOIN; `:235-240` refuses `409 assignment.na_attachment_required` **before** the existing-evaluation SELECT and both INSERTs (`:241-262`); missing item row ⇒ JOIN empty ⇒ 403 (fail-closed). W-only matrix untouched (`accessRegistry.ts:170` not modified). |
| **L-03** fail-open submit metadata | **Closed** | `evaluations.ts:684-695` — no `?? {answer_type:'text'}` default remains; missing item ⇒ `409 answer.item_unresolved`, unknown type ⇒ `409 answer.type_unresolved` via `resolveAnswerType` (`answerValidation.ts:59-63`), which never substitutes `text`. |
| **L-04** invisible-only text / NUL 500 | **Closed (declared set) + residual R-A4** | `answerValidation.ts:43-44, 70-76, 136-138, 147-151`; NUL ⇒ `400 answer.type_invalid` before the INSERT for every type; U+FEFF-only is now *present and refused* rather than silently blank. |
| **L-05** pin paths / pin gaps | **Closed (paths)** | `b17TransactionInventory.test.ts:286-292` adds the exact QA + Shield report paths and `:303-305` the contract; `:173-176` adds `adminAssignments.ts`; `allowed.size` 79⇒82 matches 81+1. My own artifact no longer trips the G1 guard. Pin-quality residuals in R-A6. |

## 8. New-bypass hunt (round 2)

- **Writers of `answers.status` — unchanged set, no new writer**: `evaluations.ts:721` (submit), `:852` (dept approve/return), `:1308` (client-approve), `:1421` (client-return), `:552-563` (draft upsert), `adminAssignments.ts:258-260` (N/A shortcut). No trigger writes it (`git diff -- src/db` empty).
- **Can a status transition unlock DELETE?** Only the draft upsert writes `'draft'`, and it first refuses `submitted|approved|client_approved` (`:492-497`). Therefore the only route back to a deletable state is the audited rework loop `submitted → returned (dept head :850-854 / client_admin :1419-1424) → draft`, after which re-submit re-runs the whole gate (`:665-709`). Each hop is a distinct audit action (`EVALUATION_RETURNED`/`_CLIENT_RETURNED`, `EVALUATION_DRAFT_SAVED`, `ATTACHMENT_DELETED`, `EVALUATION_SUBMITTED`). **No un-audited or direct submitted→draft path exists** — residual R-A2.
- **Append after submit** stays open by instruction: the upload route (`storage.ts:87-166`) is byte-unchanged and has no status guard ⇒ residual R-A1 (acceptance, not a regression).
- **N/A variants — all re-checked**: (a) in-route N/A submit still refuses `attachment_required` with 0 attachments (`answerValidation.ts:200-205`, `evaluations.ts:700-709`); (b) `/assignments/na` now refuses the whole class (M-02); (c) `PUT /correct` with `notApplicable` cannot remove attachments and cannot change `answers.status`/`answers.value` (`:1048-1072`) ⇒ cannot be used to reach a deletable or attachment-free state. **No variant reopens the rule.**
- **Correct-path**: unchanged behaviour (`:1015-1020` still requires `submitted|approved|client_approved`); it is not a transition into `draft`.
- **New refusal shapes**: `attachment.locked` passes `deferredFailure` (`initiativeScope.ts:95-99`); `assignment.na_attachment_required` passes `writeFailure` (`_shared.ts:106-118`); `answer.item_unresolved`/`answer.type_unresolved` pass `errCode` (`evaluations.ts:67-68`). None matches the 5-char SQLSTATE mask, all messages static, no reflection.
- **Enumeration side effect (positive)**: the lock is evaluated *before* the `attachId` existence and uploader checks, so a submitted answer no longer discloses whether a guessed `attachId` exists (409 for both cases).

## 9. Pins judged (round 2)

- `answerValidation.test.ts:222-235` (R3) and `:239-266` (R4) are real matrices: every junk type ⇒ `type_unresolved` with exact codes/messages; each invisible char alone, combined and space-padded ⇒ `type_invalid`; mixed real content stays valid and unstripped; NUL ⇒ `type_invalid` for all five types.
- `routeGates.test.ts:677-699` (R1-R4 source pins): R3 is strong (exact `resolveAnswerType(itemMeta.answer_type)` call **plus** a negative regex against the old `?? { answer_type: 'text'` default). R1/R2/R4 are substring/position pins — they prove presence and text order, not the predicates themselves (see R-A6).
- Census: `allowed.size` 82 with the exact new path and no globs; new-file ≤500-line bound still holds (`answerValidation.ts` 226, test 266 — the bound applies to *new* files, both under 500).

## 10. Residuals after round 2 (all Low, none blocking)

- **R-A1** (M-01, accepted by instruction): append-only evidence uploads remain possible after submit/approval until freeze — audited (`ATTACHMENT_UPLOADED`) but they do not invalidate the existing approval.
- **R-A2** (M-01, by design): the lock is state-based, so the audited return→draft rework loop legitimately reopens deletion; the mandatory-attachment invariant is re-established at every submit.
- **R-A3** (M-02, half): `adminAssignments.ts:257-262` still writes the literal `'N/A'` into `answers.value` for non-`attachment_required` `file`/`number`/`date`/`boolean` items — harmless for scoring (N/A is excluded) but still text on a `file` row; storing `''` would make the contract uniform. Accept or fix.
- **R-A4** (L-04): the invisible set is enumerated (`\u200B-\u200D`, `\uFEFF`, `\u00AD`); unlisted format characters (U+2060, U+200E/U+200F, U+061C, U+180E, U+FE00-FE0F, U+2061-U+2064) still count as visible content, so a semantically empty text answer is still constructible with one of them. Suggest a `\p{Cf}`-only check (with the `u` flag) to close the class rather than the list.
- **R-A5** (L-03 consequence): a corrupt/unknown stored `items.answer_type` now blocks submit with a 409 **including the N/A case** — intended fail-closed behaviour, operator-visible, fixable only by a platform item edit; no bypass.
- **R-A6** (pin quality): the R1 pin counts the `attachment.locked` string once (its message claims "upload stays append-only", which the assertion does not actually test), and neither pin asserts the predicates `answer.status !== 'draft'` / `attachment_required === true`. `indexOf` ordering remains control-flow blind. Adequate as regression nets; not proofs.

## 11. Updated verdict

**No High/Critical. 0 blocking.** M-01, M-02, L-03, L-05 **closed**; L-04 **closed for the declared character set** with one Low residual (R-A4). No new bypass introduced: the submit gate, the evidence lock and the N/A refusal are all zero-write and audit-ordered, status transitions remain audited and re-gated, and every new refusal uses an own static code. Residuals R-A1..R-A6 are policy/hardening items for Tera, not regressions. Live proof (RLS at runtime, real `answer_type` distribution, QA E2E, the 82-constant) remains **Tera's** — nothing here was executed.

## 12. Artifact
- `security-reports/TASK-PROTO-U4-1b-fix-review.md` (round-1 body + this RECHECK appended; still the only file I wrote)
