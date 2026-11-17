# Shield defensive review — TASK-PROTO-U4-1c-PROTECT-SEC1 (round-2 revision)

Mode: Preventive Review (static + source reasoning; NO live DB, NO scratch execution, no secrets).
Session: NEW independent reviewer. Conduct gate: `tera-system/TERA_AGENT_CONDUCT.md` read and passed.
Inputs: task `TASK-PROTO-U4-1c.md` §§7–18, delta `B17_U41C_PROTECT_TECHNICAL_DELTA.md` §§1–9,
`prototype/TECHNOLOGY_PROFILE_DRAFT.md`, `prototype/OWNER_DECISIONS.md` OD-07/11/12 (no OD-13 exists on disk),
working-tree diff vs HEAD `4eb36e9` (verified match; no foreign product changes — only the known
task/delta/reports/implementation/audit set plus two Tera-owned control-log lines).

## Verdict summary

RISK_SIGNAL maintained. 1 High · 2 Medium · 3 Low. No PASS issued (auditor owns the gate).
Round-2 revision fixes the RLS-blind reads flagged in round 1 (tenant-bound requirement pre-read
`documents.ts`, tenant-joined initiative evidence parent) and adds a sound anchor + conditional-write
core. The blocking issue is **H-01**: under owner direction §17/§18, detached rows are preserved in
the DB but are **not readable through any API path** — this contradicts the §18 invariant as written.

## Findings

### H-01 — Detached statuses/evidence preserved but unreachable (availability/integrity)
- Evidence: `src/server/routes/departmentInitiatives.ts` list joins
  `st.client_initiative_id = ci.id`; `documents.ts` `loadEvidenceParent` joins
  `ci.id = st.client_initiative_id`. After unselect, SET NULL nulls the link, so detached rows
  vanish from every list, and initiative evidence upload/delete/download-via-parent resolve to 404.
  No re-attach or detached-listing API exists; reselect mints a new selection ID the old rows never rejoin.
- Impact: any authorized W can hide arbitrary department status/proof by select/unselect cycles —
  a statically constructible destructive-by-obscurity path (data retained, denied to readers).
  `INITIATIVE_UNSELECTED` audit carries no orphaned-row counts.
- Suggested: Tera/Majed decision — either a W-scoped detached-reading path (or re-link on reselect),
  or explicitly amend §18 to "preserved in DB, hidden from API" with an operator recovery procedure.
  Do not accept §18 "readable" as met on current code.

### M-01 — Pre-lock miss returns 409 `initiatives.unselected` for any unknown ID with version != 0
- Evidence: `departmentInitiatives.ts` — `if (!pre && expectedVersion === 0) throw 404; if (!pre) throw 409
  unselected`. A never-existent UUID with `expectedVersion: 1` gets 409 "no longer selected",
  a false state claim and a 404/409 existence oracle. Post-lock 409 is sound (pre-lock proved liveness).
- Suggested: pre-lock miss is always 404; reserve 409 `initiatives.unselected` for the post-lock path.

### M-02 — Evidence mutations carry no revision; download takes no anchor
- Evidence: upload/delete serialize on the parent anchor but never check or bump `version`;
  download (`GET /evidence/.../download`) reads `evidence_files` directly with no parent/anchor check.
  A stale reader can still append while a PATCH wins; a download can serve bytes of a concurrently
  deleting file. Narrow windows, tenant/dept-gated — but the "first valid save wins, other refreshes"
  rule does not cover evidence. Delta §4 notes this boundary; needs explicit owner acceptance, not silence.
- Suggested: either bump parent revision on evidence mutation (contract change — STOP for decision) or
  record M-02 as an accepted residual risk.

### L-01 — Post-lock reread collapses department mismatch to 404 (pre-lock: 403)
- Evidence: `documents.ts` upload/delete post-lock `if (!parent || parent.department_id !== own) throw 404`.
  Fail-closed direction (safe), but inconsistent 403/404 discipline pre- vs post-lock.

### L-02 — No freeze check on status/submission/evidence writes (pre-existing, unchanged)
- Evidence: `isFrozenScope` gates select/unselect (`initiatives.ts`) but no check exists in either PATCH
  or evidence path — identical in HEAD baseline, so no round-2 widening. Freeze boundary should be
  stated explicitly (selection-level only) or extended by separate decision.

### L-03 — Nullable FK permits NULL at DB level; no orphan inventory in audit
- Evidence: `schema.sql` SET NULL block drops NOT NULL with no compensating guard; audit payloads carry
  versions but no detached-row counts. Direct-DB orphan census remains the only visibility.

## Explicit judgments requested

(a) Unselect-always-permitted destructive/exfil path: **YES (availability), NO (exfiltration).**
  Destructive-by-obscurity is constructible statically (H-01). Exfiltration is not widened:
  tenant + own-department checks intact on all paths; detached files stay tenant/dept-gated by
  `file.client_id`/`file.department_id` even where still downloadable by known ID.
(b) Version/conflict bypass: **no full bypass** — missing/empty/non-integer/negative/overflow fail
  closed with baseline 400; string "2" coerces safely, booleans/objects refused; same-version loser
  sees zero rows and 409s. Residual: M-01 oracle, M-02 evidence outside the protocol.
(c) Unenforced window: main submit/delete and update/update races serialize on the shared canonical
  anchor + conditional single-row write (static reasoning). Residual unenforced windows: download-vs-delete
  read race and non-revisioned evidence interleavings (M-02). Runtime proof UNVERIFIED (see below).

## Positive controls (verified statically)

- Tenant-bound pre-reads are a genuine fix vs HEAD: requirement PATCH now scopes `WHERE id + client_id`;
  initiative evidence parent is proven through selection + department joins (was unscoped `WHERE id`).
- Canonical `(kind, server-tenant, resource)` advisory anchor, never selection-row ID; ABA revalidation
  binds original selection ID + tenant + library ID; no path takes two anchors; lock-then-recheck order kept.
- Exact owner-approved Arabic strings, correct codes (`version.conflict`, `version.required`,
  `initiatives.unselected`, `evidence.locked`); no SQLSTATE/count/ID leakage in bodies.
- Role enforcement intact: `ownEmployeeDepartment` refuses W/C/P with zero writes; freeze still gates unselect.

## UNVERIFIED list (no live run by this reviewer)

Runtime race outcomes, deployed-role ACL equivalence (surrogate-role evidence only), installed/live orphans,
fresh-vs-upgrade migration parity and ledger convergence, deadlock behaviour at pool max 5, real-router ABA
under separate sessions, UI display of the §18 notice, W `FOR UPDATE` visibility assumptions.

## STOP / ASK (needs Tera/Majed decision)

1. H-01: amend §18 readability invariant or authorize a detached-reading/re-link path — blocks acceptance.
2. M-01: confirm pre-lock miss becomes unconditional 404 (one-line, no new wording).
3. M-02: accept evidence-outside-revision as residual risk or authorize a revision-bump contract change.
4. Record note (not my edit): control logs describe round 1 as "accepted (bounded, unit only)" while task
   §17 marks it superseded — reconcile the wording to avoid a false acceptance trail.
5. No parent acceptance issued; no live migration, cleanup, commit or deployment authorized by this review.

Artifacts: this file only (`security-reports/TASK-PROTO-U4-1c-PROTECT-SEC1.md`). No source/test/control edits.
