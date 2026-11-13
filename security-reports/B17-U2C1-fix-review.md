# B17 U2-C1 fix review (policy substrate, 0 flips)
Task ID: TASK-PROTO-B17-U2-C1 | Agent: security-agent (Shield) | Mode: Fix/Preventive Review (substrate re-review, B0 precedent)
Status: Done | Findings: 4 (High:0 Medium:0 Low:2 Info:2) | No final gate; parent PASS not issued.
Diff basis: HEAD=c4ee8bc; exactly 5 files touched 13/11 00:48-01:05 (b17-content.sql, b17Readiness.ts,
scripts/b17-domain-c-proof.ts, b17DomainPolicies.test.ts, b17ScopeSecurity.test.ts) - handback claim verified:
handlers/registry(74 UNACTIVATED, 23 taxonomy+gri all unactivated)/capabilities(4)/b17.sql/b17ContentMigration/
session/UI/package.json untouched (mtimes <=12/11 21:06; no .env; no dep churn).
(a) D1 RULING: ACCEPT catalog-wide integer counts as deviation from "explicit target" wording. Rationale:
global catalog deletes have no target (targetless posture b17-domain-c-proof.ts:401); T-scoped counts would be
fail-open vs ON DELETE CASCADE spanning tenants (executor comment b17-content.sql:534-538 correct); context still
server-selected platform.config+actor+ge_admin. Guard raises b17.count_context/count_args, never 0
(b17-content.sql:544-550); closed 6-kind list; REVOKE PUBLIC+owner GRANT (572-573); single scope.counts
set_config site (553, test pin b17DomainPolicies.test.ts:214-215) with exception-safe restore (563-567).
SHIELD-U2C1-01 (Low): count guard omits target_id presence (b17-content.sql:547) - harmless (value is
catalog-wide anyway) but weaker than D2's "explicit target" phrasing; keep or add target check in C2, either
acceptable; no request path can set purpose (R5 scan, proof:364-376).
SHIELD-U2C1-02 (Low, RATIFY): assignments has an INSERT policy (b17-content.sql:519-521) - not literally
"ZERO mutation on assignments". Required by sec 3.2/6/22 commit provisioning (gri.ts:254 INSERT assignments;
auto-department 242) and inside sec 23 D4 C1 scope "target provisioning" + sec 5 provisioning list; D2's literal
"config reads" wording under-covers it. client_services/answers/evaluations = confirmed ZERO mutation policies
anywhere (b17.sql:114-127, b17-content.sql:166/173/179 SELECT only; proof R3:305-315). No assignments
UPDATE/DELETE; departments UPDATE only b17_config_departments_update target-bound (511-515) plus U1
b17_departments_lock WITH CHECK(false)=zero effective grant (b17.sql:109-110). Recommendation: ratify, do not remove.
(b) D2 verified: purpose='platform.config' appears in NO non-test request-path source (proof R5:364-376;
setTenantContext callers pass literals, src/db/index.ts:20-32; workspace targetId is purpose='workspace' only,
workspace.ts:67); b17_platform_scope vs b17_platform_config mutually exclusive purposes, never merge
(b17-content.sql:234-253); freeze under config only via bound_tenant t=target_id (40-42, is_scope_frozen:138),
foreign T / tenant-NULL / targetless all false (proof R6:383-391); answers/evaluations blobs unreachable under
BOTH contexts - no policy admits them (b17_scope needs purpose='work'; config/summary purposes fail; proof R5:350-359).
(c) Catalog SELECT/INSERT/UPDATE/DELETE loop covers exactly the 6 catalog tables (b17-content.sql:484-494);
no policy on any tenant table from that section (comment 481-483 accurate).
(d) SHIELD-U2C1-03 (Info): audit C1 branches closed - 14-name catalog list + NULL-client (432-435) matches
taxonomy.ts:191-948 emits exactly; commit branch single action+entity_type+target (436-438) matches gri.ts:267-271.
Retained work branch (439) is action-open by design - pre-existing U2-B0-sanctioned, actor+tenant bound, NOT C1.
(e) SHIELD-U2B3-01 CLOSED: notifications DELETE now user_id-identity on both branches + membership + work_tenant
(b17-content.sql:302-307); trim signal invoker-only trigger (315-322); refingerprinted (B17_CONTENT_SHAPE
7a13a70382653f70f2733072f068ad00, b17Readiness.ts:14). Platform trim deliberately absent until U2-F (288-289).
(f) SANCTIONED_DEFINER_FUNCTIONS=[b17_catalog_child_count,b17_content_fact] with exact live b17_% definer-set
equality + per-function owner/ACL/non-bypass checks; fails closed on extra/renamed/missing definer, ACL or owner
change (b17Readiness.ts:18-101; mock-drift coverage b17ScopeSecurity.test.ts:17-51); non-b17_ definer add caught
by STRUCTURE_SQL functions section (47-66).
(g) SHIELD-U2C1-04 (Info): targetless platform.config admits ALL tenants' department rows (b17-content.sql:505-507)-
justified by taxonomy id-existence checks (taxonomy.ts:608,772) but wider than sec 3.4 P@T departments; C2
GET /departments handler must stay P@T and project no cross-tenant rows. No other NEW over-grant vs sec 3.2/5.
Unverified bounds: all execution claims (proof R1-R9, readiness shape constant, tests/lint/build, PG18 observations)
are executor/QA evidence - Shield ran no tests/live/network this session; content-version re-apply on an existing
U2D DB refuses (b17ContentMigration.ts:77,193 - fail-closed, scratch recreate required); GUC-spoofable internal
purposes by the owning app role is the pre-existing trust model (app-path boundary); R9/D3 proven at RLS layer
only, through-handler proof deferred to C2 E2E; table/column ACLs not pinned by STRUCTURE_SQL (pre-existing).
D3: /actions already excludes hidden corrective for C via b17_actions fact gate (proof R9:458-472) - NO actions.ts
pre-authorisation needed for C2; P@T usage gap stays KNOWN (D3); TLS/deps not reopened.
C2 preconditions: (1) Tera ratifies SHIELD-U2C1-02 and notes 01/04; (2) C2 binds purpose/target server-side only -
taxonomy delete pre-checks under platform.config (guard 547), commit under config+explicit T, R5 invariant kept;
(3) GET /departments handler P@T despite targetless RLS breadth; (4) recreate scratch DBs (checksum changed);
(5) full 23-flip E2E harness + QA/Shield per sec 22.
Artifacts: this file only. Evidence: file:line refs above. Decisions needed from Tera: ratify/reject
SHIELD-U2C1-02; confirm targetless-config posture for global taxonomy ops (executor's deliberate D2 reading).
