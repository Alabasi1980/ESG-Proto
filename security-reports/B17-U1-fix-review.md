# TASK-PROTO-B17-U1 — independent defensive fix review

- Agent: security-agent / The Shield; Mode: Fix Review; Last review: 2026-11-12; Status: Done — round-2 limited static review; runtime QA separate.
- Findings: SHIELD-U1-01 (Medium) STATIC-CLOSED in round 2; remaining scoped U1 source blockers: 0. No final security gate or task acceptance issued.
- Authority: conduct read first; local source READ_ONLY; this report is the sole write, via expressly authorised PowerShell.
- Contract: prototype/TASK-PROTO-B17.md:84–104 and revised B17_TECHNICAL_SPEC.md:195–236,254–338. Prototype-specific intake governs; no original-project preparation/control writes.
- Historical B17-access-review.md was read as context only; all implementation conclusions below come from current source, not that report.

## 1. Round-1 snapshot: independently discovered changes and evidence discipline

- HEAD/base: c4ee8bccb87b53fbc957861178832029cde769be; inspected actual Git status, diff/name-status/stat against c4ee8bc, and untracked files.
- Modified: server.ts; src/db/{index.ts,schema.sql}; src/server/{auth.ts,routes.ts}; src/server/routes/{_shared.ts,session.ts,system.ts}.
- New code/tests/proof: src/db/{b17.sql,b17Readiness.ts}; src/server/{access.ts,accessRegistry.ts,workspace.ts}; src/lib/{capabilities.ts,capabilities.test.ts,workspace.test.ts}; scripts/b17-workspace-proof.ts.
- Pre-existing untracked security-reports/B17-access-review.md preserved. No package/lockfile change appeared; no remote-state/parity assertion made.
- EXERCISED HERE: read-only Git inspection and git diff --check c4ee8bc (no whitespace errors; CRLF conversion warnings). No application tests were executed.
- STATIC ONLY: traced active handlers, transaction/RLS/migration code and test/proof definitions. Script PASS strings and assertions are NOT executed evidence.
- No HTTP/browser/DB/cloud access, credentials/.env access, installation/scanner, migration/build, application write, delegation, commit or push.

## 2. SHIELD-U1-01 — Medium — historical finding; STATIC-CLOSED by round 2 below

- Round-1 blocker and source references below are historical at that reviewed revision; current source evidence/closure is in section 7. Runtime remains Unverified here.
- Evidence: src/server/routes/session.ts:50–64 invokes withSession, then suppresses EVERY statusCode=401 as successful logout.
- Evidence: src/server/auth.ts:89–115 can lock a live, unrevoked sid, then throw 401 auth.binding_invalid for missing employee department or mismatched department/company BEFORE revokeSession is called.
- Evidence: src/server/auth.ts:130–132 is the actual revocation; src/db/schema.sql:46–55 permits nullable employee department and separate company/department FKs. Deactivation-only revocation at src/db/b17.sql:151–167 does not cover binding invalidation.
- Static sequence: live employee sid -> invalid/cleared department binding -> logout returns success after rollback, with no sid/tab revocation -> binding repaired before expiry -> the same signed sid can authenticate again. No request sequence was executed here.
- Impact: successful logout is not durable session invalidation in this account-lifecycle condition; a retained bearer can regain authority without re-login when the binding is repaired. No GE escalation or current business-data exposure is asserted.
- Proposed correction: separate signed sid/user binding and exclusive session-lock validation for revocation from current-user business/binding validation. Revoke the presented live session and its tabs atomically even when its account binding is invalid; do not swallow all 401 causes as already-revoked.
- Required isolated regression: invalidate/repair binding around logout, assert persisted revoked_at and continued rejection of the original bearer after repair; retain expiry/revoked idempotency, backend-failure refusal and lock-race tests.
- Round-1 action was a bounded implementation fix; round 2 closes this specific root cause IN SOURCE only. Reviewer made no code changes.

## 3. Round-1 source-control snapshot — not renewed wholesale in round 2

- Current authority: HS256 id+sid verification, live session lookup and locked current DB role/company/department replace JWT role claims; missing lookup fails closed (src/server/auth.ts:48–57,81–124). No req.user impersonation observed.
- Identity substitution: explicit bearer precedence; malformed/duplicate Authorization never falls back to cookie (auth.ts:59–67). Workspace mutations require bearer; opaque handle is hashed and bound to sid/user; query input is rejected (access.ts:39–64; workspace.ts:11–14).
- Handles/generation: random 32-byte handles, exclusive session lock around count+insert, cap 20 with no eviction; database mode/tenant/positive-generation constraints (workspace.ts:26–41; auth.ts:89–96; b17.sql:17–34).
- Lifecycle: session SHARE -> tab UPDATE -> generation/expiry recheck; explicit P->W, W->P, W->W refusal, P exit idempotency; GET reconciliation intentionally ignores version (access.ts:33–64; workspace.ts:44–79).
- Atomicity/stale writes: transitions, expiry refresh and actual-GE audit share one checked-out transaction; commit precedes response. Session revocation is exclusive and includes tabs (db/index.ts:85–105; workspace.ts:48–70; auth.ts:130–132). This supports U1 lifecycle ordering, not proof for future business uploads/writes.
- Activation: dispatcher precedes all domain routers, explicit registry matches method/path and asserts mounted declarations; only system/session/workspace active, all 87 business declarations inactive (routes.ts:24–44; accessRegistry.ts:14–72; access.ts:18–27). No current active path to legacy work handlers found.
- RLS: transaction-local fields explicitly set/cleared; old policies replaced rather than OR-combined; FORCE RLS, mode/purpose/actor/tenant checks and narrow auth/lifecycle policies (db/index.ts:20–31; b17.sql:36–147). Empty context and bare GE are not work grants; platform is not generic tenant authority.
- Replay/readiness: awaited read-only verification before listen and active dispatch; source/ledger/catalog fingerprints plus non-bypass role checks; offline predecessor verification, ledger-last commit and verified no-op (server.ts:39–41,69; access.ts:25; b17Readiness.ts:34–81).
- Schema replay/regrant: startup/HTTP/bootstrap no longer apply schema; HTTP migrate returns offline-only; empty-install guard precedes DDL and all-client GRI grant removed; offline delta contains no business/content backfill (system.ts:16–55; db/index.ts:139–158; schema.sql:1–18,1199–1203; b17.sql:1–34).
- Input/errors/secrets/config: reviewed active SQL uses bound values; new auth errors are generic, not raw backend messages; cookies HttpOnly/SameSite=Strict/production-Secure, cross-origin writes checked (auth.ts:38–42; session.ts:9–10; access.ts:12–17). No secret literal observed in additions; no secret-file/log/bundle audit performed.

## 4. Root-cause closure boundaries

- B17-01: U1 server-bound mode/tab and fail-closed legacy-activation roots addressed IN SOURCE; domain-policy and browser integration closure withheld pending U2+UI and exercised proof.
- B17-05: SHIELD-U1-01 narrow logout root is STATIC-CLOSED in round 2; no blanket B17-05 closure or runtime acceptance follows. Other round-1 boundaries remain.
- B17-06: startup/request/bootstrap replay and automatic subscription-grant roots addressed IN SOURCE; runtime readiness/restart/no-regrant/data-preservation closure remains Unverified.
- B17-02/03/04/07 and content mappings/shared-row protection remain OPEN for U2; B17-08/09 browser epochs/navigation remain OPEN for UI. Disabled endpoints contain risk; they do not prove their domain fixes.

## 5. Round-1 nonblocking bounds and verification limits — remain pending

- Lock-order bound: AFTER UPDATE deactivation trigger takes session locks AFTER the user row lock (b17.sql:151–161), opposite normal session->user order (current auth.ts:94–101). A newly arriving request can deadlock; rollback preserves safety but strict order/availability is not closed. Resolve/review before activating U2 provisioning; no current U1 deactivation API is active.
- Proof coverage is NOT proof execution: supplied harness defines real login/HTTP/RLS/cap/restart checks, but earlier-work/exit and logout races hold helpers without a business write (scripts/b17-workspace-proof.ts:206–226,360–370). Deactivation race does not establish the inverse-lock interleaving (388–403).
- Harness preservation assertions cover fixture answers and memberships, not populated approval/history/snapshot/attachment datasets (script:121–130,268–273,422–424). Broader no-damage evidence remains required; no migration damage was established statically.
- Readiness fingerprints explicitly target PostgreSQL 18 (b17Readiness.ts:7–9; script:94). Portability to other predecessor versions/privilege layouts is Unverified and fails closed; do not loosen fingerprints to force activation.
- Runtime role/policies, expiry/races/audit rollback, drift/partial activation, pooled A/B/empty context and rejected bootstrap/replay require separately authorised independent isolated execution. No U1 runtime success is claimed here.
- Linked-service/assignment refinement, report/Profile legacy association, W-only initiative selection and browser memory/epoch/clear-state work are deferred by contract, not waived. U1-only release remains forbidden.
- Residual TLS verification, dependency upgrades/scanning and broader error/deployment hardening were NOT reopened or accepted; remain outside U1 with Tera. Existing UI/business workflows were neither exercised nor accepted.

## 6. Handback

- Artifact: security-reports/B17-U1-fix-review.md. Tera follow-up: separate runtime QA and pending U2 lock-order integration review before provisioning activation; no remaining scoped source fix requested, security waiver or release recommendation.
- Handback Record Target: project-control/tasks/TASK-PROTO-B17-U1.md; Project-Control Update Required: Yes, by Tera in the applicable prototype control track, not by this reviewer.
- Documentation Status: submitted to Tera for recording. Review completed within authorised reads/report-only write; task acceptance and final security gate reserved to their owners.

## 7. Round 2 — disk-is-truth review of SHIELD-U1-01 only (2026-11-12)

- Conduct reread; independently reread current auth/session/proof/tests and scoped transaction/RLS support; Git HEAD/status and scoped base diff/check rechecked. Executor results were not evidence; no application/test/DB/network execution or secret access occurred.
- Decision: SHIELD-U1-01 STATIC-CLOSED — the root dependency on usable account bindings is removed, not bypassed by weakening ordinary authentication. Runtime QA is separate and Unverified by this reviewer.
- Current evidence: src/server/auth.ts:139–152 verifies signed id+sid, sets cleanup-only auth.logout context, locks that owned session FOR UPDATE without a user/company/department lookup, then revokes its session and tabs (135–137).
- Atomic/durable reasoning: both updates commit in one withTenantContext transaction before success (src/db/index.ts:85–105; session.ts:50–58). RLS independently restricts auth.logout rows to signed actor/session (src/db/b17.sql:64–80). Repairing account bindings cannot clear the persisted revocation.
- Failure/idempotency: no blanket 401 suppression remains; malformed bearer and backend/config failures cannot reach cookie clearing/success. Valid signed expired tokens permit cleanup ONLY; missing sessions are no-ops, repeat updates preserve revoked_at (auth.ts:52–73,135–152; session.ts:50–58).
- Normal auth: verifyToken still validates expiry (auth.ts:52–63); only the private cleanup caller requests ignoreExpiration. withSession still requires a live unrevoked sid and locked active current-user/company/department bindings (86–134); login/me/password paths retain their checks (session.ts:12–48,60–83). No ordinary-auth relaxation identified.
- Test definitions, not results: src/lib/workspace.test.ts:11–22,39–57 cover ordinary expiry rejection and malformed/forged/sid-less/duplicate bearer refusal without cookie substitution, plus missing-secret error propagation.
- Proof definitions, not results: scripts/b17-workspace-proof.ts:275–307 cover invalid department/company, GE-owned tab cleanup, persisted revocation after repair/repeat and unaffected other sessions; 309–344 cover negative credentials/origin and real backend-lock failure; 348–370 cover expired cleanup and logout lock serialization.
- U2 lock-order concern in section 5 remains explicitly PENDING before provisioning activation; this logout repair does not close the deactivation user->session inversion. Deferred domains/UI/TLS/dependencies were not reopened.
- Remaining U1 blocker from this limited static round: NONE. This closes only SHIELD-U1-01 at source level, not runtime verification, parent findings, task acceptance, release or final security gate.
