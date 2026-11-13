# Test Report — TASK-PROTO-B17-U2-D (independent executed QA, round-2 source)

## Verdict: **FAIL** (1 narrow functional failure; everything else executed PASS)
- F1 only: `POST /initiatives` with `serviceIds:[X, X.toUpperCase()]` returns **404 `scope.not_found`**; spec §5 (line 231) requires duplicate serviceId inputs → **400**. Rollback/no-partial-write holds; status code wrong. Exact-string duplicates → 400 (proof D2).
- No environmental gaps remain. No parent/full-app/release verdict. Browser/print **skipped — no UI change in diff** (git-verified).
- QA session: QA Agent (Execution Mode), 2026-11-13T19:37+03:00. Base/HEAD `6e4f4f4de000d7e6fd6faad97f78cbebd21b9d1e` re-verified before/after all runs; no commit/push.
- Env: Windows, Node v22.22.2, npm 12.2.2, Docker 29.9.2, `postgres:18`; `.env` absent throughout; harness refuses ambient DSN; generated DB/JWT secrets in-memory and redacted in logs (`<generated>`/`<redacted>`).
- Writes: this report + `C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2d-routes-qa` only. App source read-only; concurrent Shield report untouched (disjoint, not used as evidence).

## 1. Independent diff discovery (before any test)
- 14 tracked changed (355+/1227-) + 10 untracked incl. `src/lib/reports.ts` CSV encoder, `reportsCsv.test.ts`, 4 route helpers, 3 proof scripts, Shield report; all within task §4/§9 allowlist.
- Registry vs base: **exactly 11 flips 51→40**, all other rows/paths/matrices deepEqual (99 total); protected paths (auth/access/workspace/session/system/admin/evaluations/actions/storage/audit/notifications/schema/b17.sql/b17ContentMigration/capabilities.ts/package/lock/vite/UI) diff empty; tracked blob IDs identical start→end (`scope.log`).

## 2. Exact commands (cwd = prototype-app) and results
| Command | Exit | Result / evidence (TEMP `b17-u2d-routes-qa/`) |
|---|---|---|
| `npm run lint` | 0 | PASS — `lint-final.log` |
| `npm test` | 0 | **173 tests / 173 pass / 0 fail / 0 skipped** (173 claim verified) — `test-final.log` |
| `npm run build` (no `.env`, plain script) | 0 | PASS — built 832 ms, only pre-existing >500 kB chunk warning — `build-final.log` |
| `node TEMP/runner.mjs --allow-disposable-b17` | 1 | Fresh loopback PG18 container + named scratch DB; D0–D7 proof PASS + **16 QA checks: 15 pass / 1 FAIL(F1)**; exit 1 = recorded functional failure — `qa-extra.log`, `qa-run.log` |
| `node TEMP/runner.mjs --allow-disposable-b17 --regressions` | 0 | `b17-domain-proof` (40 unactivated×4 contexts, 13+23 old flips E2E, RLS/freeze/5MB/WF-04/cap/audit/readiness) + `b17-domain-c` (R1–R9) both PASS — `regression-domain.log`, `regression-c.log` |
| `node --import tsx TEMP/scope.mts` | 0 | registry/diff/protected checks + 135-file SHA-256 manifest — `scope.log`, `source-manifest.json`, `final-diff.patch` |
- Proof guards read in full before use: explicit `--allow-disposable-b17`, argv-only loopback named `b17_*scratch*` owner (≠postgres), refuses `.env`/ambient `PG*`, PG18 + NOSUPERUSER/NOBYPASSRLS asserted, empty-start asserted, seed-only fixtures, census preserved. `scripts/b17-scope-proof.ts` **not run** (forbidden `DELETE FROM assignments`).
- Build note: an initial TEMP wrapper (`--configLoader runner`) failed on the existing config's `__dirname` — wrapper-environment issue only; plain no-env `npm run build` passes, so build criterion = PASS.
## 3. Executed contract coverage (real dispatcher → session/tab → wrapper → domainTransaction → handler, FORCE RLS)
- **Matrix**: all 11 routes × P/W/C/E/anonymous denied with exact codes (401 `auth.invalid`, 403 `workspace.mode_mismatch`), no side effects; missing-tab GE → 409; **18/18 allowed contexts actual 2xx asserted** (D1/D7). Zero-link tenant: empty eligible/report, never broadens.
- **Initiatives**: C sees only selected+mapped+linked (search/eligible/library → 403, counts from authorised set only); W `view=eligible` own-A only; select/unselect touches A not B (B rows byte-intact), freeze → 409, idempotent select, audit actor = real GE; P library/mapping upsert atomic/idempotent, bad IDs rollback with **zero `client_initiatives`/`client_services` mutation** (oracle census + raw RLS: P config UPDATE client_services = 0 rows).
- **Profile**: P explicit T + explicit linked service only (missing → 400, unlinked → 403, frozen → 409 skip); repeat import = same row id, 0 inserted/1 updated; W/C DD-02 aggregate independent — GRI report payload byte-identical before/after import.
- **Settings**: P explicit T+service (0 links → `settings:null` no NULL fallback; 1 → auto; >1 → 400 `service.required`; missing serviceId write → 400); PUT preserves row id + statement/notified/date/ref; invalid → 409; **removed link → 409 with no stale-settings fallback + explicit serviceId 403** (QA check).
- **Reports**: JSON = CSV = index for W/C × L1/L2/L3; independent weighted oracle exact (weights 1/3 + scores 100/0 → dept 25, coverage 66.7, total 4/3/1/50; draft/N/A excluded; hidden-gap service not in denominator; overlap counted once); hidden service → null metrics/actions/topGaps incl. **nulls inside 422 payload index**; 409 D-038 gate; **422 offendingCodes = authorised rows only** (no foreign code); statement/notified dates preserved.
- **CSV round-2 fix**: **73 inert variants** (leading `=+-@` × control/whitespace leads, AR/EN, comma/quote/CRLF) through **actual W+C handler** at index/JSON-export/CSV-export; independent RFC-4180-style decoder; risky text cells carry only the literal apostrophe prefix; **JSON + raw DB bytes unchanged**; typed metrics numeric/unquoted; C CSV == C JSON index. String-level only — **no spreadsheet/network execution claimed**.
- **Carryovers**: malformed explicit T/path/query/body/array/SQL-like IDs → **400 before any business SQL** (pg.prototype instrumented: zero matching statements), state+audit unchanged; GE row with populated `clientId` still requires explicit T; item DELETE with only an action reference → 409, item + action `item_id` + full history preserved; **concurrent FK writer wins** (DELETE serialized via `pg_stat_activity` lock-wait → 409, exact row intact) and **concurrent DELETE wins** (late writer → 23503, no detached action).
- **Races**: select-before-exit (exit waits for admitted write; old generation → 409; audit real GE); **generation change after wrapper / during business op → 409 `workspace.stale`, no write/audit**; settings-vs-enter linearization; logout waits for admitted write → subsequent request 401 `auth.invalid`.
- **RLS/readiness**: no-context/foreign/blob denial, outsider 42501, policy/ACL/ledger drift → refusal + recovery after rollback, count-helper integer/purpose restored, FORCE RLS + non-bypass owner asserted; both offline versions applied twice safe.
## 4. Failure detail (functional ⇒ FAIL)
- **F1**: `serviceIds:[X, X.toUpperCase()]` — UUID regex is case-insensitive so both pass validation; PG `ANY()` dedupes → `found 1 ≠ ids 2` → 404 `scope.not_found`. Spec §5: "duplicate/… serviceId inputs get 400, not ignored". Exact duplicates already → 400 via `Set`; fix = case-fold/normalize before the semantic duplicate check (or map this path to 400). Atomicity itself verified (no partial write).
- Reconsidered, not a failure: initial QA expectation "C must 422 on hidden-gap incomplete row" was over-strict — spec §6 orders "filter … 422 error indexes BEFORE … error generation" and "hidden gap redacted without blocking C". Observed: **W → 422** (authorised code only, null metrics in payload) / **C → 200 fully redacted, no leak** = spec-consistent (recorded PASS).

## 5. Not verified / preserved obligations
- Browser/print/visual: skipped — no UI/view/style/i18n file in diff.
- **BF-01** (concurrent link/visibility/freeze domain-state writers) and **BF-02** (older taxonomy/GRI lifecycle revalidation): NOT covered here; remain mandatory U2-E/F/G obligations per §9 (sequential removed-link test is not a substitute). Concurrent freeze-change during select also untested (sequential freeze 409 covered).
- Shield static closure / Trivy / Semgrep: Shield's evidence, not adopted as QA evidence.

## Evidence index (TEMP `C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2d-routes-qa\`; no raw stdout embedded here)
`lint-final.log` · `test-final.log` · `build-final.log` · `qa-extra.log` (D0–D7 + 16 QA checks) · `qa-run.log` (container/db ids) · `regression-domain.log` · `regression-c.log` · `regression-run.log` · `scope.log` · `source-manifest.json` · `final-diff.patch` · `initial-diff.log`/`initial-status.log` · instrumentation `runner.mjs`, `qa-proof.mts`, `extra.mts`, `fixture.mts`, `scope.mts` (attempt logs `qa-extra-attempt*.log` retained).

QA Agent Signature — 2026-11-13T19:37:23+03:00
---

# Round 3 addendum — F1 fix verification & FINAL VERDICT (2026-11-13T20:22+03:00)

## FINAL VERDICT: **PASS** — F1 resolved, no new functional failure
- Round-2 **FAIL (F1)** above is preserved as history; disposition = fixed in round 3 (task §11) and independently re-verified below. PARTIAL not applicable — no environmental gap remained.

## R3-delta discovery (independently recomputed vs round 2)
- SHA-256 manifest recompute vs round-2 manifest: **exactly 3 files changed** — `src/server/routes/initiatives.ts`, `src/lib/b17DomainD.test.ts`, `scripts/b17-domain-d-proof.ts`. Fixture, `reports.ts` encoder, registry, DB/SQL, all other product files byte-identical.
- `initiatives.ts` (base-diff extraction): ONLY `serviceMappings` — exact-Set size check → case-folded seen-set → **`400 scope.duplicate_id`**; function now `export`ed; doc comment. Nothing else (+11 lines).
- `b17DomainD.test.ts`: +2 imports, **+2 tests** (helper matrix: case/exact/mixed orders + malformed + distinct-pass with ZERO pg statements; both handlers validate serviceIds before `domainTransaction`).
- Proof delta (reverse-patched my round-2 copy → diff vs current): **exactly 2 hunks** — (+27) F1 block (instrumented, dup/unknown-distinct/no-partial), and the D4-CSV assertion region: `location === 'X | X'` → every-segment-equals-stored-text; `departments deepEqual [X]` → `includes(X)`; CSV cell[13] expectation → `ok.departments.join(' | ')` (JSON-derived). **Assertion-only** — no product/fixture semantic change (executor said "one assertion"; actually 3 assertion lines, all one D4-CSV group — wording only).
- Flake claim **verified independently**: mechanism = A-tenant second department; source orders rows by random `dep.id`; index dedupes per item by FIRST row → 50/50 whether scored's surviving row carries the answer. Corroborated by my round-2 `qa-extra-attempt2.log` (original round-2 proof failed `location === 'X | X'` got single segment) + round-3 forced-order probe below.

## R3 commands (cwd prototype-app) — all current, source settled
| Command | Exit | Result / evidence (TEMP `b17-u2d-routes-qa/`) |
|---|---|---|
| `npm run lint` | 0 | PASS — `lint-r3.log` |
| `npm test` | 0 | **175/175 pass, 0 fail** (175 claim verified; incl. 2 new F1 tests) — `test-r3.log` |
| `npm run build` (no `.env`, plain) | 0 | PASS — `build-r3.log` |
| `node TEMP/runner.mjs --allow --product` | 0 | executor's own proof, RANDOM fixture order: D0–D7 incl. **F1 block PASS** — `product-d.log`, `product-run.log` |
| `node TEMP/runner.mjs --allow` (QA_DEPT_ORDER=1) | 0 | **17/17 checks, 0 fail** — `qa-extra-order1.log`, `qa-run-order1.log` |
| `node TEMP/runner.mjs --allow` (QA_DEPT_ORDER=2) | 0 | **17/17 checks, 0 fail** — `qa-extra-order2.log`, `qa-run-order2.log` |
| `node TEMP/runner.mjs --allow --regressions` | 0 | domain proof (47 flips→40, H/I green) + domain-c (R1–R9) — `regression-run-r3.log` |
| `node --import tsx TEMP/scope.mts` | 0 | **11 flips 51→40** deepEqual other rows (99 total), protected paths empty, diff stable vs R3 start — `scope-r3-final.log` |
## Independent F1 matrix (my method: broad `pg.Client.prototype.query` instrumentation, fresh PG18 scratch each run)
- **case-dup POST + case-dup PATCH + exact-dup POST + exact-dup PATCH + mixed(case+unknown) → all 400 `scope.duplicate_id` with ZERO business SQL statements** (armed regex over 10 business tables; auth/readiness SQL excluded and observed clean) — QA PASS in both fixture orderings.
- malformed `serviceIds:['bad-id']` → 400 `scope.id_*`, zero SQL; distinct well-formed unknown → **404 `scope.not_found`** (SQL path legitimately taken then rolled back); **no partial write**: `initiatives_library` + `service_initiatives` counts unchanged after all refusals.
- Round-2's 16 checks re-executed on FRESH scratch DBs: **16/16 PASS per ordering** (17th check = added fixture-order probe). Forced orderings empirically confirmed by probe: order1 → D-OK location **2 segments**, departments `[renamed-A]`; order2 → **1 segment**, departments `[renamed-A, "Two"]` = the exact round-2 flake shape — round-3 order-independent assertions pass in both; a run of the recovered round-2 assertion on order2 would fail (matches attempt2 evidence).
- Stability: source manifest start-vs-end = **no changes during QA**; HEAD = `6e4f4f4` after all runs; `.env` absent throughout; no leftover QA containers; secrets redacted in all logs.

## Still not verified / obligations (unchanged from round 2)
- Browser/print/visual skipped — no UI diff in R3 (git-verified). **BF-01 / BF-02** remain U2-E/F/G obligations per §9 (not waived; sequential tests are not substitutes). Shield round-3 confirmation / Trivy / Semgrep = Shield evidence, not adopted here. No parent/full-app/release verdict.

## R3 evidence index (TEMP `C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2d-routes-qa\`)
`lint-r3.log` `test-r3.log` `build-r3.log` `product-d.log` `product-run.log` `qa-extra-order1.log` `qa-run-order1.log` `qa-extra-order2.log` `qa-run-order2.log` `regression-run-r3.log` `regression-domain.log` `regression-c.log` `scope-r3-final.log` `proof-delta-r3.log` `initiatives-delta-r3b.log` `source-manifest-r3start.json` `start-diff-r3.log`; flake empirical `qa-extra-attempt2.log`; regenerated instrumentation `qa-proof.mts` `fixture.mts` (forced-order) `extra.mts` (F1 matrix + probe) `runner.mjs` (`--product`).

Round-3 QA Agent Signature — 2026-11-13T20:22:15+03:00