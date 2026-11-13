# TASK-PROTO-B17 — independent defensive access review

- Task ID: TASK-PROTO-B17
- Agent: security-agent / الدرع (The Shield)
- Mode: Preventive Review / Planning
- Review date: 2026-11-11
- Status: Baseline findings STATIC / OPEN. Latest round-3 pre-U1 reconciliation: constraints adequate for bounded U1 only; see section 10. No security gate issued.
- Security Disposition: HIGH, explicitly assigned by Tera; not reassigned by this reviewer.
- Baseline SHA: c4ee8bccb87b53fbc957861178832029cde769be
- Artifact: security-reports/B17-access-review.md
- Final security gate: NOT ISSUED; reserved for the security auditor.

## 1. Conduct, authority and resume self-check

Conduct was read before initial investigation and reread on resume. Pre-action checks: authority confirmed; explicit delegation exists; no mandatory approval is bypassed; actions limited to the smallest sufficient scope.

CONTEXT_LOST / disk-is-truth self-check: the original review context is available. On resume, TASK-PROTO-B17.md and TECHNOLOGY_PROFILE_DRAFT.md were reread from disk; Git HEAD, status and staged/unstaged source diff-stat were rechecked. HEAD remained the baseline above; status and scoped diff-stat outputs were empty before the report write. No new implementation was reviewed or inferred. No remote fetch or remote-state verification was performed; the prior task assertion about origin/main is not independently renewed here.

Tera explicitly authorised PowerShell for this one report because a dedicated writer was unavailable, and creation of ONLY its security-reports directory if missing after checking prototype-app. Initial Test-Path results: report parent absent; prototype-app parent present; report absent. No existing report required reading before creation. Application files remain read-only.

Sources: prototype/TASK-PROTO-B17.md; prototype/TECHNOLOGY_PROFILE_DRAFT.md; actual code under prototype-app/src and root server.ts. Original preparation files were not needed to interpret this owner task and were not consulted. Historical prototype reports and prior success counts were not used as acceptance evidence. No designer or other agent was contacted.

No application execution, HTTP/DB/browser testing, login, credential use, secret-file access, environment-value inspection, dependency install, build, migration, commit or push occurred. This artifact is documentation, not implementation authorisation.

## 2. Binding scope and resolved business clarification

One actual GE principal has two modes: platform administration and consultant workspace for a selected company. Platform-only configuration remains inaccessible inside consultant context. Customer impersonation and replacement business roles are not authorised.

Tera clarification on resume, grounded in the owner task: client_admin sees the OWN COMPANY departments, including all departments of that company, not just one department. The owner wording was «أقسامه والخدمات المرتبطة به» within client-management context. This agrees with TASK-PROTO-B17.md:25,70 and its own-company/service boundary at line 8. Employee remains limited to the OWN department and its assigned linked-service disclosures/evidence plus the existing preliminary approval rule.

This resolves the sole business ambiguity raised in the initial handback. Do not create a department-scoped client_admin role or classify own-company, cross-department client confirmation as inherently unauthorised. It does not authorise another company, global library browsing, platform administration, answer/scoring edits or evidence mutation by client_admin. Current non-employee provisioning excludes departmentId (src/lib/tenantAccess.ts:153–158); no role/schema change is implied by the clarification.

Historical initial-review state: profile approval and independent design were pending at that time. This is superseded by owner approval recorded in TASK-PROTO-B17.md:84–89 and the revised B17_TECHNICAL_SPEC.md reviewed in section 10. No implementation is authorised by this security report; Tera retains the individual-unit execution decision.

## 3. Method and verification limits

Diff-first baseline check found no staged or unstaged source changes. Reviewed registered routes and targeted handler bodies, shared and duplicated authorization/context helpers, relevant RLS source, authentication and browser state. Evidence references below are relative to prototype-app at the baseline SHA.

All nine findings are STATIC SOURCE FINDINGS, not live exploit proof. Database row contents, deployed schema/policies, runtime DB-role privileges, network/proxy protections and actual request outcomes remain Unverified. A source-level guard is evidence of implementation intent/logic, not acceptance evidence that deployed behavior succeeds.

No SQL-injection, XSS, account takeover or cross-tab exploit is asserted. Examined SQL scope identifiers are generally parameterised; the findings concern authorization predicates, effective authority and lifecycle, not proof of SQL injection. Secret values, if ever encountered in a later review, must be represented only as [REDACTED]. No secret-value audit was performed here.

## 4. Prioritised findings

In scope: 9 findings — High: 6; Medium: 3; Low: 0. Each is source-confirmed within the reviewed baseline; live verification remains Unverified. Ordering is defensive remediation/design priority, not a final gate verdict. High findings were escalated during the initial review and remain escalated to Tera; code/architecture changes require a separately authorised implementer.

### B17-01 — High — No authenticated platform/consultant boundary

**Evidence**
- src/server/auth.ts:21–34: principal carries role/client/department but no workspace, mode or session binding.
- src/server/routes/_shared.ts:57–63,101–115: context comes from JWT claims; GE may supply an explicit tenant.
- src/server/routes/evaluations.ts:288–326: an omitted GE client filter permits a broad queue query.
- src/db/schema.sql:309–335,365–370: GE bypasses tenant/department restrictions.
- Platform controls check GE role only, e.g. src/server/routes/admin.ts:604–607,681–684 and src/server/routes/reports.ts:193–199.

**Impact**: A client selector or clientId does not constrain GE authority. Current server logic cannot distinguish platform GE from consultant-in-A. Adding a tenant filter while retaining unrestricted GE RLS leaves the underlying escape.

**Required correction / safety constraint**: server-validated mode/workspace context, explicit route capabilities, resource ownership checks and constrained database authority for consultant requests. Preserve the real GE audit actor; do not impersonate a client.

**Verification**: source-confirmed absence in baseline; no forged-context request executed.

### B17-02 — High — Linked-service restrictions missing across reads, writes and aggregates

**Evidence**
- src/server/taxonomy.ts:57–145: service/disclosure/item reads lack tenant service-link and assignment predicates.
- src/db/schema.sql:343–352: global items are visible without assignment/service-link checks.
- src/server/routes/evaluations.ts:307–326,408–415: queue and draft eligibility use assignments without checking current linked-service eligibility.
- src/server/routes/reports.ts:81–104,119–134: explicit service resolution checks existence, not linkage; missing visibility rows default visible.
- src/server/routes/reports.ts:333–348: report content query is not filtered by selected service.
- src/server/routes/admin.ts:1428–1434,1489: dashboard aggregate uses the broad item set; zero service links makes gap visibility true.

**Impact**: Unlinked content can remain readable/actionable through retained assignments. A report can carry one service label while sourcing broader content. Empty links do not reliably mean empty access.

**Required correction / safety constraint**: canonical tenant -> linked service -> standard/disclosure/item relationship applied to relevant reads, mutations and aggregates. Apply visibility after authorization, not instead of it. Empty links must not fall back to all content. Specify treatment of shared standards/items without changing scoring semantics.

**Verification**: missing predicates/defaults confirmed in source; no data exposure measured.

### B17-03 — High — Employee endpoints expose company-wide, non-assigned modules

**Evidence**
- src/server/routes/admin.ts:542–595: client-detail endpoint lacks employee exclusion and assembles company departments, users and staff-list summaries.
- src/server/routes/initiatives.ts:548–570: ESG-profile read returns tenant-wide rows without employee capability/department restriction.
- src/server/routes/evaluations.ts:1744–1807: snapshot list/detail returns stored payloads with tenant checks, not an employee capability boundary.
- src/db/schema.sql:930–943: snapshot/note RLS is tenant-wide.
- src/server/routes/evaluations.ts:1818–1841: snapshot-note creation likewise lacks role capability checks.

**Impact**: Hidden navigation would not prevent direct access to company-wide profile/review/administrative data or snapshot-note mutation. This exceeds employee disclosure/evidence authority. The own-company client_admin clarification does not legitimise these employee paths.

**Required correction / safety constraint**: deny forbidden endpoint capabilities, including auxiliary metadata, snapshot and note paths. Employee allowlist must stay within own-department assigned linked-service workflow and necessary shell/remediation endpoints.

**Verification**: source-confirmed overbroad handlers; no live employee requests.

### B17-04 — High — client_admin can mutate evidence despite read-only answer authority

**Evidence**
- src/server/routes/storage.ts:49–62: only employees receive an explicit department guard.
- src/server/routes/storage.ts:67–105: upload permits an authenticated caller with a visible, unfrozen answer.
- src/server/routes/storage.ts:180–202: client_admin explicitly qualifies as administrator allowed to delete another uploader attachment.

**Impact**: A client administrator unable to edit answer/score can still change supporting evidence. Freeze checks do not enforce the read-only role boundary.

**Required correction / safety constraint**: explicit evidence-write capability separate from answer visibility and client confirmation/reopen. Define GE evidence-write authority rather than inheriting generic admin. Preserve employee approved evidence actions and freeze restrictions.

**Verification**: source-confirmed authorization path; no upload/deletion performed.

### B17-05 — High — Stale JWTs and inconsistent account/suspension checks undermine workspace lifecycle

**Evidence**
- src/server/auth.ts:44–63,72–92: seven-day JWT with embedded authorization claims; middleware verifies token without reloading active account/session authorization.
- src/server/routes/session.ts:69–78: active/suspended checks at login.
- src/server/routes/session.ts:133–156: logout clears cookie only; /auth/me returns JWT identity, refreshes limited flags and falls back to that identity on error.
- src/server/routes/_shared.ts:148–155: password-freshness check does not reject a missing user row.
- src/server/routes/actions.ts:51–110 and src/server/routes/storage.ts:95–105: these paths do not apply the queue suspension wall.

**Impact**: Deactivation, logout, password change or changed department/account state is not uniformly reflected in existing-token authorization. Suspension checks are route-dependent. A workspace cannot safely be bound only to user ID or stale JWT claims.

**Required correction / safety constraint**: specify current account/session validity, revocation/versioning, workspace invalidation and consistent fail-closed checks. Preserve the narrow password-change remediation path. Explicitly define behavior for missing users, backend failure and changed authorization membership.

**Verification**: source-confirmed lifecycle gaps; token replay and post-suspension requests not tested.

### B17-06 — High — Migration lifecycle can silently restore a removed service grant

**Evidence**
- server.ts:33–45: startup invokes migrations when DB configuration exists.
- src/db/index.ts:136–148: migration executes the schema file.
- src/db/schema.sql:1183–1196: GRI is linked to every existing tenant on schema reapplication.
- src/server/routes/system.ts:62–72: migration invocation is exposed without route authentication.

**Impact**: A deliberately absent GRI link can be recreated on restart/reapplication, invalidating unlinked-means-inaccessible independently of request filtering. Public migration invocation compounds the risk. Actual external reachability is Unverified.

**Required correction / safety constraint**: Tera decision on a safe migration/bootstrap boundary and removal of automatic authorization grants. Preserve existing data and memberships; no live migration is authorised. Do not silently expand this into an unrestricted infrastructure rewrite.

**Verification**: source-confirmed execution chain; no migration invoked.

### B17-07 — Medium — Initiative read returns global library, not selected client initiatives

**Evidence**: src/server/routes/initiatives.ts:55–105. Query starts from initiatives_library; selected is an annotation, not a membership filter.

**Impact**: Client administrators and employees can enumerate unselected library content despite write restrictions.

**Required correction / safety constraint**: separate platform-library browsing from scoped client selections. Lower-role responses must not contain the global library and rely on UI filtering. Employee receives no global-library capability through metadata.

**Verification**: source-confirmed query semantics; no live enumeration.

### B17-08 — Medium — Browser-global identity storage and unguarded requests create cross-tab/stale-state hazards

**Evidence**
- src/context/AuthContext.tsx:27–31,65–80: token stored in browser-global localStorage while user/token remain in per-tab React state; provider has no storage-event synchronization.
- src/server/auth.ts:75–80: bearer identity takes precedence over cookie identity.
- src/views/ClientDetailView.tsx:74–86: independently loads clients and automatically selects first tenant.
- src/views/ClientDetailView.tsx:93–129: responses update detail without selection-generation check or request cancellation.
- src/views/GapAnalysisView.tsx:33–56: queue fetch likewise lacks workspace-generation protection.

**Impact**: Tabs can retain old identity after another tab changes global token/cookie. Delayed responses can replace newer tenant-selection state. No current localStorage tenant selection was found: observed global-storage issue concerns identity, not an invented stored-workspace implementation.

**Required correction / safety constraint**: tab-local workspace bound to current authenticated session/account, deterministic account-change handling, context-keyed requests/caches/forms, immediate old-data clearing and stale-result rejection. Cancellation alone does not protect server writes. Specify bearer/cookie identity precedence and prevent mixed-identity requests.

**Verification**: static race/lifecycle risk; no browser race reproduced. Some individual effects already have cancellation flags; this is not a claim every request is unguarded.

### B17-09 — Medium — Menus do not prevent unauthorised view mounting/fetching

**Evidence**
- src/components/Sidebar.tsx:85–138: employee receives dashboard/report/profile/settings and library-related navigation.
- src/App.tsx:30,248–283: default dashboard and view rendering lack a central capability guard.
- src/views/GapAnalysisView.tsx:95–108: empty state navigates all roles to import.

**Impact**: Menu removal alone leaves alternate navigation and retained state able to mount forbidden screens and issue requests.

**Required correction / safety constraint**: one role x mode navigation/landing allowlist enforced before mounting/fetching, with truthful lower-role empty states. API controls remain independently mandatory. Preserve language/logout and forced-password-change remediation outside the settings module.

**Verification**: source-confirmed UI control gap; no visual acceptance performed.

## 5. Required B17 safety constraints and blocking design inputs

1. Complete method/path capability matrix for all affected routes: role, mode, tenant, service, department, resource, read/write and visibility. Cover metadata, exports, evidence, snapshots, audit, notifications, staff lists and provisioning. Unknown combinations fail closed.
2. Server-validated per-tab workspace handle or equivalent bound to current authenticated user/session and validated tenant. Raw header, URL, localStorage or sessionStorage client ID is not authorization. Browser tab identifiers are client inputs, not independently trusted identity.
3. Missing/expired/mismatched consultant context must not become unrestricted GE. Platform-only operations require explicit platform context; client-work requests require valid entry. A different explicitly authorised platform tab must not mutate the consultant tab context.
4. Constrained RLS/query context: setting tenant while retaining unconditional GE bypass is insufficient. Keep actual actor identity separate from effective data authority. Review duplicated context builders, not only _shared.ts.
5. Validate parent/child ownership and scope before returning data, attachment bytes, conflict snapshots or writes. Reject contradictory path/query/body/context identifiers and prevent null-context escape.
6. Specify session/account revocation, suspension, forced change, logout, enter/exit/switch, reload, deep links, duplicate-tab behavior and delayed requests. Lifecycle audit retains actual GE actor; enter/exit audited without token/handle disclosure.
7. Clear old rendered data, pending edits, selections, attachment state, generated exports and caches on context transition. Context-key all async work; reject stale results and prevent stale follow-up writes, not just visual tenant flash.
8. Preserve employee save/submit and OD-08 preliminary approval; client confirmation/reopen; versions, freeze, report gate, history, snapshots and GE attribution. client_admin may review all own-company departments; employee only its own department.
9. No startup/migration grant recreation, membership seeding or automatic grant to unrelated tenants. Schema changes need explicit target and safe forward/backward plan with preserved data.
10. Operational platform summaries must be explicitly limited; existing detailed cross-company assessment aggregates are not automatically approved simply because they appear on an overview endpoint. Clients-list status/progress must come from real linked-service rows; suspend/unsuspend stays platform-only there.

Historical prerequisite snapshot: profile/design were initially required. Owner approvals and revised staged design now resolve that prerequisite for bounded U1 planning as reconciled in section 10; full B17 remediation/verification remains outstanding. All six High and three Medium baseline findings stay STATIC / OPEN until their actual fixes and proof are reviewed. Business department-scope ambiguity remains RESOLVED: C all own-company departments; E own department.

## 6. Recommended later tests — none executed in this review

Only with separate authorisation, disposable fixtures and isolated local HTTP/DB/browser staging:

- Table-driven role x mode endpoint/view allowlists; forbidden views neither mount nor fetch. Check direct navigation and retained state, not only visible menus.
- Consultant A with tenant/resource identifiers from B across path, query, body and proposed workspace headers. Missing, forged, expired, revoked and contradictory context; conflicting/duplicate parameters; no-context GE. Denied requests disclose no resource/bytes/conflict details and change no rows.
- Platform GE cannot enter client-work endpoints without entry; consultant cannot invoke platform controls, including provisioning, suspension, head designation, service linkage, D-038, catalog/library writes and migration paths.
- Two tenants, two departments and linked/unlinked services, retained old assignments and zero links. Cover queue, standards/disclosures/items, history, mutations, aggregates, export, equivalent-item links and evidence bytes. Positive client_admin coverage includes all own-company departments, never another company.
- Employee denied company detail/profile/reports/snapshots/global library and unrelated department content; client denied evidence mutations and platform controls. Scope errors must not be masked merely by empty fixtures.
- Positive employee save -> submit -> preliminary approval and client confirm/reopen; head and no-head rules per approved OD-08; frozen, missing/stale-version and invalid-transition negatives. Preserve prior history/data and self-approval restrictions at client/GE levels.
- Deactivation, suspension, department change, password change and logout using previously issued tokens/workspaces; missing-user and backend-failure cases fail closed except explicitly approved remediation.
- Two tabs with independent A/B workspaces, reload/duplicate/deep link, account switch and logout. Delay old responses and multi-step save/submit/upload operations during exit/switch; no old data rendering or unintended follow-up write.
- Restart/schema reapplication must not recreate a removed service grant. Use throwaway DB only; never connect production credentials or invoke the current migration endpoint as part of this review.
- Desktop/mobile AR/EN evidence for four contexts, truthful empty states, forbidden controls absent, shell language/logout preserved, and GE audit attribution on workspace lifecycle and client work.

Evidence must distinguish unit/pure-helper assertions from actual HTTP authorization and active RLS behavior. No expected success counts or prior executor outcomes are supplied by this review.

## 7. Residual issues outside the B17 fix scope

Separate Tera disposition is required. These are not permission to expand implementation. They are excluded from the nine in-scope finding counts.

### R-01 — High — DB TLS server verification disabled

Evidence: src/db/index.ts:38–49 uses rejectUnauthorized: false for nonlocal connections. Impact: encrypted transport is not equivalent to authenticated database-server identity. Proposed correction: separately approve verified TLS/CA/hostname handling without credential disclosure. Verification: source-confirmed; actual network/deployment exposure Unverified. Escalated to Tera.

### R-02 — Medium — Internal-error disclosure risk

Evidence: src/server/errorHandler.ts:66–77 returns raw error messages/codes; individual handlers also return err.message, e.g. src/server/routes/session.ts:127–129. Impact: internal details may reach users; raw error logging also requires redaction review. Proposed correction: controlled public messages/correlation and server-side redaction without returning internal diagnostics. Verification: source behavior confirmed; actual disclosed values/log contents not inspected. No secret exposure is asserted.

### R-03 — Unverified — Cookie/CSRF and deployment hardening

Evidence: src/server/routes/session.ts:116–120 sets HttpOnly and production-Secure but no explicit SameSite. Cookie authentication fallback exists in src/server/auth.ts:75–80. CSRF protection, cookie policy, proxy/TLS configuration and browser enforcement are not established by this review. Recommendation: separately verify cookie and request-origin/CSRF policy against the chosen auth strategy. No live CSRF vulnerability or exploit is claimed.

### R-04 — Unverified — Dependencies, secrets and deployed privileges

Package/lockfiles, dependency scanner, environment values, bundles, logs, active schema and database-role bypass privileges were not inspected. No dependency-safety, secret-safety or deployed-RLS acceptance claim is made. Request only narrowly scoped, non-secret evidence through Tera if later required.

## 8. Boundaries for later fix review

- Required inputs: approved technology profile, final independent specification and capability matrix, exact new SHA/diff with owned changes, finding-to-fix mapping, migration plan if applicable, and separately authorised isolated test evidence.
- Review actual diffs and shared/RLS callers, including duplicate context helpers. Executor summaries, historical reports and screenshots alone cannot establish authorization.
- Close each finding only when its root cause is addressed. UI hiding, trusting a clientId header, adding one tenant predicate or retaining broad GE RLS is not sufficient.
- Recheck positive own-company client_admin access as well as employee own-department negatives; do not reintroduce the resolved ambiguity or invent new roles.
- Keep source-level closure and runtime verification separately labelled. Active schema/policies and HTTP behavior need independent evidence; absent evidence stays Unverified.
- Verify no regression in suspension/password/version/freeze/head/report gates, historical data, actor attribution and tab lifecycle. Broader route changes require explicit scope expansion.
- This reviewer does not implement code, execute attacks, use read secrets for testing, issue final PASS/FAIL, disable features, migrate production or accept the task. Tera decides remediation scope; QA/red team/auditor retain their separate roles under fresh authorisation.

## 9. Historical initial handback (current round-3 handback in section 10)

Task ID: TASK-PROTO-B17
Agent: security-agent
Mode: Preventive Review / Planning
Status: Escalated — independent static review persisted; no implementation authorised.
Findings: 9 in scope (High: 6; Medium: 3; Low: 0); runtime verification Unverified for all. Residuals separately listed, including one High.
Artifacts: security-reports/B17-access-review.md only.
Evidence: file:line references above at baseline c4ee8bccb87b53fbc957861178832029cde769be.
Resolved clarification: client_admin all OWN COMPANY departments; employee OWN department only; grounded in owner task and explicit Tera resume clarification.
Unverified Items / Risks: runtime HTTP/DB/browser outcomes, deployed RLS/DB-role privileges, dependencies, secrets, logs and deployment hardening; no prior success accepted as proof.
Decisions Needed from Tera: profile approval; independent specification and fail-closed workspace/session/RLS protocol; bounded remediation/migration authority; separate residual-risk handling and later verification authority.

Completion boundary: conduct observed; only this authorised report and its expressly permitted parent directory may be written. No application changes, execution, credentials, commit or push. Documentation completion is not a security gate or owner acceptance.

## 10. Round-3 pre-U1 defensive reconciliation — 2026-11-11

### 10.1 Authority, disk-is-truth and limited question

Task: TASK-PROTO-B17. Agent: security-agent. Mode: Preventive Review / limited pre-U1 reconciliation. Status: Done for this document review only. This is NOT an implementation/fix review, execution authorisation, task acceptance, or final security gate.

Conduct reread first. CONTEXT_LOST check: same review context available; disk inputs reread rather than assuming prior pending decisions. Inputs for this round: revised prototype/B17_TECHNICAL_SPEC.md (353 lines, design round 2), prototype/TASK-PROTO-B17.md including section 9, and this report before editing. User/Tera expressly authorised this limited reconciliation and the same sole report write via PowerShell. No additional source inventory, agents, code writes, secret access, DB/HTTP/browser requests, test/build/migration, commit or push.

Read-only Git recheck: HEAD c4ee8bccb87b53fbc957861178832029cde769be; status showed only the already-known untracked security-reports directory; staged/unstaged src/server.ts-scoped diff-stat output was empty (scope: src and root server.ts). No new implementation diff was supplied or reviewed. No remote parity claim renewed. Parent/report existence verified before editing; pre-edit report hash used to refuse concurrent overwrite.

Question answered: is there a blocking omission in the specified U1 protocol, central route dispatcher, RLS substrate or activation/readiness boundary? The designer readiness label is treated as a claim to assess, not acceptance evidence.

### 10.2 Superseded prerequisites and accepted owner resolutions

- Profile approval and prototype-specific intake are resolved for this repair by TASK-PROTO-B17.md:84–89 and B17_TECHNICAL_SPEC.md:7–8,23–24. The prior pending-profile/intake language is historical, not a renewed U1 blocker. Approval does not waive individual-unit authority or production/security gates.
- Explicit legacy GRI standards/Profile/report association is approved, metadata-only and narrowly versioned; independent Profile rating and actual report choices must be preserved (task:85–86; spec:245,250,277–283). It belongs to U2, not U1. Exact inventory/ambiguity refusal remains required before content application; no subscription creation/regrant or runtime all-content fallback.
- Initiative assign/select/unselect is W(A) only; P defines library/service mappings; C selected set; E denied (task:87; spec:56,167–171,193,248). No platform client-selection exception is inferred.
- G-SHARED safe refusal, no foreign-department read/overwrite, no rekey/scoring/approval redesign is the approved deferred boundary, not an unresolved U1 business decision (task:88; spec:242,287,348). C still covers all own-company departments and E only its own.

### 10.3 Independent conclusion: U1 constraints adequate, no concrete blocking omission identified

The revised written constraints are adequate for the bounded U1 security substrate and its later isolated proof. No new blocking design omission was identified within this limited reconciliation. This conclusion is conditional on implementing the stated fail-closed activation boundary, not permission to activate legacy routes or claim that code already enforces it.

| U1 surface | Specification evidence | Defensive reconciliation |
|---|---|---|
| Protocol / identity | spec:195–224,261–262 | Actual GE retained; live sid/current-user checks, hashed opaque tab bound to sid/user, required handle/version, no missing-tab platform fallback, memory-only browser contract, reconciliation after lost response, expiry and auth-only cross-tab synchronization are specified. Logout revokes sid/tabs; remediation exceptions expose no business content. |
| Linearization / stale writes | spec:220–224 | Captured request identity/generation and consistent session/tab/domain lock order cover mode changes, logout and post-parse uploads; no old-generation write may commit after exit acknowledgement. Failed audit/DB transition rolls back, not a partially switched workspace. |
| Central dispatcher / staging | spec:71–84,203–208,228–231,271–275,312–322 | Explicit method/path classification plus separate activation is mandatory before legacy routers. U1 enables verified session/workspace/minimal system operations ONLY. A role-allowed row in the full B17 matrix is not U1 activation. All unretrofitted business handlers stay denied, including old optional-auth/global reads. |
| RLS substrate | spec:232–236,260–263,273 | Old permissive policies must be replaced, not OR-combined; transaction-local mode/purpose/actor/tenant/department is set/cleared on one client. Purpose is server-selected, auth internals/lifecycle are narrow, P has no general client-work permission, W is tenant-bound, security tables have policies, FORCE RLS/non-bypass role and effective-policy verification are required. U2 linked-content refinement is not falsely claimed complete by U1. |
| Migration / readiness | spec:269–275,282–283,316,338 | All startup/HTTP/bootstrap schema replay removed; awaited read-only ledger/checksum/schema/effective-policy readiness before normal serving; missing/drifted/partial state denies service, never repairs. Empty-install initializer guards existing databases before DDL/data/policy changes; existing DB uses explicit transactional b17.sql, predecessor checks and ledger-last/no-op verification. No regrant and no unsafe old-binary rollback. |

The critical U1 design improvement is that partial remediation does not expose partially protected domain behavior. It is safe to defer the content predicates and browser retrofit only while the legacy business activation set remains empty. The current baseline application still has the original findings; this review does not certify a running U1 system.

### 10.4 Non-negotiable U1 implementation / later fix-review checks

These are consequences of the supplied protocol and exit conditions, not new business features or extra source targets:

1. Dispatcher enforcement must occur before domain handler execution, including upload parsing where required. Cover the existing registry, new workspace operations and intentionally minimal system/session exceptions; unknown, duplicate or newly unclassified declarations do not become reachable. Do not make the full section-3 matrix the U1 active allowlist. Verify actual entry/mount paths, not just a registry constant or source count.
2. Every U1-authorised operation, including login/bootstrap/session lookup, workspace enter lookup and lifecycle audit, must use only its narrow server-selected DB purpose; no inherited elevated context can return business rows. Session/tab ownership, expiry, generation and current-account gates must be checked within the relevant locked transaction. Runtime DB permissions/readiness must not depend only on a ledger row.
3. Implement lock semantics, not just lock names: session issuance/revocation and workspace transitions must follow the specified serialization. In particular the stated 20-active-tab cap requires count-and-insert serialization; compatible FOR SHARE locks alone cannot enforce that cap. Use an exclusive per-session issuance critical section or equivalent within the specified transaction discipline and prove concurrent issuance cannot exceed the stated bound. This is an implementation check for spec:224, not a new U1 blocker or a requested feature.
4. Keep initializer, explicit existing-DB delta and runtime readiness distinct. Rejected bootstrap, startup/restart, invalid migration request and missing version must never reach schema.sql. Assert no grant restoration or policy rollback and no ledger commit after failed activation. Diagnostics, if exposed during failure, stay isolated from business dispatch.
5. U1 exit requires its specified unit plus disposable local HTTP/RLS/restart/no-regrant evidence (spec:316,326,328,330–331,338), a non-bypass runtime role and unchanged business data/memberships. Include forged/foreign/stale/missing handles, sid-less JWTs, logout/deactivation races, audit failure, pool context clearing and inactive/unactivated business requests. No such evidence was executed or accepted in this round.
6. Before U2 activation, re-review scoped predicates, by-ID/error/blob ownership, the approved mapping inventory, independent Profile computation, shared-row refusal and W-only initiative mutations. Before U3/U4 completion, review actual page-before-mount and request-epoch behavior. No partial-security publication or production deployment is authorised.

### 10.5 Findings and deferred work status

B17-01 through B17-09: STATIC / OPEN, all nine unchanged as baseline findings. No severity change, no closure, no live-exploit assertion and no functional success count. The design addresses obligations but code plus proof must be reviewed before closure.

- U1 targets B17-01/05 and B17-06; their status remains open until actual implementation and isolated protocol/RLS/readiness evidence are reviewed.
- U2 targets B17-02/03/04/07 and content association/shared-row safeguards; deferred under closed legacy routes, not waived.
- U3/U4 target browser portions of B17-08/09; U1 provides the server boundary only. No claim that memory handles/epochs/menus already exist in the current browser.
- Legacy inventory and ambiguous content association are U2 prerequisites, not a renewed owner-decision or U1 blocker. Multi-department positive semantics remain separately deferred; no new redesign required in this review.
- Residual TLS/dependency/raw-error/deployment work in section 7 remains separately with Tera, unchanged and not reopened/investigated here. No extra infrastructure/dependency task or acceptance waiver is inferred. Narrow auth-origin/cookie safeguards already in the U1 protocol remain U1 obligations, not a TLS/dependency scope expansion.

### 10.6 Current handback

Task ID: TASK-PROTO-B17 — defensive reconciliation round 3, pre-U1 only.
Agent: security-agent.
Mode: Preventive Review / Planning.
Status: Done — U1 written constraints adequate; no concrete blocking omission identified in this limited review. Tera retains the individual-unit execution decision; no final security gate issued.
Findings: 9 existing STATIC / OPEN (High: 6; Medium: 3). New blocking omissions in this reconciliation: none identified. Runtime/code verification remains Unverified.
Artifacts: prototype-app/security-reports/B17-access-review.md only.
Evidence: revised spec/task line references in section 10; baseline code evidence retained unchanged in section 4.
Decisions needed: no reopened profile/mapping/initiative-placement/intake business decision for U1. Individual-unit authority and required later proof/review remain with Tera; no production release.
Boundaries: no code/live tests/agents/commit/push; no full implementation review, no unchanged inventory repetition, no TLS/dependency expansion, no finding closure without code and proof.

