# QA Execution Report — TASK-PROTO-B17-U2D

## 1. Disposition and validity boundary

- **Historical bounded execution result: PASS for the checks actually executed against the exact pre-fix source manifest in Appendix C.** This is not a claim that every possible defect was excluded.
- **Current U2D handback: PARTIAL / RECHECK REQUIRED.** Tera states that bounded fixes for static Shield findings are now assigned. Their resolution and any upcoming/current changed source are **NOT VERIFIED** by this report. Historical PASS does not transfer to changed hashes.
- **No final application, domain-workflow, security-acceptance or release verdict.** Business endpoints remained UNACTIVATED in the executed proof. Acceptance remains Tera/owner authority.
- Original execution: 2026-11-12, Windows PowerShell 5.1 / Node v22.22.2 / npm 12.2.2 / Docker 29.9.2 / isolated PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2).
- Report-only resume: Tera explicitly identified `security-reports/B17-U2D-fix-review.md` as an authorised, disjoint concurrent Shield artifact and released the report-write STOP. Its contents were not read or used to infer test results.
- On this resume, no tests, application reads/diff rechecks, source writes, database operations or container operations were performed. Only historical evidence was read and this report written. The conduct gate was re-read first.

## 2. Authority, independent discovery and tested source

Governing scope: `prototype/TASK-PROTO-B17.md` §13, approved `prototype/TECHNOLOGY_PROFILE_DRAFT.md`, and `prototype/B17_TECHNICAL_SPEC.md` §6–7.2. Local RUN_TESTS only; production/application modifications were prohibited.

Before testing, QA independently ran `git status`, `git diff --stat`, `git diff --name-status`, full tracked diff and untracked-file discovery from base `c4ee8bc`. HEAD and the locally recorded origin/main resolved to `c4ee8bccb87b53fbc957861178832029cde769be`; no fetch/network Git action was performed.

The tracked diff was **8 files, 324 insertions, 592 deletions**: `server.ts`, `src/db/index.ts`, `src/db/schema.sql`, `src/server/auth.ts`, `src/server/routes.ts`, `src/server/routes/_shared.ts`, `src/server/routes/session.ts`, `src/server/routes/system.ts`. This includes the already-local U1/U1V substrate and is **not** presented as an isolated U2D-only delta. Untracked U1/U2D source and existing reports were discovered separately; Git's tracked diff does not include new files.

U2D-relevant new source inspected: `src/db/b17-content.sql`, `src/db/b17ContentMigration.ts`, `src/server/scope.ts`, `src/lib/scope.test.ts`, `src/lib/b17ScopeProof.test.ts`, `scripts/b17-scope-proof.ts`, together with `src/db/b17Readiness.ts`, the initializer/context implementation and U1 enforcement dependencies. No frontend, business-handler activation, dependency or lockfile modification was identified in the tracked baseline diff. Without a separate committed U1 snapshot, exact chronological attribution of every U1/U2D line cannot be independently reconstructed from the base alone.

A pre-execution SHA-256 manifest covered **111 source/configuration/test files**, excluding review/control report directories. The original end-of-test comparison returned `SOURCE_MANIFEST_IDENTICAL files=111`. This demonstrates no measured source drift across that execution window, not that concurrent/future source remains unchanged now. Appendix C embeds the historical manifest; no current application hashes were substituted during report-only continuation.

### Relevant exact tested SHA-256 values

| File | Historical tested SHA-256 |
|---|---|
| `server.ts` | `04BEF6BBB37CF132EF96B1F4AB03957FC70B862841FE66AEB47CADBED3CD7FA1` |
| `src/db/index.ts` | `9838C78B34AD877E9A645EF0877F498AF293E7708D93A06988684B3BD318F8C9` |
| `src/db/schema.sql` | `B141A3D8FCBB60625EE984D31EB15BCBC03EE46F2C8AB5E8F7965A8012511C59` |
| `scripts/b17-scope-proof.ts` | `F6B7C6412F945B5D2ACC5FCF3D8ED4F380DFA5385F26D637A1794CC133466B59` |
| `src/db/b17-content.sql` | `1A678D3643DBC81F4E93EB4021CA471538E8FEE7344C356353067F95E372A01B` |
| `src/db/b17.sql` | `ACE11265D876B6F18229DD62EFA1DB693CD8DF00ECD0EA6012B448694406D8D6` |
| `src/db/b17ContentMigration.ts` | `DDB940166912EB5EFC49B25D023DCCEB53898E84A30F4752E68CF439D471028F` |
| `src/db/b17Readiness.ts` | `8755E22813808A9A8468CC8C65C7384BA11AA999D8AF15B6C175A0745337D71A` |
| `src/lib/b17ScopeProof.test.ts` | `411096D7733189A0FB9D9B19C6A6264F18A69033095E1912A59EDFCD5186168E` |
| `src/lib/scope.test.ts` | `356AA5CFA7FCD51FB77E10BC699C31AE93F10E218BC028DCA741EABCC05BA3EB` |
| `src/server/access.ts` | `191F60C2844DD849B2CBBA43EE08AFD42D52D6AB89F2594C9D8E44DB458794F2` |
| `src/server/accessRegistry.ts` | `AF94FC365E6C2114DBB13FABC726E95139415CD07DFC72CBF6CAEC41E1E396EA` |
| `src/server/scope.ts` | `AAC1014B6A85602A44D809246C916FD126A9C7162661ED1A2607836C45D3841B` |

## 3. Evidence standard and safety guards

- **Independent Evidence:** QA-issued Git/file-hash measurements, actual local CLI outputs, execution of the inspected repository proof on QA-owned infrastructure, and separate QA-authored raw-SQL/migration probes. Repository-authored assertions became evidence only through this session's execution; previous executor results were not reused.
- **Executor/security statements:** context only. The new Shield artifact is not test evidence and does not supply a PASS. Tera's notice of upcoming fixes is a limitation requiring follow-up, not proof those fixes work.
- Proof safety was inspected before invocation: explicit `--allow-disposable-b17`; exactly one named `b17_*scratch*` loopback URL; rejection of ambient DATABASE_URL/PG settings, non-loopback hosts, query/hash additions and unsafe default user; no dotenv load in the proof. Child startup used `B17_SCRATCH_OPT_IN=YES` (no `.env` load), production mode and ephemeral loopback HTTP.
- QA created only its own `postgres:18` container, `b17-u2d-sol-20261112-a` (ID `5283fadfda798e015409956f7b8891b9d19ca53df7c0b57b9066dc9fff7ff56b`). Existing B17/other containers were neither used nor altered.
- Provisioning used the own-container administrator only to create disposable role/databases and rotate generated test-only credentials. Application/proof/raw-data execution used **current_user=session_user=b17_qa_runtime**, `rolsuper=false`, `rolbypassrls=false`, `rolcreaterole=false`, `rolcreatedb=false`, memberships=0, `row_security=on`. All public tables had ENABLE/FORCE RLS; the tested runtime role was their owner.
- Observation policies were fixture-only, transactionally rolled back before actual raw-RLS measurements. No FORCE toggle or bypass-role substitution was used. Raw-RLS probes explicitly set LOCAL trusted GUCs and queried actual tables without app scope/context helpers; expected sets were computed independently in QA JavaScript.
- These RLS results concern correctly server-selected trusted context; they do not establish safety against arbitrary SQL/DB-credential compromise. The delegated table-owner role has DDL authority. This was not a production privilege-hardening audit.
- All execution tool timeouts were at most 60 seconds; proof child timeout was 45 seconds and startup waits 20 seconds. No installation, application `.env` access, cloud application/DB access, agent activation, commit, push or deploy was performed. A generic public PostgreSQL documentation lookup contained no project source or credentials.

## 4. Executed results

| Check | Actual result | Evidence / limits |
|---|---|---|
| `git diff --check c4ee8bc` | PASS, exit 0 | Git emitted LF/CRLF conversion warnings; no whitespace-error failure. |
| `npm run lint` (`tsc --noEmit`) | PASS, exit 0 | No emit/build; original terminal output reproduced in Appendix A. |
| `npm test` | PASS, exit 0 | **146 tests passed, 0 failed, 5 suites**, 0 skipped/cancelled; TAP duration 7212.307 ms. Full captured log in Appendix B. Intentional error-handler test diagnostics are not failing tests. |
| Inspected `scripts/b17-scope-proof.ts` on QA DB | PASS, exit 0 | Five verification groups passed; real login/session/tab, actual local startup/restart, helper and RLS/migration checks. Not counted as five individual tests or full domain acceptance. |
| Independent `direct.mjs` | PASS, exit 0 | **20 checks passed, 0 failed**; actual raw SQL as exact runtime role, independent JS visibility oracle. |
| Independent `migration-r3.mjs` | PASS, syntax check 0 / run 0 | **17 checks passed, 0 failed**, after the two separately recorded instrumentation failures below. |
| Independent `extras.mjs` | PASS, syntax check 0 / run 0 | **3 checks passed, 0 failed**; raw Profile-with-empty-items and missing-GRI refusal checks. |
| Source manifest comparison during original execution | PASS | 111 measured file hashes identical; does not certify post-test fixes. |
| Own-container shutdown | PASS, command succeeded | Own container stopped; subsequent Docker listing omitted it and retained the pre-existing containers. `--time` produced a deprecation warning only. |

**Additional QA-authored total = 20 + 17 + 3 = 40 passed, 0 failed in completed runs.** Do not add the proof's five groups to the Node test count. No unexpected application failure was observed by these completed checks; the instrumentation failures remain part of the execution record.

### 4.1 Linked content, parent, department/history/evidence boundaries

Raw `SELECT *` queries (no application scoping WHERE helper) were compared to independently computed expected IDs for items, standards, disclosures, services, assignments, answers, evaluations, approvals, attachment rows, client_services, initiatives, Profile, report settings and actions. Workspaces A/B, own client, own employee department, removed-link and new-no-link tenants, empty context, platform mode and unknown role were exercised.

| Raw context | Items | Standards / disclosures / services | Answers / evaluations / attachments | Library / client selections | Profile / settings / actions |
|---|---:|---|---|---|---|
| W(A) | 3 | 2 / 2 / 2 | 4 / 3 / 4 | 2 eligible / 1 selected | 1 / 1 / 2 |
| W(B) | 3 | 2 / 2 / 1 | 1 / 1 / 1 | 2 eligible / 0 selected | 0 / 0 / 1 |
| C(A) | 3 | 2 / 2 / 2 | 4 / 3 / 4 | 1 selected-only / 1 | 1 / 1 / 2 |
| E(A0) | 3 | 2 / 2 / 2 | 3 / 2 / 3 | 0 / 0 | 0 / 0 / 0 |
| Removed link / new no link / empty / platform / unknown role | 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 | 0 / 0 / 0 |

- A's foreign department answer/history, shared foreign evaluation and attached evidence were invisible to E(A0), even with parallel item assignment. Ambiguous ownership returned false at the DB guard / 409 `scope.shared_ambiguous` at the application guard. The direct UPDATE affected **0 rows**; attempted business INSERT was rejected with SQLSTATE **42501**. Original data remained unchanged.
- The inspected proof additionally checked attachment-ID/answer-ID binding, metadata listing without byte data, exact own binary download bytes `[0,1,128,254,255]`, and denied foreign/guessed combinations. No new business write policy was inferred.
- Parent services/standards/disclosures derived from authorised child sets. A linked service with no standard mapping yielded no children/parent fallback; explicitly unlinked service was refused. Removed/new-client links remained empty.
- Overlapping mapped services yielded **3 unique items, 3 evaluations, sum(score)=150**, without fan-out. Profile's independent rating was not included in those totals.
- Consultant default helper view was selected-only (1); explicit eligible view returned 2 deduplicated candidates. Client raw library access returned selected eligible content only and the helper denied `eligible`/`library`; employee initiative/Profile/actions access was denied. Empty link/mapping did not expose the global library.
- C saw authorised answers across both A departments and action rows owned by A's second department, with no B leakage; positive action workflow in each department was not tested. Item-linked actions required actual linkage; explicitly entitled standalone action was visible, unidentified standalone action stayed stored/unavailable. Source proof rejected new unentitled standalone action via SQLSTATE **23514**.
- Physical reuse of the same DB connection across A/B/empty transactions showed LOCAL settings cleared after rollback, without the application context helper. Inaccessible snapshots, snapshot notes, profile_assessments and notifications remained unavailable rather than exposing legacy blobs.

### 4.2 Strict legacy inventory, metadata-only application and rollback

The separate QA fixture used synthetic provenance/values and compared complete business row JSON (including IDs, timestamps, correction history, evaluations, approvals, snapshot payload/hash/notes and binary attachment values), not only counts. Existing membership IDs and false visibility flags were part of those comparisons.

- Inventory refused: unknown Profile source, an unidentified Profile batch, missing/duplicate import lineage, non-GRI report ownership, duplicate target GRI report row, mismatched report audit values, frozen target, conflicting standard service ownership, and an unknown child within an otherwise evidenced standard. Missing GRI catalog was also independently refused. Every applicable refused inventory retained the U1 effective fingerprint and unchanged observed business state.
- Empty/duplicate explicit targets and invalid source digest were rejected. Deterministic successful dry-run captured exact imported item/standard, Profile and report IDs, audit lineage, memberships/flags and before hashes. Inventory results contained no password_hash, session/tab or handle-hash data.
- Dry-run used authorised transactional SELECT-policy DDL, **not SQL READ ONLY**; its policies always rolled back. Original U1 fingerprint was `4b4e39e3a13eae0d336d30fa94bbf52f`.
- Changed expected inventory was rejected with `before_state_drift`. The inspected repository proof independently exercised real membership-flag drift between inventory and apply, then restored its deliberate fixture change.
- Real DB failure `SELECT 1/0` was injected at the ledger INSERT after metadata work: SQLSTATE **22012**. Transaction rollback restored all observed values, metadata and U1 structure. This was an expected negative test, not a simulated success.
- Successful independent application changed only the two explicitly inventoried Profile service bindings, two same-row report service bindings and one exact GRI standard mapping, with the additive schema. Existing unrelated mappings remained; unknown standalone actions were not assigned; `service_initiatives` remained empty. No client_services row was inserted/updated/deleted by metadata application, and membership IDs/flags were byte-equivalent before/after.
- Profile rating/text and legacy report level, disclosure level, statement, period, notification/date/reference stayed unchanged; no ratings/answers/evaluation ownership/history/snapshot/approval/attachment rewrite occurred. Original immutable/freeze guards remained enabled.
- Repeating the same content version returned `verified`, with no repair/backfill and no observed row/fingerprint change. A positively associated Profile/report for a deliberately unlinked tenant was still unavailable at runtime.

Independent migration evidence identifiers:

```text
PRE_U2D_BUSINESS_SHA256 2856f4d2fc1bb50bb7b4230eb6c69fdc3bfecbc2cbc892a4f741dc94e01443f9
INVENTORY beforeHash d20462e852415921c526c072da35d970454489b7f5447859b10ac3a21f35a03c
INVENTORY itemIDs=1 profileIDs=2 reportIDs=2 membershipIDs=1
MEMBERSHIPS_SHA256 f491e10388e09c55f5552c7a22ce74285eee6329bd75b58c2b54e8a00c16a276
POST_U2D_BUSINESS_SHA256 ecd0d09e560f65da688057d86c5e729732e86f30f401afb6b47c438d565708c7
```

The pre/post whole-business digests intentionally differ because authorised service metadata/mapping changed. The PASS rests on explicit exact-row comparisons with only those authorised fields changed, not on asserting those two digests equal.

### 4.3 Independent Profile entitlement, readiness and inactive business APIs

- A raw-SQL probe temporarily reassigned the synthetic fixture's GRI mapping away from the linked service, then removed its temporary observer/write policies before measurement. With no authorised disclosure items or evaluation rows and `show_gap=false/show_corrective=false`, the exact role still saw **Profile1, independent rating2, report L3** through its GRI subscription. The entire mapping probe rolled back and final U2D readiness/fingerprint remained intact. This distinguishes subscription entitlement from disclosure-item/scoring membership.
- Known U1 readiness verified before content application, but content use was rejected as `content_required`. Known U2D verified after application; ledger versions were exactly `B17_U1` and `B17_U2D`. Missing content was not treated as permission for all services.
- Effective U2D catalog fingerprint was **`215246397ad1c621b2fcc8cc74eeca79`**. Independent readiness negatives rejected `row_security=off` (`runtime_role_unsafe`), effective-policy drift (`schema_drift`) and ledger checksum drift (`version_drift`); all probes rolled back, and final readiness/business hashes matched their baseline.
- The inspected proof exercised actual local server restart without schema/data repair, removed/new-client GRI links staying absent, offline initializer/replayed schema refusal and POST `/db/migrate` returning **409**. All **87 UNACTIVATED legacy business declarations** returned **403 `access.unactivated`**, even with supplied inventory-purpose query/body values. Request input did not select the trusted inventory purpose. Positive real login/session/tab substrate remained functional.
- A separate raw-observer policy-set digest before/after direct tests was `d5bea0bb7fb817a2db7f8a597173053b79a84f1327a117430618b9b354e3bccc`; unchanged synthetic business oracle digest was `91eae4877b669c742a31ced87cdc59051d1f8f9cbb6fff789e82fcbb2ffa3e83`. These are distinct QA checksums, not substitutes for the application effective catalog fingerprint.

## 5. Failures, tooling limitations and escalation record

| Event | Actual outcome | Classification / handling |
|---|---|---|
| Initial contract read requested offset 240 from a 128-line file | No content returned | QA read-range mistake; explicitly reported, then full contract read before execution. No authority inferred from missing content. |
| Independent migration fixture attempt 1 (`migration.mjs`) | Exit **1**, SQLSTATE **23502**, missing `standards.category` | **QA fixture/instrumentation failure**, before U1/U2D migration verification. Not application FAIL or PASS. Original TEMP script retained; known required category/item fields corrected only in TEMP. |
| First fixture correction (`migration-r2.mjs`) | Exit **1**, `SyntaxError: missing ) after argument list` | **QA instrumentation quoting error**, before any DB operation. Original attempt/log retained; no app changes. |
| Corrected fixture (`migration-r3.mjs`) | `node --check` 0, run 0; 17/17 | Re-run in a fresh named disposable DB, original two failed attempts not erased or counted as application tests. |
| PowerShell native-command formatting around npm notices | npm/test exit **0**, TAP 146/146 | Captured stderr formatting/expected error-handler diagnostics, not an asserted failing test. Full raw log retained. |
| `docker stop --time 10` | Succeeded; flag deprecation notice | Own-container shutdown completed. No existing container stopped. |
| New `security-reports/B17-U2D-fix-review.md` appeared during original run | **STOP WRITES**, requested report not initially persisted | No source drift was measured; QA escalated the unknown disjoint artifact instead of overwriting/reading it as evidence. Tera's report-only continuation explicitly resolved this blocker. |
| Dedicated reader classified old UTF-16 PowerShell logs as binary on resume | Log read method unavailable | Explicitly escalated; authorised report-only PowerShell writer decodes original BOM-marked logs directly into Appendix B. No rerun or new evidence fabricated. |

## 6. Not verified / deliberately excluded

- **NOT VERIFIED:** upcoming or concurrently changed source implementing static Shield fixes, closure of those findings, and regression on those changed hashes. Tera follow-up must authorise any recheck; none was run during this report-only continuation.
- **NOT VERIFIED:** full B17/domain integration, positive business endpoint workflows, scoring/report/UI integration and application-wide acceptance. Closed endpoints are not functional workflow PASS.
- **SKIPPED:** build, because `npm run build` writes application `dist` and this QA session had no application-write authority. No successful build is inferred from lint/unit tests.
- **N/A to this substrate unit:** new-UI Playwright/axe/visual checks; no new UI in U2D. No desktop/mobile/AR/EN visual acceptance or browser end-to-end claim.
- **NOT VERIFIED / unauthorised:** live/cloud data inventory/apply, production privileges, deployment, publication or real customer datasets. Only disposable local data was exercised.
- No independent static-security clearance is claimed. Shield's review/fix work remains a separate evidence stream; this QA report neither supersedes it nor assumes its findings are resolved.

## 7. Handback and required follow-up

- Report authored by QA Agent Execution Mode under explicit report-only PowerShell permission after validating the parent and confirming the report did not already exist.
- Historical executed checks passed on the manifest below. Current handback remains **PARTIAL / RECHECK REQUIRED**, with **no final app verdict** and no unit closure by QA.
- Only repo write by QA: `project-control/qa-reports/B17-U2D-QA.md`. Earlier instrumentation/logs were confined to the approved TEMP location; no source/dependency/.env modifications, Git mutations, cloud execution or new agents.
- Tera to supply bounded fix completion, exact changed-source scope/hashes and explicit follow-up authorisation before further tests. Historical outputs must not be relabelled as results for that new source.

## Appendix A. Original terminal-only outputs and commands

These excerpts are copied from the original captured tool responses, not rerun during report persistence. Fresh test-only DSNs/credentials are intentionally omitted; the proof was invoked with its required explicit loopback/disposable URL argument.

```text
npm run lint
npm notice run react-example@0.0.0 lint
npm notice run tsc --noEmit
LINT_EXIT=0

npm test
UNIT_EXIT=0

node <approved TEMP>/run-proof.mjs
QA_PROOF_TOOL_EXIT=0

node --import tsx <approved TEMP>/direct.mjs
DIRECT_EXIT=0

node --import tsx <approved TEMP>/migration.mjs
MIGRATION_EXIT=1

node --import tsx <approved TEMP>/migration-r2.mjs
MIGRATION_R2_EXIT=1

node --check <approved TEMP>/migration-r3.mjs
node --import tsx <approved TEMP>/migration-r3.mjs
MIGRATION_R3_EXIT=0

node --check <approved TEMP>/extras.mjs
node --import tsx <approved TEMP>/extras.mjs
EXTRAS_EXIT=0

SOURCE_MANIFEST_IDENTICAL files=111
DIFF_CHECK_EXIT=0

docker stop --time 10 b17-u2d-sol-20261112-a
Flag --time has been deprecated, use --timeout instead
b17-u2d-sol-20261112-a
```

Original first migration-fixture failure terminal output (no separate stderr log survived for that attempt):

```text
D:\Teranoo Work\Client01\prototype-app\node_modules\pg\lib\client.js:694
          Error.captureStackTrace(err)
                ^

error: null value in column "category" of relation "standards" violates not-null constraint
    at D:\Teranoo Work\Client01\prototype-app\node_modules\pg\lib\client.js:694:17
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async one (C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2d-qa\sol-20261112-01\migration.mjs:22:24)
    at async standard (C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2d-qa\sol-20261112-01\migration.mjs:28:48)
    at async <anonymous> (C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2d-qa\sol-20261112-01\migration.mjs:29:13) {
  length: 299,
  severity: 'ERROR',
  code: '23502',
  detail: 'Failing row contains (c476c6f2-a45f-425a-aedd-a7420f3b1dbb, S, S, null, 2021, 2026-11-12 07:10:34.006418+00).',
  hint: undefined,
  position: undefined,
  internalPosition: undefined,
  internalQuery: undefined,
  where: undefined,
  schema: 'public',
  table: 'standards',
  column: 'category',
  dataType: undefined,
  constraint: undefined,
  file: 'execMain.c',
  line: '2213',
  routine: 'ReportNotNullViolationError'
}

Node.js v22.22.2
MIGRATION_EXIT=1
```

## Appendix B. Preserved evidence artifacts and full captured logs

Historical artifact root: `C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2d-qa\sol-20261112-01`.

Artifact SHA-256 below is packaging integrity measured during this report-only write, **not a new test or comparison against currently changing application source**. Raw logs are transcoded from their original encoding; their displayed content is not rewritten to suppress failed attempts or expected diagnostics. Some non-ASCII test labels already contain PowerShell/native code-page mojibake in the preserved log files; these are retained verbatim rather than repaired or relabelled. ASCII counts, exit codes and numeric evidence remain readable; no language/UI acceptance is inferred.

| Historical artifact | SHA-256 |
|---|---|
| `source-before.json` | `D627E80159B33A0BDC4700C043C020796C32E46D262F465C7D219FF26266A004` |
| `status-before.txt` | `32CC4FB6447E334D3EA774F307114CDA46D3BC009C721FF41DAE27CB065BD82C` |
| `run-proof.mjs` | `C4383313D0F4FA11CC908BF7EF04C8D2EA392B9041804B369D056211C467E1EA` |
| `direct.mjs` | `578AF362467E0CB5938A97510B8DFA82CFBE4250A66468DCDC40D08022FD3686` |
| `migration.mjs` | `A808F47BAB12143A290F2873164A5B7B88B7748451F00ED46C0CC92278EAB72D` |
| `migration-r2.mjs` | `753C7EE12F761EEE55AADAF4172C34652521D88C9689A58B5DE06DB9EB1C9320` |
| `migration-r3.mjs` | `A5CC8885F63DA031FE0E37E02BD0BA3B794CA629190F2BEDFC14056E915ECF53` |
| `extras.mjs` | `EA5681D39A7D0DB98C537591CA062D3310C5B7411E6777F8A6FCF103E076B3E8` |
| `unit.log` | `7AAF2479463923752BE6FB4ED0B8DECC8185DF5C3FD16B4678E850072C3EC460` |
| `proof.log` | `44787C1CD22656D82F61B19CD9A7A953C8B87674EE33BB6CC3B7146E21F192C3` |
| `direct.log` | `373875787CA325262DDD6B3D337E9C3B90C6315F9DAA3B6312A58ADBC63E0B17` |
| `migration-r2.log` | `6405E85C219A296CD5B667CC5D8D27668DB914FC1766AF64FC7ADDC680DD8A54` |
| `migration-r3.log` | `E7AE2D9FE1045250EA4CB0C72CFEA171B71726B323E807132D525E442B62044C` |
| `extras.log` | `4D5624AF83E59C307F640D0811B6F436073360FF3EEE59F1F3838B648E3658E7` |

### unit.log

```text
node.exe : npm notice run react-example@0.0.0 test
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Users\Fares\AppData\Roaming\ ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (npm notice run react-example@0.0.0 test:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
npm notice run tsx --test src/**/*.test.ts
TAP version 13
# Subtest: WF-04: open ظْ in_progress only
ok 1 - WF-04: open ظْ in_progress only
  ---
  duration_ms: 5.177
  type: 'test'
  ...
# Subtest: WF-04: in_progress ظْ awaiting_verification only
ok 2 - WF-04: in_progress ظْ awaiting_verification only
  ---
  duration_ms: 0.5516
  type: 'test'
  ...
# Subtest: WF-04: awaiting_verification ظْ closed | reopened
ok 3 - WF-04: awaiting_verification ظْ closed | reopened
  ---
  duration_ms: 0.6943
  type: 'test'
  ...
# Subtest: WF-04: closed ظْ reopened only (never straight back to work)
ok 4 - WF-04: closed ظْ reopened only (never straight back to work)
  ---
  duration_ms: 0.9551
  type: 'test'
  ...
# Subtest: WF-04: reopened ظْ in_progress (rework restarts with the owner)
ok 5 - WF-04: reopened ظْ in_progress (rework restarts with the owner)
  ---
  duration_ms: 0.5484
  type: 'test'
  ...
# Subtest: WF-04: every other pair is refused
ok 6 - WF-04: every other pair is refused
  ---
  duration_ms: 0.771
  type: 'test'
  ...
# Subtest: WF-04: reopened always requires a reason; other targets do not
ok 7 - WF-04: reopened always requires a reason; other targets do not
  ---
  duration_ms: 0.5702
  type: 'test'
  ...
# Subtest: WF-04: close/reopen are admin-only; work transitions are not
ok 8 - WF-04: close/reopen are admin-only; work transitions are not
  ---
  duration_ms: 0.74
  type: 'test'
  ...
# Subtest: WF-04: status guard accepts the five states and rejects the rest
ok 9 - WF-04: status guard accepts the five states and rejects the rest
  ---
  duration_ms: 1.6959
  type: 'test'
  ...
# Subtest: A1: gate passes when every department is dept-approved or client-approved
ok 10 - A1: gate passes when every department is dept-approved or client-approved
  ---
  duration_ms: 6.4774
  type: 'test'
  ...
# Subtest: A1: gate refuses and NAMES the incomplete departments
ok 11 - A1: gate refuses and NAMES the incomplete departments
  ---
  duration_ms: 1.9767
  type: 'test'
  ...
# Subtest: A1: deduplicates incomplete department names when multiple items are assigned to same department
ok 12 - A1: deduplicates incomplete department names when multiple items are assigned to same department
  ---
  duration_ms: 0.9708
  type: 'test'
  ...
# Subtest: A1: submitted/returned/draft never count as dept-approved
ok 13 - A1: submitted/returned/draft never count as dept-approved
  ---
  duration_ms: 0.6546
  type: 'test'
  ...
# Subtest: B1: GE final requires client-approved (or N/A with reason) everywhere
ok 14 - B1: GE final requires client-approved (or N/A with reason) everywhere
  ---
  duration_ms: 0.8803
  type: 'test'
  ...
# Subtest: B1: snapshot hash is deterministic and content-sensitive
ok 15 - B1: snapshot hash is deterministic and content-sensitive
  ---
  duration_ms: 4.0048
  type: 'test'
  ...
# Subtest: C1: matching version passes
ok 16 - C1: matching version passes
  ---
  duration_ms: 0.9466
  type: 'test'
  ...
# Subtest: C1: stale version gets 409 WITH the current outcome (mine-vs-theirs)
ok 17 - C1: stale version gets 409 WITH the current outcome (mine-vs-theirs)
  ---
  duration_ms: 0.6991
  type: 'test'
  ...
# Subtest: C1: missing/garbage version is 400 (reload required), not a silent win
ok 18 - C1: missing/garbage version is 400 (reload required), not a silent win
  ---
  duration_ms: 1.097
  type: 'test'
  ...
# Subtest: D: 5242880 bytes is accepted, 5242881 is rejected with the oversize key
ok 19 - D: 5242880 bytes is accepted, 5242881 is rejected with the oversize key
  ---
  duration_ms: 1.8989
  type: 'test'
  ...
# Subtest: D: only the small allowlist passes the mime check
ok 20 - D: only the small allowlist passes the mime check
  ---
  duration_ms: 1.1932
  type: 'test'
  ...
# Subtest: D3: storage warn threshold is 800 MB with human readout
ok 21 - D3: storage warn threshold is 800 MB with human readout
  ---
  duration_ms: 0.7031
  type: 'test'
  ...
# Subtest: B11b staff rows: valid rows pass, duplicates/bad email/department refused
ok 22 - B11b staff rows: valid rows pass, duplicates/bad email/department refused
  ---
  duration_ms: 9.0187
  type: 'test'
  ...
# Subtest: B11b staff rows: empty array and oversize refused
ok 23 - B11b staff rows: empty array and oversize refused
  ---
  duration_ms: 1.3367
  type: 'test'
  ...
# Subtest: B11b OTP: 16 chars, unique per call, never contains spaces
ok 24 - B11b OTP: 16 chars, unique per call, never contains spaces
  ---
  duration_ms: 1.2595
  type: 'test'
  ...
# Subtest: B11b unassign refusal names blockers (S-10 409 human)
ok 25 - B11b unassign refusal names blockers (S-10 409 human)
  ---
  duration_ms: 0.5597
  type: 'test'
  ...
# Subtest: B11b visibility: show_gap=false redacts scores (S-09 flags wiring)
ok 26 - B11b visibility: show_gap=false redacts scores (S-09 flags wiring)
  ---
  duration_ms: 0.5702
  type: 'test'
  ...
# Subtest: B11b security shapes: suspended body carries no user data; stripSecrets drops hashes/OTPs
ok 27 - B11b security shapes: suspended body carries no user data; stripSecrets drops hashes/OTPs
  ---
  duration_ms: 0.7645
  type: 'test'
  ...
# Subtest: B16-A2: dept member approves when no head is assigned (no self-ban)
ok 28 - B16-A2: dept member approves when no head is assigned (no self-ban)
  ---
  duration_ms: 5.509
  type: 'test'
  ...
# Subtest: B16-A2: head-only when a head is assigned; member refused, head passes
ok 29 - B16-A2: head-only when a head is assigned; member refused, head passes
  ---
  duration_ms: 1.1804
  type: 'test'
  ...
# Subtest: B16-A2 OD-08 s2: self-approval ALLOWED at dept level and flagged preliminary
ok 30 - B16-A2 OD-08 s2: self-approval ALLOWED at dept level and flagged preliminary
  ---
  duration_ms: 0.7028
  type: 'test'
  ...
# Subtest: B16-A2: cross-dept employee refused even without a head
ok 31 - B16-A2: cross-dept employee refused even without a head
  ---
  duration_ms: 0.3794
  type: 'test'
  ...
# Subtest: B16-A2: head of ANOTHER department is still cross-dept (head ظëب pass)
ok 32 - B16-A2: head of ANOTHER department is still cross-dept (head ظëب pass)
  ---
  duration_ms: 0.4094
  type: 'test'
  ...
# Subtest: B16-A2: client_admin refused (belongs to the department path)
ok 33 - B16-A2: client_admin refused (belongs to the department path)
  ---
  duration_ms: 0.3961
  type: 'test'
  ...
# Subtest: B16-A2: ge_admin refused (GE acts at final approval)
ok 34 - B16-A2: ge_admin refused (GE acts at final approval)
  ---
  duration_ms: 0.5914
  type: 'test'
  ...
# Subtest: B16-B: every stripped 403 is bilingual EN/AR with the correct path
ok 35 - B16-B: every stripped 403 is bilingual EN/AR with the correct path
  ---
  duration_ms: 1.0664
  type: 'test'
  ...
# Subtest: U2D proof refuses absent opt-in, nonloopback/unnamed scratch, ambiguous URLs and ambient DSN
ok 36 - U2D proof refuses absent opt-in, nonloopback/unnamed scratch, ambiguous URLs and ambient DSN
  ---
  duration_ms: 6.2906
  type: 'test'
  ...
# Subtest: B17 exact route inventory: all 95 legacy declarations classified once; business activation is empty
ok 37 - B17 exact route inventory: all 95 legacy declarations classified once; business activation is empty
  ---
  duration_ms: 33.069
  type: 'test'
  ...
# Subtest: B17 mounted declaration coverage rejects missing, duplicate and new routes
ok 38 - B17 mounted declaration coverage rejects missing, duplicate and new routes
  ---
  duration_ms: 7.6998
  type: 'test'
  ...
# Subtest: B17 pure bindings never derive platform from missing context
ok 39 - B17 pure bindings never derive platform from missing context
  ---
  duration_ms: 3.2791
  type: 'test'
  ...
# Subtest: B17 runtime call-chain has no schema application; initializer guards before DDL and never regrants
ok 40 - B17 runtime call-chain has no schema application; initializer guards before DDL and never regrants
  ---
  duration_ms: 7.4941
  type: 'test'
  ...
# Subtest: B17 U1V runtime roles require explicit membership in every mode
ok 41 - B17 U1V runtime roles require explicit membership in every mode
  ---
  duration_ms: 3.0808
  type: 'test'
  ...
# [API error] 418 sync boom Error: sync boom
#     at <anonymous> (D:\\Teranoo Work\\Client01\\prototype-app\\src\\lib\\errorHandler.test.ts:30:25)
#     at Layer.handle [as handle_request] (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\layer.js:95:5)
#     at next (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\route.js:149:13)
#     at Route.dispatch (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\route.js:119:3)
#     at Layer.handle [as handle_request] (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\layer.js:95:5)
#     at D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\index.js:284:15
#     at Function.process_params (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\index.js:346:12)
#     at next (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\index.js:280:10)
#     at jsonParser (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\body-parser\\lib\\types\\json.js:117:7)
#     at Layer.handle [as handle_request] (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\layer.js:95:5)
# Subtest: thrown error inside a route yields JSON (not HTML) with the thrown status + code
ok 42 - thrown error inside a route yields JSON (not HTML) with the thrown status + code
  ---
  duration_ms: 254.7604
  type: 'test'
  ...
# [API error] 403 next boom Error: next boom
#     at <anonymous> (D:\\Teranoo Work\\Client01\\prototype-app\\src\\lib\\errorHandler.test.ts:34:24)
#     at Layer.handle [as handle_request] (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\layer.js:95:5)
#     at next (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\route.js:149:13)
#     at Route.dispatch (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\route.js:119:3)
#     at Layer.handle [as handle_request] (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\layer.js:95:5)
#     at D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\index.js:284:15
#     at Function.process_params (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\index.js:346:12)
#     at next (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\index.js:280:10)
#     at jsonParser (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\body-parser\\lib\\types\\json.js:117:7)
#     at Layer.handle [as handle_request] (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\layer.js:95:5)
# Subtest: next(err)-forwarded 403 yields JSON with status + code, no stack
ok 43 - next(err)-forwarded 403 yields JSON with status + code, no stack
  ---
  duration_ms: 38.9207
  type: 'test'
  ...
# [API error] 500 plain boom Error: plain boom
#     at <anonymous> (D:\\Teranoo Work\\Client01\\prototype-app\\src\\lib\\errorHandler.test.ts:38:11)
#     at Layer.handle [as handle_request] (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\layer.js:95:5)
#     at next (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\route.js:149:13)
#     at Route.dispatch (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\route.js:119:3)
#     at Layer.handle [as handle_request] (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\layer.js:95:5)
#     at D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\index.js:284:15
#     at Function.process_params (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\index.js:346:12)
#     at next (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\index.js:280:10)
#     at jsonParser (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\body-parser\\lib\\types\\json.js:117:7)
#     at Layer.handle [as handle_request] (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\express\\lib\\router\\layer.js:95:5)
# Subtest: plain Error without status defaults to 500 JSON
ok 44 - plain Error without status defaults to 500 JSON
  ---
  duration_ms: 39.7807
  type: 'test'
  ...
# Subtest: unknown route yields 404 JSON (never the default HTML page)
ok 45 - unknown route yields 404 JSON (never the default HTML page)
  ---
  duration_ms: 20.5514
  type: 'test'
  ...
# [API error] 400 Expected property name or '}' in JSON at position 1 (line 1 column 2) SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)
#     at JSON.parse (<anonymous>)
#     at parse (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\body-parser\\lib\\types\\json.js:96:19)
#     at D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\body-parser\\lib\\read.js:146:18
#     at AsyncResource.runInAsyncScope (node:async_hooks:214:14)
#     at invokeCallback (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\raw-body\\index.js:238:16)
#     at done (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\raw-body\\index.js:227:7)
#     at IncomingMessage.onEnd (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\raw-body\\index.js:287:7)
#     at IncomingMessage.emit (node:events:519:28)
#     at endReadableNT (node:internal/streams/readable:1698:12)
#     at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
# Subtest: malformed JSON body yields 400 JSON (never an HTML page)
ok 46 - malformed JSON body yields 400 JSON (never an HTML page)
  ---
  duration_ms: 200.0954
  type: 'test'
  ...
# [API error] 400 Expected property name or '}' in JSON at position 1 (line 1 column 2) SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)
#     at JSON.parse (<anonymous>)
#     at parse (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\body-parser\\lib\\types\\json.js:96:19)
#     at D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\body-parser\\lib\\read.js:146:18
#     at AsyncResource.runInAsyncScope (node:async_hooks:214:14)
#     at invokeCallback (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\raw-body\\index.js:238:16)
#     at done (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\raw-body\\index.js:227:7)
#     at IncomingMessage.onEnd (D:\\Teranoo Work\\Client01\\prototype-app\\node_modules\\raw-body\\index.js:287:7)
#     at IncomingMessage.emit (node:events:519:28)
#     at endReadableNT (node:internal/streams/readable:1698:12)
#     at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
# Subtest: APP-level mount (server.ts order): malformed JSON to /api/* yields 400 JSON, never HTML
ok 47 - APP-level mount (server.ts order): malformed JSON to /api/* yields 400 JSON, never HTML
  ---
  duration_ms: 22.8521
  type: 'test'
  ...
# Subtest: errorStatus: preserves statusCode/status in range, defaults 500 otherwise
ok 48 - errorStatus: preserves statusCode/status in range, defaults 500 otherwise
  ---
  duration_ms: 0.7619
  type: 'test'
  ...
# Subtest: DD-02: sheet totals 155/255 ظْ score 60.8, coverage 100
ok 49 - DD-02: sheet totals 155/255 ظْ score 60.8, coverage 100
  ---
  duration_ms: 3.3598
  type: 'test'
  ...
# Subtest: DD-02: unrated rows are excluded from the score but kept in coverage
ok 50 - DD-02: unrated rows are excluded from the score but kept in coverage
  ---
  duration_ms: 0.7538
  type: 'test'
  ...
# Subtest: DD-02: nothing rated ظْ null score, zero coverage
ok 51 - DD-02: nothing rated ظْ null score, zero coverage
  ---
  duration_ms: 0.5255
  type: 'test'
  ...
# Subtest: DD-02: empty set ظْ null score
ok 52 - DD-02: empty set ظْ null score
  ---
  duration_ms: 0.4197
  type: 'test'
  ...
# Subtest: MP-41: natural key trims and keeps blanks as empty (never guessed)
ok 53 - MP-41: natural key trims and keeps blanks as empty (never guessed)
  ---
  duration_ms: 2.8087
  type: 'test'
  ...
# Subtest: MP-42: PROFILE text maps exactly; trailing space tolerated, unknown ظْ null
ok 54 - MP-42: PROFILE text maps exactly; trailing space tolerated, unknown ظْ null
  ---
  duration_ms: 0.5903
  type: 'test'
  ...
# Subtest: parses CSV disclosure rows with standard, disclosure, and items
ok 55 - parses CSV disclosure rows with standard, disclosure, and items
  ---
  duration_ms: 12.8653
  type: 'test'
  ...
# Subtest: handles empty CSV gracefully
ok 56 - handles empty CSV gracefully
  ---
  duration_ms: 0.9624
  type: 'test'
  ...
# Subtest: FIX-BATCH-4: dash-numeric codes are NOT date-mangled (2-29 vs 3-1 stay distinct)
ok 57 - FIX-BATCH-4: dash-numeric codes are NOT date-mangled (2-29 vs 3-1 stay distinct)
  ---
  duration_ms: 4.4367
  type: 'test'
  ...
# Subtest: B12 idle: thresholds are 30 min timeout / 28 min warning (S-01)
ok 58 - B12 idle: thresholds are 30 min timeout / 28 min warning (S-01)
  ---
  duration_ms: 3.5092
  type: 'test'
  ...
# Subtest: B12 idle: active ظْ warning ظْ expired boundaries
ok 59 - B12 idle: active ظْ warning ظْ expired boundaries
  ---
  duration_ms: 0.818
  type: 'test'
  ...
# Subtest: B12 idle: countdown seconds remaining
ok 60 - B12 idle: countdown seconds remaining
  ---
  duration_ms: 1.129
  type: 'test'
  ...
# Subtest: U1V shared parser refuses duplicate decoded keys at every object depth before state/audit changes
ok 61 - U1V shared parser refuses duplicate decoded keys at every object depth before state/audit changes
  ---
  duration_ms: 742.8158
  type: 'test'
  ...
# Subtest: U1V valid JSON values, string escapes and independent key scopes retain native JSON semantics
ok 62 - U1V valid JSON values, string escapes and independent key scopes retain native JSON semantics
  ---
  duration_ms: 141.3035
  type: 'test'
  ...
# Subtest: U1V malformed/strict-root JSON stays 400 JSON without body disclosure or state/audit changes
ok 63 - U1V malformed/strict-root JSON stays 400 JSON without body disclosure or state/audit changes
  ---
  duration_ms: 282.715
  type: 'test'
  ...
# Subtest: U1V JSON bound remains 10 MiB including inflated bodies; charset and content-type behavior stays closed
ok 64 - U1V JSON bound remains 10 MiB including inflated bodies; charset and content-type behavior stays closed
  ---
  duration_ms: 1108.9455
  type: 'test'
  ...
# Subtest: B12 password: boundary 9 vs 10 chars (S-02)
ok 65 - B12 password: boundary 9 vs 10 chars (S-02)
  ---
  duration_ms: 2.8586
  type: 'test'
  ...
# Subtest: B12 password: each complexity class required
ok 66 - B12 password: each complexity class required
  ---
  duration_ms: 0.7604
  type: 'test'
  ...
# Subtest: B12 password: non-string/empty refused without throwing
ok 67 - B12 password: non-string/empty refused without throwing
  ---
  duration_ms: 0.489
  type: 'test'
  ...
# Subtest: D-038 gate matrix (A-09, MP-47)
    # Subtest: unset settings block export with the unified 409 refusal
    ok 1 - unset settings block export with the unified 409 refusal
      ---
      duration_ms: 3.8399
      type: 'test'
      ...
    # Subtest: legacy row missing statement fields still blocks (no default)
    ok 2 - legacy row missing statement fields still blocks (no default)
      ---
      duration_ms: 0.6968
      type: 'test'
      ...
    # Subtest: complete settings pass the gate
    ok 3 - complete settings pass the gate
      ---
      duration_ms: 0.8087
      type: 'test'
      ...
    1..3
ok 68 - D-038 gate matrix (A-09, MP-47)
  ---
  duration_ms: 9.7195
  type: 'suite'
  ...
# Subtest: PUT validation (A-10 statement, A-11 notification)
    # Subtest: requires disclosureLevel + reportLevel + statementName + statementPeriod
    ok 1 - requires disclosureLevel + reportLevel + statementName + statementPeriod
      ---
      duration_ms: 0.855
      type: 'test'
      ...
    # Subtest: rejects unknown levels
    ok 2 - rejects unknown levels
      ---
      duration_ms: 0.5079
      type: 'test'
      ...
    # Subtest: notified fields optional but validated when given
    ok 3 - notified fields optional but validated when given
      ---
      duration_ms: 0.5564
      type: 'test'
      ...
    1..3
ok 69 - PUT validation (A-10 statement, A-11 notification)
  ---
  duration_ms: 2.8738
  type: 'suite'
  ...
# Subtest: disclosure index HARD RULE (MP-48, A-13)
    # Subtest: evaluated disclosure builds a non-omitted row with coverage beside score
    ok 1 - evaluated disclosure builds a non-omitted row with coverage beside score
      ---
      duration_ms: 3.8885
      type: 'test'
      ...
    # Subtest: per-disclosure score uses priority weights (dashboard-traceable)
    ok 2 - per-disclosure score uses priority weights (dashboard-traceable)
      ---
      duration_ms: 0.7717
      type: 'test'
      ...
    # Subtest: fully N/A disclosure with reason + explanation is omitted (not dropped)
    ok 3 - fully N/A disclosure with reason + explanation is omitted (not dropped)
      ---
      duration_ms: 1.1759
      type: 'test'
      ...
    # Subtest: N/A evaluation without stored reason ظْ 422 payload names the disclosure
    ok 4 - N/A evaluation without stored reason ظْ 422 payload names the disclosure
      ---
      duration_ms: 2.0317
      type: 'test'
      ...
    # Subtest: tampered omission (reason without explanation) ظْ 422 payload names it
    ok 5 - tampered omission (reason without explanation) ظْ 422 payload names it
      ---
      duration_ms: 0.9965
      type: 'test'
      ...
    # Subtest: mixed disclosure stays non-omitted; N/A items excluded from coverage math
    ok 6 - mixed disclosure stays non-omitted; N/A items excluded from coverage math
      ---
      duration_ms: 0.627
      type: 'test'
      ...
    1..6
ok 70 - disclosure index HARD RULE (MP-48, A-13)
  ---
  duration_ms: 11.6277
  type: 'suite'
  ...
# Subtest: visibility bounds (04 ┬د4)
    # Subtest: employee export is a strict subset of the admin export
    ok 1 - employee export is a strict subset of the admin export
      ---
      duration_ms: 0.8245
      type: 'test'
      ...
    # Subtest: show_gap=false redacts scores without dropping rows
    ok 2 - show_gap=false redacts scores without dropping rows
      ---
      duration_ms: 0.844
      type: 'test'
      ...
    1..2
ok 71 - visibility bounds (04 ┬د4)
  ---
  duration_ms: 2.269
  type: 'suite'
  ...
# Subtest: structured export shape (MP-50)
    # Subtest: CSV carries reason + explanation columns on every row
    ok 1 - CSV carries reason + explanation columns on every row
      ---
      duration_ms: 1.6288
      type: 'test'
      ...
    1..1
ok 72 - structured export shape (MP-50)
  ---
  duration_ms: 1.9556
  type: 'suite'
  ...
# Subtest: B12 F-03: every mutating route carries requireFreshPassword or is allowlisted
ok 73 - B12 F-03: every mutating route carries requireFreshPassword or is allowlisted
  ---
  duration_ms: 20.2078
  type: 'test'
  ...
# Subtest: B12 S-24: audit-reader matrix (GE + named delegate only)
ok 74 - B12 S-24: audit-reader matrix (GE + named delegate only)
  ---
  duration_ms: 1.3922
  type: 'test'
  ...
# Subtest: B12 S-23: inbox cap is 50 and the ten fan-out types exist
ok 75 - B12 S-23: inbox cap is 50 and the ten fan-out types exist
  ---
  duration_ms: 0.7719
  type: 'test'
  ...
# Subtest: B15 RTL: no physical LTR directionals in views/components/App/css
ok 76 - B15 RTL: no physical LTR directionals in views/components/App/css
  ---
  duration_ms: 53.3399
  type: 'test'
  ...
# Subtest: B15 RTL: sidebar docking contract (source)
ok 77 - B15 RTL: sidebar docking contract (source)
  ---
  duration_ms: 2.4666
  type: 'test'
  ...
# Subtest: B15 RTL: header hamburger + main content selectors (source)
ok 78 - B15 RTL: header hamburger + main content selectors (source)
  ---
  duration_ms: 1.6127
  type: 'test'
  ...
# Subtest: B15 RTL: dir="ltr" isolates on codes / scores / emails (source)
ok 79 - B15 RTL: dir="ltr" isolates on codes / scores / emails (source)
  ---
  duration_ms: 3.5652
  type: 'test'
  ...
# Subtest: B15 RTL: directional arrow icons mirror in RTL (source)
ok 80 - B15 RTL: directional arrow icons mirror in RTL (source)
  ---
  duration_ms: 9.6365
  type: 'test'
  ...
# Subtest: B15 RTL: print stylesheet is RTL-correct (source)
ok 81 - B15 RTL: print stylesheet is RTL-correct (source)
  ---
  duration_ms: 1.7192
  type: 'test'
  ...
# Subtest: B15 RTL harness: closed drawer renders docked-safe markup (EN + AR)
ok 82 - B15 RTL harness: closed drawer renders docked-safe markup (EN + AR)
  ---
  duration_ms: 1709.6076
  type: 'test'
  ...
# Subtest: B15 RTL harness: open drawer renders overlay + visible transform (EN + AR)
ok 83 - B15 RTL harness: open drawer renders overlay + visible transform (EN + AR)
  ---
  duration_ms: 136.0518
  type: 'test'
  ...
# Subtest: scope predicates are fixed, parameterized EXISTS and department assignment, never service fan-out
ok 84 - scope predicates are fixed, parameterized EXISTS and department assignment, never service fan-out
  ---
  duration_ms: 7.7429
  type: 'test'
  ...
# Subtest: unknown/malformed bindings and array/object/duplicate-like resource filters fail closed
ok 85 - unknown/malformed bindings and array/object/duplicate-like resource filters fail closed
  ---
  duration_ms: 4.3938
  type: 'test'
  ...
# Subtest: initiative eligible/library never broadens client or employee access
ok 86 - initiative eligible/library never broadens client or employee access
  ---
  duration_ms: 3.1844
  type: 'test'
  ...
# Subtest: service choice uses links, not report defaults; standalone actions require explicit service
ok 87 - service choice uses links, not report defaults; standalone actions require explicit service
  ---
  duration_ms: 2.7175
  type: 'test'
  ...
# Subtest: existing XLSX parses quoted commas/newlines; source keys reject missing/duplicate provenance
ok 88 - existing XLSX parses quoted commas/newlines; source keys reject missing/duplicate provenance
  ---
  duration_ms: 11.6046
  type: 'test'
  ...
# Subtest: approved source extracts are parsed read-only with actual headers
ok 89 - approved source extracts are parsed read-only with actual headers
  ---
  duration_ms: 146.4699
  type: 'test'
  ...
# Subtest: calculates correct score with pure 0, 50, 100 evaluations
ok 90 - calculates correct score with pure 0, 50, 100 evaluations
  ---
  duration_ms: 4.3757
  type: 'test'
  ...
# Subtest: rule: not_evaluated is NOT zero and must be excluded from average and included in coverage deficit
ok 91 - rule: not_evaluated is NOT zero and must be excluded from average and included in coverage deficit
  ---
  duration_ms: 2.0089
  type: 'test'
  ...
# Subtest: rule: not_applicable is excluded from averages and counters
ok 92 - rule: not_applicable is excluded from averages and counters
  ---
  duration_ms: 0.6235
  type: 'test'
  ...
# Subtest: rule: weighted average sum(weight * score) / sum(weight)
ok 93 - rule: weighted average sum(weight * score) / sum(weight)
  ---
  duration_ms: 0.9868
  type: 'test'
  ...
# Subtest: empty evaluations return null aggregate and 0 coverage
ok 94 - empty evaluations return null aggregate and 0 coverage
  ---
  duration_ms: 0.8842
  type: 'test'
  ...
# Subtest: F-01 C1 baseline: all-submitted scenario aggregates to 60.0 / 66.7%
ok 95 - F-01 C1 baseline: all-submitted scenario aggregates to 60.0 / 66.7%
  ---
  duration_ms: 1.3193
  type: 'test'
  ...
# Subtest: F-01 A2: leaving one evaluation in DRAFT removes it from numbers (100.0 / 33.3%)
ok 96 - F-01 A2: leaving one evaluation in DRAFT removes it from numbers (100.0 / 33.3%)
  ---
  duration_ms: 1.2165
  type: 'test'
  ...
# Subtest: F-01: draft N/A evaluation is treated as not-evaluated, not as N/A
ok 97 - F-01: draft N/A evaluation is treated as not-evaluated, not as N/A
  ---
  duration_ms: 0.5291
  type: 'test'
  ...
# Subtest: F-01: submitted N/A keeps excluding the item from the denominator
ok 98 - F-01: submitted N/A keeps excluding the item from the denominator
  ---
  duration_ms: 0.9211
  type: 'test'
  ...
# Subtest: B11c gate matrix: submitted+approved+client_approved count; draft/returned/reopened do not
ok 99 - B11c gate matrix: submitted+approved+client_approved count; draft/returned/reopened do not
  ---
  duration_ms: 1.9718
  type: 'test'
  ...
# Subtest: B11c: dashboard aggregate predicate in gri.ts carries the three-value gate
ok 100 - B11c: dashboard aggregate predicate in gri.ts carries the three-value gate
  ---
  duration_ms: 1.7177
  type: 'test'
  ...
# Subtest: submit gate: author submits own draft (head assigned or not)
ok 101 - submit gate: author submits own draft (head assigned or not)
  ---
  duration_ms: 2.5958
  type: 'test'
  ...
# Subtest: submit gate: designated head submits (different user, head of dept)
ok 102 - submit gate: designated head submits (different user, head of dept)
  ---
  duration_ms: 0.3706
  type: 'test'
  ...
# Subtest: submit gate: null head means author-only (member refused)
ok 103 - submit gate: null head means author-only (member refused)
  ---
  duration_ms: 0.645
  type: 'test'
  ...
# Subtest: submit gate: client_admin submit refused (bilingual 403)
ok 104 - submit gate: client_admin submit refused (bilingual 403)
  ---
  duration_ms: 0.4062
  type: 'test'
  ...
# Subtest: submit gate: ge_admin submit refused (bilingual 403)
ok 105 - submit gate: ge_admin submit refused (bilingual 403)
  ---
  duration_ms: 0.4762
  type: 'test'
  ...
# Subtest: submit gate: non-author same-dept employee refused when head assigned
ok 106 - submit gate: non-author same-dept employee refused when head assigned
  ---
  duration_ms: 0.3642
  type: 'test'
  ...
# Subtest: submit gate: head of ANOTHER dept refused (head identity is dept-scoped)
ok 107 - submit gate: head of ANOTHER dept refused (head identity is dept-scoped)
  ---
  duration_ms: 0.4185
  type: 'test'
  ...
# Subtest: submit gate: refusal is bilingual EN + AR with the exact EN contract
ok 108 - submit gate: refusal is bilingual EN + AR with the exact EN contract
  ---
  duration_ms: 0.6888
  type: 'test'
  ...
# Subtest: weight is derived from priority: high=3, mid=2, low=1
ok 109 - weight is derived from priority: high=3, mid=2, low=1
  ---
  duration_ms: 3.6076
  type: 'test'
  ...
# Subtest: canonicalLinkPair sorts both directions to one row
ok 110 - canonicalLinkPair sorts both directions to one row
  ---
  duration_ms: 2.3285
  type: 'test'
  ...
# Subtest: canonicalLinkPair refuses self-links and junk
ok 111 - canonicalLinkPair refuses self-links and junk
  ---
  duration_ms: 0.6232
  type: 'test'
  ...
# Subtest: validateNewItem accepts a minimal body with sane defaults
ok 112 - validateNewItem accepts a minimal body with sane defaults
  ---
  duration_ms: 0.8925
  type: 'test'
  ...
# Subtest: validateNewItem refuses missing disclosureId/code/requirement
ok 113 - validateNewItem refuses missing disclosureId/code/requirement
  ---
  duration_ms: 0.5525
  type: 'test'
  ...
# Subtest: validateNewItem refuses out-of-domain priority/esgClass/answerType/sortOrder
ok 114 - validateNewItem refuses out-of-domain priority/esgClass/answerType/sortOrder
  ---
  duration_ms: 0.5588
  type: 'test'
  ...
# Subtest: domain guards accept only known values
ok 115 - domain guards accept only known values
  ---
  duration_ms: 0.5896
  type: 'test'
  ...
# Subtest: itemDeleteRefusal names every referencing child kind
ok 116 - itemDeleteRefusal names every referencing child kind
  ---
  duration_ms: 0.9703
  type: 'test'
  ...
# Subtest: B: ge_admin with explicit clientId resolves to that tenant (explicit)
ok 117 - B: ge_admin with explicit clientId resolves to that tenant (explicit)
  ---
  duration_ms: 5.2407
  type: 'test'
  ...
# Subtest: B: tenant-less ge_admin without clientId fails 400 (choose a tenant)
ok 118 - B: tenant-less ge_admin without clientId fails 400 (choose a tenant)
  ---
  duration_ms: 1.0393
  type: 'test'
  ...
# Subtest: B: client_admin defaults to own tenant; naming own tenant is fine
ok 119 - B: client_admin defaults to own tenant; naming own tenant is fine
  ---
  duration_ms: 0.4797
  type: 'test'
  ...
# Subtest: B3: client_admin naming another tenant ظْ 403
ok 120 - B3: client_admin naming another tenant ظْ 403
  ---
  duration_ms: 0.7034
  type: 'test'
  ...
# Subtest: B3: employee naming another tenant ظْ 403
ok 121 - B3: employee naming another tenant ظْ 403
  ---
  duration_ms: 0.4255
  type: 'test'
  ...
# Subtest: C: ge_admin can create employee in explicit tenant
ok 122 - C: ge_admin can create employee in explicit tenant
  ---
  duration_ms: 0.9283
  type: 'test'
  ...
# Subtest: C: ge_admin can create tenant-less ge_admin
ok 123 - C: ge_admin can create tenant-less ge_admin
  ---
  duration_ms: 0.7549
  type: 'test'
  ...
# Subtest: C: client_admin direct-create is forbidden (WF-01: ╪د┘╪╣┘à┘è┘ ┘╪د ┘è┘╪┤╪خ ╪ص╪│╪د╪ذ╪د╪ز)
ok 124 - C: client_admin direct-create is forbidden (WF-01: ╪د┘╪╣┘à┘è┘ ┘╪د ┘è┘╪┤╪خ ╪ص╪│╪د╪ذ╪د╪ز)
  ---
  duration_ms: 0.5945
  type: 'test'
  ...
# Subtest: C3: client_admin creating ge_admin ظْ 403 with the staff-list pointer
ok 125 - C3: client_admin creating ge_admin ظْ 403 with the staff-list pointer
  ---
  duration_ms: 1.1126
  type: 'test'
  ...
# Subtest: C3: client_admin creating user in another tenant ظْ 403 (role gate fires first)
ok 126 - C3: client_admin creating user in another tenant ظْ 403 (role gate fires first)
  ---
  duration_ms: 1.2774
  type: 'test'
  ...
# Subtest: C3: ge_admin creating employee without department ظْ 400 (shape still enforced)
ok 127 - C3: ge_admin creating employee without department ظْ 400 (shape still enforced)
  ---
  duration_ms: 0.5492
  type: 'test'
  ...
# Subtest: C: non-employee with departmentId ظْ 400 (ge_admin shape check)
ok 128 - C: non-employee with departmentId ظْ 400 (ge_admin shape check)
  ---
  duration_ms: 0.3785
  type: 'test'
  ...
# Subtest: B12: weak self-chosen passwords ظْ 400 (S-02: 10 chars + complexity)
ok 129 - B12: weak self-chosen passwords ظْ 400 (S-02: 10 chars + complexity)
  ---
  duration_ms: 0.4353
  type: 'test'
  ...
# Subtest: C: employee creator cannot create users ظْ 403; short password ظْ 400
ok 130 - C: employee creator cannot create users ظْ 403; short password ظْ 400
  ---
  duration_ms: 0.4307
  type: 'test'
  ...
# Subtest: B17 signed identity requires UUID sid; sid-less legacy JWTs require re-login
ok 131 - B17 signed identity requires UUID sid; sid-less legacy JWTs require re-login
  ---
  duration_ms: 9.2032
  type: 'test'
  ...
# Subtest: B17 opaque handles hash independently and versions reject non-positive/ambiguous inputs
ok 132 - B17 opaque handles hash independently and versions reject non-positive/ambiguous inputs
  ---
  duration_ms: 2.2022
  type: 'test'
  ...
# Subtest: B17 malformed/duplicate bearer never falls back to cookie, and writes reject foreign origins
ok 133 - B17 malformed/duplicate bearer never falls back to cookie, and writes reject foreign origins
  ---
  duration_ms: 0.7049
  type: 'test'
  ...
# Subtest: SHIELD-U1-01: logout rejects malformed/forged/sid-less bearers before DB access, never using a valid cookie
ok 134 - SHIELD-U1-01: logout rejects malformed/forged/sid-less bearers before DB access, never using a valid cookie
  ---
  duration_ms: 2.9015
  type: 'test'
  ...
# Subtest: B17 actual mounted dispatcher denies every business operation, including legacy public GET and multipart preview
ok 135 - B17 actual mounted dispatcher denies every business operation, including legacy public GET and multipart preview
  ---
  duration_ms: 379.5879
  type: 'test'
  ...
# Subtest: U1V production and PostgreSQL proof mount the shared JSON parser, never a synthetic duplicate check
ok 136 - U1V production and PostgreSQL proof mount the shared JSON parser, never a synthetic duplicate check
  ---
  duration_ms: 1.3442
  type: 'test'
  ...
1..136
# tests 146
# suites 5
# pass 146
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 7212.307

```

### proof.log

```text
OWN_CONTAINER b17-u2d-sol-20261112-a 5283fadfda798e015409956f7b8891b9d19ca53df7c0b57b9066dc9fff7ff56b
ROLE {"current_user":"b17_qa_runtime","session_user":"b17_qa_runtime","rolsuper":false,"rolbypassrls":false,"rolcreaterole":false,"rolcreatedb":false,"memberships":0,"row_security":"on","version":"18.6 (Debian 18.6-1.pgdg13+2)"}
PASS dry-run transactional DDL ALWAYS rolled back: exact U1 fingerprint/business hashes; unknown/conflicting/frozen provenance refused
PASS source-evidenced exact-ID GRI/Profile/report association, same settings/rating/history/bytes, ledger failure rollback and idempotent version
PASS real login/session/tab ظْ scoped helpers: linked/empty/unlinked parents, dedup score, selected/eligible initiatives, independent Profile and actions
PASS employee own answers/evidence; foreign shared evaluation/history hidden and ambiguous upsert guard denied without business rekey
PASS A/B/empty pooled context, no request-selected inventory purpose, all legacy APIs unactivated, no old-schema replay/regrant after real restart
B17_U2D local substrate proof complete; NOT full domain/parent acceptance.
PROOF_EXIT=0 SIGNAL=null ERROR=none

```

### direct.log

```text
OBSERVATION_POLICY_ROLLBACK_SHA256 d5bea0bb7fb817a2db7f8a597173053b79a84f1327a117430618b9b354e3bccc
PASS exact runtime identity, PG18.6, no inherited memberships and FORCE on every public table
COUNTS W(A) {"items":3,"standards":2,"disclosures":2,"services":2,"answers":4,"evaluations":3,"assignments":4,"approvals":4,"evidence_attachments":4,"client_services":3,"initiatives_library":2,"client_initiatives":1,"esg_profile":1,"report_settings":1,"actions":2,"profile_assessments":0,"review_snapshots":0,"snapshot_notes":0,"notifications":0}
PASS raw SELECT RLS W(A) matches independent item/parent/history/evidence/initiative/profile/action oracle
COUNTS W(B) {"items":3,"standards":2,"disclosures":2,"services":1,"answers":1,"evaluations":1,"assignments":1,"approvals":1,"evidence_attachments":1,"client_services":1,"initiatives_library":2,"client_initiatives":0,"esg_profile":0,"report_settings":0,"actions":1,"profile_assessments":0,"review_snapshots":0,"snapshot_notes":0,"notifications":0}
PASS raw SELECT RLS W(B) matches independent item/parent/history/evidence/initiative/profile/action oracle
COUNTS C(A) {"items":3,"standards":2,"disclosures":2,"services":2,"answers":4,"evaluations":3,"assignments":4,"approvals":4,"evidence_attachments":4,"client_services":3,"initiatives_library":1,"client_initiatives":1,"esg_profile":1,"report_settings":1,"actions":2,"profile_assessments":0,"review_snapshots":0,"snapshot_notes":0,"notifications":0}
PASS raw SELECT RLS C(A) matches independent item/parent/history/evidence/initiative/profile/action oracle
COUNTS E(A0) {"items":3,"standards":2,"disclosures":2,"services":2,"answers":3,"evaluations":2,"assignments":3,"approvals":3,"evidence_attachments":3,"client_services":2,"initiatives_library":0,"client_initiatives":0,"esg_profile":0,"report_settings":0,"actions":0,"profile_assessments":0,"review_snapshots":0,"snapshot_notes":0,"notifications":0}
PASS raw SELECT RLS E(A0) matches independent item/parent/history/evidence/initiative/profile/action oracle
COUNTS removed-link {"items":0,"standards":0,"disclosures":0,"services":0,"answers":0,"evaluations":0,"assignments":0,"approvals":0,"evidence_attachments":0,"client_services":0,"initiatives_library":0,"client_initiatives":0,"esg_profile":0,"report_settings":0,"actions":0,"profile_assessments":0,"review_snapshots":0,"snapshot_notes":0,"notifications":0}
PASS raw SELECT RLS removed-link matches independent item/parent/history/evidence/initiative/profile/action oracle
COUNTS new-no-link {"items":0,"standards":0,"disclosures":0,"services":0,"answers":0,"evaluations":0,"assignments":0,"approvals":0,"evidence_attachments":0,"client_services":0,"initiatives_library":0,"client_initiatives":0,"esg_profile":0,"report_settings":0,"actions":0,"profile_assessments":0,"review_snapshots":0,"snapshot_notes":0,"notifications":0}
PASS raw SELECT RLS new-no-link matches independent item/parent/history/evidence/initiative/profile/action oracle
COUNTS empty-context {"items":0,"standards":0,"disclosures":0,"services":0,"answers":0,"evaluations":0,"assignments":0,"approvals":0,"evidence_attachments":0,"client_services":0,"initiatives_library":0,"client_initiatives":0,"esg_profile":0,"report_settings":0,"actions":0,"profile_assessments":0,"review_snapshots":0,"snapshot_notes":0,"notifications":0}
PASS raw SELECT RLS empty-context matches independent item/parent/history/evidence/initiative/profile/action oracle
COUNTS platform {"items":0,"standards":0,"disclosures":0,"services":0,"answers":0,"evaluations":0,"assignments":0,"approvals":0,"evidence_attachments":0,"client_services":0,"initiatives_library":0,"client_initiatives":0,"esg_profile":0,"report_settings":0,"actions":0,"profile_assessments":0,"review_snapshots":0,"snapshot_notes":0,"notifications":0}
PASS raw SELECT RLS platform matches independent item/parent/history/evidence/initiative/profile/action oracle
COUNTS unknown-role {"items":0,"standards":0,"disclosures":0,"services":0,"answers":0,"evaluations":0,"assignments":0,"approvals":0,"evidence_attachments":0,"client_services":0,"initiatives_library":0,"client_initiatives":0,"esg_profile":0,"report_settings":0,"actions":0,"profile_assessments":0,"review_snapshots":0,"snapshot_notes":0,"notifications":0}
PASS raw SELECT RLS unknown-role matches independent item/parent/history/evidence/initiative/profile/action oracle
PASS raw shared evaluation hidden, foreign correction history/attachments excluded, mutation denied and zero UPDATE
PASS overlapping services produce 3 items and 3 evaluations, sum150; no Profile score contribution
PASS empty mapping linked service has no item/parent children, no library fallback
PASS physical backend reuse clears transaction-local A/B/empty context with no app context helper
BUSINESS_ORACLE_SHA256 91eae4877b669c742a31ced87cdc59051d1f8f9cbb6fff789e82fcbb2ffa3e83
PASS full synthetic business state and temporary policies unchanged after direct negative checks
EFFECTIVE_U2D_SHAPE 215246397ad1c621b2fcc8cc74eeca79
PASS effective U2D fingerprint matches independently queried live catalog; ledger versions exactly U1/U2D
PASS readiness rejects row_security=off without runtime bypass
PASS readiness rejects effective policy drift, rolling back unchanged
PASS readiness rejects ledger checksum drift, rolling back unchanged
PASS final U2D readiness and business/fingerprint unchanged after all independent probes
DIRECT_QA_TOTAL=20 PASS=20 FAIL=0

```

### migration-r2.log

```text
node : file:///C:/Users/Fares/AppData/Local/Temp/opencode/b17-u2d-qa/sol-20261112-01/migration-r2.mjs:28
At line:1 char:1202
+ ... _CACHE='1'; node --import tsx "C:\Users\Fares\AppData\Local\Temp\open ...
+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (file:///C:/User...ation-r2.mjs:28:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
const standard=async(code,batch,req)=>{const s=await one('INSERT INTO standards(code,title,category) 
VALUES($1,$1,'Governance') RETURNING id',[code]);const d=await one("INSERT INTO disclosures(standard_id,code,title) 
VALUES($1,'D','Disclosure') RETURNING id",[s]);const i=await one("INSERT INTO 
items(disclosure_id,code,requirement,import_batch_id,priority,esg_class) VALUES($1,'I',$2,$3,'high','governance') 
RETURNING id",[d,req,batch]);return{s,d,i};};
                                                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

SyntaxError: missing ) after argument list
    at compileSourceTextModule (node:internal/modules/esm/utils:346:16)
    at ModuleLoader.moduleStrategy (node:internal/modules/esm/translators:107:18)
    at #translate (node:internal/modules/esm/loader:546:20)
    at afterLoad (node:internal/modules/esm/loader:596:29)
    at async ModuleJob._link (node:internal/modules/esm/module_job:162:19)

Node.js v22.22.2

```

### migration-r3.log

```text
PASS known U1 readiness accepted but content use refused before U2D
PASS independent inventory refusal unknownProfile preserves exact rows/U1 fingerprint
PASS independent inventory refusal unknownBatch preserves exact rows/U1 fingerprint
PASS independent inventory refusal missingLineage preserves exact rows/U1 fingerprint
PASS independent inventory refusal duplicateLineage preserves exact rows/U1 fingerprint
PASS independent inventory refusal nonGRIReport preserves exact rows/U1 fingerprint
PASS independent inventory refusal duplicateReport preserves exact rows/U1 fingerprint
PASS independent inventory refusal wrongReportLineage preserves exact rows/U1 fingerprint
PASS independent inventory refusal frozen preserves exact rows/U1 fingerprint
PASS independent inventory refusal standardConflict preserves exact rows/U1 fingerprint
PASS independent inventory refusal unknownChild preserves exact rows/U1 fingerprint
PASS explicit targets and self-consistent provenance source digest mandatory
PRE_U2D_BUSINESS_SHA256 2856f4d2fc1bb50bb7b4230eb6c69fdc3bfecbc2cbc892a4f741dc94e01443f9
EXPLICIT_INVENTORY beforeHash=d20462e852415921c526c072da35d970454489b7f5447859b10ac3a21f35a03c itemIDs=1 profileIDs=2 reportIDs=2 membershipIDs=1
PASS deterministic dry-run exact target IDs/lineage/flags/hashes; no credentials/security records
PASS changed expected inventory refused; no metadata or policy/version persists
PASS real DB error after metadata association but before ledger rolls back all bytes/IDs/metadata/policies
MEMBERSHIPS_SHA256 f491e10388e09c55f5552c7a22ce74285eee6329bd75b58c2b54e8a00c16a276
POST_U2D_BUSINESS_SHA256 ecd0d09e560f65da688057d86c5e729732e86f30f401afb6b47c438d565708c7
PASS apply changes only two explicit Profile/report service bindings and one exact GRI mapping; no subscriptions
PASS same content version verifies no-op, no initiative/action mapping repair; missing links remain missing
MIGRATION_QA_TOTAL=17 PASS=17 FAIL=0

```

### extras.log

```text
PASS exact-role raw Profile entitlement independent of empty item mappings and false gap/corrective flags: items0/evaluations0/Profile1 rating2/reportL3
PASS mapping-reassignment probe rolled back, final U2D fingerprint/readiness unchanged
PASS missing GRI catalog refuses inventory before association; U1 fingerprint unchanged
EXTRA_TOTAL=3 PASS=3 FAIL=0

```

## Appendix C. Complete historical 111-file tested source manifest

Captured before the original execution and independently compared unchanged at its final source checkpoint. This is not a current-source snapshot from the report-only resume.

```json
[
    {
        "Path":  ".env.example",
        "Hash":  "69145C2D773454E462D46054EEA646FD29182CB70435F2508EC29583F6DF2F19"
    },
    {
        "Path":  ".gitignore",
        "Hash":  "EB13E93639D4C770F0A28BA670E9F4A922BC20FF1E734BDBE916740B0AE13D74"
    },
    {
        "Path":  "bun.lock",
        "Hash":  "1F6CC073E5944A059DF318E2A261345EEB15FEE3BB8325A6BEB3B423188229F3"
    },
    {
        "Path":  "index.html",
        "Hash":  "BF47CDE4E0A88CE38D482083D0382E799C48C76A923347E724E4D03302301571"
    },
    {
        "Path":  "metadata.json",
        "Hash":  "77E1C60F843F8342B81DCF499608DFFB5FB4B6A0DD1791E8AF5D5FDDFE9F0D56"
    },
    {
        "Path":  "package.json",
        "Hash":  "339663502CD326DCF5E9DC0B1BE5EC2DA6DF1D12D290C855415E79EEED1C3507"
    },
    {
        "Path":  "public/favicon.svg",
        "Hash":  "691ECBCB66D5EC7144D2BAF849C9D21EAEFE1370434061F3CAFA00B7C1C52EEA"
    },
    {
        "Path":  "scripts/b11a-proof.ts",
        "Hash":  "5A7300A41ADA1EFAD858F06571C0984AF3716043C972D6928FE3020869EA932E"
    },
    {
        "Path":  "scripts/b11b-proof.ts",
        "Hash":  "FD79D85EA93AB1CCFF837DBD54AE15BFCB7DEE86421F6B10227D268BC2AFD7CA"
    },
    {
        "Path":  "scripts/b11c-proof.ts",
        "Hash":  "3D7E5C32354B8B8AC7891807C7487E669EF251B309E03E4E66750EC9079D9D7B"
    },
    {
        "Path":  "scripts/b16-proof.ts",
        "Hash":  "ADA8C1E410D33F28657E55E387341F7608736C4ED2429CC048D5F459E856F8D5"
    },
    {
        "Path":  "scripts/ge-provision-proof.ts",
        "Hash":  "4CB3A569635695632C08C5567890B3505B015B99A55884924C3CFC7B463E53C0"
    },
    {
        "Path":  "scripts/json-error-proof.ts",
        "Hash":  "313D8D49E053ADADF1482BE15CBB1BFD0EF29BB58283650AD38208081A0461DA"
    },
    {
        "Path":  "scripts/submit-gate-proof.ts",
        "Hash":  "42929D3969BC2FDA23FC322CDC5C863712202F5CE58F8EE24E5E95F1319AFC20"
    },
    {
        "Path":  "server.ts",
        "Hash":  "04BEF6BBB37CF132EF96B1F4AB03957FC70B862841FE66AEB47CADBED3CD7FA1"
    },
    {
        "Path":  "src/App.tsx",
        "Hash":  "988C6BFA3F44687DEFD0E9F3CCE348D583A57958F665BF8564BBD41B9A3250AF"
    },
    {
        "Path":  "src/components/DemoBanner.tsx",
        "Hash":  "FBDB4D3D8307667EEEBBCAABFAB0FD6391A743A6F26C2DCF88AD59154B695757"
    },
    {
        "Path":  "src/components/Header.tsx",
        "Hash":  "2349B2A2A95BBAD1C62E8E330116B625404E1286BEFD141F1A652A16B5ED66ED"
    },
    {
        "Path":  "src/components/Sidebar.tsx",
        "Hash":  "AF0B57B5056E8C1ACCEB55EDE5E13A9210205758B0F264401B02FAFCE6B5532B"
    },
    {
        "Path":  "src/context/AuthContext.tsx",
        "Hash":  "F75D3F4720BA6B619E04955714D15A56FA015CFA0A251F8F229836BC1488D283"
    },
    {
        "Path":  "src/db/index.ts",
        "Hash":  "9838C78B34AD877E9A645EF0877F498AF293E7708D93A06988684B3BD318F8C9"
    },
    {
        "Path":  "src/db/schema.sql",
        "Hash":  "B141A3D8FCBB60625EE984D31EB15BCBC03EE46F2C8AB5E8F7965A8012511C59"
    },
    {
        "Path":  "src/i18n/LanguageContext.tsx",
        "Hash":  "13BE199FCC0E9F747D98290C0708BF2DA3479ED8980E0F6D3DA722A0EE747130"
    },
    {
        "Path":  "src/i18n/translations.ts",
        "Hash":  "AB892DED30B75342417D871D3B586A09CC5E11A51E956AEE1952E7F6A0F71A19"
    },
    {
        "Path":  "src/index.css",
        "Hash":  "0C926CF21486CDCB2D25D4C529611F63A277A2CCBADFFDE9415E1EB37A27EA71"
    },
    {
        "Path":  "src/lib/actions.test.ts",
        "Hash":  "ACA11A0C51A700859105C163F9C2D8DD560A828FED4A0763AFF49EF9D82874BE"
    },
    {
        "Path":  "src/lib/actions.ts",
        "Hash":  "B4D4E5A5B56D236C77360C8085D878D7536698B732D00B535B52C0237DF75BFC"
    },
    {
        "Path":  "src/lib/approvalChain.test.ts",
        "Hash":  "40B936F667AE541F4EF7FDCA75C6FB2F1641E8EF3466C27BD04DCE010F1F2B6A"
    },
    {
        "Path":  "src/lib/approvalChain.ts",
        "Hash":  "B5987FF9A108F0D55F32E7C3B8A93FC8A839A1122343AF143A319293C7F2B046"
    },
    {
        "Path":  "src/lib/b11b.test.ts",
        "Hash":  "BA47C92F0C9FA329E7F14843AF2F87E3AC535995EE86D9D60482B7247C2DD516"
    },
    {
        "Path":  "src/lib/b11b.ts",
        "Hash":  "265DA46F84ACBA7DD525650A567AB149696BDB6924E955FE668EEB6A996F6469"
    },
    {
        "Path":  "src/lib/b16.test.ts",
        "Hash":  "D8BD09CC209B1D9AD9CD605776210BF41F57A6149D0F1C489865005C1B708127"
    },
    {
        "Path":  "src/lib/errorHandler.test.ts",
        "Hash":  "EA1D5CACFDC5B6CF76B4B4413DB3F1B5EBD354C0ACF79F11C1E4EED78E7E9545"
    },
    {
        "Path":  "src/lib/esgProfile.test.ts",
        "Hash":  "86E5CFA2B9441B331D026C6CF3E896F1BB135D0B863AE445B01A3C70A477ED21"
    },
    {
        "Path":  "src/lib/esgProfile.ts",
        "Hash":  "8BC327503F81B2DB4AE6DF0BB00A3169553B4DFD9E4CAC870DF179772829F2A5"
    },
    {
        "Path":  "src/lib/griParser.test.ts",
        "Hash":  "0AF4CEE5D0E1FC9B6E6C680903BAA9CD38F865577470609E7E4475F4E55A00D5"
    },
    {
        "Path":  "src/lib/griParser.ts",
        "Hash":  "523BCF0381DD6E3F152DE51AB8E6C8EC3E2726001BA859E5814E87EBC75C1F9B"
    },
    {
        "Path":  "src/lib/idleTimeout.test.ts",
        "Hash":  "70D25864F9785C5FC23FFACDA1F7B365E30ADAF3152D95DC34507C3F007DBC53"
    },
    {
        "Path":  "src/lib/idleTimeout.ts",
        "Hash":  "342CEE2D386E8104D139B88BB406F747C01DFC31D9C6E96C7BAC79B0F926EC75"
    },
    {
        "Path":  "src/lib/initiatives.ts",
        "Hash":  "F5D0C7D1EA8191158E5419E680740199F2E3C9BBE56834F22FC00E7BD8225602"
    },
    {
        "Path":  "src/lib/password.test.ts",
        "Hash":  "FC202E912282B58FFED1EC01E5BA8859F62038324E8CCEAE5A930A5BE7547D91"
    },
    {
        "Path":  "src/lib/password.ts",
        "Hash":  "F03CD4822093C5D0DF9AC3D2C9DA37E6415A7FCEAA36503B371CCFFC0175F6EB"
    },
    {
        "Path":  "src/lib/reports.test.ts",
        "Hash":  "F248E98BFEB7FBFA3ABF2A91052B82ADFAF90AA6F3EEEBB7426200425787B51A"
    },
    {
        "Path":  "src/lib/reports.ts",
        "Hash":  "4935FB2DA27C92619A976D53466AF3DBAA308834B6E66AFC529FEFC032C01D13"
    },
    {
        "Path":  "src/lib/routeGates.test.ts",
        "Hash":  "79EC9C277856AEE548C213A04C52128A282D260B8CFC087144A77E4FADB745BF"
    },
    {
        "Path":  "src/lib/rtl.test.ts",
        "Hash":  "4284FA332361744313A88E047790EA3640356F39138E209A78D261A06581BD96"
    },
    {
        "Path":  "src/lib/scoring.test.ts",
        "Hash":  "6D1BE9C4D8B13836D45C541D0067726732BD9CB6FC200BEB1554E5AC13547A00"
    },
    {
        "Path":  "src/lib/scoring.ts",
        "Hash":  "7FDBA8247801BD1C40A611418CD9119770A3AC271088A83C46FD4E345A291776"
    },
    {
        "Path":  "src/lib/submitGate.test.ts",
        "Hash":  "AFD4E2AD6DA8B2D944D1E7C48615F01C02C88C7442FD88F671A2A0142C515D7F"
    },
    {
        "Path":  "src/lib/taxonomy.test.ts",
        "Hash":  "9F4EA4656E6C6C71230BE0826BCC04360872F46F13D82F3EDD63797DD314832A"
    },
    {
        "Path":  "src/lib/taxonomy.ts",
        "Hash":  "494AA1BF5A06648910DF9EF18FE93B6F957F4AD4C0AC8F0AC84A77CCCE8B4540"
    },
    {
        "Path":  "src/lib/tenantAccess.test.ts",
        "Hash":  "7F4573832BAAB80A4914EABFF6660C2CFF782748F9A2515188D776BB69DB4059"
    },
    {
        "Path":  "src/lib/tenantAccess.ts",
        "Hash":  "2581893782B422BCE010DB203C1C973B20AE3314C5542DB2CD79F1E9F12A7E74"
    },
    {
        "Path":  "src/main.tsx",
        "Hash":  "47AE3E53E64C565EE24467E34EC314BE9B42A56BA76B02CED3BD8E923675B43C"
    },
    {
        "Path":  "src/server/auth.ts",
        "Hash":  "04403DA24FEC5855887794B46B767E32412928B68EAF89B811D68EA5A8F621A8"
    },
    {
        "Path":  "src/server/errorHandler.ts",
        "Hash":  "093018C547854453CE1C548484FF9387A4047A4C5ED83C9B1200FC1F8F868CAA"
    },
    {
        "Path":  "src/server/routes.ts",
        "Hash":  "FA8DD328AE1337DC16FB15F75C4579E7C4A4335ECDDFFE1F43381C3972704A38"
    },
    {
        "Path":  "src/server/routes/_shared.ts",
        "Hash":  "22E4FD4FA5C6559CAA7AF67A5D411F6B0EEEAFCC222A32FC9B84351F79A8B225"
    },
    {
        "Path":  "src/server/routes/actions.ts",
        "Hash":  "40B9B88192B4404C4C467BBD55F2D08765BDEED47E3470C3F04CFE2C2A48910E"
    },
    {
        "Path":  "src/server/routes/admin.ts",
        "Hash":  "9BA1667991423DD72AC1251D5668F6D7F4C4A41367AADB05559FA7CF87B894C0"
    },
    {
        "Path":  "src/server/routes/audit.ts",
        "Hash":  "25A913E23354E0E58A63BC7A50AEB312A3DDDC75E9722422CA0D3C324CD12DA9"
    },
    {
        "Path":  "src/server/routes/evaluations.ts",
        "Hash":  "FD2FAA28A121482AB180289C17F209592903740ABC0232BFA741F61AC31EF312"
    },
    {
        "Path":  "src/server/routes/gri.ts",
        "Hash":  "AC5BC26E09AA1AAFA8D0E8DD2FA2E8F38BE3D78F83DF2DC7EAAA8ED1A27A7CD0"
    },
    {
        "Path":  "src/server/routes/initiatives.ts",
        "Hash":  "E5ABB329A86D0AFE3DFA3E0529E6E8F552120520C70BA611229BD98AAD30275B"
    },
    {
        "Path":  "src/server/routes/notifications.ts",
        "Hash":  "D98ED0191F6C1575D1BA8627633B770BCC258F824C80FB4718B1788CDD05CFE1"
    },
    {
        "Path":  "src/server/routes/reports.ts",
        "Hash":  "0C62D292174DD13AF6A878F24B3E3F91ABE0AEA56469D5E96FDEBBB3F8F9D5D7"
    },
    {
        "Path":  "src/server/routes/session.ts",
        "Hash":  "0084D8F35550DBAFCF0EE6137077ED7CEA18FC832B99E53E87BED5CEE7E8F0E0"
    },
    {
        "Path":  "src/server/routes/storage.ts",
        "Hash":  "007D93FA99E7C5FDEB717864D39733997FD6199A177F417FDD0563CE493F8A94"
    },
    {
        "Path":  "src/server/routes/system.ts",
        "Hash":  "3871C429736CD52DDD26E7C26A5DBF2025F3CBDD5F31DE7F94D371E7FD7DCA97"
    },
    {
        "Path":  "src/server/taxonomy.ts",
        "Hash":  "F4D56FA299BF8AC2F9F39EA80DECCF69FD0172BB1234F7EA9CFD55B7A48713FD"
    },
    {
        "Path":  "src/views/ActionsView.tsx",
        "Hash":  "956BCE4083C589417151ACA0E14C57153F471C8DBF7702DEF523DFD9A6ED0105"
    },
    {
        "Path":  "src/views/AuditLogView.tsx",
        "Hash":  "1188EA82280B658688B6167BE2E74A0A6383AB4E1E6505D8E4D298D9736075DD"
    },
    {
        "Path":  "src/views/ClientDashboardView.tsx",
        "Hash":  "8F34872734AA4FA920FCCDC7F674DE20918122E75C7FDB63993D25542EC5836F"
    },
    {
        "Path":  "src/views/ClientDetailView.tsx",
        "Hash":  "80DB84371896E6C09BED200312E534F6A5B800915FCDE936AF2461C97F7D951A"
    },
    {
        "Path":  "src/views/ClientReviewView.tsx",
        "Hash":  "6128A259DEA3A1C2987D81E2C8B10717787EFE3EED5A18AF03ECFEEB15B609CE"
    },
    {
        "Path":  "src/views/DashboardView.tsx",
        "Hash":  "8E4283AEFD63BB5658483FEB542B9BBE5B2E824143BA88AAFE5EEF0AEAFEDEBD"
    },
    {
        "Path":  "src/views/EsgProfileView.tsx",
        "Hash":  "F178A6C77FAE7DBBC215F9829CC0B466577B8F50818312512C429CD63DC56327"
    },
    {
        "Path":  "src/views/EvaluationPanel.tsx",
        "Hash":  "5C57EAECC8FCCA3ECC7A5C61CACFE11FE580BBA9543D3C4A17409C9FFF482BBF"
    },
    {
        "Path":  "src/views/GapAnalysisView.tsx",
        "Hash":  "3365BD67FB281B71CC1F115EDB5DB0D41C1964798E89550C2715C79378992325"
    },
    {
        "Path":  "src/views/GeFinalView.tsx",
        "Hash":  "4A6C15A2301A3DD7588C898D1481237F8700B6C34174254724F500EB21CD0338"
    },
    {
        "Path":  "src/views/GeOverviewView.tsx",
        "Hash":  "58F30580C183FF1E992CB9679FFD9F89B0B6D3F46F52F763DC20DC106179D11E"
    },
    {
        "Path":  "src/views/ImportGRIView.tsx",
        "Hash":  "A340D766BD3F6FFEB9C7A14F8BDAD1E329A27F5B3FDF8013E204B1CF3464E98E"
    },
    {
        "Path":  "src/views/InitiativesView.tsx",
        "Hash":  "670A8E2A2638A180805D2C23658EC76F98D1392197B1CCB0B1D9DC7E1343C4CB"
    },
    {
        "Path":  "src/views/LoginView.tsx",
        "Hash":  "FBFC80E5C441AA40B5131E92A49A8C893AF010BE3071445FDEAC9C8F29C68DA9"
    },
    {
        "Path":  "src/views/NotificationsView.tsx",
        "Hash":  "CEE75F49B266BEA1097ADDEB015586B0D5C7BA72AFDF115A3112EEC204B1D523"
    },
    {
        "Path":  "src/views/ReportsView.tsx",
        "Hash":  "AC267549EA2B611F256D40252CF1C016B0266C1ED17A670CD0B6B2663FCE5CE3"
    },
    {
        "Path":  "src/views/ServicesManage.tsx",
        "Hash":  "45281A23912C75F5739B7F57B8DDEBB96137CA7CEECBF4B11A2E03C56F66A792"
    },
    {
        "Path":  "src/views/SettingsView.tsx",
        "Hash":  "C717D56CBCBBF7B5078E74310B3B9347E9A1E7DAFD8F786E5D826EF8CA85EA94"
    },
    {
        "Path":  "src/views/SetupView.tsx",
        "Hash":  "08CBAD918E51115AAC5F6EFB3104E5963B0120CD30D0ADB46B9D92458F1238F7"
    },
    {
        "Path":  "src/views/StaffListsView.tsx",
        "Hash":  "15D95387B42BF3DA6FD61BCA0F4D8DC9EF93509F771093EA5EB15508266D77CD"
    },
    {
        "Path":  "src/views/StandardsView.tsx",
        "Hash":  "9F759F6D2E6CEA5DBF4894582EFFB1F3705805FB6A0335BB6F97B2B3C148FDE3"
    },
    {
        "Path":  "src/views/TaxonomyManage.tsx",
        "Hash":  "4AEFFBD1ECE4738B72AC2F7CDF1EC2F16A2570CFDDE6B4560C0029B6826D2813"
    },
    {
        "Path":  "tsconfig.json",
        "Hash":  "C55D1FB1FEBD860EFB07D3968371A7324E17B015FB48CFCAA7D17C2427E4C1E7"
    },
    {
        "Path":  "vite.config.ts",
        "Hash":  "DC221BABFF2C70C1A90F06A8B0E51BC8C5D5DBE4AA92691D80C6D1D6C86A4430"
    },
    {
        "Path":  "scripts/b17-scope-proof.ts",
        "Hash":  "F6B7C6412F945B5D2ACC5FCF3D8ED4F380DFA5385F26D637A1794CC133466B59"
    },
    {
        "Path":  "scripts/b17-workspace-proof.ts",
        "Hash":  "131E6D1414F4D89768011B11DEF02F210F3326CE31DBD8FB2344D92FA6C82652"
    },
    {
        "Path":  "src/db/b17-content.sql",
        "Hash":  "1A678D3643DBC81F4E93EB4021CA471538E8FEE7344C356353067F95E372A01B"
    },
    {
        "Path":  "src/db/b17.sql",
        "Hash":  "ACE11265D876B6F18229DD62EFA1DB693CD8DF00ECD0EA6012B448694406D8D6"
    },
    {
        "Path":  "src/db/b17ContentMigration.ts",
        "Hash":  "DDB940166912EB5EFC49B25D023DCCEB53898E84A30F4752E68CF439D471028F"
    },
    {
        "Path":  "src/db/b17Readiness.ts",
        "Hash":  "8755E22813808A9A8468CC8C65C7384BA11AA999D8AF15B6C175A0745337D71A"
    },
    {
        "Path":  "src/lib/b17ScopeProof.test.ts",
        "Hash":  "411096D7733189A0FB9D9B19C6A6264F18A69033095E1912A59EDFCD5186168E"
    },
    {
        "Path":  "src/lib/capabilities.test.ts",
        "Hash":  "E7046FB58B6A415F08944B4EC7C14F81123D52D46194B63EB1FC3806C1D74E07"
    },
    {
        "Path":  "src/lib/capabilities.ts",
        "Hash":  "2F24A5D41F90688BB901034D0648BC436B3B7E065AAB4680AED65920459867AE"
    },
    {
        "Path":  "src/lib/jsonInput.test.ts",
        "Hash":  "5ABA35F938C74279B2CDC5B9C155E6841A18A36B96D077A2E1D6DEF46B911BB6"
    },
    {
        "Path":  "src/lib/scope.test.ts",
        "Hash":  "356AA5CFA7FCD51FB77E10BC699C31AE93F10E218BC028DCA741EABCC05BA3EB"
    },
    {
        "Path":  "src/lib/workspace.test.ts",
        "Hash":  "5CFD00E6E522B49AABCB40C91EFC8FDD1D8B803E1763B37878FD06CAB8A02A4D"
    },
    {
        "Path":  "src/server/access.ts",
        "Hash":  "191F60C2844DD849B2CBBA43EE08AFD42D52D6AB89F2594C9D8E44DB458794F2"
    },
    {
        "Path":  "src/server/accessRegistry.ts",
        "Hash":  "AF94FC365E6C2114DBB13FABC726E95139415CD07DFC72CBF6CAEC41E1E396EA"
    },
    {
        "Path":  "src/server/jsonInput.ts",
        "Hash":  "FF985BAA76089B30030856AAA8046A23C2F2B541473DC55B0279C44E18C764AA"
    },
    {
        "Path":  "src/server/scope.ts",
        "Hash":  "AAC1014B6A85602A44D809246C916FD126A9C7162661ED1A2607836C45D3841B"
    },
    {
        "Path":  "src/server/workspace.ts",
        "Hash":  "33A04A5D79C2E87AEFDBF3731A7F61B60B9AFC9E9CAD56F21AAB32EB171017C6"
    }
]

```

## QA signature

QA Agent — Execution Mode. Report persisted: 2026-11-12T10:22:42.8848187+03:00.
Scoped historical evidence only; PARTIAL / RECHECK REQUIRED for ongoing U2D changes. No final application verdict.

---

## Appendix D. Third independent QA recheck — current source (2026-11-12)

**Scope:** current source/diff/hashes after assigned bounded Shield fixes. Existing report sections above remain historical; this appendix supersedes only their applicability to the current hashes.

### D1. Current source discovery and exact fingerprints

Independent git status, git diff --stat/name-status, full diff and untracked discovery were rerun. HEAD remains c4ee8bccb87b53fbc957861178832029cde769be. Compared with the prior historical manifest, six files changed and one file was added; all other measured source/configuration/test files were unchanged.

| File | Current tested SHA-256 |
|---|---|
| `server.ts` | `04BEF6BBB37CF132EF96B1F4AB03957FC70B862841FE66AEB47CADBED3CD7FA1` |
| `src/db/index.ts` | `9838C78B34AD877E9A645EF0877F498AF293E7708D93A06988684B3BD318F8C9` |
| `src/db/schema.sql` | `B141A3D8FCBB60625EE984D31EB15BCBC03EE46F2C8AB5E8F7965A8012511C59` |
| `scripts/b17-scope-proof.ts` | `6B08A780530B834A781BC9693AF07AC4658D43783ED2DE912081B458D1C07D71` |
| `src/db/b17-content.sql` | `D933C91EB721815E4C4043719910D4B1E4C4CCD4C7641DFD94B83F8280F8B860` |
| `src/db/b17.sql` | `ACE11265D876B6F18229DD62EFA1DB693CD8DF00ECD0EA6012B448694406D8D6` |
| `src/db/b17ContentMigration.ts` | `DDB940166912EB5EFC49B25D023DCCEB53898E84A30F4752E68CF439D471028F` |
| `src/db/b17Readiness.ts` | `A89ED5DCAD06E8EDB2B0F87D067A86CE2F8783A4B9691EE962769F731E12B3F9` |
| `src/lib/b17ScopeProof.test.ts` | `F23D57FCC4AE7DC0FD3625AC8F325308CA10676A802EC3538C79566DDE8AC22C` |
| `src/lib/b17ScopeSecurity.test.ts` | `69878DC96EAF78060D8C9EE9E20E5506DB2AE80A9A278D94D328A809BD896FEA` |
| `src/lib/scope.test.ts` | `356AA5CFA7FCD51FB77E10BC699C31AE93F10E218BC028DCA741EABCC05BA3EB` |
| `src/server/access.ts` | `191F60C2844DD849B2CBBA43EE08AFD42D52D6AB89F2594C9D8E44DB458794F2` |
| `src/server/accessRegistry.ts` | `AF94FC365E6C2114DBB13FABC726E95139415CD07DFC72CBF6CAEC41E1E396EA` |
| `src/server/scope.ts` | `86C3AEAC206068041F644872167816A05D4EE695D685524FDF8843F0BBACFFEC` |

The current diff still shows the already-local U1/U1V substrate plus U2D content/ACL/ownership changes. The Shield report was not read or used as evidence. No executor counts or claims were accepted without independent execution.

### D2. Completed current-source checks

| Check | Actual result |
|---|---|
| 
pm run lint (	sc --noEmit) | **PASS**, exit 0 |
| 
pm test | **PASS**, exit 0; independently observed TAP: 149 tests, 0 failed, 5 suites, 0 skipped/cancelled |
| Current source static inspection | Owner/ACL readiness now checks SECURITY DEFINER, explicit ACL, owner/table/session principal, non-superuser/non-BYPASSRLS and exactly one owner EXECUTE grant. 17_content_fact is revoked from PUBLIC and granted only to CURRENT_USER in the same content transaction. Employee evaluation ownership now requires retained first-pair evidence, not evaluator current department alone. scopedEvaluations additionally applies the retained-ownership fact for employees. |
| Current source hash comparison before/after tests | Source manifest captured before testing; tests completed without source edits. Report-only continuation does not substitute current hashes for historical hashes. |

### D3. Independent lifecycle / ownership recheck — FAIL

A separate local PG18 fixture was created with a non-superuser, non-BYPASSRLS runtime role. The fixture attempted the requested ordinary own-department workflow with realistic row updates mirroring the existing handler contract: multiple draft saves, version advancement, submitted → department-approved, and scoped history reads.

**Functional FAIL:** after the second draft save, the ordinary own-department evaluation ceased to satisfy the current retained-ownership predicate and was no longer returned by scopedEvaluations. The same happened after submit/approval and own correction because the current predicate requires both evaluation and answer ersion=1, equal timestamps, previous_score IS NULL, empty correction history, and exactly one answer/assignment.

This is not an arbitrary hidden/foreign case: it is the normal own-department lifecycle explicitly required by the recheck. Existing handler SQL advances versions and appends correction history; therefore the current predicate rejects ordinary post-save/submitted/approved/corrected pairs. The repository proof’s “simple own pair still readable” assertion uses a specially seeded initial pair and does not exercise this repeated-save lifecycle.

Classifications retained separately:
- Initial ordinary own pair at version 1: readable before lifecycle mutations.
- Own second save / submitted / department-approved / correction: **FAIL** — not readable after expected version/history advancement.
- Transferred evaluator, foreign department, multi-department shared pair and legacy unknown history: **NOT RUN to completion in the independent fixture** because the fixture stopped before those assertions; repository proof’s corresponding negative cases are recorded separately and are not substituted for this missing independent run.
- Missing provenance case: **NOT RUN** for the same fixture reason.

### D4. ACL / readiness / inventory checks

- Repository current proof was **NOT RUN** in this recheck because its fixture contains DELETE FROM assignments for ownership cases; destructive SQL remains prohibited by the standing QA constraint. Its prior run is historical only and not re-used as current evidence.
- The current source’s untrusted-principal spoofed-GUC/ACL denial path was inspected statically but **NOT independently executed** in this recheck; no PASS is claimed for it.
- Inventory rollback/idempotence/no-regrant current-source execution was **NOT completed** independently in this recheck; no PASS is claimed for it.
- The lifecycle fixture’s repeated disposable setup failures (schema initialization order, bootstrap target UUID/context, container readiness and module resolution) are QA instrumentation failures, not application failures. They are preserved in TEMP logs and are not counted as tests.

### D5. Current verdict

**FAIL — functional lifecycle regression on current source hashes.** The required ordinary own-department positive read path fails after normal version/history advancement. This must be fixed before any acceptance of the current U2D source. Owner/ACL readiness changes remain statically inspected but not independently runtime-verified in this recheck.

No application, cloud, .env, dependency, Git commit/push, deployment or production operation was performed. No final application/domain acceptance verdict is issued.

### D6. Evidence artifacts

Current-source manifest, suite logs and lifecycle attempt logs are retained under C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2d-qa\sol-20261112-recheck03. The existing container 17-u2d-sol-20261112-recheck is owned by this QA run and must be stopped after report persistence.

**QA signature:** third independent QA recheck, report append only. Verdict: FAIL for ordinary own-department lifecycle readability on current hashes; other current checks unverified where noted.
**Cleanup after report persistence:** all own containers named `b17-u2d-sol-20261112-recheck*` created during this recheck were stopped; pre-existing unrelated containers were left running.

---

## Appendix E. QA round-3 recheck — round-4 authorised source (2026-11-12)

**Disk-is-truth note:** this file already contained Appendix D (prior lifecycle FAIL against the pre-round-4 snapshot) when this session began; it is preserved verbatim as history. This new section records the QA round-3 execution requested by Tera against the **round-4 authorised source** (`prototype/TASK-PROTO-B17.md` §13 round-4 authorisation, read in full). Appendix E supersedes Appendix D's applicability **only for the hashes below**; it does not delete or rewrite prior results. The concurrently authorised `security-reports/B17-U2D-fix-review.md` (Shield) was not read and supplied no test evidence.

### E1. Independent current-source discovery

HEAD/base remained `c4ee8bccb87b53fbc957861178832029cde769be`; no fetch/network Git action. Manifest of **112** source/config/test files (review/report directories excluded) captured before testing. Diff against the last tested snapshot (Appendix D) showed **exactly 4 changed files, 0 added, 0 removed**; `src/server/scope.ts` was unchanged:

| File | Round-4 tested SHA-256 |
|---|---|
| `src/db/b17-content.sql` | `B99C92775E99BBA33AA916A7E5CBDE11A7F82A513C3C776B6D9EE63F72CDB9DE` |
| `src/db/b17Readiness.ts` | `1424F5F250D75CAF2552D6DC3672C81F1D8F315B8F4CD0E0EEA5A89F9670F32E` |
| `scripts/b17-scope-proof.ts` | `ECABA73D09F10E5124DB95BAF0F06BEC64922732AB47E12359D68F71F3AFF727` |
| `src/lib/b17ScopeSecurity.test.ts` | `857F265001C753D8E28F3532754476A560D1BE6E5125C62C2B7385462BA4E122` |
| `src/server/scope.ts` (unchanged) | `86C3AEAC206068041F644872167816A05D4EE695D685524FDF8843F0BBACFFEC` |
| `src/lib/b17ScopeProof.test.ts` (unchanged) | `F23D57FCC4AE7DC0FD3625AC8F325308CA10676A802EC3538C79566DDE8AC22C` |
| `src/lib/scope.test.ts` (unchanged) | `356AA5CFA7FCD51FB77E10BC699C31AE93F10E218BC028DCA741EABCC05BA3EB` |

Static reading of the round-4 delta: the `evaluation` ownership fact now proves ownership **only** from exactly-one answer in the reader's own department + `answer.submitted_by = evaluation.evaluator_id` + a retained assignment for that department; the removed gates (`version=1`, timestamp equality, `previous_score IS NULL`, empty correction history, evaluator current department, single-assignment count) are absent from both the read and writable facts, per §13 round-4. `B17_CONTENT_SHAPE` moved to `525be74c50497746e99da48d0ab9bf80`. Static text alone was not treated as proof.

### E2. Executed results (all against the hashes above)

| Check | Actual result |
|---|---|
| `git diff --check c4ee8bc` | PASS, exit 0 (LF/CRLF warnings only) |
| `npm run lint` (`tsc --noEmit`) | PASS, exit 0 |
| `npm test` | PASS, exit 0 — independently observed TAP: **149 tests, 149 pass, 0 fail, 5 suites, 0 skipped/cancelled** |
| `npm run build` (`vite build`) | PASS, exit 0; produced gitignored `dist/` only (explicitly requested this round) |
| QA-owned independent harness `round4.mjs` on fresh disposable PG18 | PASS, exit 0 — **37 checks passed, 0 failed** (`R4_TOTAL=37 PASS=37 FAIL=0`) |
| Source manifest before vs after all runs | PASS — **112/112 identical**, no source drift during testing |

Harness environment: QA-owned `postgres:18` container (unique name, stopped afterwards), role `b17_qa_runtime` = `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`, `current_user=session_user`, `row_security=on`, all public tables ENABLE+FORCE RLS, runtime role is table owner; second login `b17_untrusted` (no memberships). Empty-install schema → fixtures seeded **before** U1/U2D activation under the trusted ge fixture context (mirroring repository proof ordering) → `applyB17Offline` → inventory/apply. No ambient `DATABASE_URL`/PG* variables (deleted at process start), no dotenv, no `.env`, loopback-only, no cloud, no application writes, no commit/push.

### E3. CRITICAL functional check — normal own-department lifecycle (the reason round 4 exists)

All executed **readable AND writable** post-activation for the own-department employee (`scopedEvaluations` returned exactly 1 row, `assertEmployeeEvaluationWritable` resolved, raw `b17_content_fact('evaluation',…)` = true):

| Case | Result |
|---|---|
| STAGE1..STAGE5 (pairs frozen at eval/answer versions 1,2,3,4,5 incl. submitted and approved states) | **PASS** — all 5 readable + writable |
| SEQ literal chain `save(v1) → resave(v2) → submit(v3) → dept-approve(v4) → author correction(v5)` | **PASS** — ends eval **v5** + answer **v5**, `previous_score=50`, `score=100`, `status=approved`, 1 correction-history entry, all readable + writable |
| STAGE5 values exposed | **PASS** — score 100, previous_score 50, eval version 5, answer version 5/approved, history entry `reason='Author correction'` |
| STAGE1 pristine values | **PASS** — version 1, previous_score null, empty history |
| CLEAN control pair | **PASS** |
| BOTH (both departments assigned, only d0 answered) | **PASS** — answering department keeps its work; second assignment alone does not deny |
| TRANSFER (evaluator moved to d1, retained d0 answer) read by d0 | **PASS** — no hiding after a member transfers |
| FRESH (assignment only, no pair) | **PASS** — writable guard allows the initial save; reads empty |

This directly resolves the Appendix D functional FAIL: ordinary version/history progression no longer hides an employee's own work.

### E4. Security negatives — all denied, no values leaked

For each case: helper `scopedEvaluations` returned `[]` (or `scope.not_found` where the item itself is unauthorised), raw `SELECT * FROM evaluations` under the employee work context returned **0 rows**, raw `b17_content_fact('evaluation',…)` = **false**, and `assertEmployeeEvaluationWritable` threw **409 `scope.shared_ambiguous`** (404 `scope.not_found` where the item is invisible). No score/justification appeared in any returned payload.

| Negative | Result |
|---|---|
| Second-department answer (d0 + d1 answers) | **PASS — denied** |
| No-answer evaluation (orphan evaluation) | **PASS — denied** |
| `answer.submitted_by ≠ evaluation.evaluator_id` (same department) | **PASS — evaluation denied**; observation: the own-dept answer row itself remains visible under the separate answer policy (1 row), which is not an evaluation-value leak |
| No retained assignment | **PASS — denied** (item invisible, fact false) |
| reader-dept ≠ answer-dept (ANSD1 answered in d1, read by d0) | **PASS — denied**, no values |
| Foreign-department reader (d1 reading d0-answered BOTH) | **PASS — denied**, guard 409 |
| Transferred colleague (now d1) reading retained d0 TRANSFER row | **PASS — denied** |
| Positive control: d1 employee reads its own ANSD1 (score 0) + writable | **PASS** — isolation holds in both directions |

### E5. ACL/owner readiness, untrusted SQL, inventory, no-regrant

| Check | Result |
|---|---|
| Untrusted principal: `has_function_privilege(… EXECUTE)` on `b17_content_fact` | **false** — PASS |
| Untrusted spoofed GUCs (session-set tenant/actor/mode/role/dept/purpose) → direct helper / `b17_item_visible` / raw `SELECT … FROM evaluations` | **all SQLSTATE 42501** — PASS (even after `GRANT SELECT ON ALL TABLES` to untrusted, so denial is policy/definer driven, not base privilege) |
| `GRANT EXECUTE … TO PUBLIC` then readiness | refuses `b17.content_authority_drift`; rollback restores — PASS |
| `GRANT EXECUTE … TO b17_untrusted` then readiness | refuses `b17.content_authority_drift`; rollback restores — PASS |
| Effective policy drift (`CREATE POLICY … ON clients`) | refuses `b17.schema_drift`; rollback restores — PASS |
| `SET LOCAL row_security=off` | refuses `b17.runtime_role_unsafe`; rollback restores — PASS |
| Inventory dry-run, run twice | deep-equal deterministic; U1 shape `4b4e39e3a13eae0d336d30fa94bbf52f` + 4-table business snapshot unchanged; no password/session/tab/handle fields — PASS |
| Ambiguous provenance (unknown profile batch) | refused `lineage_ambiguous`; state unchanged — PASS |
| Unevidenced child (source CSV missing one item) | refused `item_source_unknown`; state unchanged — PASS |
| Real DB fault at ledger INSERT after metadata work | SQLSTATE **22012**, full rollback to U1 state — PASS |
| Apply → `applied`; re-apply → `verified` (idempotent) | PASS; effective shape **`525be74c50497746e99da48d0ab9bf80`**; ledger exactly `[B17_U1, B17_U2D]`; `verifyB17Content` + `assertB17Ready` green |
| Apply touched only authorised metadata | profile→GRI, report→GRI, exactly one `(GRI,S1)` mapping; `service_initiatives` = 0; A membership `show_gap=false/show_corrective=false` preserved (not defaulted true) — PASS |
| No regrant | tenant B still has **zero** GRI links (read under entitled consultant context of B); A flags preserved — PASS |
| Old schema replay | `runMigrations()` → `false`; direct `schema.sql` → `schema.empty_install_only`; shape unchanged — PASS |
| Current proof opt-in guard (`guardedScopeProofUrl/Urls`) | absent opt-in, ambient DSN, non-loopback, `postgres` user, missing/different-port untrusted URL all rejected — PASS |
| Final business snapshot | unchanged since pre-inventory; no `qa_%`/`b17_inventory%` policies remain — PASS |

### E6. Instrumentation failures and deliberate exclusions (not application failures)

| Event | Classification |
|---|---|
| Harness attempt 1: readiness loop broke during the official image's temporary init server, `psql` hit the gap before the real server started | **QA instrumentation failure** — stopped before any DB object existed; own container stopped; fixed with stable-readiness + idempotent retried provisioning. |
| Harness attempt 2 (`round4-attempt1.log`): 36/37 — metadata check queried `esg_profile` on the RLS connection without tenant context (`undefined.service_id`) | **QA instrumentation failure** — not an application failure; the apply itself had already succeeded. Corrected to read under the entitled consultant context; full clean re-run then 37/37. Both logs preserved. |
| Repository `scripts/b17-scope-proof.ts` not executed | **Deliberate exclusion**: its fixture still contains `DELETE FROM assignments` (destructive SQL prohibited by the standing QA constraint). Its round-4 lifecycle/ownership/ACL assertions were instead covered by QA's own non-destructive harness above. Its URL-guard functions were executed directly. |
| Business endpoints / full domain workflow / UI / production | **NOT VERIFIED / out of scope** — legacy business routes remain UNACTIVATED by design; no final application or acceptance verdict is issued. |

### E7. Verdict

**PASS — round-4 source on the executed scope.** The Appendix D functional FAIL (own-department row hidden after ordinary save/submit/approve/correct progression) is **resolved** on the round-4 hashes: all lifecycle stages v1–v5 remain readable and writable, while transferred/parallel/missing-provenance/signature-mismatch/foreign rows are denied with no values leaked; untrusted spoofed-GUC, ACL/policy/row-security drift, inventory rollback/idempotence and no-regrant all held. Lint, 149/149 tests and build passed. This PASS binds **only** to the E1 hashes; any later source change requires a new recheck. No application, cloud, `.env`, dependency, commit or push action was performed; all own containers were stopped; the only repository write by QA is this report.

**QA signature:** QA Agent, Execution Mode, QA round-3 recheck of round-4 source; report append only; prior history preserved.