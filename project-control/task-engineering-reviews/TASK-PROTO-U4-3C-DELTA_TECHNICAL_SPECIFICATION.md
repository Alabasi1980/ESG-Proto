# TASK-PROTO-U4-3C-DELTA — Minimal substrate delta for unit (c) (design only, NOT execution-authorized)

> Status: DESIGN ONLY — Draft. No code, no migration, no live DB. This file is the
> sole allowed write target of this design task.
> Classification: **SDA_REQUIRED** (auth/permissions mutation · P→W provisioning shift ·
> public API contract · cross-module approval state · background delivery writes).
> Impact overrides complexity.
> Parent spec: `project-control/task-engineering-reviews/TASK-PROTO-U4-3_TECHNICAL_SPECIFICATION.md`
> (API-2/4/5, DB-1/2/3, SEC-1/2/3, INV list — extended, not contradicted).
> Task file: `project-control/tasks/TASK-PROTO-U4-3/TASK-PROTO-U4-3.md`
> (§c + U4-3c1 STOP packet + Tera rulings HIGH/SPLIT/delta-first).
> Governing product: `prototype/OWNER_DECISIONS.md` OD-11/12/13 · `prototype/B17_UI_BINDINGS.md`
> §10 + staff matrix (C fills, W provisions+delivers) · G1 reveal-only now · G2 N/A
> disclosure-or-item + reason mandatory + W-only lift · G4 auto-match + override.
> RLS sources (read-only): `src/db/b17-content.sql` (ll.1214–1229, 1262–1271, 1325–1332,
> 1237–1240, 1284–1307) · `src/db/schema.sql` (inventory ll.112–145, 1144–1198) ·
> handlers `src/server/routes/adminProvisioning.ts`, `adminAssignments.ts`,
> `serviceVisibility.ts`, `src/lib/clientFieldMask.ts` (ownership only).
> Designer: tera-software-designer (مصمم). Stage: Phase 5 delta → Pre-Execution Gate (blocks c1 re-delegation).

---

## CORE

### 1. Task Identity

| Field | Value |
|---|---|
| Task | TASK-PROTO-U4-3c-delta (narrow SDA design — no code, NOT execution-authorized) |
| Title | Minimal RLS + store substrate that makes unit (c) buildable |
| Stage | Phase 5 delta (blocks U4-3c1 re-delegation) |
| Designer | tera-software-designer (مصمم) |
| Classification | SDA_REQUIRED |

### 2. Objective

Design the MINIMAL substrate delta the (c1) executor proved missing under zero-DDL
(read-only STOP, ses_e11f426a3ffeXpVQ57Ba9wfYLd): exact least-privilege RLS branch set
for W link/unlink, W approve/provision, W-assisted password completion, and N/A lift —
plus persistable stores for dept-matching override, delivery metadata (reveal-ack
idempotency), and participating-departments PUT. No code, no migration, no live DB.

### 3. In Scope / Out of Scope

**In scope (this delta only):**
- Exact RLS predicates (USING/WITH CHECK) + DROP-IF-EXISTS guards for gaps (a)–(d).
- Store shapes for (e)(f)(g): table/column design OR audit-derivation with explicit
  trade-off + why; migration order/rollback/zero-data-loss if DDL; transaction boundaries.
- Verification negative tests per branch; reviewers; Engineering Review Decision.

**Out of scope (explicitly NOT this delta):**
- Any handler/UI implementation (c1/c2 units consume this spec).
- Any FIX-sealed behavior change (INV-FIX-FROZEN); any new answer/approval semantics.
- Email infrastructure (G1 reveal-only now; per-recipient email table deferred, sketched only).
- First-class N/A scope table (parent DB-2 deferred option; this delta uses derived
  disclosure-N/A, no new scope column).
- Any widening of P/C/E capability; any UI-only authz fix.

### 4. Governing Sources (exact lines relied on)

| # | Source | Exact reliance |
|---|---|---|
| G-1 | Parent spec API-2/4/5, DB-1/2/3, SEC-1/2/3, INV-1…11 | Consumed unchanged; this delta extends DB-3 ("narrow policy addition with re-audit") and revises D-5 derivation-only per STOP proof — not a contradiction |
| G-2 | `b17-content.sql` ll.1214–1229 | `client_services` platform-config-only INSERT/UPDATE/DELETE (P@T explicit-T + NULL-target bulk); W has NO link/unlink branch → gap (a) |
| G-3 | `b17-content.sql` ll.1237–1240 | `b17_consultant_service_visibility` W UPDATE own row (purpose work + consultant + tenant match); RLS cannot column-scope → handler is column guard; INSERT/DELETE absent → gap (a) twin |
| G-4 | `b17-content.sql` ll.1254–1282 | `staff_lists` work INSERT (draft only) + work UPDATE (WITH CHECK submitted/rejected — cannot mint approved) + rows SELECT/INSERT platform-or-draft only → gap (b) |
| G-5 | `b17-content.sql` ll.1325–1332 | `users` INSERT/UPDATE platform-config-only (explicit-T) → W provision/completion has NO work branch → gaps (b)(c) |
| G-6 | `b17-content.sql` ll.1284–1307 | N/A shortcut W R+L INSERT (not_applicable + actor + linked + retained assignment); P/C/E refused; workflow UPDATE admits W broadly → gap (d) needs narrow lift transition |
| G-7 | `schema.sql` ll.1144–1198 | `staff_lists`/`staff_list_rows` shape (status draft/submitted/approved/rejected, UNIQUE(list,email)); no delivery columns; no matching/participation tables → gaps (e)(f)(g) |
| G-8 | Handlers (ownership) | `adminProvisioning.ts` explicit-T + FOR UPDATE + all-or-nothing + OTP-once; `adminAssignments.ts` linked/assigned/freeze/attachment guards; `serviceVisibility.ts` exact-key column guard; `clientFieldMask.ts` whitelist + fail-closed read |
| G-9 | Task G1/G2/G4 | Reveal-only now (no email build); N/A disclosure-or-item + reason mandatory + W-only lift; auto-match by code + manual override |

**Lifecycle-header note:** prototype docs carry no formal Lifecycle Header. Accepted as
owner-signed binding (same waiver as parent spec §4); Tera to confirm header requirement
for prototype/ docs at gate. Non-blocking.

### 5. Decision Provenance

| Decision | Source | Authority | Status |
|---|---|---|---|
| DD-1 W link/unlink = two additive work branches (INSERT + DELETE) on `client_services`, platform branches untouched | G-2/G-3 + STOP (a) | Approved source (DB-3 pattern) | APPROVED_SOURCE |
| DD-2 W approve = one additive UPDATE branch (submitted→approved, decided_by=actor) + W rows-SELECT + W users-INSERT, all work-bound-to-A | G-4/G-5 + STOP (b) | Approved source | APPROVED_SOURCE |
| DD-3 W-assisted completion = one additive users-UPDATE branch (must_change_password pinned true, role domain pinned) + handler single-column guard | G-5 + STOP (c) | Approved source | APPROVED_SOURCE |
| DD-4 N/A lift = one additive evaluations-UPDATE branch (USING not_applicable true → WITH CHECK not_applicable false + not_evaluated true + score NULL); disclosure-N/A stays derived (no scope column) | G-6 + G-9(G2) + parent DB-2 | Approved source (mechanism) / TECHNICAL_CHOICE (derived-disclosure) | APPROVED_SOURCE / TECHNICAL_CHOICE |
| DD-5 Dept-matching override = ONE narrow table (not audit-derivation); D-5 derivation-only superseded by STOP proof | G-7/G-9(G4) + STOP (e) | Technical choice (needs gate eyes) | TECHNICAL_CHOICE |
| DD-6 Delivery metadata = narrow columns on `staff_lists` (reveal-only now); per-recipient email table deferred | G-7/G-9(G1) + STOP (f) | Technical choice | TECHNICAL_CHOICE |
| DD-7 Participation = ONE narrow join table (not audit-derivation); D-5 reconciled as allowlist + assignment gate | G-7 + STOP (g) | Technical choice | TECHNICAL_CHOICE |
| DD-8 Zero wider access: every branch adds platform-config + ge_admin + actor-bound + target-bound-to-A pattern (W: purpose work + consultant + ge_admin + actor + tenant=A); P/C/E and cross-tenant explicitly denied | Profile Forbidden Defaults + STOP | Approved source | APPROVED_SOURCE |

> Any TECHNICAL_CHOICE changing visible behavior beyond this substrate → NEEDS_DECISION / Design Gap — no invention.

### 6. Technical Invariants (must remain true before/after)

1. **INV-DEF-APP**: no client application writes from Services surface (parent §6.1).
2. **INV-SINGLE-DEPT / INV-E-OWN-DEPT / INV-C/W-NEVER-ANSWERS**: unchanged.
3. **INV-FIX-FROZEN + INV-APPROVED-IMMUNE + INV-HISTORY + INV-FREEZE**: triggers + 409 paths untouched; delivery/lift/match writes respect freeze (409 + trigger backstop).
4. **INV-TENANT-ISOLATION**: W bound-to-A; C own-company; cross-tenant 403/404; no implicit scope.
5. **INV-AUDIT**: every new write audited in-txn from closed vocabulary (`SERVICE_LINKED/UNLINKED`, `STAFF_LIST_APPROVED_BY_W`, `STAFF_PASSWORD_COMPLETED`, `NA_SCOPE_LIFTED`, `DEPT_MATCH_OVERRIDDEN`, `PARTICIPATING_DEPTS_SET`, `CREDENTIAL_DELIVERED` metadata-only); OTPs/hashes never in payloads.
6. **INV-NO-SECRETS / INV-NO-LIVE-DB**: no secrets in code/logs/reports; no live DB in verification (isolated harness only).
7. **Additive-only RLS**: existing policies untouched; new branches carry DROP-IF-EXISTS; no FOR ALL widening; FORCE RLS retained.

### 7. Dependencies

- Code: parent §7 list (queue/answer/evidence/documents/initiatives/visibility/adminStaff/adminProvisioning/b11b/password/_shared/initiativeScope/scope/access + answerValidation).
- Schema: FIX-migrated baseline + `b17-content.sql` activation order (policies live there, not schema.sql — H13 precedent).
- Decisions: G1 (reveal-only built), G2 (disclosure-or-item + W-lift), G4 (auto-match + override table); G3/G5–G7 consumed.
- Blocking: SecurityAgent re-audit of this delta before c1 re-delegation (parent DB-3 rule).

### 8. Side-Effect Registry

| Area | Effect | Handling |
|---|---|---|
| `client_services` writes | W gains link/unlink in bound-A only | INSERT/DELETE branches §RLS-a; flags/mask unwritable via these (handler allowlist + separate visibility route) |
| Staff flow | W gains approve (submitted→approved) + provision INSERT + completion UPDATE | §RLS-b/c; all-or-nothing + OTP-once + must_change preserved; P leg unchanged (emergency explicit-T only) |
| N/A lift | W-only lift to unevaluated (never direct-to-scored) | §RLS-d; reason + audit + freeze + version gates handler-side |
| Matching/participation/delivery | Two narrow tables + list columns (iff DDL approved) | §STORE; FK RESTRICT backstops; audit in-txn; rollback = DROP (delivery metadata ephemeral, accounts source of truth) |
| Reports/exports | Derived disclosure-N/A (all-items-N/A + exclusion filter); no recount | Handler/report rule; no scope column in this delta |
| Audit vocabulary | 7 additive actions (see §6.5) | Existing names untouched; `b17_audit_insert` work branch (`OR b17_work_tenant`) already admits — no new audit policy needed |
| Notifications | No new fan-out in this delta | Reuse existing staff/assignment notify paths |

### 9. Failure & Recovery

| Failure | Response | Recovery |
|---|---|---|
| Link exists / unlink with live tenant work | 409 `service.link_conflict` / `service.unlink_blocked`; no partial link | Re-fetch links; archive-scope rule per FIX DG-02 before unlink; audit attempt |
| Approve with empty/invalid/foreign rows | 400/409/403; whole batch rolls back (existing all-or-nothing) | Fix rows → resubmit; no partial provisioning |
| OTP redisplay / second reveal fetch | 404/403 refused; delivery status metadata only | Forced-rotation reset via completion flow; no OTP regeneration |
| Delivery send failure (reveal-ack) | Batch unaffected (accounts already committed in prior txn); delivery status `failed` | Retry delivery only; no re-provision |
| N/A lift on frozen scope / with downstream GE-final | 409 FROZEN_SCOPE + trigger backstop | Snapshot-note path only; history intact |
| Match override to non-participating dept | 400/403 refused; assignment unchanged | Add dept to participation set first (audited) |
| Dept removal with assignments/overrides | 409 + FK RESTRICT backstop | Unassign/unmap first; no cascade |
| Cross-tenant / P/C/E write attempt | 403/404 + audit; RLS default-deny | Re-scope to own tenant/dept |
| Concurrent link/match/approve | `FOR UPDATE` + `ON CONFLICT DO NOTHING` + version 409; stale rolls back | Re-fetch, merge, retry |
| Migration need discovered beyond this sketch | STOP: separate SDA_REQUIRED migration design, not smuggled into c1 | This delta IS that design; c1 consumes it |

### 10. Security Classification

- Trust boundaries: P (platform config, explicit-T or NULL-target) · W (consultant, bound A, purpose `work`) · C (own-company) · E (own-dept). Server selects purpose/target; request values never trusted (profile First Task Rule).
- AuthN/Z: `authMiddleware` + `requireFreshPassword` (all writes) + `requireDomainAccess`; workspace routes re-assert `mode==='consultant' && role==='ge_admin'` defence-in-depth beside matrix.
- Secrets: OTPs CSPRNG server-side, hash-only storage, returned ONCE in approve response, never logged/audited/refetched; reveal panel shows once + acknowledge clears memory; completion sets temporary + must_change stays true (login forces rotation).
- Fail-closed: unknown combos 403; frozen 409 + triggers; mask smuggling 400; stale version 409; corrupt mask fail-closed (ALL hidden).

### 11. Verification Strategy (summary — full matrix in §VERIFY)

- Existing harness (`node:test` + file-pin tests) + API contract tests per route × role.
- **Negative tests mandatory** (N-1…N-14 in §VERIFY): cross-tenant, P/C/E denial, frozen-scope, re-entry/replay, smuggling, version conflict.
- Lint/tests/build green; zero literal colors; AR/EN + mobile/desktop; isolated harness only.

### 12. Reviewers (suggested post-execution)

SecurityAgent (RLS branch re-audit MANDATORY — least-privilege + no-wider-access proof), QA (E2E §VERIFY + N-1…N-14 harness), Auditor (audit vocabulary + history + no-secret evidence), Tera (gate), Majed (DDL approval + any open Design Gap).

### 13. Engineering Review Decision

**APPROVED_FOR_GATE (conditional)** — the substrate below is technically mature for the
Pre-Execution Gate **iff** SecurityAgent re-audits the exact predicates in §RLS and the
DDL sketch in §STORE, and Majed approves the ONE-or-TWO-table + list-columns migration
(or orders the audit-derivation fallback explicitly). On those two approvals → c1
re-delegation unblocked with widened targets. No invented product behavior; open points
are explicit Design Gaps in §14, not silent assumptions.

### 14. Design Gaps

| ID | Gap (owner-facing wording) | Impact | Proposed default |
|---|---|---|---|
| DG-D1 | "مسار إكمال كلمة المرور (G5 سابقاً): هل يضبط W كلمة أولى مؤقتة تُجبر على التغيير، أم يرسل رابط إعداد لمرة واحدة؟ وهل يُسمح لـ C بالمساعدة؟" | Gates complete-password UX copy (row scope designed; UX pick open) | Temporary + must_change preserved; C never sees secrets (parent G5 default, unchanged) |
| DG-D2 | "أعمدة القناع الجديدة لحقول U4-3 (مستندات/مبادرات/حالة N/A): هل تُخفى عن C افتراضياً أم تُعرض؟" | Gates visibility vocabulary extension (route exists; word list open) | Default visible unless W hides (parent G6 default, unchanged) |
| DG-D3 | "الكشف لمرة واحدة: هل الإقرار (acknowledge) من W وحده كافٍ لاعتبار التسليم مكتملاً، أم يلزم تأكيد استلام من C؟" | Gates delivery-status terminal state wording | W-ack = `revealed`; C-relay out-of-band; `completed` only at first-login rotation (no new C write invented) |

---

## RLS MODULE — exact branch set (additive only; existing policies untouched)

Conventions: every new policy carries `DROP POLICY IF EXISTS` first (idempotent
re-application, same contract as FIX P1/P4). `b17_work_tenant(t)` = own-tenant work
scope; `b17_platform_config()` = server-set purpose `platform.config` + GE actor.
W branches use **purpose `work` + mode `consultant` + role `ge_admin` + actor NOT NULL +
`client_id = current_tenant_id`** (target-bound-to-A). P/C/E and cross-tenant have NO
branch → default-deny. Handler remains the column/transition guard where RLS cannot
express it (mask single-column, approve OTP-once, lift reason, freeze 409).

### RLS-a — W link/unlink `client_services` (gap a)

Evidence: P-only INSERT `b17_admin_links_insert` (platform.config + platform + target-bound
or NULL-target bulk, ll.1214–1217); P-only UPDATE/DELETE (target-bound, ll.1222–1229);
W UPDATE own row `b17_consultant_service_visibility` (work + consultant + tenant match,
ll.1237–1240). No W INSERT/DELETE → link/unlink impossible for W. SELECT already admitted
via `b17_scope` (work_tenant + mode≠employee).

```sql
DROP POLICY IF EXISTS b17_consultant_links_insert ON client_services;
CREATE POLICY b17_consultant_links_insert ON client_services FOR INSERT WITH CHECK (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
  AND service_id IS NOT NULL
);

DROP POLICY IF EXISTS b17_consultant_links_delete ON client_services;
CREATE POLICY b17_consultant_links_delete ON client_services FOR DELETE USING (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
);
```

- Rationale: mirrors platform branch shape (config + ge_admin + actor + target-bound)
  translated to the work context; strictly narrower than the existing visibility UPDATE
  (which lacks role/actor pins — this delta does NOT widen that policy).
- Does NOT admit: P/C/E (mode/role mismatch); cross-tenant (tenant pin); targetless
  bulk (no NULL-target branch); flag/mask escalation (handler writes ONLY
  `(client_id, service_id)` on INSERT and deletes the row; `show_gap/show_corrective/
  client_field_mask` unwritable via these branches — separate visibility route owns mask).
- Txn: link/unlink one txn (work-precondition counts + `FOR UPDATE` on existing link + audit `SERVICE_LINKED/UNLINKED`); unlink with live work → 409 before DELETE.

### RLS-b — W approve/provision (gap b)

Evidence: work UPDATE WITH CHECK pins W/C to `submitted/rejected` (ll.1267–1271) so W
cannot mint `approved`; rows SELECT/INSERT platform-or-draft only (ll.1272–1282); users
INSERT/UPDATE platform-only (ll.1325–1332); staff SELECT `b17_admin_staff_read`
platform-only (ll.1254–1256) so W/C work reads need branches too.

```sql
-- (b1) W/C own-tenant list reads (work; P keeps its platform branches untouched)
DROP POLICY IF EXISTS b17_work_staff_read ON staff_lists;
CREATE POLICY b17_work_staff_read ON staff_lists FOR SELECT USING (
  b17_work_tenant(client_id)
  AND b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') IN ('consultant', 'client')
  AND b17_setting('current_actor_id') IS NOT NULL
);

-- (b2) W rows read for approve preflight (read-only; no row mutation widened)
DROP POLICY IF EXISTS b17_consultant_staff_rows_read ON staff_list_rows;
CREATE POLICY b17_consultant_staff_rows_read ON staff_list_rows FOR SELECT USING (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND EXISTS (SELECT 1 FROM staff_lists s WHERE s.id = staff_list_rows.list_id
    AND b17_work_tenant(s.client_id))
);

-- (b3) W approve transition ONLY: submitted -> approved, decider = actor
DROP POLICY IF EXISTS b17_consultant_staff_approve_update ON staff_lists;
CREATE POLICY b17_consultant_staff_approve_update ON staff_lists FOR UPDATE
  USING (
    b17_work_tenant(client_id)
    AND b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND status = 'submitted'
  )
  WITH CHECK (
    b17_work_tenant(client_id)
    AND b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND decided_by::text = b17_setting('current_actor_id')
    AND status = 'approved'
  );

-- (b4) W provision INSERT (WF-01 pinned in SQL: forced rotation + non-platform roles only)
DROP POLICY IF EXISTS b17_consultant_users_provision_insert ON users;
CREATE POLICY b17_consultant_users_provision_insert ON users FOR INSERT WITH CHECK (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
  AND role IN ('employee', 'client_admin')
  AND must_change_password = true
  AND is_active = true
);
```

- Rationale: (b3) USING pins the OLD row `submitted` (no draft→approved skip; WF-01
  preserved); WITH CHECK pins NEW `approved` + `decided_by=actor` (accountability).
  (b4) pins forced rotation + role domain so this path can never mint a `ge_admin` or a
  rotation-free account. Existing platform branches untouched (emergency P@T preserved).
- Does NOT admit: C approve (mode mismatch); P approve via work (mode mismatch);
  E (mode mismatch); cross-tenant (tenant pin); empty-list approve / foreign-dept rows /
  duplicate emails (handler preflight 400/409 before any INSERT; all-or-nothing txn);
  second OTP fetch (no SELECT/UPDATE branch returns hashes/OTPs).
- Txn: approve one txn (`SELECT … FOR UPDATE` on list + row preflight + users INSERTs +
  list UPDATE + `STAFF_LIST_APPROVED_BY_W` audit + notify in-txn); any failure rolls back
  the batch. Delivery runs in a SEPARATE later txn (§STORE-f).

### RLS-c — W-assisted password completion (gap c)

New route `POST /api/workspace/staff/:userId/complete-password` (W bound-A only).
Row scope admits the hash rotation; the HANDLER is the single-column guard (writes ONLY
`password_hash` + `updated_at`, never email/role/client/department/is_active/
must_change_password — same discipline as `serviceVisibility.ts`).

```sql
DROP POLICY IF EXISTS b17_consultant_staff_complete_password ON users;
CREATE POLICY b17_consultant_staff_complete_password ON users FOR UPDATE
  USING (
    b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND client_id::text = b17_setting('current_tenant_id')
    AND id::text <> b17_setting('current_actor_id')
    AND must_change_password = true
    AND is_active = true
    AND role IN ('employee', 'client_admin')
  )
  WITH CHECK (
    b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND client_id::text = b17_setting('current_tenant_id')
    AND must_change_password = true
    AND is_active = true
    AND role IN ('employee', 'client_admin')
  );
```

- Rationale: USING pins a provisioned, rotation-pending, active, non-platform account
  of A that is NOT the actor (no self-completion via this route — self rotates via login
  flow S-11); WITH CHECK keeps rotation forced + role domain (this path can never clear
  `must_change_password` nor promote to `ge_admin`).
- Does NOT admit: P/C/E; cross-tenant; self-target; rotation bypass; role/email/client
  reassignment (handler column guard + WITH CHECK domain); login-flow changes (untouched).
- Txn: single-row txn (user `FOR UPDATE` + hash write + `STAFF_PASSWORD_COMPLETED`
  metadata-only audit); freeze N/A (users are not scope-frozen; tenant suspension checked handler-side).

### RLS-d — N/A lift (gap d)

Evidence: shortcut INSERTs W-only (ll.1290–1307); workflow UPDATE admits W broadly
(ll.1088–1104) but encodes no lift transition. Disclosure scope needs no new column
(this delta): disclosure-N/A = ALL items under the disclosure N/A'd (derived, parent DB-2
option ii); report filter excludes N/A (never zero-fills); lift disclosure = lift each.

```sql
DROP POLICY IF EXISTS b17_consultant_evaluations_na_lift_update ON evaluations;
CREATE POLICY b17_consultant_evaluations_na_lift_update ON evaluations FOR UPDATE
  USING (
    b17_work_tenant(client_id)
    AND b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND b17_item_visible(client_id, item_id)
    AND not_applicable = true
  )
  WITH CHECK (
    b17_work_tenant(client_id)
    AND b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND b17_item_visible(client_id, item_id)
    AND not_applicable = false
    AND not_evaluated = true
    AND score IS NULL
    AND na_reason IS NULL
  );
```
-- Shield F2 [Low]: WITH CHECK re-pins purpose/mode/role/actor/item_visible
-- (defense-in-depth, mirrors b3). No behavior change beyond the pin; handler still
-- owns reason-required (400 `na.reason_required`), freeze 409, and version lockstep.

- Rationale: USING pins an N/A row on a linked item in A; WITH CHECK forces the lift
  landing state to **unevaluated** (never direct-to-scored — re-evaluation goes through
  the normal scored flow; prevents lift-to-score smuggling). Reason lives in the
  `NA_SCOPE_LIFTED` audit payload + paired answer correction history (handler-required,
  400 `na.reason_required` if absent). The paired `answers` shortcut row reverts via the
  EXISTING `b17_answers_workflow_update` W branch (no new answers policy needed — stated
  explicitly so SecurityAgent can verify zero-widening there).
- Does NOT admit: P/C/E lift (matrix refused before handler + no branch); cross-tenant;
  lift-to-scored; reason-less lift (handler 400); frozen-scope lift (409 + trigger
  backstop); lift of a non-N/A row (USING pin).
- Txn: single txn (freeze check → evaluation UPDATE → paired answer reopen/correction →
  audit; stale `expectedVersion` → ROLLBACK + 409).

---

## STORE MODULE — persistable state for (e)(f)(g)

Doctrine: audit is evidence, not state. Audit-derivation (replay `*_SET` payloads) is
designed as the explicit fallback and REJECTED for (e)(g) with reasons (no FK, no
uniqueness, replay cost, lost-update on concurrency, cannot enforce
unmatched-blocks-assignment / dept-removal-409 at DB level). DDL below is minimal,
additive, idempotent (DO-block catalogue guards, same contract as FIX BATCH 1/8/9/10/11),
with forward/backward + zero-data-loss per FIX DB-6 pattern.

### STORE-e — dept-matching override (gap e)

No table exists (parent DB-1 lists none; STOP proof accepted). Recommended: ONE narrow table.

```sql
-- Forward (idempotent; additive only; no existing row rewritten)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='dept_match_overrides') THEN
    CREATE TABLE dept_match_overrides (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      service_dept_code TEXT NOT NULL,
      client_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      UNIQUE(client_id, service_id, service_dept_code)
    );
  END IF;
END $$;
ALTER TABLE dept_match_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE dept_match_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS b17_match_override_read ON dept_match_overrides;
CREATE POLICY b17_match_override_read ON dept_match_overrides FOR SELECT USING (
  b17_work_tenant(client_id)
  AND b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') IN ('consultant', 'client')
  AND b17_setting('current_actor_id') IS NOT NULL);
DROP POLICY IF EXISTS b17_match_override_write ON dept_match_overrides;
CREATE POLICY b17_match_override_write ON dept_match_overrides FOR INSERT WITH CHECK (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
  AND EXISTS (SELECT 1 FROM departments d WHERE d.id = client_department_id AND d.client_id::text = b17_setting('current_tenant_id')));
DROP POLICY IF EXISTS b17_match_override_update ON dept_match_overrides;
CREATE POLICY b17_match_override_update ON dept_match_overrides FOR UPDATE
  USING (
    b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND client_id::text = b17_setting('current_tenant_id')
    AND b17_work_tenant(client_id)
  )
  WITH CHECK (
    b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND client_id::text = b17_setting('current_tenant_id')
    AND b17_work_tenant(client_id)
    AND EXISTS (SELECT 1 FROM departments d WHERE d.id = client_department_id AND d.client_id::text = b17_setting('current_tenant_id')));
DROP POLICY IF EXISTS b17_match_override_delete ON dept_match_overrides;
-- Tenant DELETE only when no dependent work: handler refuses 409 when assignments
-- reference the mapped dept; FK RESTRICT on client_department_id is the DB backstop.
CREATE POLICY b17_match_override_delete ON dept_match_overrides FOR DELETE USING (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
  AND b17_work_tenant(client_id)
);
```

- Why a table (not a column on `client_services`, not audit replay): per-mapping FK
  (`client_department_id` RESTRICT — dept removal with override refused at DB level),
  per-(client,service,code) uniqueness (auto-match + override cannot double-book),
  per-row audit, `FOR UPDATE` concurrency. A JSONB map column would lose FK/uniqueness;
  audit replay would lose all three + cost replay on every assignment.
- Keys: `service_dept_code` = the service-side department code being matched (auto-match
  compares against `departments.code` of A; G4). No invented semantics: unmatched items
  block assignment (400 `match.incomplete`), override audited (`DEPT_MATCH_OVERRIDDEN`).
- Backward/rollback: `DROP TABLE IF EXISTS dept_match_overrides` (+ policies). Zero
  data loss: green installs create empty; live upgrade adds empty table (no backfill, no
  rewrite); rollback drops only override rows (assignments/answers untouched — source of
  truth preserved).
- Txn: `PUT /workspace/dept-matching` one txn (validate depts ∈ A + services linked +
  upsert set + audit; removal-with-assignments → 409 before DELETE).

### STORE-f — delivery metadata / reveal-ack idempotency (gap f)

Reveal-ack idempotency REQUIRES persisted state (otherwise reload re-displays the OTP =
secret leak). Recommended: narrow columns on `staff_lists` (reveal-only now); per-recipient
email table DEFERRED (sketched, not built — G1 reveal-only).

```sql
-- Forward (idempotent DO-blocks; NULL = undelivered; no backfill; no rewrite)
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff_lists' AND column_name='delivery_channel') THEN ALTER TABLE staff_lists ADD COLUMN delivery_channel TEXT NULL; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff_lists' AND column_name='delivery_status') THEN ALTER TABLE staff_lists ADD COLUMN delivery_status TEXT NULL; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff_lists' AND column_name='revealed_by') THEN ALTER TABLE staff_lists ADD COLUMN revealed_by UUID REFERENCES users(id) ON DELETE SET NULL; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff_lists' AND column_name='revealed_at') THEN ALTER TABLE staff_lists ADD COLUMN revealed_at TIMESTAMP WITH TIME ZONE NULL; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff_lists' AND column_name='reveal_acked_at') THEN ALTER TABLE staff_lists ADD COLUMN reveal_acked_at TIMESTAMP WITH TIME ZONE NULL; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='staff_lists_delivery_valid') THEN ALTER TABLE staff_lists ADD CONSTRAINT staff_lists_delivery_valid CHECK (delivery_channel IS NULL OR delivery_channel IN ('reveal','email')) ; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='staff_lists_delivery_status_valid') THEN ALTER TABLE staff_lists ADD CONSTRAINT staff_lists_delivery_status_valid CHECK (delivery_status IS NULL OR delivery_status IN ('undelivered','revealed','acked','emailed','failed')); END IF; END $$;
-- Shield F1 [Medium]: NARROW additive delivery-UPDATE branch (new-code path only).
-- b3 (`b17_consultant_staff_approve_update`) is NOT widened — it still admits ONLY
-- submitted -> approved. Delivery runs AFTER approval on an already-approved row, so it
-- needs its own branch: USING approved + W bound-A -> WITH CHECK approved + delivery
-- domain pins. RLS cannot column-scope: the HANDLER is the single-column guard
-- (writes ONLY delivery_channel/delivery_status/revealed_by/revealed_at/reveal_acked_at,
-- never status/client/decided_by — same discipline as serviceVisibility.ts).
DROP POLICY IF EXISTS b17_consultant_staff_deliver_update ON staff_lists;
CREATE POLICY b17_consultant_staff_deliver_update ON staff_lists FOR UPDATE
  USING (
    b17_work_tenant(client_id)
    AND b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND status = 'approved'
  )
  WITH CHECK (
    b17_work_tenant(client_id)
    AND b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND status = 'approved'
    AND (delivery_channel IS NULL OR delivery_channel IN ('reveal', 'email'))
    AND (delivery_status IS NULL OR delivery_status IN ('undelivered', 'revealed', 'acked', 'emailed', 'failed'))
  );
-- W/C reads reuse (b1); W approve reuses b3. This branch is delivery-only.
```

- States: `NULL/undelivered → revealed (OTP shown once) → acked (W acknowledge, OTP memory
  cleared, no refetch)`; `completed` is derived at first-login rotation (no new write).
  Second reveal fetch → refused (status proves prior disclosure); ack replay → idempotent
  same status. Payloads carry metadata only (counts + emails), never secrets.
- Deferred (NOT built): `staff_list_deliveries(list_id, recipient_email, channel, status,
  attempted_at)` per-recipient email statuses + retry — only if owner later orders G1-i.
- Backward/rollback: drop the two CHECKs + columns. Zero data loss: accounts (`users`)
  are source of truth in the EARLIER provisioning txn; delivery txn touches ONLY these
  columns + audit, so rollback drops ephemeral metadata, never accounts.
- Txn: delivery SEPARATE txn AFTER provisioning (approve commits accounts first);
  `POST …/:id/deliver {channel:'reveal-ack'}` → set `revealed` + audit
  `CREDENTIAL_DELIVERED{channel, delivered}` → ack → `acked`. Email channel (if ever)
  returns 400 `delivery.email_unavailable` until the deferred table lands.

### STORE-g — participating departments PUT state (gap g; reconciles D-5)

D-5 (derived from `assignments` presence) cannot persist a `PUT {departmentIds[]}` set:
assignments are per-(client,item,dept) and need an item; participation is per-(client,dept)
membership. Recommended: ONE narrow join table as the membership allowlist; D-5 derivation
becomes the EFFECTIVE rule (explicit set ∩ assignment gate), not the storage.

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='participating_departments') THEN
    CREATE TABLE participating_departments (
      client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
      added_by UUID REFERENCES users(id) ON DELETE SET NULL,
      added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      PRIMARY KEY (client_id, department_id)
    );
  END IF;
END $$;
ALTER TABLE participating_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE participating_departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS b17_participating_read ON participating_departments;
CREATE POLICY b17_participating_read ON participating_departments FOR SELECT USING (
  b17_work_tenant(client_id)
  AND b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') IN ('consultant', 'client')
  AND b17_setting('current_actor_id') IS NOT NULL);
DROP POLICY IF EXISTS b17_participating_write ON participating_departments;
CREATE POLICY b17_participating_write ON participating_departments FOR INSERT WITH CHECK (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
  AND EXISTS (SELECT 1 FROM departments d WHERE d.id = department_id AND d.client_id::text = b17_setting('current_tenant_id')));
DROP POLICY IF EXISTS b17_participating_update ON participating_departments;
CREATE POLICY b17_participating_update ON participating_departments FOR UPDATE
  USING (
    b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND client_id::text = b17_setting('current_tenant_id')
    AND b17_work_tenant(client_id)
  )
  WITH CHECK (
    b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND client_id::text = b17_setting('current_tenant_id')
    AND b17_work_tenant(client_id)
    AND EXISTS (SELECT 1 FROM departments d WHERE d.id = department_id AND d.client_id::text = b17_setting('current_tenant_id')));
DROP POLICY IF EXISTS b17_participating_delete ON participating_departments;
-- Tenant DELETE only when no dependent work: handler refuses 409 when assignments
-- exist for the dept; FK RESTRICT on department_id is the DB backstop.
CREATE POLICY b17_participating_delete ON participating_departments FOR DELETE USING (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
  AND b17_work_tenant(client_id)
);
```

- Reconciliation with D-5: explicit set = allowlist; assignment creation requires dept ∈
  set (400 `match.incomplete` otherwise); removing a dept WITH assignments → 409
  (handler check first, RESTRICT backstop second); effective participation shown in UI =
  set members (with ≥1-assignment marker derived, preserving D-5's spirit without
  history-as-state). C reads the set; only W writes it.
- Backward/rollback: `DROP TABLE IF EXISTS participating_departments`. Zero data loss:
  empty on create; rollback drops membership only (assignments/answers untouched).
- Txn: `PUT /workspace/participating-departments` one txn (validate depts ∈ A +
  diff add/remove + removal-with-work check + audit `PARTICIPATING_DEPTS_SET`).
- Migration order (if DDL approved): `schema.sql` DO-blocks (2 tables + 5 columns +
  2 CHECKs, no backfill) → `b17-content.sql` policies (DROP-IF-EXISTS + CREATE, §RLS+§STORE)
  → `b17.sql` fingerprint / readiness re-pin → c1 build. Rollback order reversed.

---

## API / DB / SECURITY notes (extends parent, no contradiction)

- Routes consumed unchanged (parent API-2 CONSUME list); NEW/CHANGE routes carry the §RLS
  branches above; handler ownership (`adminProvisioning` locks + OTP-once,
  `adminAssignments` linked/assigned/freeze/attachment guards, `serviceVisibility`
  exact-key guard, `clientFieldMask` whitelist + fail-closed) unchanged and owns all
  non-row-scope rules (reason required, version lockstep, freeze 409, mask vocabulary,
  column guards).
- `b17_audit_insert` needs NO new branch (existing `OR b17_work_tenant(client_id)` admits
  W/C work audit rows; platform branches admit P@T rows).
- Freeze: `is_scope_frozen` triggers + `block_frozen_scope_write` cover answers/evaluations;
  match/participation/delivery refuses frozen tenant/item with 409 before writes.

---

## VERIFY MODULE — verification strategy + negative tests

- Unit: mask parser, auto-map (code equality), staff-row validator (`b11b.ts` preserved),
  N/A-scope validator, lift-transition validator (USING→WITH CHECK pins), delivery-status
  machine (no secret in payload), participating-diff helper.
- Contract: P/W/C/E × each route in parent API-2 + new PUT/POST/DELETE above; allowed →
  2xx, others → 403/404; matrix deltas pinned per route.
- **Negative tests (mandatory, isolated harness only):**
  - N-1 cross-tenant link/unlink/read of another tenant's services/lists → 403.
  - N-2 write to frozen scope (link/mask/match/N-A/approve/deliver) → 409 + trigger backstop.
  - N-3 C POST answer/attachment OR W POST answer/attachment → 403 (never-answer).
  - N-4 E read/write outside own department → 403.
  - N-5 N/A shortcut on attachment-required item → 409 `assignment.na_attachment_required`.
  - N-6 P direct approve call (post-UI-removal) → 403 + audit; emergency explicit-T only.
  - N-7 OTP redisplay / second reveal fetch → 404/403; audit shows metadata only.
  - N-8 mask smuggling (unknown key / extra column key) → 400 `service.mask_invalid`.
  - N-9 unbound/expired W workspace application write → 403 `workspace.mode_mismatch`.
  - N-10 stale-version confirm/correct (evaluation/answer) → 409; history intact.
  - N-11 W link cross-tenant service / P/C/E link attempt → 403 (RLS-a).
  - N-12 C approve / draft→approved skip / ge_admin mint via provision path → 403 + RLS WITH CHECK refusal.
  - N-13 N/A lift to scored / reason-less lift / lift of non-N/A row → 400/403 (RLS-d + handler).
  - N-14 reveal-ack replay / second delivery after ack → idempotent same status, no OTP; email channel while reveal-only → 400 `delivery.email_unavailable`.

---

## SHIELD RE-AUDIT CHECKLIST (round 2 — FINAL; ses_e11ecf226ffeq1IY3qL0VozVeT)

- F1 delivery branch `b17_consultant_staff_deliver_update`: exact text in §STORE-f; b3 untouched (submitted→approved only). Harness: N-7 (no OTP refetch) + N-14 (ack replay idempotent; email channel 400 while reveal-only).
- F2 N/A-lift WITH CHECK re-pin (purpose/mode/role/actor/item_visible): exact text in §RLS-d. Harness: N-13 (lift-to-scored refused; reason-less 400; non-N/A 403) + N-2 (frozen 409 + trigger).
- F3 STORE-e `b17_match_override_update/delete` + STORE-g `b17_participating_update/delete`: exact texts in §STORE-e/§STORE-g (no abbreviations remain). Harness: N-11/N-1 (cross-tenant 403), N-2 (removal-with-work 409 + RESTRICT), N-4 (E denied).
- Full negative matrix N-1…N-14 in §VERIFY: N-1 cross-tenant 403 · N-2 frozen 409 · N-3 never-answer 403 · N-4 E-dept 403 · N-5 attachment-required 409 · N-6 P-approve 403 · N-7 OTP 404/403 · N-8 mask 400 · N-9 mode_mismatch 403 · N-10 version 409 · N-11 link 403 · N-12 provision-domain 403 · N-13 lift 400/403 · N-14 ack-idempotent/email-400. Isolated harness only, no live DB.
- DG-D1 UX-only, zero predicate impact (completion copy pick; row scope fixed in §RLS-c).
- DG-D2 UX-only, zero predicate impact (mask word list pick; parser/vocabulary fixed).
- DG-D3 UX-only, zero predicate impact (ack terminal wording; reveal states fixed in §STORE-f).
- Self-consistency: every named branch (RLS-a ×2, b1–b4, deliver, RLS-c, RLS-d, STORE-e ×4, STORE-g ×4) has exact CREATE text + DROP-IF-EXISTS; no dangling references; additive-only; FORCE RLS retained.

---

## Handback checklist

- Spec path: `prototype-app/project-control/task-engineering-reviews/TASK-PROTO-U4-3C-DELTA_TECHNICAL_SPECIFICATION.md`
- Gaps closed: (a) RLS-a INSERT+DELETE · (b) RLS-b b1–b4 · (c) RLS-c · (d) RLS-d (+ derived disclosure-N/A, no scope column) · (e) STORE-e table · (f) STORE-f columns (+ deferred email table) · (g) STORE-g table — or explicit owner-facing Design Gap DG-D1…D3 where UX wording remains open (no silent invention)
- STOP/ASK: SecurityAgent re-audit of exact predicates (MANDATORY) + Majed DDL approval (2 tables + list columns) before c1 re-delegation
- Decision: APPROVED_FOR_GATE (conditional — SecurityAgent + Majed approvals as gate conditions)
- Return: completed + spec path + gap list + STOP/ASK
