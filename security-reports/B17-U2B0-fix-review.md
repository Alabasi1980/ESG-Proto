# B17-U2-B0 policy-substrate defensive fix review — Shield (الدرع)
Task ID: TASK-PROTO-B17-U2-B0 (task §18/§15; spec §3/§5/§7) · Agent: security-agent · Mode: Fix Review · Status: Done (STATIC ONLY — no gate, no parent PASS)
Scope: B0 window writes 2026-11-12 16:51–18:09 = src/db/b17-content.sql:217–341, src/db/b17Readiness.ts, src/lib/b17DomainPolicies.test.ts, src/lib/b17ScopeSecurity.test.ts:21–25, scripts/b17-domain-proof.ts. No tests/DB/network/.env/commit by Shield; TLS/deps not reopened.

## 1. §3 row scope — no over-grant found (static, file:line)
- notifications b17-content.sql:242–256: P = platform_scope + client_id IS NULL + user_id=actor; W/C = work_tenant(A/own) + user_id=actor; E excluded (`mode<>'employee'`). UPDATE:249–256 mirrors USING in WITH CHECK, so read/read-all cannot move a row's user_id/client_id out of scope. Matches §3.6 (inbox/unread/:id/read/read-all); E denied in both commands.
- evidence_attachments :264–293: SELECT = parent answer bound (work_tenant + item_visible + owning department; E additionally own-dept + assigned); INSERT :274–281 E-only with uploaded_by=actor (no C/W/P filing); DELETE :284–293 = E-own-uploader OR consultant, platform/client fail both branches (C/P denied). No UPDATE policy anywhere (proof:537–539) → no E write beyond upload; no guessed answer id.
- actions :299–320: INSERT consultant-only + work_tenant + owner-dept-in-A + linked item or explicit linked service; UPDATE USING/WITH CHECK mirror the read scope incl. C's corrective-visibility gate; E denied (`<>'employee'`), P denied (work_tenant fails platform mode), cross-tenant impossible (tenant pinned by work_tenant).
- audit_log :324–340: SELECT P = platform events only (client_id NULL), W = consultant + work_tenant(A) A-filtered, C/E denied; INSERT = U1 auth/workspace branches byte-retained (cf. b17.sql:140–147) + new `OR b17_work_tenant(client_id)` → W/C/E own-tenant, actor-bound only; P work-context append denied (proof:592–594). No W write beyond A, no cross-tenant branch.

## 2. Invariants NOT weakened by these policies (static)
- Append-only: no audit UPDATE/DELETE policy added; schema.sql:240–242 trg_block_audit_log_mod retained; b17-content.sql contains no DROP TRIGGER (b17DomainPolicies.test.ts:26–28).
- Freeze: trg_block_frozen_attachments schema.sql:933–935 + is_scope_frozen untouched by B0; 5 MB CHECK + mime validator and WF-04 actions_status_check/lib rules untouched (test:29; proof:609–637).
- 50-cap: NOTIFICATION_INBOX_LIMIT=50 _shared.ts:221 unchanged; absent notifications INSERT/DELETE policy (b17-content.sql:257–258) means the trim cannot bypass the cap — but see F1.
- B0 adds no constraint/trigger/definer redefinition; freeze/WF-04/field rules are deliberately OUTSIDE RLS (handler/trigger-owned) → those must be re-proven through handlers at flip time.

## 3. Readiness fingerprint (static)
- b17Readiness.ts:11 content shape refreshed; :18–34/:79–80 enumerate every `prosecdef AND left(proname,4)='b17_'` and require exactly ['b17_content_fact']; :45–46 fold pg_policies into structure; :92–97 refuse checksum/shape/authority drift. b17_platform_scope is invoker-only (b17-content.sql:230, no SECURITY DEFINER) → definer surface unchanged and still single-homed. Ledger source of truth shared: b17ContentMigration.ts:6–7 imports these constants (no §18 ledger-shape edit needed — none made).

## 4. Findings and reported-gap dispositions
1. [Medium] SHIELD-B17B0-01 — notifications fan-out/trim has NO policy: notifyUsers INSERT _shared.ts:260 + trim DELETE :275, called from actions.ts:293 (inside U2-B's own 13 routes). Pre-existing (U1: SELECT-only b17.sql:136; B0 contract named SELECT+UPDATE only) and fail-closed while routes stay UNACTIVATED → DISPOSITION: MUST-FIX inside U2-B round-2's policy delta, before any fan-out route flips (tenant-bounded INSERT for own-tenant recipients; trim DELETE bound to the same transaction; platform fan-out planned separately for U2-F).
2. [Low] SHIELD-B17B0-02 — P platform-mode business/config audit INSERT has no branch (b17-content.sql:332–340 allow only auth/workspace/work; writer recordAuditLog index.ts:111–130) → P config/provisioning audit will be refused once admin routes flip. Fail-closed, and no P audit write exists among U2-B's 13 routes → DISPOSITION: acceptable-now; PRECONDITION before U2-F flips.
3. [Low] SHIELD-B17B0-03 — work-context audit INSERT (b17-content.sql:340) validates actor + tenant only, no action/entity whitelist: C/E can append self-attributed rows into their own tenant log (W(A) then reads them). Honest attribution, cross-tenant denied → DISPOSITION: acceptable-now; hardening decision for Tera, not a round-2 blocker.
4. [Info] Audit UPDATE/DELETE default-deny is silent 0-rows rather than 42501 (no policy; trigger only fires on a reaching row, proof:639–665) → append-only invariant intact → DISPOSITION: acceptable-now (detection nicety).
5. [Info] W A-filter deliberately not widened (b17-content.sql:327 keeps `mode='consultant'` + work_tenant; no platform-event or B leakage, proof:511–514) → correct §3.6 conformance → DISPOSITION: acceptable-now, no fix.
6. [Scope note] The declared 4-file diff omits a 5th B0-window write, src/lib/b17ScopeSecurity.test.ts:21–25 — inside §18's "src/lib/* policy tests" allowlist, content strengthens drift refusal (expects a two-function definer list to be REFUSED); no weakening found. Worktree is fully uncommitted at HEAD=c4ee8bc, so Git cannot isolate B0: file mtimes are the only diff evidence (caveat, not a defect).

## 5. Exercised vs static — unverified bounds (Shield ran nothing)
- All executed claims are agent-reported, NOT re-run by Shield: b17-domain-proof.ts groups/denials/drift probes (494–697), B17_CONTENT_SHAPE value (requires STRUCTURE_SQL execution), unit/lint/build totals.
- Handler behaviour unchanged-but-unexercised by Shield: WF-04 + required-reason, C start-work/evidence-only, freeze 409 pre-check, mime/size validator, purpose='work'/'workspace' GUC wiring for P notification/audit reads (mis-set purpose → 0 rows, fail-closed but wrong).
- Non-definer function ACL/owner changes are not in the structure fingerprint (function bodies only) — no escalation path (no SECURITY DEFINER), completeness note only.

## 6. Round-2 preconditions (before the 13 route flips)
1. Land SHIELD-B17B0-01 fan-out/trim policy + FORCE-RLS proof of positive insert/trim and cross-tenant/cross-user recipient denial.
2. Table-driven §3 positive+negative for all 13 rows through the real dispatcher+handler chain (incl. C full-transition denied, WF-04/reason negatives, E upload-only, P-with-tenant mismatch).
3. Re-prove freeze/5 MB/mime/WF-04/50-cap through the handlers post-flip; recompute B17_CONTENT_SHAPE by executing STRUCTURE_SQL after apply.
4. Resolve SHIELD-B17B0-02 before U2-F; decision needed from Tera: SHIELD-B17B0-03 whitelist — defer or require in round 2.
