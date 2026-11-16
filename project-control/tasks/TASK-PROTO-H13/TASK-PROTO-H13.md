# TASK-PROTO-H13 — application-wide theme setting (platform) + ISS-005 token fix

Status: APPROVED — owner instruction 2026-11-16: «في صفحة الإعدادات خيارات لتحديد الثيم للتطبيق، وإذا اختاره مدير المنصة يسري على كل التطبيق».
Base: latest HEAD on `main` (verify `git rev-parse HEAD`; expected `f85b3a5`; worktree clean).
Owner Approval Required: Yes (owner stated the behaviour). Governing: `STYLE_CONTRACT.md` (binding), `PROJECT_STATE.md`.

## 1. Behaviour (owner-decided)
Resolution for a user's effective theme, in order:
1. **Global app theme** (`app_settings.theme`) if set — applies to **all** tenants and platform users.
2. Else the user's **tenant theme** (`clients.theme`).
3. Else `'ge'`.
Platform admin (ge_admin) chooses the global value in Settings: options `auto` (يتبع ثيم المستأجر — default), `ge`, `lime`, `dark`. `auto` = store NULL.
Tenant theme writing remains platform-only via `PATCH /clients/:id` (D-H01-01 unchanged).

## 2. Scope
1. **Storage**: new table `app_settings(id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1), theme text NULL, updated_at timestamptz DEFAULT now())`;
   `ENABLE`+`FORCE ROW LEVEL SECURITY`; policies: SELECT `USING (true)` (display-only, needed pre-auth-identity),
   INSERT/UPDATE `USING/WITH CHECK (nullif(current_setting('app.current_purpose',true),'') = 'platform.config')`.
   No CHECK on theme (handler validates; same rule as clients.theme). Seeds nothing (absent row = auto).
2. **Session resolution** (`auth.ts`, login/me path in `session.ts`): effective theme = global ?? tenant ?? 'ge'; ge_admin also gets the global value.
   `clients.theme` read stays as-is.
3. **API** (new, P-only): `GET /settings` → `{theme: 'auto'|'ge'|'lime'|'dark'}` (auto when NULL);
   `PUT /settings` body `{theme}` → validates enum (`400 settings.theme_invalid` otherwise), upserts row 1, audits
   (`APP_THEME_UPDATED`, payload `{theme}`), returns the same shape. Both require platform mode (matrix `P`), fresh identity and the standard wrapper.
4. **Registry/matrix**: register exactly these two declarations (P context only) with the existing §3 conventions; update the documented
   census pins (99→101, 95→97) **deliberately and disclosed** — no other pin weakened.
5. **UI**: `SettingsView` gets a platform-only section «ثيم التطبيق» with 4 radio options (auto + 3 themes), current value loaded from `GET /settings`,
   save via `PUT /settings`, then `refreshUser()` so the change applies immediately; tenant/client and employee never see the section.
   Any colour usage follows STYLE_CONTRACT (no literal colours, `text-brand-text` for coloured text).
6. **ISS-005 (same files)**: replace colour-as-text `text-brand` with `text-brand-text` at the recorded spots —
   `SettingsView.tsx` (`bg-brand-soft text-brand` ×2 + icon), `App.tsx` spinner icon, `SetupView.tsx` radio accent —
   only where it renders on a soft/surface background; verify contrast ≥ the contract bar and do not touch GAP-002 elements.
7. **Tests**: enum validation 400, auto→NULL, global overrides tenant, tenant used when global NULL, ge fallback, P-only 403 for C/W/E,
   audit row, `GET` reflects PUT, resolution precedence matrix.

## 3. Allowed write targets
`src/db/schema.sql` · `src/db/b17Readiness.ts` (three structure constants, measured) · `src/server/auth.ts` (theme resolution only) ·
`src/server/routes/session.ts` · **new** `src/server/routes/settings.ts` · `src/server/routes.ts` (mount) ·
`src/server/accessRegistry.ts` (two declarations + matrix) · `src/context/AuthContext.tsx` (type/refresh only) ·
`src/views/SettingsView.tsx` · `src/views/SetupView.tsx` (one accent class) · `src/App.tsx` (one icon class) ·
`src/lib/*.test.ts` (new tests + disclosed census-pin updates) · `scripts/*` only if a proof is genuinely needed (state it).
**Forbidden:** `b17.sql` · `b17-content.sql` · `b17ContentMigration.ts` · access/access.ts/capabilities/scope/initiativeScope ·
other routes/views/components · `src/styles/*` · print/PDF · deps/lock · `.env` · Aiven · live DB writes · control docs (Tera writes).

## 4. Live shared DB (Tera executes after review)
Executor computes the new three structure constants on its OWN throwaway scratch (falsifiability check: dropping the table restores the previous md5)
and hands the exact ONE-transaction SQL: `CREATE TABLE app_settings …` + policies + both ledger `structure_checksum` updates.
Tera backs up (`pg_dump`) then runs it on `127.0.0.1:55432/b17_showcase`, boots, and verifies.

## 5. Evidence before done
lint 0 · full tests green (with the disclosed pin updates) · build 0 · unit tests per §2(7) · fresh scratch: table+policies present,
`get`/`put` behaviour, resolution matrix · grep: zero literal colours in touched files; no `text-brand`-as-text left at the ISS-005 spots ·
`git status` == ratified set · semgrep local rules + gitleaks on diff.

## 6. Classification
SDA_REQUIRED satisfied by this contract (new API declarations are explicitly owner-driven; no other architecture).
Security MEDIUM (new write endpoint + session resolution) → QA_REQUIRED + Shield after landing. Rounds 2 (impl + fix buffer).
Session NEW, WRITE_CODE + local RUN_TESTS, Strong tier acceptable.

## 7. فهم القرار
فهمي: مدير المنصة يضبط ثيماً واحداً يسري على الجميع، و«تلقائي» يُعيد السلوك لكل مستأجر ثيمه.
الافتراضات: عمود المستأجر يبقى (لا إلغاء لـD-H01-01)؛ لا CHECK في القاعدة (التحقق في المعالج)؛ القائمة/الأدوار الأخرى لا ترى الخيار.
ما سيكشفه القبول: أن قرار المنصة يسري فعلياً على الأدوار الثلاثة فور الحفظ، وأن الإعداد ملتبس بلا حالة وسطى.

## 8. Pre-Execution Gate
| Check | Result |
|---|---|
| Owner-decided behaviour, one objective | PASS |
| New API explicitly required by the behaviour | PASS |
| Schema additive (new single-row table), rollback = DROP | PASS |
| No style-token/literal-colour additions | PASS |
| Testable acceptance incl. precedence matrix | PASS |
| Live DB separation retained by Tera | PASS |
Gate Status: **PASS**.

## 9. Authorisations granted during execution (record)
- **b17-content.sql added to allowed targets (§3 amendment, owner-behaviour driven):** two hunks only —
  (a) `'APP_THEME_UPDATED'` appended to the CLOSED NULL-target `platform.config` audit list (without it the
  audited save rolls back with 42501), (b) `app_settings` policies re-asserted after `b17.sql`'s activation
  wipe (otherwise fresh installs end policy-less while live keeps them → structure drift).
- **translations.ts** authorised for the section's AR/EN keys.
- Pin set authorised as enumerated by the executor (census 95→97 / 99→101 / 87→89 / allowed 54→63, sha256
  re-freezes, inventory totals); later tightened further by QA findings.

## 10. COMPLETE — accepted (2026-11-16)
- **Round 1:** feature implemented (table + policies + resolution + P-only endpoints + platform-only Settings
  section + ISS-005 ×5); local gates 245/245, lint 0, build 0; constants measured with double falsifiability.
- **Live shared DB (Tera):** backup → one transaction (table+3 policies+audit policy replacement+3 ledger
  updates) → boot refused with `b17.schema_drift`; root cause found by a read-only diagnostic: the table was
  created by `postgres`, so the app role could not see its columns (fingerprint blind) and `/settings` would
  have failed on privileges → fixed with `ALTER TABLE app_settings OWNER TO b17showcaseowner` (no ledger move).
  Boot green afterwards. **Lesson recorded:** live DDL must run as the app role (or set owner in the same
  transaction); the new `b17.ownership_drift` readiness check now names this class.
- **Live behaviour verified (Tera):** GET auto → PUT dark applies to owner+client+employee immediately → PUT
  auto returns client to its tenant theme; invalid value 400; audit rows `APP_THEME_UPDATED {theme}` written;
  employee denied on the endpoint; final defaults left `auto` + tenant `ge`.
- **Round 2 (fix buffer):** guard exact-path exclusions (R1), whole-file sha256 pin for `b17-content.sql`
  replacing a provably weak hunk-strip (R2), `app_settings` ownership assertion (R3). 245/245.
- **Reviews:** QA **FAIL→PASS** (round-1 gate red was test-scope only; product criteria 1–7 PASS; recheck PASS
  on R1–R3 with independent strength challenges) · Shield **0 High / 1 Medium / 1 Low** — Medium = same guard
  red (closed by R1), Low = live-apply ownership (closed by R3 + record).
- **Evidence:** `project-control/prototypes/task-proto-h13/settings-app-theme.png` (platform Settings section,
  4 options, correct copy); reports `project-control/qa-reports/TASK-PROTO-H13-QA.md` (incl. RECHECK),
  `security-reports/TASK-PROTO-H13-fix-review.md`.
- **Accepted residuals:** audit payload carries the new value only (mirrors existing pattern) · BOM removed from
  `capabilities.test.ts` (cosmetic) · QA harness CRLF-normalisation note for future scratch runs.
- Round cap: 2/2. No push/deploy.
