# B17 U2-A Fix Review — TASK-PROTO-B17-U2-A (foundation, 0 flips)

Agent: security-agent (Shield) · Mode: Preventive/Fix Review · Session NEW · Date: 2026-11-12
Scope: U2-A diff from c4ee8bc (working tree; HEAD=origin/main=c4ee8bc). Sole write of this review.
Inputs: TERA_AGENT_CONDUCT.md; TASK-PROTO-B17.md §15–§16; B17_TECHNICAL_SPEC.md §3 (matrix source) + §4–§5; prototype/U2_LEGACY_HELPER_RETIREMENT.md (ControlPath, plan-only).
Status: Done — no gate decision (security-auditor owns it), no parent PASS claim, TLS/dependency residuals not reopened.

## Result
Findings: 2 Low · 0 Medium/High/Critical · 2 Info observations · Unverified: 6.
No client-input adoption, no platform/unrestricted fallback, no activation flip found in this unit.

## 1. deriveDomainAccess — no client-supplied identity/tenant/department/mode (static)
- GE: only X-Workspace-Tab / X-Workspace-Version are read (access.ts:95-106) and used as lookup keys; mode and tenantId come from the DB row matched on handle_hash+session_id+user_id (access.ts:97-108). No body/query field is read anywhere in the wrapper (access.ts:86-119).
- C/E: context built only from the live session row (access.ts:110-114); identity.clientId/departmentId are loaded from users inside withSession (auth.ts:100-122), and a non-GE user without client_id or employee without department_id is rejected 401 auth.binding_invalid (auth.ts:108-109) — so C tenantId cannot be null and cannot come from a selector.
- Missing/foreign/expired tab → 409 workspace.invalid; bad/stale version → 400/409; missing/revoked session → 401 (access.ts:96,101,105-106; auth.ts:97-99). No `?? platform`, no ge_admin/role default, no fallback path anywhere in the wrapper.
- Employee free of GE tab influence: the non-GE branch reads no workspace headers (access.ts:109-115). Exercised claim: tabId stays null and a supplied foreign tab is ignored (b17-domain-proof.ts:176-178).
- C free of tenant selector: exercised claim — `?clientId=<B>` still yields own tenant A (b17-domain-proof.ts:169-172); employee `?departmentId=<other>` still yields own department (b17-domain-proof.ts:173-175).
- withSession verifies signature/expiry, live unrevoked session, active user, current role/company/department and tenant existence per request (auth.ts:86-129); assertFreshIdentity blocks password-change and suspended-tenant states (access.ts:92; auth.ts:131-134).

## 2. Dispatcher pre-check — every UNACTIVATED route denied, no ordering/handler bypass (static)
- access.ts:20-27: classify → unknown 404 api.not_found → `!route.matrix.length || route.activation !== 'U1'` → 403 access.unactivated, thrown BEFORE assertSameOrigin, assertB17Ready and next(). The added condition is monotone-deny: group() refuses a missing/empty matrix (accessRegistry.ts:63), so matrix.length >= 1 for every registered row and the operative gate is exactly activation === 'U1'.
- Ordering: router.use(accessDispatcher) is the first middleware of the API router (routes.ts:27), ahead of workspace + all 10 domain routers (routes.ts:28-44) and the terminal 404/error handlers (routes.ts:53-54). server.ts mounts this router only at /api (server.ts:35); no domain handler is mounted at app level (server.ts:56 is the SPA fallback, after /api). All 13 routers are imported only by routes.ts — no alternate mount can skip the dispatcher.
- Classification parity: case-insensitive + optional-trailing-slash patterns (accessRegistry.ts:199-201) match Express defaults, so every request Express would route is classified first; HEAD maps to its GET row (access.ts:203), so business HEAD answers 403 rather than falling through unclassified.
- Coverage fails closed at import: assertRegistryCoverage (routes.ts:24; accessRegistry.ts:207-215) throws on missing/extra/duplicate declarations; two further independent inventories exist (capabilities.test.ts:7-24 source scan of the 95 literals; domainAccess.test.ts:159-169 exact §3 key set).
- Ordering nuance (fail-closed, informational): denial precedes the origin check, readiness and app-level body parsing (server.ts:30), so an unactivated route can answer 400 on a malformed body or skip origin.denied — but no handler ever runs.

## 3. Matrix-as-data cannot make a route admissible contrary to §3 (static)
- Matrix content is runtime-inert: only `.length` is read (access.ts:27); requireDomainAccess derives context and never consults route.matrix (access.ts:122-129). Admission is solely activation === 'U1'; §3 tags (L/D/R/V) are enforced only by future per-route handlers (U2-B..F, by design per task §15).
- Active set in the present tree = exactly what §3.1/§4 permit: 4 system + 4 session (accessRegistry.ts:76,82) + 4 workspace (accessRegistry.ts:196) = 12; the 87 business declarations are UNACTIVATED (domainAccess.test.ts:171-177 pins 95/87/8/4; registry total 99).
- 0 activation flips: `activation` is assigned only inside group() (accessRegistry.ts:65) and only those three groups pass active=true; grep across src/ and scripts/ found no other assignment and no env/DB/runtime flip mechanism. (Identity of the active set verified in the current tree; a U1-vs-U2-A temporal diff is not separable in git — both are uncommitted — see Unverified 1.)
- §3↔registry read-through by Shield over all 99 rows found no over-grant: e.g. client-approve/return C:R+L only (accessRegistry.ts:118-119 vs §3.3), POST /assignments/na W:R+L (146 vs §3.4), GET /audit-log P;W (182 vs §3.6), GET /esg-profile W;C (166 vs §3.5), workspace rows match §4 (192-195). The independent row-by-row oracle diff remains QA's (task §16).
- Active workspace handlers enforce §4 mode rules independent of the matrix: enter rejects a non-platform tab with 409 workspace.exit_required (workspace.ts:66); exit is idempotent from platform (workspace.ts:78).

## 4. Findings (no exposure today; both latent behind 0 flips)

SHIELD-U2A-01 (Low) — wrapper does not re-assert activation; admission depends solely on dispatcher ordering.
Evidence: access.ts:122-129 and access.ts:86-119 classify and derive but never check route.activation, while the header comment claims the wrapper is "only ever reached for admitted requests" (access.ts:82-84).
Impact: none currently — the dispatcher is provably first (routes.ts:27) and no other mount exists. Forward risk in U2-B..F: a sub-unit could mount requireDomainAccess believing it enforces deny-by-default.
Fix: add `if (route.activation !== 'U1') throw authError(403,'access.unactivated')` at the top of requireDomainAccess/deriveDomainAccess, or state explicitly that the dispatcher is the single gate and must stay first. Status: verified statically.

SHIELD-U2A-02 (Low) — GE context attached unlocked and without mode/tenant-vs-route validation.
Evidence: the tab read is a plain SELECT with no FOR UPDATE (access.ts:97-99), unlike withWorkspace's locking read (access.ts:45-47); tab.mode and tab.client_id pass through unchanged (access.ts:107-108) with no comparison against route.matrix — a platform tab yields mode:'platform', tenantId:null for any GE route the dispatcher admits.
Impact: none today (wrapper unreachable for business routes; workspace routes use withWorkspace, which locks). Forward risk for U2-B+: req.access is advisory until the handler re-locks/revalidates per spec §4 server linearization, and W-context handlers must reject mode:'platform'.
Fix: carry both points into the U2-B contract (handler-side lock+revalidate, explicit mode check against the §3 row), or validate mode against the route's contexts inside the wrapper. Status: verified statically; no runtime exposure.

Info O1: access.ts:26 comment says "the 8 active routes" while 12 declarations carry activation 'U1' (8 legacy + 4 workspace; domainAccess.test.ts:174-176). Comment accuracy only.
Info O2: activeBusinessCapabilities() is hardcoded `return []` (capabilities.ts:42) and feeds the workspace envelope (workspace.ts:20); capabilities.test.ts:23 asserts [] without deriving it from registry activation. Fail-closed today; it must be kept in step with future flips or envelopes under-report capabilities (safe direction).

## Static vs exercised
- Static (Shield-verified this session): all file:line evidence above; full reads of access.ts, accessRegistry.ts, domainAccess.test.ts, routes.ts, the dispatcher-relevant parts of server.ts/_shared.ts/auth.ts/workspace.ts, b17-domain-proof.ts and U2_LEGACY_HELPER_RETIREMENT.md.
- Exercised (implementer claims; NOT re-executed by Shield — no tests/network/live in this session): guarded PG18 proof 6/6 — wrapper P/W/C/E contexts plus missing/stale/foreign-tab negatives (b17-domain-proof.ts:138-186); 87 x 4 = 348 denials through the real dispatcher (189-200); the 8 active route behaviours (202-224); coverage-test spawn (226-236); seeded-row preservation (238-241); plus 153/153 tests, lint/build, Semgrep-scoped 0 findings (task §16).

## Unverified bounds
1. "Byte-identical to U1": no pre-U2-A baseline exists in git (HEAD=c4ee8bc predates all B17 work; U1 files are uncommitted). Verified only: a single throw before auth/origin/readiness/next (access.ts:27), the same error code U1-era assertions expect (workspace.test.ts:71), and monotone-deny logic. Byte-level response parity = Unverified.
2. Wrapper through the real dispatcher + handler chain: impossible pre-flip by design; exercised only in an isolated probe app without the dispatcher (b17-domain-proof.ts:141-149).
3. Proof/test/lint/build/Semgrep results: taken from task §16, not re-run by Shield.
4. §3 matrix transcription: agent double-entry; Shield's read-through found no mismatch, but the independent row-by-row oracle diff is QA's (task §16).
5. Catalog preservation: proven only via no-op `UPDATE ... SET id=id` rowCount 0 (b17-domain-proof.ts:93-97), carried from the handback.
6. Legacy helpers (contextFromUser, b11b*, taxonomy's local builder taxonomy.ts:31) remain inside unactivated handlers — retirement is plan-only (103 call sites / 11 files) and unreachable while unactivated; confirmed none is used by an active system/session/workspace route.

## Decisions needed from Tera
- Whether SHIELD-U2A-01 (activation re-check inside the wrapper) is applied in U2-B's first edit or recorded as a U2-B checklist item.
- Nothing else: no Medium+ finding, no secret exposure, no code change required by this review. Attack testing (red-team-agent) and the final gate (security-auditor) remain out of scope.
