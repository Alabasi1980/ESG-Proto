# Shield defensive review — TASK-PROTO-U4-1c-PROTECT-SEC3 (round-4 archived-write refusal)

Mode: Preventive Review (static + source reasoning; NO tests/DB execution by reviewer).
Session NEW independent. Conduct gate: `tera-system/TERA_AGENT_CONDUCT.md` read and PASSED.
Pre-Action Gate: conduct read Yes / authority WRITE_DOCS new-file-only Yes / Tera RISK_SIGNAL HIGH scope Yes / no gate skipped Yes / smallest action Yes.
Inputs: task `TASK-PROTO-U4-1c.md` Ss17-23 + delta `B17_U41C_PROTECT_TECHNICAL_DELTA.md` Ss1-8; `prototype/TECHNOLOGY_PROFILE_DRAFT.md`; `prototype/OWNER_DECISIONS.md` OD-07/11/12 (OD-13 absent on disk — reference gap only, no verdict impact); working-tree diff vs HEAD `4eb36e9` read directly (round-3 archive + round-4 refusal combined, uncommitted); prior SEC2, QA2 `TASK-PROTO-U4-1c-PROTECT-QA2.md`, AUD01 `TASK-PROTO-U4-1c-PROTECT-AUD01.md`.

## Verdict summary

RISK_SIGNAL maintained (auditor owns disposition; no PASS issued). 0 High / 0 Medium / 3 Low / 0 Unverified-as-finding. Round-4 CLOSES SEC2 M-01 on static evidence: initiative evidence upload/delete now resolve through an ACTIVE selection only and reuse the existing 404 — no silent append/delete on archived selections. Version/conflict, grants, destructive-path, wording and audit judgments all SOUND as scoped below. Round-4 has NO fresh QA/Auditor execution on record — acceptance still blocked pending those independent runs.

## Findings

### CLOSED — SEC2 M-01 now fail-closed (was MEDIUM)
- Evidence: `src/server/routes/documents.ts` `loadEvidenceParent` (~369-375) joins `ci.archived_at IS NULL` + department client check for `initiative_status`; upload (~424-445) and delete (~512-532) do pre-read (active-only) + `evidenceAnchor` + `u41cProtectLock` + same-ID reread (active-only) + selection-ID/resource equality check, else `404 evidence.not_found`. Status PATCH (`departmentInitiatives.ts` ~100/114) binds `archived_at IS NULL` pre- and post-lock. No new text, no redirect to a replacement row, no write before the post-wait recheck.
- Residual note (LOW, defense-in-depth): `evidenceAnchor` initiative branch (~388-392) selects the selection row without its own `archived_at` predicate — safe only because both callers gate via `loadEvidenceParent` before and after the lock. Any future caller must reuse `loadEvidenceParent`, never `evidenceAnchor` alone. No change requested (STOP for decision; not a bypass on current paths).

### L-01 — Version-shape checked before role gate (fail-closed, pre-existing) [LOW]
- Evidence: both PATCH routes run `parseExpectedVersion` before `ownEmployeeDepartment` inside the transaction. A denied role with a malformed version gets 400 `version.required` instead of 403. Conflict fields null; no data disclosed. Matches SEC2 L-01 disposition; no widening in round-4.

### L-02 — No freeze check on status/submission/evidence writes (pre-existing, unchanged) [LOW]
- Evidence: `isFrozenScope` gates POST/DELETE select (`initiatives.ts` ~155/191, rechecked after lock) but no check exists in either PATCH or evidence paths — identical to HEAD baseline and QA2 bounded PASS. State freeze boundary explicitly selection-level unless Tera decides otherwise.

### L-03 — RESTRICT is selection-link-only; ancestor cascades remain [LOW]
- Evidence: `schema.sql` named `initiative_department_status_selection_restrict` + `client_initiative_id SET NOT NULL`; client/library/department `ON DELETE CASCADE` paths untouched (delta admits). No code claims otherwise. Installed-data inventory stays a separate activation obligation.

## Explicit judgments requested

(a) Archived-write paths closed without silent bypass: YES (static). Upload/delete/status all fail closed 404 on archived; download (`documents.ts` ~480-490) stays tenant/dept-gated read — readable archived proof is the Ss20 intent, not a bypass. Idempotent already-archived unselect returns 200 with no audit (`initiatives.ts` ~205-212, documented) — serial semantic needs Tera confirm (see ASK).
(b) Version/conflict intact: SOUND (static). Missing/non-integer/negative/overflow to 400 `version.required` (baseline evaluations wording); mismatch to conditional single-row UPDATE, loser zero rows to 409 `version.conflict` + approved Arabic + numeric-only conflict after full authorization; `api.ts` retries only `workspace.stale/invalid` once, never `version.conflict`. Evidence mutations still carry no revision (delta boundary, accepted as design — no silent overwrite).
(c) No new grants/privileges/bypass: CONFIRMED except the one Ss21-approved hunk. `b17-content.sql` carries ONLY `b17_selection_update` FOR UPDATE, USING/WITH CHECK textually identical in scope to `b17_selection_delete` (W-consultant + own-tenant + linked service). `accessRegistry.ts` zero diff; no bypass-RLS, no definer change (sanctioned set still 2), no new dependency, no secret in diff.
(d) No destructive path introduced: CONFIRMED (static). No `DELETE FROM client_initiatives` on the API path; unselect SETs `archived_at`, reselect clears it in place (same ID, history reconnects); hard row delete refused by RESTRICT only when linked rows exist; link back to NOT NULL (fail-closed on nulled link).
(e) Error wording exact: SOUND (static). Stale message byte-identical to Ss13 in both PATCH routes; missing-version baseline exact; round-2 `initiatives.unselected` notice retired (asserted absent); superseded dependency refusal gone from unselect path; `domainFailure`/`writeFailure` strip SQLSTATE/diagnostics; conflict payloads carry revision numbers only.
(f) Audit integrity: SOUND (static). All state changes audit in-transaction with expected/current versions; refusals (403/404/409) write no audit; idempotent archived repeat writes none (documented). No orphan-count claims.
(g) Prior closures re-verified on the round-4 diff: HOLD. SEC1 H-01 detached-rows resolved (archiving, NOT NULL + RESTRICT, re-list with history); SEC1 M-02 evidence-outside-revision residual unchanged by design; fix-review H-01/M-01 closures hold (RESTRICT + client-scoped + collision suffix intact, no regression in diff); R3-03 collision and R3-04 rebinding untouched and explicitly NOT waived (remain OPEN for their separate unit); QA2 criteria 1-9 behavioral proofs cited as context only, not re-claimed here.

## UNVERIFIED list (explicit — no live run by this reviewer)

Runtime race outcomes; real-router ABA under separate sessions; deployed-role/ACL equivalence (surrogate-role evidence only); installed/live orphans; fresh-vs-upgrade migration + ledger parity on live data; pool-max-5 deadlock; silent-200-without-archive runtime proof for round-4 (QA2 proved round-3 only); UI display of `archived` flag + refresh behavior; evidence-on-archived runtime interleave for round-4; hash-collision behavior; MIME/5 MB exhaustive; performance. No round-4 QA/Auditor execution on record at review time.

## STOP / ASK (needs Tera/Majed decision)

1. Confirm idempotent already-archived unselect (200, no audit) is the intended serial semantic.
2. Order FRESH QA execution on the round-4 tree + Auditor review; do not accept on QA2/AUD01 alone (they predate the refusal hunk).
3. Confirm L-02 freeze stays selection-level-only, or open a separate freeze-extension unit.
4. Confirm L-01 ordering accepted as-is, or direct the inside-transaction move (touches both PATCH routes — STOP first).
5. No parent acceptance issued; no live migration, cleanup, commit, deployment, or push authorized by this review.

Artifacts: this file only (`security-reports/TASK-PROTO-U4-1c-PROTECT-SEC3.md`). No source/test/control edits.
