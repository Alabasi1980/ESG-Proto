# QA Report — TASK-PROTO-U4-1b (Execution Mode, independent)

| Item | Value |
|---|---|
| Task | TASK-PROTO-U4-1b — typed answers + independent mandatory attachment (server rules), OD-12 §1–2 |
| Agent | QA Agent — Execution Mode, session NEW |
| Date | 2026-11-16 |
| Base | `d53d8ef` (= `git rev-parse HEAD` in `prototype-app`) |
| Scratch DB | own container `u41b-qa-pg` (postgres:18-alpine, `127.0.0.1:55471`), own role `u41bapp` (NOSUPERUSER / NOBYPASSRLS) |
| Live DB | **not touched**; the running `b17-showcase` container was never used |
| Verdict | **PASS** - 0 code FAIL. 3 LOW + 3 INFO (code) + 1 MEDIUM control-doc encoding finding outside the diff (none blocks acceptance) |

## 1. Independent scope discovery (before any expected-result assumption)

`git status --porcelain` (executor handback state):

```text
 M src/lib/b17TransactionInventory.test.ts
 M src/lib/routeGates.test.ts
 M src/server/routes/evaluations.ts
?? project-control/tasks/TASK-PROTO-U4-1b/         (Tera-owned input)
?? src/lib/answerValidation.ts
?? src/lib/answerValidation.test.ts
```

`git diff --stat d53d8ef` = **3 files changed, +92 / −9**. Deleted lines (complete list, `--unified=0`):
`allowed` set tail line, `allowed.size` assertion line (79 → 81), the removed `const note = …`,
the old `SELECT id FROM assignments …` statement, and the 4 `note`-bearing parameter arrays.
**No assertion was deleted, no matcher was widened, no pin was relaxed** (§7).

Out-of-scope files: **none**. `dist/` (build output) is git-ignored. A Shield-owned
`security-reports/TASK-PROTO-U4-1b-fix-review.md` appeared during my run; I did not write to it.

## 2. Commands and results (all executed, exit codes captured)

| # | Command | Result |
|---|---|---|
| 1 | `node node_modules/typescript/bin/tsc --noEmit` | **exit 0**, no output (lint clean) |
| 2 | `node node_modules/tsx/dist/cli.mjs --test "src/**/*.test.ts"` (full suite) | `# tests 348 / pass 348 / fail 0` → **348/348** (expected) |
| 3 | `node node_modules/tsx/dist/cli.mjs --test src/lib/answerValidation.test.ts` | `tests 13 / pass 13 / fail 0` |
| 4 | `node node_modules/vite/bin/vite.js build` | **exit 0**, `✓ built in 691ms` (chunk-size advisory only) |
| 5 | Pure edge matrix, own scratch (`edges.ts`, 134 checks) | **134/134 PASS** |
| 6 | HTTP E2E over the real router (own scratch, `e2e.ts`, 92 checks) | **92/92 PASS** |
| 7 | Extra probes (`probe8.ts`, 18 checks) | **18/18 PASS** |
| 8 | Wire-pin static audit (independent grep) | see §7 |

Scratch harness bootstrap (why the app answers at all): `schema.sql` → content-inventory
bootstrap → `b17.sql` (`applyB17Offline` → `applied`) → `b17-content.sql` (`applyB17ContentOffline` → `applied`).
This is required because every request passes `assertB17Ready()` + `assertRuntimeRole()`
(a superuser/BYPASSRLS runtime role is refused: `b17.runtime_role_unsafe`). Fixtures were then
seeded as `postgres` (data only — `STRUCTURE_SQL` untouched) and the app ran as `u41bapp`, so
**RLS was live** for every assertion below.
## 3. Criterion 1 — typed validation per `answer_type` (executed)

Pure matrix (own file, not the executor's tests), 134 checks:
`number` accepted 0/−0/42/−42/`+7`/`3.14`/`−0.5`/`.5`/`1e3`/`−2.5E−2`/` 42 `/`Number.MAX_VALUE`;
blank/absent (`''`,`'   '`,`'\t\n'`,undefined,null) = *not provided* (draft-lenient);
refused `0x10`,`0X1F`,`0b101`,`1e`,`--1`,`1.2.3`,`1 2`,`1,000`,`NaN`,`Infinity`,`-Infinity`,`inf`,
`1e999`,`1`×400,`5.`,`true`,false,true,[],{},NaN,±Infinity.
`date` accepted `2026-11-16`,`2024-02-29`,`2000-01-01`,`9999-12-31`,`' 2026-11-16 '`;
refused `2026-02-30`,`2026-02-29`,`2026-04-31`,`2026-13-01`,`2026-00-10`,`2026-1-01`,`2026-01-1`,
`2026-01-32`,`16/11/2026`,`2026/11/16`,`2026-11-16T00:00:00Z`,`2026-11-16 00:00`,20261116,true,{}.
`boolean` accepted `true`,`false`,`'true'`,`'false'`; refused `'TRUE'`,`'True'`,`'FALSE'`,`'1'`,`'0'`,
`'yes'`,`'no'`,`'on'`,`'off'`,1,0,2,{},[].
`text` trim-only (`'  hello  '` → `hello`), 10 000 ok / 10 001 refused, 10 000 `U+00E9` ok,
5000 emoji (10 000 UTF-16 units) ok / 5001 refused, whitespace-only = not provided, non-string refused.
`file` blank = not provided; text/number/boolean = `answer.type_invalid`.
Legacy/unknown stored type reads as `text`.

HTTP (real route, real DB):

| # | Case | Measured |
|---|---|---|
| A1 | `evidenceNote: '  hello  '` on a `text` item | 201, `answers.value = "hello"` (trimmed persisted) |
| A2 | `evidenceNote: 42` on a `text` item | **400 `answer.type_invalid`**, zero delta |
| A3 | `'0x10'` on a `number` item | 400 `answer.type_invalid`, zero delta |
| A4/A5 | 10 000 / 10 001 chars | 201 (`len=10000`) / **400 `answer.type_invalid`**, state unchanged |
| A5b | refusal message | fixed text, **no reflection** of the 10 001-char input |
| A7/A8 | `'3.5'` / `'1e3'` on `number` | 201, stored `3.5` / `1e3` |
| A9/A10 | `'Infinity'` / `'1e999'` | 400 `answer.type_invalid`, zero delta each |
| A11–A13 | `true` / `'TRUE'` / `1` on `boolean` | 201 stored `"true"` / 400 / 400 |
| A14–A16 | `2026-11-16` / `2026-02-30` / `16/11/2026` on `date` | 201 / 400 / 400 |
| A17/A18 | text on a `file` item; blank on a `file` item | 400 `answer.type_invalid` (zero delta) / 201 stored `""` |
| A19 | whitespace-only note | 201, stored `""` (not a refusal — draft leniency) |

## 4. Criterion 2 — `attachment_required` is submit-only and independent of text (executed)

| # | Case | Measured |
|---|---|---|
| B1 | `text` item, no `attachment_required`, no file | 200 `submitted` |
| B2 | `text` item **+ valid written answer** + `attachment_required`, 0 files | **400 `answer.attachment_required`**, zero delta (answer/`evaluations` versions, `approvals` count unchanged) |
| B2c | state after refusal | still `draft` |
| B3/B3b | 1 KB PDF uploaded, then submit | 201 upload → 200 `submitted` |
| B7 | blank answer on `number`, `boolean`, `date` at submit | 400 `answer.type_invalid` (×3), zero delta each |
| NATT/BATT/DATT | `attachment_required` on `number`/`boolean`/`date`: 0 files → 400 `answer.attachment_required`; upload (201) → 200 | all pass; **all types covered** |
| C3b | 2 files present but a blank `text` answer | 400 `answer.type_invalid` — an attachment never satisfies the answer |

## 5. Criterion 3 — `file` type (executed)

B4: `file` item, 0 attachments → **400 `answer.attachment_required`**, zero delta.
B5/B5b: upload → 200 `submitted`.
B6b: a legacy text value written directly into `answers.value` (behind the API) **plus 1 attachment**
→ **400 `answer.type_invalid`** — the submit gate re-checks the type independently of the draft gate,
and refuses even when an attachment exists.

## 6. Criterion 4 — N/A rule as ratified (executed, both directions)

| # | Case | Measured |
|---|---|---|
| C1/C1b | N/A + `naReason='not-applicable'`, no value, no file, `attachment_required=false` | 201 draft → **200 `submitted`** (N/A satisfies the answer) |
| C2/C2b | N/A on an `attachment_required` item, 0 files | 201 draft → **400 `answer.attachment_required`**, zero delta (N/A does **not** bypass it) |
| C2c/C2d | upload then submit the same N/A draft | 201 → **200** |
| unit | N/A on a `file` item (no value) | allowed (`ok`) — an outcome, not an attachment-bearing answer |

This is the decision documented in `answerValidation.ts` and is consistent with task §1 rule 4
("attachments not required unless the item also `attachment_required`").

## 7. Criterion 5 — drafts are lenient (executed)

A6 (no value), A18 (`file`, no text), A19 (whitespace-only) all **saved 201 with `value = ''`**.
A value that *is* provided is still validated at draft time (A2/A3/A9/A12/A15/A16/A17).
Drafts never reach the submit gate (it lives only in `POST /evaluations/:id/submit`).
## 8. Criterion 6 — freeze / version / append-only / caps / scoping unchanged (executed + static)

| # | Case | Measured |
|---|---|---|
| D1 | upload 5 MB + 1 byte | 400 `attachments.oversize` |
| D2 | `.exe` MIME | 400 `attachments.mime` |
| D2b | exactly 5 MB | 201 (cap boundary intact) |
| D3 | disclosure frozen via `review_snapshots`, then submit | **409** frozen, zero delta |
| D3b | draft save on the frozen scope | 409 |
| D4 | other-department employee files on a foreign assignment | 403 |
| version | save existing draft **without** `version` | 400 `version.required` |
| version | submit with a stale version | 409 `version.conflict` |
| version | submit with the current version | 200 |
| E4b | correction after approval | `correction_history` length 1 (append-only intact) |

Static: `git diff --name-only d53d8ef` = `src/server/routes/evaluations.ts`, `src/lib/routeGates.test.ts`,
`src/lib/b17TransactionInventory.test.ts` — `storage.ts`, `approvalChain.ts`, `scope.ts`, `access.ts`,
`schema.sql`, `b17*.sql` and every other route are **byte-identical** to the base.

## 9. Criterion 7 — wire pins and gate ordering (independent audit)

| Check | Independent measurement |
|---|---|
| `validateAnswerValue(` in the route | **1** occurrence |
| `validateSubmitAnswer(` in the route | **1** occurrence |
| `'answer.type_invalid'` / `'answer.attachment_required'` literals in the route | **0 / 0** (codes live only in the lib) |
| Draft order | validate @477 → `enforcePairVersion` @503 → `INSERT INTO answers` @546 |
| Submit order | item meta @675 → attachment count @680 → **gate @683** → `enforcePairVersion` @695 → `UPDATE answers SET status` @704 |
| Behavioural proof of "gate before writes" | B2b/B4/C2b/B6b/B7 zero-delta + a stale-version submit returns the **attachment** refusal first (gate precedes the version gate) |
| Pin edits judged | additions only: `allowed` 79 → 81 (2 real paths), contract path added to `controlInputs`, `allowed.size` equality tightened to the new count, one new appended test in `routeGates.test.ts`. No assertion removed/loosened. |

## 10. Criterion 8 — lifecycle E2E (executed, own scratch)

save → submit → dept approve → correct → client confirm on a solo-disclosure item:
E1 201 `draft` · E2 200 `submitted` · E3 200 `approved` · E4 200 `score 100 → 50` ·
E4b history 1 entry · E5 **200 `client_approved`** · E6 double submit **409**.
No U4-1b refusal interfered with the existing chain.

## 11. Findings

| ID | Severity | Finding | Evidence | Location |
|---|---|---|---|---|
| QAF-01 | **LOW** | `number` is validated strictly but not *normalised*: `'1e3'` is stored verbatim as `"1e3"`, `'+7'` as `"+7"`. Any future consumer that string-compares or sorts stored answers numerically will mis-order them. Accepting exponent/sign forms is spec-consistent ("finite numeric, signed"); only the stored form is non-canonical. | A8 (`value=1e3`), unit matrix | `src/lib/answerValidation.ts:59-67` |
| QAF-02 | **LOW** | The 10 000 cap counts **UTF-16 code units**, not code points: 5001 astral characters (10 002 units) are refused although they are 5001 "characters". No DB-side length guard exists, so this is the only cap. | unit matrix (5000 emoji ok / 5001 refused) | `src/lib/answerValidation.ts:113` |
| QAF-03 | INFO | `boolean` accepts only JSON `true/false` and the exact strings `'true'/'false'`; `'TRUE'`, `'1'`, `'yes'` are refused. Correct per OD-12 ("true/false"), but U4-3 must send real booleans or exact lowercase strings. | A11–A13 | `src/lib/answerValidation.ts:91-95` |
| QAF-04 | INFO | `date` has no lower bound: `'0000-01-01'` is a valid answer (year 0 round-trips). Not contradicted by OD-12; flagged in case a business floor is intended. | unit matrix | `src/lib/answerValidation.ts:72-89` |
| QAF-05 | INFO | The draft path now `JOIN items` in the assignment lookup, so a missing `items` row yields 403 instead of proceeding. Fail-closed and correct, but it is a behaviour change to an existing query (no functional regression observed). | diff @452-462; A1–E6 all pass | `src/server/routes/evaluations.ts` |
| QAF-06 | **MEDIUM (control doc, not code)** | The governing `prototype/OWNER_DECISIONS.md` (working tree, uncommitted) has **corrupted Arabic encoding** (mojibake `?`/`�` runs); OD-12 §1–4 cannot be read from the record. I verified against the executor's English restatement in the task file plus the code's documented decision, not against the owner's original bytes. The decision text should be restored/re-committed by Tera. | `Get-Content -Encoding UTF8/1256` both produce undecodable Arabic; HEAD copy predates OD-12 | `prototype/OWNER_DECISIONS.md` |
| QAF-07 | **LOW (procedural)** | The scope guard `reviewerReports` still lists only up to `TASK-PROTO-U4-1a` paths, so once this QA report (and Shield's fix-review) land, the full suite reports 1 failure: `Unapproved write: project-control/qa-reports/TASK-PROTO-U4-1b-QA.md`. Identical precedent to QAF-08 in U4-1a. The executor must add the two exact paths in the fix round. Measured pre-write: **348/348**; measured post-write: see §12. | `src/lib/b17TransactionInventory.test.ts` `reviewerReports` | — |

No HIGH/MEDIUM code finding. No refusal weakness found: every refusal is 400 with an own wire
code, a fixed non-reflective message, and **zero** row delta.

## 12. Unverified / limits (NOT VERIFIED)

- The **owner's original OD-12 bytes** (QAF-06) — the record is corrupted; I could not confirm the
  Arabic wording independently of the executor's restatement.
- **UI path (U4-3)** — out of scope by design; no browser/Playwright run was needed for a server-rule task.
- **Concurrency under real parallel load** (two evaluators racing the same pair) — not exercised;
  the advisory-lock path is unchanged by this diff and covered by existing pins.

## 13. Recommendation

1. Accept U4-1b (PASS). 2. Executor fix round: add
`project-control/qa-reports/TASK-PROTO-U4-1b-QA.md` and `security-reports/TASK-PROTO-U4-1b-fix-review.md`
to `reviewerReports` so `npm test` returns 348/348 with the evidence present (QAF-07).
3. Tera: restore the corrupted OD-12 text (QAF-06). 4. U4-3 note: send real booleans and expect
non-canonical `number` strings back (QAF-01/03).

## 14. Cleanup

Scratch container `u41b-qa-pg` removed (`docker rm -f`); own TEMP scratch
(`%TEMP%\opencode\u41b-qa-e2e`) deleted after the run. Live/shared DB untouched.

QA Agent — Execution Mode · 2026-11-16
## 15. Post-report measurement (procedure, QAF-07)

Recorded **after** this report was written into the worktree (the executor handback state gave 348/348):

```text
$ node node_modules/tsx/dist/cli.mjs --test src/lib/b17TransactionInventory.test.ts
  error: 'Unapproved write: project-control/qa-reports/TASK-PROTO-U4-1b-QA.md'
not ok 100 - G1 protected policies, route keys, auth/lifecycle and capabilities are byte-unchanged
# tests 348 / pass 347 / fail 1
```

The single failure is the reviewer-evidence path, exactly as in QAF-08 (U4-1a). It is **not** a
U4-1b code defect: the same suite is green with the QA/Shield paths absent, and green again once the
executor adds the two exact paths in the fix round. No other test changed state.
---

# RECHECK — round 2 (2026-11-16)

| Item | Value |
|---|---|
| Scope | **only R1–R5** after the fix round (no re-review of round 1) |
| Base | `d53d8ef` (unchanged) — delta is now **5 files, +178 / −11** |
| New files in delta | `src/server/routes/adminAssignments.ts`, `src/server/routes/storage.ts` (both were untouched in round 1) |
| Scratch | fresh container `u41b-qa-pg` (postgres:18-alpine, `127.0.0.1:55472`), own role `u41bapp` (NOSUPERUSER / NOBYPASSRLS), own DB built with `schema.sql` → `b17.sql` → `b17-content.sql` (same recipe as round 1, so `assertB17Ready` + RLS are live) |
| Live DB | **not touched** |
| Verdict | **PASS on R1–R5** — 0 product failures; 3 residual observations (RR-01…RR-03) |

## R1 — attachment DELETE locked once the answer is not a draft: **PASS**

| Check | Measured |
|---|---|
| draft answer: upload → DELETE | 201 upload → **200**, attachment row gone (`count=0`) |
| submitted answer: upload → submit → DELETE | 200 submit → **409**, **`code = "attachment.locked"`**, attachment **still present** (`1 → 1`) |
| zero writes | no `ATTACHMENT_DELETED` audit row appeared (`before=1 after=1`) and `answers.status` unchanged |
| post-submit **ADD** | 201 — append-only preserved |
| frozen precedence | submit first, then freeze the disclosure → DELETE returns **409 frozen** (`code = undefined`, frozen message), **not** `attachment.locked`; attachment untouched (`count=1`) |
| failed-closed mechanism | `DeferredRefusal(409,{code:'attachment.locked'})` → `deferredFailure` → `{error, code}` (verified in the source and by the live response) |

**BYPASS ATTEMPT (honest report):** submit → **dept `return`** (status `returned`, still non-draft) → DELETE is **still refused** (409 `attachment.locked`).
The route does however allow a **draft save while `returned`** (the existing B9-C guard only refuses `submitted/approved/client_approved`), which flips the answer back to `draft`; after that save the DELETE is **allowed (200)**.
So R1 is exactly "status ≠ draft": the lock releases only through the legitimate rework cycle, and re-submission re-applies the attachment gate before the record can be re-frozen/approved. See **RR-02** (LOW) — a stricter "never after first submit" rule would need a `submitted_once` marker, which is not in this task's scope.

## R2 — `POST /assignments/na` refuses an `attachment_required` item: **PASS**

| Check | Measured |
|---|---|
| W workspace tab obtained (`POST /workspace/tab` → `POST /workspace/enter`) | `generation=2` |
| shortcut on an `attachment_required` item | **409 `assignment.na_attachment_required`** |
| zero rows | `evaluations/answers` for that item before `0/0` → after `0/0` |
| control: non-required item | **201**, exactly 1 answer row (route still works) |
| catch path | `writeFailure` passes the own `statusCode`+`code` through |

**BYPASS ATTEMPT:** on an `attachment_required` item, submit **with** the attachment, then `PUT /correct → notApplicable` — the correction itself returns **200** (it does not consult `attachment_required`), but the evidence is still there and **R1 blocks deleting it** (409 `attachment.locked`). The N/A record therefore keeps its attachment. See **RR-03** (LOW) for the remaining theoretical edge.

## R3 — submit fails closed on unresolved metadata/type: **PASS**

| Check | Measured |
|---|---|
| stored `answer_type = 'essay'` (no CHECK constraint exists) | submit → **409 `answer.type_unresolved`**, answer stayed `draft` (zero writes) |
| control: restore `'text'`, resubmit | 200 — the same answer submits once the type is valid |
| item unreachable (assignment removed after the draft) | submit → **404 “Evaluation not found.”** — fails closed at RLS/visibility **before** the metadata read; answer stayed `draft` |
| the `409 answer.item_unresolved` branch | **not reachable** through that probe (RLS hides the pair first); it is defensive and only source-pinned. Reported, not claimed as executed. |
| no silent default | `normalizeAnswerType` (legacy reader) is no longer used at submit; `resolveAnswerType` refuses unknown values; the round-1 `?? { answer_type: 'text' }` fallback is gone |

## R4 — invisible-only text / NUL / mixed: **PASS**

| Input on a draft | Measured |
|---|---|
| `U+200B` only | **400 `answer.type_invalid`** |
| `U+FEFF` only | **400** |
| `U+200B U+00AD U+200C U+200D` | **400** |
| spaces + `U+200B` + spaces | **400** |
| `a U+200B b` (mixed) | **201**, stored `a\u200Bb` (invisible retained inside real content) |
| `x NUL y` | **400** (`answer.type_invalid`) — **no 500** |
| `NUL` only | **400** |
| `1 NUL` on a `number` item | **400** |
| NBSP only | draft 201 storing `""` (JS `trim` ⇒ *absent*), **submit 400 `answer.type_invalid`** |

One recheck check initially failed **because my expectation was wrong** (I expected NBSP-only to be refused at save time). NBSP is JavaScript whitespace, so it is *absent* rather than *invisible*; the draft accepts absence and the submit gate refuses it — verified by a follow-up probe. Net product failures: **0**.
**RR-01 (LOW):** invisibles outside the implemented class still count as text — `U+2060` (word joiner) only was **accepted and submitted (200)**. The pinned set is `U+200B–U+200D`, `U+00AD`, `U+FEFF`.

## R5 — the two report paths and the pins: **PASS (no weakening)**

| Check | Measured |
|---|---|
| `reviewerReports` | now contains the **two exact** paths `project-control/qa-reports/TASK-PROTO-U4-1b-QA.md` and `security-reports/TASK-PROTO-U4-1b-fix-review.md` — no globs, no prefixes, no directory entries |
| `allowed` set | `assert.equal(allowed.size,82)` = 81 (round 1) **+ 1** (`adminAssignments.ts`, the only new writer) — and the two report paths went to `reviewerReports`, **not** to `allowed` |
| `controlInputs` | U4-1b contract path present (Tera-owned input) |
| deletions (`--unified=0`, complete) | the two old `SELECT id FROM assignments …` statements, the removed `const note`, the four `note`-bearing parameter arrays, and set tail/count lines. **No assertion deleted, no matcher widened, no equality loosened.** |
| new pin block (R1–R4) | pins the single `attachment.locked`, lock-before-DELETE, the N/A guard before `INSERT INTO evaluations`, `resolveAnswerType` + absence of the `'text'` fallback, and the NUL/invisible literals. Judged **fair but partly textual**: it proves presence/order, not the 409s (which this round's behavioural run supplies). |
| round-1 pins | unchanged — the `validateAnswerValue(`/`validateSubmitAnswer(` = 1 equalities and the “no wire-code literals in the route” negative are still present and still equalities |

## Commands (round 2)

```text
tsc --noEmit                                   exit 0 (no output)
tsx --test "src/**/*.test.ts"                  # tests 352 / pass 352 / fail 0   (expected 352)
vite build                                     exit 0  (✓ built in 794ms)
recheck harness (R1–R4, real router)           40 checks: 39 pass, 1 harness-expectation error, 0 product failures
follow-up probe (NBSP / U+2060 at submit)      2/2 pass
```

The suite is green **with both review artefacts present**, so QAF-07 from round 1 is closed.

## Residual findings (round 2)

| ID | Severity | Finding |
|---|---|---|
| RR-01 | LOW | Invisible-only text is only enforced for `U+200B–U+200D`, `U+00AD`, `U+FEFF`. `U+2060` (and peers such as `U+2061–U+2064`, `U+180E`, `U+3164`, variation selectors) still count as a real answer (measured: `U+2060`-only submitted 200). |
| RR-02 | LOW | R1's rule is literally `status !== 'draft'`. The dept/client **return** paths let the author save a draft again, which releases the lock and permits deleting previously-submitted evidence (measured 200 after the rework save). Re-submission re-applies the attachment gate, so the final record stays sound; a stricter rule needs a “submitted once” marker (out of scope). |
| RR-03 | LOW | `PUT /correct → notApplicable` does not consult `attachment_required` (measured 200 on an `attachment_required` item). Harmless today because the evidence cannot be deleted (R1) — but if an item is switched to `attachment_required` **after** a submitted answer carried no attachment, a correction could leave an N/A without evidence. Worth a U4-3/U5 note. |

Round-1 findings QAF-01/QAF-02/QAF-04/QAF-05/QAF-06 stand unchanged (QAF-07 closed).

## Cleanup (round 2)

Container `u41b-qa-pg` removed; `%TEMP%\opencode\u41b-qa-r2` deleted; worktree contains only the executor delta + the two review artefacts; live/shared DB untouched.

QA Agent — Execution Mode (recheck) · 2026-11-16