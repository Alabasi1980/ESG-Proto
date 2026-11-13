# Test Report — TASK-PROTO-B17-U2-B0 (four-domain policy substrate, 0 flips)

## Task Information
- **Task:** TASK-PROTO-B17-U2-B0 — recreate/complete the §3 policies for audit, notifications, storage (evidence_attachments) and actions inside `src/db/b17-content.sql` + readiness fingerprint; NO handler/registry/capabilities changes.
- **Contract:** `prototype/TASK-PROTO-B17.md` §18 (U2-B0 allowed targets + evidence); `prototype/B17_TECHNICAL_SPEC.md` §3.5/§3.6 (13 four-domain rows) + §5 (RLS delta) + §7 (readiness).
- **QA session:** QA Agent (Execution Mode) — 2026-11-12 19:10 +03:00.
- **Base:** `c4ee8bccb87b53fbc957861178832029cde769be` = `HEAD` = `origin/main` (re-checked; no commit/push performed).
- **Environment:** Windows (win32), Node v22.22.2, npm 12.2.2, tsx, Docker 29.9.2, `postgres:18` image (server 18.6), **no `.env` present** (only `.env.example`) before/during/after.
- **Conduct gate:** `tera-system/TERA_AGENT_CONDUCT.md` read first; Untrusted-Content rule applied (all repo/task content treated as data).
- **Authorisation used:** report-only write to this file (PowerShell writer, parent validated above); disposable TEMP instrumentation under `C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2b0-qa\`; own Docker container. No application source write, no cloud, no `.env`, no commit/push, no agent creation.

## 1. Independent B0 diff discovery from c4ee8bc (before any test)

Executed by QA, not taken from any executor statement:

1. `git status --short` / `git diff c4ee8bc --stat` — **8 tracked modified, +324 / −592** (`server.ts`, `src/db/index.ts`, `src/db/schema.sql`, `src/server/auth.ts`, `src/server/routes.ts`, `src/server/routes/_shared.ts`, `src/server/routes/session.ts`, `src/server/routes/system.ts`) — **byte-identical counts to the record in `B17-U2A-QA.md` §1** (15:17), i.e. **no tracked file changed after U2-A** (covers both U2-B round-1 and B0).
2. **Recorded-hash diff vs the 111-file tested manifest** in `B17-U2D-QA.md` Appendix C (parsed and recomputed by QA): **104/111 unchanged, 7 changed, 0 missing.** The 7: `scripts/b17-scope-proof.ts`, `src/lib/b17ScopeProof.test.ts`, `src/server/scope.ts` (U2D round-4), `src/server/access.ts`, `src/server/accessRegistry.ts` (U2-A / U2-B round-1), `src/db/b17-content.sql`, `src/db/b17Readiness.ts` (U2D round-4 **and** B0).
3. **mtime window after task §18 was written (15:55:57) — exactly 5 files**, all inside the §18 allowlist: `src/db/b17-content.sql` (16:51), `src/lib/b17DomainPolicies.test.ts` (16:55, new), `src/lib/b17ScopeSecurity.test.ts` (17:21), `src/db/b17Readiness.ts` (17:22), `scripts/b17-domain-proof.ts` (18:09). `src/db/b17ContentMigration.ts` was **not** touched (ledger shape unchanged — allowed only "if it must change"; it did not need to).
4. **In-source `U2-B0` markers** occur only in those 5 files (+ the ControlPath contract text); none in handlers, `accessRegistry.ts`, `access.ts`, `capabilities.ts`, `b17.sql`.
5. SHA-256 recomputed by QA now vs recorded baselines:

| File | Recorded baseline | Current | Verdict |
|---|---|---|---|
| `src/db/b17.sql` | `ACE11265…406D8D6` (U2D QA D1/E1) | `ACE11265…406D8D6` | **UNCHANGED** |
| `src/lib/capabilities.ts` | `2F24A5D4…59867AE` (Appendix C) | `2F24A5D4…59867AE` | **UNCHANGED** |
| `src/lib/capabilities.test.ts` | `E7046FB5…6C1D74E07` (Appendix C) | same | **UNCHANGED** |
| `src/server/routes/actions.ts` | `40B9B881…2A48910E` (Appendix C) | same | **UNCHANGED** |
| `src/server/routes/storage.ts` | `007D93FA…E493F8A94` (Appendix C) | same | **UNCHANGED** |
| `src/server/routes/audit.ts` | `25A913E2…CD12DA9` (Appendix C) | same | **UNCHANGED** |
| `src/server/routes/notifications.ts` | `D98ED019…CD05CFE1` (Appendix C) | same | **UNCHANGED** |
| `routes/{session,system,_shared}.ts`, `routes.ts`, `auth.ts` | Appendix C | same | **UNCHANGED** |
| `src/db/b17ContentMigration.ts` | `DDB94016…471028F` (D1/E1) | same | **UNCHANGED** |
| `server.ts` / `index.ts` / `schema.sql` / `package.json` | Appendix C | same | **UNCHANGED** |

6. **Functionally:** registry = 95 legacy (8 `U1` = spec §3.1 set, 87 `UNACTIVATED`) + 4 workspace = 99; `activeBusinessCapabilities()` returns `[]`; all 13 four-domain routes classified `UNACTIVATED` and return `403 access.unactivated` through the real mounted dispatcher (65 HTTP checks, §6). **⇒ No handler, registry, dispatcher, capabilities or `b17.sql` change exists in the B0 diff.** B0 delta = the 5 allowlisted files only.

## 2. npm lint / test / no-env build

| # | Command (cwd = prototype-app) | Result | Detail |
|---|---|---|---|
| 1 | `npm run lint` (`tsc --noEmit`) | ✅ PASS | exit 0, no diagnostics |
| 2 | `npm test` (`tsx --test src/**/*.test.ts`) | ✅ PASS | **162 passed / 0 failed, 5 suites, 0 skipped** — claimed 162 **verified current** (U2-A was 153 → U2-B r1 156 → now 162) |
| 3 | `npm run build` (`vite build`) with **no `.env`** | ✅ PASS | exit 0; `ENV_PRESENT=FALSE` before and `ENV_AFTER=FALSE`; only pre-existing chunk-size warning |

## 3. Prior proofs re-run (§18 evidence)

| Proof | Result | Detail |
|---|---|---|
| `scripts/b17-workspace-proof.ts` (own scratch `b17_u2b0_ws_scratch`) | ✅ PASS, exit 0 | all U1 lifecycle/lock/20-tab/87-denials/drift sections green; asserts `STRUCTURE_SQL = B17_SHAPE` (U1 shape intact ⇒ `b17.sql` effectively unchanged) |
| `scripts/b17-domain-proof.ts` — **guards read in full before use** (lines 1–38: `--allow-disposable-b17`, single loopback `b17_*scratch*` URL, non-`postgres` owner, no dotenv, `DATABASE_URL` from argv only) — own scratch `b17_u2b0_qa_scratch` | ✅ PASS, exit 0 | `served=19 denied=12`, `0 registry flips, 0 handler changes`, final row counts preserved |
| `scripts/b17-scope-proof.ts` | ⏭️ **EXCLUDED by contract** | contains `DELETE FROM assignments` (line 135); task §15 forbids using it. Scope coverage taken from `scope.test.ts` / `b17Scope*` unit tests inside the 162. |

## 4. QA's OWN guarded non-destructive PG18 harness

**File:** `TEMP\opencode\b17-u2b0-qa\qa-harness.mjs` (QA-written, independent assertions; not the executor's script). **Container:** QA-owned `b17-u2b0-qa-20261112` (`postgres:18`, published `127.0.0.1:65156` only); role `b17u2b0qa` = `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION` (verified `rolsuper=f rolbypassrls=f`, `session_user` non-bypass, `row_security=on`, server 18.6). Databases created: `b17_u2b0_{qa,ws,own,own2,own3}_scratch` (named, loopback, owner = runtime role). No other container touched; no ambient `DATABASE_URL`/PG* used; no cloud DSN.

**Guards re-implemented independently:** explicit `--allow-disposable-b17`; exactly one `--database-url=`; protocol `postgres:`; host ∈ {127.0.0.1, localhost, [::1]}; path matches `^/b17_[a-z0-9_]*scratch[a-z0-9_]*$`; no query/hash; username non-empty and ≠ `postgres`; `.env` asserted absent; `DATABASE_URL` overwritten from argv; `B17_SCRATCH_OPT_IN=YES`; random `JWT_SECRET`; empty public schema asserted before start.

**Non-destructive by construction:** INSERT-only seeding (two tenants A/B, two departments each, linked GRI service, own/foreign/frozen answers, own/frozen attachments, open action, 9 notification rows across P/W/C/E + foreign, platform + A + B audit rows, OD-10 content fixtures from the approved CSV keys); **every** §3 probe, tamper probe and freeze/size probe runs inside a transaction that ALWAYS rolls back; **no `DELETE` of any business row is written by the harness**; 21 business table counts asserted identical before/after.

**Real activation path used:** `runMigrations()` (predecessor schema) → seed → `applyB17Offline` (`applied`) → `assertB17Ready` → `inventoryB17ContentOffline` → `applyB17ContentOffline` (`applied`, then idempotent `verified`) → `STRUCTURE_SQL = B17_CONTENT_SHAPE` → ledger exactly `['B17_U1','B17_U2D']` (B0 did not bump the content version; the policy delta rides the U2D content transaction).

**Contexts are the real ones:** every probe sets the production GUCs via `setTenantContext` (the helper `withTenantContext` uses) under FORCE RLS as the non-bypass owner; P@T = platform mode deliberately carrying tenant A; owner with no GUCs sees 0 notifications (FORCE binds the owner).

## 5. §3 positives — all succeeded (through the real policy layer)

| Domain / context | Check | Result |
|---|---|---|
| audit **P** platform-only | reads `client_id IS NULL` ≥1; `client_id IS NOT NULL` = 0 | ✅ |
| audit **W** A-filtered | A rows ≥1 incl. `IMPORT_GRI_DISCLOSURES`=1; platform=0; B=0 | ✅ |
| audit **C/E** | both 0 rows | ✅ (denial) |
| notifications **P** inbox | own platform rows=1, tenant rows=0 | ✅ |
| notifications **W** inbox | own A=1; B=0; platform=0 | ✅ |
| notifications **C** inbox + read | own company=2, other users=0, platform=0, foreign=0; mark-one read=1 | ✅ |
| notifications **C read-all** | affects only C's own still-unread row (1); other-C user, W, P, E rows and C's platform row **all still unread** (verified incl. via rolled-back temp policy for invisible rows) | ✅ |
| notifications **P/W read-all** | P affects own platform rows only (1), never tenant rows; W affects own A rows only (1), never platform/B rows | ✅ |
| notifications **E** | SELECT = 0 rows | ✅ |
| storage **E upload** own-assigned parent | INSERT = 1 row (rolled back) | ✅ |
| storage **E delete** own uploader | DELETE = 1 row (rolled back) | ✅ |
| storage **W delete** (scoped GE) | DELETE = 1 row (rolled back) | ✅ |
| storage reads W/C/E | parent-answer bound reads succeed; E sees own bytes; no UPDATE policy on attachments | ✅ |
| actions **W create** (bounds) | INSERT = 1 row | ✅ |
| actions **W transition** | UPDATE = 1 row | ✅ |
| actions **C start-work** | UPDATE status = 1 row | ✅ |
| actions **C evidence** | UPDATE evidence_note = 1 row | ✅ |
| actions reads | W/C see own-company only; E 0 | ✅ |
| audit **append W/C** (work context) | INSERT = 1 row each | ✅ |

**Write positives: 9/9 succeeded (exactly 1 row each). Read positives: all as specified. ⇒ No §3 positive is impossible.**
## 6. Denials — all held (22 explicit + read denials)

| Denial | Actual outcome |
|---|---|
| E notifications read (UPDATE own row) | `0rows` |
| E notifications read-all | `0rows` |
| E notifications SELECT | `0rows` |
| E upload to foreign-department answer | `42501` |
| E action create / E action update | `42501` / `0rows` |
| C action create / P@T action create | `42501` / `42501` |
| W action create in foreign department (B1 under A) / foreign tenant (B) | `42501` / `42501` |
| C attachment delete / P@T attachment delete | `0rows` / `0rows` |
| C attachment upload / P@T attachment upload | `42501` / `42501` |
| W read-all over platform inbox rows | `0rows` |
| P@T audit append / P@T notifications read | `42501` / `0rows` |
| Foreign tenant reads: W audit B, W notifications B, W actions B, C audit A, C notifications B, C actions B, E actions/notifications/audit | all `0rows` |
| P@T audit reads (tenant **and** platform) | `0rows` / `0rows` |
| WITH CHECK: moving a notification out of the admitting scope | `42501` |

**Real dispatcher:** all 13 four-domain declarations × {anonymous, P, W, C, E} = **65 requests → `403 access.unactivated`** (registry `activation='UNACTIVATED'` for each of the 13). 8 U1 active routes unchanged (`/auth/me` 200 sanity inside the same run).

## 7. Append-only audit — what ACTUALLY happens (independently verified)

- **Policy layer default-deny:** under a valid W work context, `UPDATE audit_log SET action='…'` → **0 rows, no error**; `DELETE FROM audit_log` → **0 rows, no error** (no UPDATE/DELETE policy exists and FORCE RLS binds the owner).
- **Trigger backstop:** inside a single rolled-back transaction a temporary `FOR UPDATE` / `FOR DELETE` policy was created so the write could actually reach rows → **both raised `P0001` with message containing `append-only`** from `trg_block_audit_log_mod`.
- **Trigger inventory:** exactly **1** non-internal trigger `trg_block_audit_log_mod` on `audit_log`, `BEFORE`, covering `UPDATE` and `DELETE`.
- **⇒ Append-only is truly intact** (default-deny at policy layer + BEFORE UPDATE/DELETE trigger exception for any reaching write). Observation for Tera: the policy-layer result is a silent 0-row no-op rather than an error — harmless today because no handler performs audit UPDATE/DELETE, but any future code path must not treat "0 rows" as success.

## 8. freeze + 5 MB + WF-04 + 50-cap — unchanged

- **Freeze:** E insert into a GE-final-frozen parent → `FROZEN_SCOPE` exception; E delete of frozen-scope attachment → `FROZEN_SCOPE`; `trg_block_frozen_attachments` present (1); `block_frozen_scope_write` still `BEFORE` on answers/evaluations; no `DROP TRIGGER` anywhere in `b17-content.sql`.
- **5 MB:** oversize INSERT → SQLSTATE `23514`; `evidence_attachments` CHECK containing `5242880` present; `MAX_ATTACHMENT_BYTES === 5*1024*1024`; `validateAttachment` returns `attachments.oversize` / `attachments.mime` exactly as before.
- **WF-04:** `actions_status_check` constraint with `awaiting_verification` present (1); `canTransitionAction('open','in_progress')=true`, `('open','closed')=false`, `actionTransitionRequiresReason('reopened')=true`; the B0 actions-policy section contains **no** WF-04 state tokens (transition legality stays in `src/lib/actions.ts`, as §18 requires).
- **50-cap:** `NOTIFICATION_INBOX_LIMIT === 50`; **no** `notifications INSERT/DELETE` policy exists (fan-out/trim stays handler-owned).

## 9. Readiness — fingerprint drift and policy tamper refuse (then recover)

All inside rolled-back transactions, each asserted to reject with the exact error:

| Tamper | Refusal |
|---|---|
| `DROP POLICY b17_notifications` (a B0 policy) | `b17.schema_drift` |
| `DROP POLICY b17_attachments_insert` (a B0 policy) | `b17.schema_drift` |
| add rogue `b17_qa_rogue` SELECT policy | `b17.schema_drift` |
| ledger checksum → zeros (B17_U2D row) | `b17.version_drift` |
| insert rogue ledger version `B17_QA_ROGUE` | `b17.version_drift` |
| `GRANT EXECUTE … b17_content_fact TO PUBLIC` | `b17.content_authority_drift` |

After rollback: `assertB17Ready()` green and `STRUCTURE_SQL = B17_CONTENT_SHAPE` (recovers). Fingerprint covers policies, triggers, functions and the SECURITY DEFINER authority surface (exactly one privileged helper: `b17_content_fact`).

## 10. Dropped-notifications regression (U2D gap) — covered

`b17_notifications` SELECT policy **exists** again (`pg_policies` count = 1); P platform inbox visible, W own-A visible, C own-company visible (and only own rows), **E sees none**; P/W/C read + read-all operate on own scope only. The U2D-era "all four notification reads return 0 rows" defect is closed at the policy layer.

## 11. Concurrency / scope hygiene

- QA wrote **only** this file in the workspace (parent validated; file did not previously exist). Instrumentation lives only in `TEMP\opencode\b17-u2b0-qa\`.
- Source integrity before vs after all runs: SHA-256 of the 5 B0 files + `b17.sql`, `capabilities.ts`, `access.ts`, `accessRegistry.ts` and all 4 domain handlers **identical pre/post**; `git status` still 31 entries; `git diff c4ee8bc --stat` still `8 files, +324/−592`; no `.env`; `dist/` gitignored.
- Own container `b17-u2b0-qa-20261112` stopped/removed after this report; pre-existing unrelated containers (incl. `b17-u2d-qa-20261112`) left untouched. No cloud, no commit/push, no app-source edit, no agent creation.

## 12. Pass/Fail decision

# ✅ PASS — TASK-PROTO-B17-U2-B0 on executed scope

- **Critical focus (§3 positives):** PASS — every newly-needed positive succeeds through FORCE RLS as the non-bypass owner in its own context; **no §3 positive is impossible**.
- **Denials:** PASS — all 22 explicit denials + all read denials hold (0 rows / 42501); 65/65 dispatcher denials.
- **No over-grant found:** every B0 policy is row-scoped to §3 (own-user inbox, parent-answer attachments, W/C action bounds, P-platform/W-A audit); WITH CHECK blocks scope escape; no notifications INSERT/DELETE, no UPDATE policy on attachments, no WF-04 state in SQL, no trigger dropped, no new SECURITY DEFINER helper.
- **B0 boundary:** PASS — diff = exactly the 5 §18-allowlisted files; **no handler / registry / dispatcher / capabilities / `b17.sql` / `b17ContentMigration.ts` change** (hash-proven against recorded baselines + git stat + mtime window + markers + functional 0-flip evidence).
- lint 0 · **test 162/162 (claim verified)** · no-env build 0 · own harness 15 groups PASS (9 write positives, 22 denials, non-destructive) · executor proof 19/12 PASS · workspace proof PASS.

**NOT VERIFIED (recorded, not converted to PASS):**
1. Byte-level B0-only git reconstruction — impossible (single cumulative uncommitted stack since c4ee8bc); substituted evidence = recorded-hash manifest diff + post-§18 mtime window + markers + functional 0-flip checks.
2. `scripts/b17-scope-proof.ts` re-run — excluded by task §15 (`DELETE FROM assignments`); scope behaviour covered only by unit tests in the 162.
3. §3 positives **through the 13 HTTP handlers** — impossible by design in B0 (routes must stay UNACTIVATED until U2-B round 2); proven at the policy layer + 403-denial at the dispatcher, exactly as §18 scopes it.

**Risks / notes for Tera:**
- R1 (low): B0 changes `b17-content.sql`'s file checksum, so any scratch DB activated with the pre-B0 content file now refuses readiness (`version_drift`) until recreated — no in-place upgrade path is offered; acceptable for disposable scratch, flag if any retained activated DB exists.
- R2 (low): C's action UPDATE policy admits any column on rows inside C's row scope (status transitions included). WF-04 legality and C's "start-work/evidence only" restriction remain handler obligations — safe today only because all 13 routes are UNACTIVATED; U2-B round 2 must enforce them in the handler before activation.
- R3 (info): append-only default-deny returns 0 rows rather than an error (see §7).

## 13. Full output (key excerpts)

```text
$ npm run lint            → exit 0
$ npm test                → # tests 162  # pass 162  # fail 0  # suites 5  # skipped 0   (exit 0)
$ npm run build           → ✓ built, ENV_PRESENT=FALSE / ENV_AFTER=FALSE              (exit 0)

$ node --import tsx scripts/b17-workspace-proof.ts --allow-disposable-b17 --database-url=…b17_u2b0_ws_scratch
B17_U1 isolated HTTP/RLS proof complete. No legacy business activation or release acceptance.   (exit 0)

$ node --import tsx scripts/b17-domain-proof.ts --allow-disposable-b17 --database-url=…b17_u2b0_qa_scratch
PASS guards … offline U1 + U2D/B0 content activation, readiness green
B0_RLS served=19 denied=12 :: E notifications read=0rows | E action create=42501 | C action create=42501 |
 P action create (platform@T mode mismatch)=42501 | W action create in a foreign department/tenant=42501 |
 E upload to a foreign-department answer=42501 | C attachment delete=0rows | P attachment delete=0rows |
 W read-all over platform inbox rows=0rows | P business audit append=42501 | audit_log UPDATE=0rows | audit_log DELETE=0rows
B17_U2B0 policy-substrate proof complete. 0 registry flips, 0 handler changes; all 13 routes remain UNACTIVATED. (exit 0)

$ node --import tsx TEMP\…\qa-harness.mjs --allow-disposable-b17 --database-url=…b17_u2b0_own3_scratch
PASS guards: opt-in loopback named scratch, argv-only URL, no .env, non-superuser/non-BYPASSRLS PG18, empty start
PASS offline U1 + U2D/B0 content activation idempotent; readiness green; structure fingerprint matches
PASS FORCE RLS binds owner; registry 95=8U1+87UNACTIVATED, 99 rows; all 13 four-domain routes UNACTIVATED; capabilities empty
PASS real dispatcher: all 13 four-domain routes 403 access.unactivated across anonymous/P/W/C/E (65 checks)
PASS audit reads: P platform-only, W A-filtered incl. business events, C/E denied, P@T mismatch denied
PASS dropped-notifications regression: P/W/C inbox visible per §3, E none, 50-cap + trim policy absence intact
PASS notifications read/read-all: C own-rows-only, P platform-only, W A-only, foreign/platform rows untouched, scope-move refused
PASS storage reads/positives: E own upload+delete, W admin delete, W/C/E parent-bound reads
PASS actions: W create/transition + C start-work/evidence succeed; W/C own-company reads only; E none
PASS business audit INSERT allowed under W/C work context (§3 row scope only)
PASS all denials held (22): E notifications/upload/action, C/P action-create+attachment-delete, foreign tenant/department, P@T mismatch
APPEND_ONLY_POLICY_LAYER UPDATE=0 rows DELETE=0 rows | temp-policy reaching write=P0001/P0001
PASS append-only audit intact: policy layer default-denies (0 rows), reaching write raises trigger exception
PASS freeze (FROZEN_SCOPE trigger) + 5MB CHECK/validator + WF-04 constraint/lib rules + 50-cap all unchanged
PASS readiness refuses structure/policy/ledger/authority drift and recovers after rollback
PASS non-destructive: 21 business tables count identical before/after (all probes rolled back)
QA_HARNESS_RESULT PASS groups=15 positives=9 denials=22                                        (exit 0)
```

## QA Agent Signature
QA Agent (Execution Mode) — 2026-11-12 19:10 +03:00 — verdict **PASS** on executed scope. Own container `b17-u2b0-qa-20261112` stopped/removed after this report; no application source written; no commit/push.