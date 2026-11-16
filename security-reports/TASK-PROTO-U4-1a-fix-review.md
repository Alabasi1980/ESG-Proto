# TASK-PROTO-U4-1a — Security Fix Review (الدرع / Shield)

- Mode: Fix Review (static, session NEW)
- Client app: `prototype-app` · Base: `0edf250`
- Reviewer: security-agent (الدرع)
- Verdict: **No High/Critical. 0 blocking. 3 Low (1 process, 1 defense-in-depth, 1 latent) + residuals.**
- Method: diff-first vs `0edf250`; no execution, no live DB, no source/test/control writes. This report is the only artifact.

---

## 1. Findings by severity

### High / Critical
None.

### SHIELD-U41A-01 — Low — A malformed/stale stored mask is **fail-OPEN** (defense-in-depth)
- Evidence: `src/lib/clientFieldMask.ts:45-50` (non-array ⇒ `EMPTY_CLIENT_FIELD_MASK`); `src/server/scope.ts:292-294` (`CASE WHEN jsonb_typeof(...)='array' THEN ... ELSE '[]'`); pinned as intended in `src/lib/clientFieldMask.test.ts:48-52`.
- Impact: if `client_services.client_field_mask` ever holds a non-array/legacy value (direct DB write, future bug, or migration), the CLIENT is served the fields that should be hidden. No API path can create a malformed value: both writers validate (`serviceVisibility.ts:29`, `adminClients.ts:414-424`), and the column intentionally has no CHECK (`schema.sql`).
- Gap vs the review question "fail-closed when malformed": the implementation is fail-open **by design** (documented). Not currently exploitable.
- Recommendation: Tera records an explicit acceptance, OR change malformed ⇒ "hide all whitelisted fields" if strict fail-closed is required.
- Status: **Open — Tera disposition** (not a blocker in my judgement).

### SHIELD-U41A-02 — Low (process) — G1 reviewer-report exclusion not updated for U4-1a
- Evidence: `src/lib/b17TransactionInventory.test.ts:266-280` (`reviewerReports`) lists prior QA/Shield paths but **not** `security-reports/TASK-PROTO-U4-1a-fix-review.md` (nor the QA report); the guard at `:300-305` flags any untracked/diff path not in `allowed`/`reviewerReports`/`controlInputs`/`authorizedDeletions` as `Unapproved write`. `security-reports/` is tracked (`.gitignore` only ignores `.env*`).
- Impact: as soon as this review artifact (and the QA report) lands, the executor-scope guard fails. This is a governance/pin gap, **not** a confidentiality or authority issue.
- Recommendation: add the two exact paths to `reviewerReports` (sanctioned test edit, mirroring U3-A/U3-B2), or a Tera ruling.
- Status: **Open**.

### SHIELD-U41A-03 — Low (latent) — Reports 422 incomplete-index path bypasses redaction
- Evidence: redaction runs in `src/server/routes/reports.ts:25-29` only AFTER `buildReportPayload` returns; on an incomplete index it THROWS with the **unstripped** `index` (`reportData.ts:52-53`) and `failure` returns `err.index` (`reports.ts:35`).
- Impact now: none — `DisclosureIndexRow` has no maskable field (`src/lib/reports.ts:202-224`); only aggregates/score/coverage. Latent: if a maskable column (e.g. `weight`) is ever added to the index row, this error/CSV path would leak it. `/reports/export` JSON+CSV use the stripped `payload.index` (`reports.ts:47-51`).
- Recommendation: strip `err.index` on the throw path, or assert the index row carries no maskable key.
- Status: **Open — hardening** (Tera to accept or route).

### Residual / informational (no action this round)
- `scopedScoreInputs` returns `e.*, i.weight` (`scope.ts:124-132`) but has **no callers** — latent mask bypass if ever wired to a C route.
- `itemQuery`/`scopedItems` return `SELECT i.*` (`scope.ts:59`); today only used for existence checks and `inner.values` — latent bypass if a future C projection returns those rows.
- Masking `weight` does not remove weight's influence on shown aggregate scores/coverage (`reportData.ts`, `gri.ts:530-596`); accepted per task ("aggregates computed above"); scores stay governed by `show_gap`.
- P@T audit payload spreads `...body` (`adminClients.ts:456-458`); P-trusted, no secrets — consider whitelisting audit keys.

---

## 2. Requirement-by-requirement (evidence)

**(1) New W policy — reachability & column scope — PASS**
- `src/db/b17-content.sql:985-988`: `FOR UPDATE`; `USING (purpose='work' AND mode='consultant' AND client_id=current_tenant_id)`; `WITH CHECK (client_id=current_tenant_id)`. Tenant is asserted on both the row and the resulting row ⇒ no cross-tenant move.
- Non-consultant cannot reach: `requireDomainAccess`→`assertRouteContext` maps mode→context and the route is `W` only (`access.ts:102-119`; `accessRegistry.ts:179`), plus a handler re-check `mode==='consultant' && role==='ge_admin'` (`serviceVisibility.ts:26-27`). W requires ge_admin+tab+tenant (`capabilities.ts:26-31`).
- Column scope = handler (RLS is row-level): only two `UPDATE client_services` sites exist — `adminClients.ts:446` (P@T, platform context) and `serviceVisibility.ts:43` (writes **only** `client_field_mask`, `WHERE client_id=$2 = access.tenantId`). No other writer.
- Body strictness: global `jsonInput` rejects duplicate JSON keys (`jsonInput.ts:80-86`, mounted `server.ts:30`); `parseVisibilityBody` requires exactly one key `clientFieldMask`, rejects non-object/array/extra/prototype keys (`clientFieldMask.ts:56-63`); value must be a whitelist array, length ≤ 8, no dupes (`:29-39`). Arrays/scalars/null and `{showGap}`, `{client_field_mask}`, `{clientFieldMask,showGap}` all rejected — pinned in `clientFieldMask.test.ts:123-163`.

**(2) Redaction completeness on C-callable projections — PASS** (see enumeration)
- Mask lookup is C-only, server-tenant-derived, UNION/fail-closed across all linked services, join identically to `LINKED_ITEM_SQL` (`scope.ts:45-48` vs `scope.ts:286-296`): `hint, priority, weight, esg_class, reference, topic, objective, sort_order` are deleted in place before response. `attachment_required` deliberately not maskable.
- C endpoints checked (projection → status):
  - `GET /items` → masked `taxonomy.ts:179-187`
  - `GET /items/:id/links` (`other_` prefix) → masked `taxonomy.ts:1079-1085`
  - `GET /queue` → masked `evaluations.ts:355-362`
  - `GET /evaluations` item header → masked `evaluations.ts:1093-1097`
  - `GET /reports/index`, `GET /reports/export` (JSON+CSV) → stripped payload `reports.ts:22-29,47-51` (see U41A-03 for 422 path)
  - `GET /client-review` → no maskable columns `evaluations.ts:1433-1503`
  - `GET /dashboard/stats` → aggregate only, no weight key `gri.ts:530-596` + `scoring.ts:141-153`
  - `GET /clients/:id/services` → explicit cols, no mask/settings `adminClients.ts:341-351`
  - `GET /services` → no `settings` projected `taxonomy.ts:99-113`
  - `GET /actions` → action columns only `actions.ts:110`
  - `GET /items` uniqueness sweep: the only projections selecting the 8 maskable item columns are the five masked sites + `adminStaff` (P) + `scopedScoreInputs` (uncalled). No `SELECT i.*`/`SELECT * FROM items|client_services|services` reaches a C route.
- Fail-closed when malformed: resolution errors abort the txn (no unmasked data served); a *malformed stored value* is fail-open — see SHIELD-U41A-01.

**(3) Settings validation — PASS**
- `serviceSettings.ts:16-27`: plain object only (rejects null/array/scalar), exact UTF-8 8 KB cap on the persisted string. Only `PATCH /services/:id` writes it (`taxonomy.ts:279-292`, P-only `accessRegistry.ts:101`); `POST /services` and `POST /services/:id/duplicate` never set it (`taxonomy.ts:218,343`). `GET /services` does not expose it. No arbitrary-size storage; nested shapes allowed up to 8 KB by spec ("no deep schema").

**(4) No authority widening for C/E; P path unchanged — PASS**
- C/E gain no UPDATE policy on `client_services`; the new route is W-only. New column is not projected to C (`listClientServices`/`reportData`/`gri` select explicit columns; no `cs.*` to C). P@T additively accepts `clientFieldMask` under its existing policy/actor (`adminClients.ts:414-459`) — no change to *who* may call P@T.

**(5) Audit — PASS**
- W: `action CLIENT_SERVICE_VISIBILITY_UPDATED`, `userId=access.actorId`, payload `{clientId, serviceId, clientFieldMask}` (`serviceVisibility.ts:50-56`) — no secrets, server-derived actor/tenant. P: `UPDATE_CLIENT_SERVICE_FLAGS` includes the validated mask (`adminClients.ts:455-459`). Error paths return generic strings, never echoed bodies.

**(6) Content-file delta & fingerprint trust — PASS (static)**
- `git diff 0edf250 -- src/db/b17-content.sql` = one comment block + exactly one `CREATE POLICY b17_consultant_service_visibility ... FOR UPDATE` (`:979-988`); no definer, no other policy/row-scope change.
- Byte pins recomputed by us and they MATCH the test constants: content `2e07a7c1…` (`:170`), routes `b72f5b5f…`, accessRegistry `d19d4630…`, readiness LF `f712295e…` (`b17TransactionInventory.test.ts:132-157`). `B17_CONTENT_SHAPE=6f67b44d…` matches the comment's measured structure. The three md5 constants themselves can only be re-measured on the live PG18 scratch — **Unverified** here (Tera's live proof).

**(7) Pins judged — PASS except SHIELD-U41A-02**
- Census updated coherently: 98 legacy routes (`capabilities.test.ts`), 98/90/102 activation split & registry (`domainAccess.test.ts`), inventory 84/38, `total+3=87`, `allowed.size=79` covering exactly the ratified set (scope.ts, the 4 new lib files, scratch, serviceVisibility) with no globs. New-file ≤500-line bound holds.

**(8) No deps / .env / style change — PASS**
- `git diff --name-only 0edf250` = db/lib/server + pins only; untracked = 4 new src files + scratch + contract. No `package.json`/lockfile, no `.env*`, no `.css`/`.tsx`/views.

---

## 3. Closures / open
- Closed by static evidence: one-policy constraint; W-only + own-tenant reachability; `WITH CHECK` tenant fix; handler-only column guard; duplicate-key/array/prototype body rejection; C redaction on the enumerated set incl. CSV; settings cap/writer; audit actor & no-secret; content delta; deps/env/style.
- Open: SHIELD-U41A-01 (fail-open on malformed) · SHIELD-U41A-02 (reviewer-report pin) · SHIELD-U41A-03 (422 redaction path).

## 4. Honest static bounds
- DB shape/md5 constants and RLS at runtime are inferred from policy text + context binding; they require the live PG18 scratch (W sets mask ⇒ C sees stripped; P unaffected) — **Tera's live proof**, not mine.
- No runtime/lint/test execution performed; no subagent, install, commit, or live DB access.

## 5. Artifact
- `security-reports/TASK-PROTO-U4-1a-fix-review.md` (only file written)