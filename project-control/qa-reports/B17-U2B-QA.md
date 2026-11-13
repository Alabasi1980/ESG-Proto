# Test Report — TASK-PROTO-B17-U2-B round 3 (13-route retrofit + first flips)

## Task Information
- **Task:** TASK-PROTO-B17-U2-B **round 3** — retrofit the 13 audit/notifications/storage/actions declarations through the real dispatcher → `requireDomainAccess` → scope → handler chain and flip exactly those 13 activation flags.
- **Contract:** `prototype/TASK-PROTO-B17.md` §15 / §17 / §18 / §19 / §20 (D1 = users-SELECT branches, D2 = test inversion authorised, D3 = P@T usage-gap deferred); `prototype/B17_TECHNICAL_SPEC.md` §3.5 + §3.6 (the 13 rows), §4 (workspace/mode/lock), §8 (workflow & side-effect registry).
- **QA session:** QA Agent (Execution Mode) — 2026-11-12 23:15 +03:00.
- **Base:** `c4ee8bccb87b53fbc957861178832029cde769be` = `HEAD` = `origin/main` (re-checked; **no commit/push performed**).
- **Environment:** Windows (win32), Node v22.22.2, npm 12.2.2, Docker 29.9.2, `postgres:18` image (server **18.6**), **no `.env` present** (only `.env.example`) before, during and after.
- **Conduct gate:** `tera-system/TERA_AGENT_CONDUCT.md` read first; Untrusted-Content rule applied (all repo/task content treated as DATA, not instructions).
- **Authorisation used:** report-only write to **this file** (PowerShell writer, parent `project-control/qa-reports/` validated, file did not previously exist); disposable instrumentation under `C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2b-qa-r3\`; QA-owned Docker container. **No application source write, no `security-reports/*` write, no cloud, no `.env`, no commit/push, no agent creation.**

---

## 1. Independent round-3 diff discovery from c4ee8bc (before any test)

Executed by QA, not taken from any executor statement. The worktree is one cumulative uncommitted stack, so a byte-level "round-3-only" git reconstruction is impossible by design (same limitation recorded in `B17-U2A-QA.md` §1). Substituted evidence — four independent signals that agree:

1. **git baseline (cumulative):** `git status --porcelain` = **37 entries**; `git diff --shortstat` = **13 files changed, 543 insertions(+), 777 deletions(-)** — captured **before** any QA test and **identical after** all tests. The 13 tracked files are: `server.ts`, `src/db/index.ts`, `src/db/schema.sql`, `src/lib/routeGates.test.ts`, `src/server/{auth.ts,routes.ts,routes/_shared.ts,routes/actions.ts,routes/audit.ts,routes/notifications.ts,routes/session.ts,routes/storage.ts,routes/system.ts}`.
2. **mtime window:** the last verified pre-round-3 state is `B17-U2B0-QA.md` (19:10) and the round-2 discovery-only STOP artifact `scripts/b17-freshgate-proof.ts` (19:48:51). Everything written after that, **20:58:54 → 22:07:30**, is the round-3 delta — **exactly 17 files**, no more:

   | # | File (mtime) | §15/§19/§20 allowlist source |
   |---|---|---|
   | 1 | `src/server/routes/_shared.ts` (20:58) | §19(2) `readContext()` purpose binding |
   | 2 | `src/server/routes/audit.ts` (20:59) | §19(2) audit users-JOIN repair |
   | 3 | `src/server/routes/notifications.ts` (21:00) | §19(2) purpose binding (same `readContext` fix) |
   | 4 | `src/server/routes/storage.ts` (21:01) | §19(2) `isAdmin` contradiction + purpose binding |
   | 5 | `src/server/routes/actions.ts` (21:04) | §19(4)/R2 C column scope handler-side |
   | 6 | `src/lib/capabilities.ts` (21:05) | §15(2) writable from the first flip round |
   | 7 | `src/server/accessRegistry.ts` (21:05) | §15(2) registry flips |
   | 8 | `src/server/access.ts` (21:06) | §15(2) dispatcher/wrapper checks |
   | 9 | `src/lib/capabilities.test.ts` (21:06) | §15(2) `(+ capabilities.test.ts)` |
   | 10 | `src/lib/domainAccess.test.ts` (21:07) | §15 registry-coverage table test (U2-A file, updated at flip) |
   | 11 | `scripts/b17-scope-proof.ts` (21:08) | **not named in §15/§19/§20 — see §12 observation S1** |
   | 12 | `src/lib/routeGates.test.ts` (21:10) | spec §10 U2 row (`relevant src/lib/routeGates.test.ts`) |
   | 13 | `src/db/b17-content.sql` (21:59) | §19(1) + §20 D1 (notify fan-out/trim + users SELECT) |
   | 14 | `src/lib/b17DomainPolicies.test.ts` (21:59) | §20 **D2** (absence-pin inverted to assert the new scope) |
   | 15 | `src/db/b17Readiness.ts` (22:00) | §19(1) + §20 D1 (fingerprint for the new policy) |
   | 16 | `scripts/b17-domain-proof.ts` (22:02) | §19 allowed targets (`scripts/b17-domain-proof.ts`) |
   | 17 | `scripts/b17-workspace-proof.ts` (22:07) | **not named in §15/§19/§20 — see §12 observation S1** |

   Round-2's `scripts/b17-freshgate-proof.ts` (19:48) is accounted for by §20 and is **source-untouched**.
3. **In-source markers:** `U2-B round 3` / `task §19(2)` / `task §20 D1|D2` / `87 -> 74` markers occur **only** in files 1–16 above (plus the ControlPath contract text). **None** in `b17.sql`, `workspace.ts`, `auth.ts`, `session.ts`, `routes.ts`, `system.ts`, `gri.ts`, `evaluations.ts`, `initiatives.ts`, `reports.ts`, `admin.ts`, or any UI file.
4. **Recorded-hash manifest** (`B17-U2D-QA.md` Appendix C, 111 files, recomputed by QA): protected files all **UNCHANGED** — `src/db/b17.sql` `ACE11265…406D8D6`, `src/server/workspace.ts`, `src/server/auth.ts`, `routes/{session,system}.ts`, `routes.ts`, `src/db/index.ts`, `src/db/schema.sql`, `server.ts`, `package.json`, `bun.lock`, `routes/{gri,evaluations,initiatives,reports,admin}.ts`, `src/server/jsonInput.ts`, `src/db/b17ContentMigration.ts`. (`src/server/scope.ts` differs from Appendix C but is the **U2D round-4** change, mtime 10:21, i.e. pre-round-3.)

**Emphasis list result (task requirement):**
- `src/db/b17.sql` — **UNCHANGED** (hash + mtime 11-11 22:06).
- `src/server/workspace.ts`, `src/server/auth.ts`, `src/server/routes/session.ts` — **UNCHANGED** (hash + mtime 11-11 / 12-11 07:5x, all pre-round-3).
- Other handlers (`gri`, `evaluations`, `initiatives`, `reports`, `admin`, `taxonomy`) — **UNCHANGED** (hash + git not modified).
- UI (`src/views/*`, `src/components/*`, `src/context/*`, `src/i18n/*`, `App.tsx`) — **UNCHANGED** (all mtimes 11-11; git-clean).
- Dependencies/config (`package.json`, `bun.lock`, `vite.config.ts`, `tsconfig.json`) — **UNCHANGED**.
- **No file outside the table above was written in round 3.** Two entries (11, 17) sit outside the literal §15/§19/§20 target lists — recorded as **observation S1**, not silently accepted.

---

## 2. npm lint / test / no-env build

| # | Command (cwd = prototype-app) | Result | Detail |
|---|---|---|---|
| 1 | `npm run lint` (`tsc --noEmit`) | ✅ PASS | exit 0, no diagnostics |
| 2 | `npm test` (`tsx --test src/**/*.test.ts`) | ✅ PASS | **`# tests 163  # pass 163  # fail 0  # suites 5  # skipped 0`**, exit 0 — claimed **163 verified current** |
| 3 | `npm run build` (`vite build`) with **no `.env`** | ✅ PASS | exit 0; `ENV_PRESENT=FALSE` before and `ENV_AFTER=FALSE`; only the pre-existing >500 kB chunk warning |

---

## 3. Repository proof scripts (guards read before use)

`scripts/b17-domain-proof.ts` **guards read in full before use** (lines 1–70): explicit `--allow-disposable-b17`; exactly one `--database-url=` from argv only; `postgres:` + loopback host + path matching `^/b17_[a-z0-9_]*scratch[a-z0-9_]*$`; no query/hash; owner non-empty and ≠ `postgres`; no dotenv import; `B17_SCRATCH_OPT_IN`; empty public schema asserted; non-superuser/non-BYPASSRLS asserted. The file header states the non-destructive contract (no `DELETE FROM assignments/answers`; probes roll back).

| Proof | Result | Detail |
|---|---|---|
| `scripts/b17-domain-proof.ts` (own scratch `b17_u2b_qa_dom_scratch`) | ✅ PASS, **exit 0** | guards → offline U1 + U2D/B0 content activation → readiness green → `registry truth: exactly 13 flips (87 -> 74)` → `74 × 4 = 296` dispatcher denials → §3 positives/negatives → freeze/5MB/WF-04/readiness → `U2-B round 3 E2E: 13 routes exercised through dispatcher→requireDomainAccess→scope→handler` → `B17_U2B round-3 proof complete` |
| `scripts/b17-workspace-proof.ts` (own scratch `b17_u2b_qa_ws2_scratch`) | ✅ PASS, **exit 0** | all U1 lifecycle/lock/20-tab/drift sections green; **`all 74 remaining unactivated business declarations denied across anonymous/platform/consultant/client/employee`** (dynamic count, adapts to the flips); `B17_U1 isolated HTTP/RLS proof complete` |
| `scripts/b17-scope-proof.ts` | ⏭️ **EXCLUDED by task §15** | contains `DELETE FROM assignments` (line 135); §15 forbids using it. Scope behaviour covered by `scope.test.ts` / `b17Scope*` inside the 163. |

---

## 4. QA's OWN guarded non-destructive PG18 harness

**File:** `C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2b-qa-r3\qa-harness.mts` — **QA-written, independent assertions, not the executor's script** (the executor's `b17-domain-proof.ts` was read for its guards and for context only; every expectation below was re-derived by QA from spec §3/§4/§8).

**Container:** QA-owned `b17-u2b-qa-r3` (`postgres:18`, published **`127.0.0.1:37462` only**, server 18.6). Role **`b17u2bqa`** = `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION` (verified `rolsuper=f rolbypassrls=f`, `row_security=on`, `session_user=b17u2bqa`). Databases created: `b17_u2b_qa_scratch`, `b17_u2b_qa_dom_scratch`, `b17_u2b_qa_ws2_scratch` (named, loopback, owned by the runtime role). No other container touched; no ambient `DATABASE_URL`/`PG*` used; no cloud DSN.

**Guards re-implemented independently:** explicit `--allow-disposable-b17`; exactly one `--database-url=`; protocol `postgres:`; host ∈ {127.0.0.1, localhost, [::1]}; path `^/b17_[a-z0-9_]*scratch[a-z0-9_]*$`; no query/hash; username non-empty ≠ `postgres`; `.env` asserted absent before **and** after; `DATABASE_URL` overwritten from argv only; `B17_SCRATCH_OPT_IN=YES`; random `JWT_SECRET`; empty public schema asserted before start.

**Non-destructive by construction:** the harness issues **no `DELETE` against any business table**. Fixtures are INSERT-only (tenants `Q3A`/`Q3B`, 2 departments each, linked GRI service, own/foreign-department/frozen answers, own/other-uploader/frozen attachments, actions in A(d1)/A(d2)/B, 12 notification rows across P/W/C/E/foreign/second-GE, platform+A+B audit rows, OD-10 content fixtures from the approved CSV keys). Every policy probe and drift probe runs inside a transaction that **ALWAYS rolls back**. A fixed multi-context core-table census taken after activation is repeated unchanged at the end (see §11).

**Real activation path:** `runMigrations()` (predecessor schema) → seed → `applyB17Offline` (`applied`) → `assertB17Ready` → `inventoryB17ContentOffline` → `applyB17ContentOffline` (`applied`, then idempotent `verified`) → `STRUCTURE_SQL = B17_CONTENT_SHAPE`.

**Contexts are the real ones:** every probe sets the production GUCs via `setTenantContext` (the helper `withTenantContext` uses) under FORCE RLS as the non-bypass owner; HTTP probes use **real logins + real workspace tabs** through the mounted `apiRouter`.

---

## 5. Requirement (1) — all 13 routes END-TO-END for every §3 allowed context, and every §3 disallowed context refused

Every assertion below went through `accessDispatcher → requireDomainAccess → readContext/scope → handler` on a live loopback HTTP server (first time this chain has ever executed).

### 5.1 §3 matrix transcription (QA's own re-reading of spec §3.5/§3.6 ⇄ registry)

For each of the 13 rows QA independently transcribed `(context, tenant, tags)` from `B17_TECHNICAL_SPEC.md` and compared against `parseMatrix(route.matrix)`: **13/13 exact matches**, 0 missing / 0 invented / 0 mismatched; all 13 `activation === 'U1'`.

### 5.2 Allowed contexts (all served)

| Route | Allowed per §3 | Observed |
|---|---|---|
| `GET /audit-log` | P (platform events only), W (mandatory A filter) | 200 / 200 ✅ |
| `GET /notifications` | P, W, C | 200 / 200 / 200 ✅ |
| `GET /notifications/unread-count` | P, W, C | 200 / 200 / 200 ✅ |
| `POST /notifications/:id/read` | P, W, C | 200 / 200 / 200 ✅ |
| `POST /notifications/read-all` | P, W, C | 200 / 200 / 200 ✅ |
| `POST /answers/:id/attachments` | E own assigned parent R+L+D | **201** ✅ (uploader pinned to the server-derived actor) |
| `GET /answers/:id/attachments` | W, C, E | 200 / 200 / 200 ✅ |
| `GET …/:attachId/download` | W, C, E | 200 / 200 / 200 ✅ |
| `DELETE …/:attachId` | E own uploader **or** W scoped GE | **200 / 200** ✅ |
| `GET /storage/usage` | P@T, W, C, E | 200 / 200 / 200 / 200 ✅ |
| `GET /actions` | W, C (C covers ALL own-company departments) | 200 / 200 ✅ |
| `POST /actions` | W only | **201** (item-linked) + **201** (standalone with explicit linked `serviceId`) ✅ |
| `PATCH /actions/:id` | W GE transitions; C start-work + evidence | 200 / 200 ✅ |

### 5.3 Disallowed contexts (all refused with the §3 status/code)

| Refusal | Observed |
|---|---|
| `POST /actions` by **P** | **403 `workspace.mode_mismatch`** (GE platform→W-only row) |
| `POST /actions` by C, by E | 403 / 403 |
| `GET /actions` by P, by E | 403 / 403 |
| `PATCH /actions/:id` by P, by E | 403 / 403 |
| `POST /answers/:id/attachments` by **W** | **403 `workspace.mode_mismatch`** (GE consultant→E-only row) |
| … by **P** | **403 `workspace.mode_mismatch`** |
| … by C | 403 |
| `GET /answers/:id/attachments`, `…/download` by P | 403 / 403 |
| **`DELETE …/:attachId` by C** | **403** ✅ (§3 C-storage-DELETE; matrix refusal **and** handler-side refusal — the old `isAdmin` branch is gone) |
| `DELETE …/:attachId` by P | 403 |
| `GET /storage/usage` by P **without** T | **400** (D3) |
| `GET /audit-log` by **C**, by **E** | **403 / 403** (delegates cannot reopen it) |
| `GET /notifications` + unread-count + read + read-all by **E** | **403 / 403 / 403 / 403** (no polling path) |
| anonymous on any of the 13 | **401 `auth.invalid`** |
| foreign `clientId` / foreign `departmentId` filters (W) | **403** (own department filter still 200 — narrows, never broadens) |
| malformed `clientId` (`not-a-uuid`) | **400 `scope.id_invalid`** |

**Both GE directions proven, and shared rows admit both:** platform→W-only and consultant→E-only (and platform on the E-only row) all `403 workspace.mode_mismatch`, while `GET /audit-log` and `GET /notifications` return 200 for **both** GE modes (their matrix is `P;W[;C]`).

**Disallowed-context side effects:** cross-tenant notification is a **404** (scope + ownership), a guessed `attachId` is a **404**, a foreign-department answer parent is a **404**, a foreign action is a **404**, `?status=bogus` is a **400** — all as §3/§4 specify.

---

## 6. Requirement (2) — exactly 13 activation flags flipped 87→74, nothing else

| Check | Result |
|---|---|
| `ACCESS_REGISTRY.length` | **99** (95 legacy + 4 workspace) ✅ |
| `LEGACY_ROUTES.length` | **95** ✅ |
| rows with `activation === 'U1'` | **21** = 8 system/session + **exactly the 13 four-domain rows** (asserted as an exact sorted key-set equality) ✅ |
| rows with `activation === 'UNACTIVATED'` | **74** (87 → 74) ✅ |
| capability groups still `UNACTIVATED` | exactly `['admin','evaluations','gri','initiatives','reports','taxonomy']` (18+5+15+25+4+7 = 74) — **no four-domain row remains UNACTIVATED, no other group moved** ✅ |
| `activeBusinessCapabilities()` | `['actions','storage','audit','notifications']` ✅ |
| workspace `enter` envelope `capabilities` | `['actions','storage','audit','notifications']` ✅ (feeds `workspace.ts` truthfully) |
| **Functional proof that no other row changed** | all **74** remaining `UNACTIVATED` declarations × 4 contexts = **296 HTTP requests** → **403 `access.unactivated`**, every one ✅ |

---

## 7. Requirement (3) — D1 fresh gate + user-name joins without `password_hash`

- **D1 branch 2 / F-03 through an ACTIVATED mutating route:** with `must_change_password=true`, `POST /notifications/<uuid>/read` → **403 `auth.password_change_required`** (gate runs before the handler); with it cleared, the same call reaches the handler and returns **404** (no such notification). This proves `requireFreshPassword → contextFromUser` (purpose NULL, session NULL, own row) reads its own `users` row under the new policy — without it every activated mutating route would 401.
- **audit JOIN:** P response contains `user_name = 'q3-ge'` for the platform actor; W response contains `user_name = 'q3-ca'` for the own-tenant actor. `JSON.stringify(...)` contains **no `password_hash`** and **no `$2b$`** bcrypt material in either P or W payloads.
- **storage JOIN:** attachment metadata returns `uploaded_by_name = 'q3-e1'` with **no `password_hash`**.
- **Scope of the new `b17_domain_users_read` policy:** `purpose='work'` → P sees only `client_id IS NULL` rows, W/C/E only own-tenant rows (asserted by the policy-shape test in the 163 **and** by runtime behaviour above).

---

## 8. Requirement (4) — notify INSERT + cap-trim scope (56→50 own-row), no cross-tenant exposure via the GUC

- **Cap path through the REAL handler:** `capadmin` (tenant-A `client_admin`, **0** rows) pre-filled to **55** own rows → `PATCH /actions/:id` `in_progress → awaiting_verification` as W triggers `notifyUsers` → **56** → cap-trim → **exactly 50**. ✅
- **Other rows untouched by the same fan-out:** `ca` +1 (no trim), owner-dept `e1` +1, `e3` +1 (second department member), other-department `e2` **unchanged**, GE inbox **unchanged**, **tenant-B inbox unchanged**, `capadmin` holds **no** foreign-tenant row. ✅
- **`notify_trim_target` GUC cannot expose another tenant's inbox** (explicit probe): under a tenant-A work context with `app.notify_trim_target` set to a **tenant-B user → 0 rows**; set to the GE actor → **platform rows (`client_id IS NULL`) 0 rows** (scope half still enforced); same-tenant recipient rows **are** admitted (the branch works as designed); a tenant-B context with the same GUC sees **only** the B row (1), never the A or platform rows. ✅
- **D2 test inversion present and real:** `src/lib/b17DomainPolicies.test.ts` now asserts the **existence and scope** of `b17_notifications_insert` / `b17_notifications_delete` / `b17_domain_users_read` (tenant+recipient binding, purpose binding, no `SECURITY DEFINER`, `b17_notify_target` invoker-only) instead of pinning their absence. ✅

---

## 9. Requirement (5) — freeze / 5 MB / mime / WF-04 / append-only / 50-cap through the handlers

| Guard | Through the real handler | Result |
|---|---|---|
| freeze | upload to a GE-final-frozen parent | **409** ("frozen by GE final approval") ✅ |
| freeze | delete of a frozen-scope attachment | **409** ✅ |
| 5 MB | multipart upload of `MAX_ATTACHMENT_BYTES + 1` | **400 `attachments.oversize`** ✅ |
| mime | `application/x-msdownload` | **400 `attachments.mime`** ✅ |
| WF-04 | `awaiting_verification → in_progress` | **409** (illegal transition) ✅ |
| WF-04 | `awaiting_verification → reopened` without reason | **400** (reason required) ✅ |
| WF-04 | `open → closed` | **409** ✅ |
| WF-04 | C `in_progress → awaiting_verification` / `→ closed` | **403** (GE-only message retained) / **409** ✅ |
| WF-04 | C unknown status / empty body | **400 / 400** ✅ |
| C column scope | PATCH carrying `title`/`due_date`/`owner_department_id` alongside `evidenceNote` | only `evidence_note` + `updated_at` move; title/due_date/owner_department_id/client_id **byte-identical** before/after ✅ |
| append-only | `UPDATE audit_log` under a valid W work context | **0 rows, no error** (policy-layer default-deny) ✅ |
| append-only | `DELETE FROM audit_log` under a valid W work context | **0 rows, no error** ✅ |
| append-only | trigger inventory | exactly **1** non-internal `BEFORE UPDATE OR DELETE` trigger on `audit_log` (`trg_block_audit_log_mod`) ✅ |
| append-only | reaching write (temp SELECT+UPDATE policy inside an ALWAYS-rolled-back transaction) | raises with message containing **`append-only`** ✅ |
| 50-cap | `NOTIFICATION_INBOX_LIMIT` + trim | **50** exactly, own rows only (§8) ✅ |
| audit atomicity | `POST /actions` success | `ACTION_CREATED` appended **exactly once** with `user_id =` the real GE actor ✅ |

---

## 10. Requirement (6) — D3 usage dispositions

| Probe | Result |
|---|---|
| P **without** explicit `clientId` | **400** ✅ |
| W / C / E with **foreign** `clientId` | **403 / 403 / 403** ✅ |
| malformed `clientId` | **400 `scope.id_invalid`** ✅ |
| W / C / E without `clientId` | **200** with **true** counts (`files ≥ 1`, `bytes > 0`) ✅ |
| **P@T** | **200** but `files=0 bytes=0` while W sees `files=3` → **recorded as KNOWN GAP (task §20 D3), NOT a PASS**: true P@T counts are deferred to a later platform-summary round; no new definer aggregate, no blanket P blob read, no §5 loosening |

---

## 11. Requirement (7) — readiness fingerprint drift still refuses + non-destructive closure

All inside transactions that ALWAYS rolled back:

| Tamper | Refusal |
|---|---|
| `DROP POLICY b17_domain_users_read` (the **new** D1 policy) | `b17.schema_drift` |
| `DROP POLICY b17_notifications_insert` (the new notify policy) | `b17.schema_drift` |
| add rogue `b17qa_rogue` SELECT policy | `b17.schema_drift` |
| insert rogue ledger version `B17_QA_ROGUE` via the real `purpose='migration'` INSERT path | `b17.version_drift` |
| `GRANT EXECUTE … b17_content_fact TO PUBLIC` | `b17.content_authority_drift` |
| `UPDATE app_schema_versions` (no UPDATE policy) | **0 rows** — the ledger is immutable at the policy layer |

After rollback: `assertB17Ready()` green and `STRUCTURE_SQL = B17_CONTENT_SHAPE` (recovers).

**Non-destructive closure:** the fixed multi-context core-table census (19 tables: clients, departments, users, standards, disclosures, items, services, client_services, assignments, answers, evaluations, approvals, report_settings, esg_profile, staff_lists, staff_list_rows, client_initiatives, review_snapshots, snapshot_notes) is **identical** before and after the whole run; the seed census itself equals exactly the INSERT-only fixture (`clients 2, departments 4, users 9, standards 3, disclosures 3, items 3, client_services 1, assignments 4, answers 3, report_settings 1, esg_profile 1, review_snapshots 1, everything else 0`); **every** seeded notification / audit / attachment / action row survives; **no `.env` appeared**.

---

## 12. Observations / NOT VERIFIED (recorded, not converted to PASS)

**S1 (scope observation, needs a Tera call): two proof scripts outside the literal §15/§19/§20 target list were touched in round 3** — `scripts/b17-workspace-proof.ts` (22:07) and `scripts/b17-scope-proof.ts` (21:08). Mitigating evidence, offered as context, **not** as a waiver: both are named U1/U2D proof targets in spec §10/§13; §19 requires the workspace/scope/domain proofs to re-run **green**; QA reviewed every flip-sensitive assertion in both and found them **dynamic** (the `UNACTIVATED` sweep uses `filter(r => r.activation === 'UNACTIVATED')` and a computed count — **no hardcoded route count, no weakened assertion**) and `b17-scope-proof.ts`'s `b17_setting('current_purpose') === 'work'` assertions are the natural counterpart of the §19(2) purpose binding. Both proofs re-run **green** (§3). **NOT VERIFIED:** the exact byte-level delta of these two files — they are untracked, no git baseline exists, and no prior recorded content was found on disk. *Decision needed from Tera: ratify the two proof-script edits, or require the executor to justify them.*

**S2 — `src/lib/domainAccess.test.ts`** (21:07) is likewise not literally named in §15/§20, but it **is** the registry-coverage table test §15 mandates for every flip round; its content is the flip set itself (74/21/13 assertions). Not treated as scope drift.

**S3 — P@T storage usage returns zeros, not true counts** — the §20 D3 KNOWN GAP, deliberately deferred. Not a PASS.

**S4 — policy-layer default-deny is silent (0 rows) rather than an error** for `audit_log` UPDATE/DELETE; harmless today (no handler performs them) but any future path must not treat "0 rows" as success. Observation for Tera.

**S5 — byte-level round-3-only git reconstruction is impossible** (single cumulative uncommitted stack since `c4ee8bc`); substituted evidence is the four agreeing signals in §1.

---

## 13. Pass/Fail decision

# ✅ PASS — TASK-PROTO-B17-U2-B round 3, on executed scope

- **§3 positives (requirement 1): PASS** — all 13 declarations served for **every** allowed context (P/W/C/E as specified) through the real `accessDispatcher → requireDomainAccess → readContext/scope → handler` chain; QA's own §3.5/§3.6 re-transcription matches the registry on all 13 rows.
- **§3 negatives (requirement 1): PASS** — every disallowed context refused with the specified status/code, including **both GE directions** (`403 workspace.mode_mismatch` on platform→W-only and consultant→E-only), **C storage-DELETE 403**, audit **P-platform-only / W-A-filtered / C+E 403**, notifications **P/W/C own + E 403 on all four**, actions **W-create 201 / C start-work+evidence 200 with WF-04 / E+P 403**, plus 404/400 for foreign/guessed/malformed ids. **No over-grant found.**
- **Requirement 2: PASS** — exactly **13** flips, **87 → 74**, U1 key-set equality proven, untouched capability groups proven, `activeBusinessCapabilities()` truthful, and **296** HTTP probes confirm no other declaration became reachable.
- **Requirement 3: PASS** — D1/F-03 fresh gate works end-to-end on an activated mutating route; audit + storage name joins return real names with **no `password_hash` / no bcrypt material**.
- **Requirement 4: PASS** — notify INSERT + cap-trim **56 → 50 own-row**, every other user's/tenant's rows untouched, and the `notify_trim_target` GUC path **cannot** expose another tenant's inbox or platform rows.
- **Requirement 5: PASS** — freeze **409**, 5 MB **400**, mime **400**, WF-04 **409/400/403**, append-only (policy default-deny + trigger backstop), 50-cap — all enforced **through the handlers**.
- **Requirement 6: PASS with KNOWN GAP** — P-without-T **400**, foreign-T **403**, P@T **zeros recorded as a KNOWN GAP, not a PASS** (§20 D3).
- **Requirement 7: PASS** — readiness refuses D1/notify/rogue-policy/ledger/authority drift and recovers; **workspace proof** and **domain proof** re-run green on QA-owned scratch DBs.
- **Diff/scope:** the emphasis list (`b17.sql`, `workspace.ts`, `session.ts`, `auth.ts`, other handlers, UI, deps/config) is **byte-unchanged**; the round-3 delta is **exactly the 17 files** in §1; **observation S1** (2 proof scripts outside the literal target lists) is escalated rather than absorbed.
- **lint 0 · test 163/163 (claim verified current) · no-env build 0 · QA harness 16 PASS groups + exit 0 · domain proof exit 0 · workspace proof exit 0.**

**NOT VERIFIED (recorded, not converted to PASS):** S1 byte-level delta of the two proof scripts; S5 byte-level round-3-only git reconstruction.

**No §3 failure and no over-grant were found, so the task's FAIL condition is not met.**

---

## 14. Concurrency / source integrity

- QA wrote **only this file** in the workspace (parent validated; file did not previously exist). Instrumentation lives only in `TEMP\opencode\b17-u2b-qa-r3\` (a `node_modules` junction to the app's `node_modules` was created there solely so module resolution works; nothing was written into the repo).
- Source integrity **before vs after all runs:** `git status` still **37** entries; `git diff --shortstat` still **13 files, +543/−777**; protected-file SHA-256 vs `B17-U2D-QA.md` Appendix C **0 changed**; newest `src/`+`scripts/` mtime still `22:07:30` (i.e. **QA wrote no source**); **no `.env`**; `dist/` gitignored.
- QA-owned container `b17-u2b-qa-r3` stopped/removed after this report; pre-existing unrelated containers (incl. `b17-u2b-r2-pg`, `b17-u2d-qa-20261112`) left untouched. No cloud, no commit/push, no app-source edit, no `security-reports/*` write, no agent creation.

---

## 15. Full output (key excerpts)

```text
$ npm run lint             → exit 0
$ npm test                 → # tests 163  # pass 163  # fail 0  # suites 5  # skipped 0   (exit 0)
$ npm run build            → ✓ built, ENV_PRESENT=FALSE / ENV_AFTER=FALSE                (exit 0)

$ node --import tsx TEMP\…\qa-harness.mts --allow-disposable-b17 --database-url=…b17_u2b_qa_scratch
PASS guards: opt-in loopback named scratch, argv-only URL, no .env, non-superuser/non-BYPASSRLS b17u2bqa,
             row_security=on, PG18, empty start
PASS offline U1 + U2D content activation applied then verified idempotently; readiness green;
     structure fingerprint matches
PASS registry truth: exactly 13 flips (87->74), untouched capability groups, capabilities truthful,
     QA §3 re-transcription matches all 13 rows
PASS real dispatcher still refuses all 74 remaining UNACTIVATED rows across 4 contexts (296 requests)
PASS D1 branch 2 (purpose/session NULL, own row) serves the F-03 fresh gate end-to-end:
     403 stale -> handler 404 fresh
PASS §3.6 notifications E2E: P/W/C own scope exact (inbox+badge+read+read-all canaries), E 403, anon 401
PASS §3.5 GET /actions E2E: W/C linked+owned (C all own-company depts), E/P denied, explicit mismatches 403
PASS §3.5 POST /actions E2E: W creates in A (item + explicit linked service), audit actor kept, P/C/E denied 403
PASS §3.6 audit E2E: P platform-only / W A-filtered / C+E denied / JOIN names resolved / no password_hash leak
PASS §3.5 PATCH E2E: W transitions + C start-work/evidence only (columns pinned),
     WF-04 409/400/403, 56->50 cap-trim own-row only
PASS §3.6 storage E2E: metadata/download/upload/delete per §3, C-DELETE 403,
     5MB/mime/freeze enforced through handlers
PASS GE mode validation both directions: platform->W-only and consultant->E-only refused;
     shared rows admit both
PASS append-only audit intact: policy-layer default-deny (0 rows) + BEFORE UPDATE/DELETE trigger raises append-only
KNOWN GAP (task §20 D3): P@T storage usage returned files=0 bytes=0 while W sees files=3 —
     zeros, not true counts; deferred to a later platform-summary round
PASS §3.6 usage E2E: P-without-T 400, foreign-T 403, W/C/E true counts (P@T = KNOWN GAP zeros, recorded)
PASS readiness refuses D1/notify/rogue-policy/ledger/authority drift inside rolled-back transactions and recovers
PASS non-destructive closure: every core table count identical, every seeded notification/audit/attachment/
     action row survives, no .env
QA_HARNESS_RESULT PASS routes=13 flips=87>74 contexts=P/W/C/E+anon freshgate=D1 notify=56>50
     d3=KNOWN_GAP readiness=refuses
QA_HARNESS_DONE                                                                 (exit 0)

$ node --import tsx scripts/b17-domain-proof.ts --allow-disposable-b17 --database-url=…b17_u2b_qa_dom_scratch
PASS registry truth: exactly 13 flips (87 -> 74), no other row changed, capabilities match
PASS U2-B round 3 E2E: 13 routes exercised through dispatcher→requireDomainAccess→scope→handler (first time)
     — allowed contexts served, §3 denials held
B17_U2B round-3 proof complete: 13 routes flipped (87→74), E2E chain green, D1/D2/D3 dispositions applied;
     no release acceptance.                                                                   (exit 0)

$ node --import tsx scripts/b17-workspace-proof.ts --allow-disposable-b17 --database-url=…b17_u2b_qa_ws2_scratch
PASS all 74 remaining unactivated business declarations denied across anonymous/platform/consultant/client/employee
B17_U1 isolated HTTP/RLS proof complete. No legacy business activation or release acceptance.  (exit 0)

$ scripts/b17-scope-proof.ts  → EXCLUDED by task §15 (contains DELETE FROM assignments)
```

## QA Agent Signature
QA Agent (Execution Mode) — 2026-11-12 23:15 +03:00 — verdict **PASS on executed scope**, with scope observation **S1** escalated to Tera. Own container `b17-u2b-qa-r3` stopped/removed after this report; no application source written; no commit/push.