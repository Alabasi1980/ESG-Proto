# TASK-PROTO-H12 — tenant theme from the server (D-H01-01)

Status: APPROVED — owner decision (أ) 2026-11-15: platform-only writer.
Base: `4e13a82` (clean; origin/main `c4ee8bc`; local-only track, never pushed).
Owner Approval Required: Yes (owner asked for D-H01-01 explicitly; قالب «أ»).
Governing: `project-control/PROJECT_STATE.md` → `STYLE_CONTRACT.md` → `STYLE_HANDOFF.md` (binding), `DECISIONS_LOG` D-H01-01/D-STYLE-01.

## 1. Objective
Replace the client-side preview mechanism (`?theme=` + hardcoded `TENANT_THEME='ge'`) with the
server-enforced tenant theme: `clients.theme` column, broadcast in the session payload
(`POST /auth/login`, `GET /auth/me`), applied by `ThemeContext`, URL param removed.
Writer surface = **platform only**, via the existing `PATCH /clients/:id` (decision أ).

## 2. Scope (exactly)
1. `clients.theme TEXT NOT NULL DEFAULT 'ge'` — appended via the existing `IF NOT EXISTS` DO-block idiom
   (`schema.sql` precedent: `clients.suspended`, line ~1124). **No CHECK constraint** (business
   validation stays in the handler per gate rule).
2. `B17_CONTENT_SHAPE` recompute: STRUCTURE_SQL fingerprints every public column, so the constant in
   `b17Readiness.ts` MUST change to the value measured on a fresh scratch DB after the column exists.
3. Session broadcast: `auth.ts` tenant SELECT adds `theme` → `identity.user.theme`; `session.ts` login
   returns it in `user` (same payload shape otherwise); `/auth/me` carries it via identity.
   `ge_admin` (no tenant) → `'ge'`. Unknown/NULL stored value → `'ge'` (never crash).
4. `PATCH /clients/:id`: accept optional `theme` ∈ {`ge`,`lime`,`dark`}; invalid → 400 with an own code;
   P-only (already enforced by matrix); audit the change following the existing PATCH audit pattern.
5. Frontend: `ThemeContext` consumes the authenticated user's theme (default `'ge'` pre-auth), applies
   `data-theme` in a layout effect **on change** (login/logout/refresh), no localStorage, no picker,
   no fetch inside the provider. `?theme=` logic deleted. Provider order fixed: `AuthProvider` outer,
   `ThemeProvider` inner (`main.tsx` / `App.tsx`).
6. Tests: theme enum validation, login+me payload include theme, invalid theme 400, C/W/E cannot write
   theme (403), fresh-install shape == constant, `ge_admin` default, legacy NULL/NULL-safe read.
   Deliberate, disclosed updates to existing pins that assert the old constant/comment state
   (`b17TransactionInventory.test.ts` b17Readiness pin) — no other pin weakened.

## 3. Allowed write targets (ratified, ClientAppPath)
`src/db/schema.sql` · `src/db/b17Readiness.ts` (constant + comment only) · `src/server/auth.ts`
(tenant SELECT + user.theme only) · `src/server/routes/session.ts` · `src/server/routes/adminClients.ts`
(PATCH theme only) · `src/context/ThemeContext.tsx` · `src/context/AuthContext.tsx` (type only) ·
`src/App.tsx` + `src/main.tsx` (provider order only) · `src/lib/*.test.ts` (new tests + the two
disclosed pin updates).
**Forbidden:** `b17.sql` · `b17-content.sql` · `b17ContentMigration.ts` · access/accessRegistry/
capabilities/scope/initiativeScope · every other route · all views/components (no visual redesign) ·
`src/styles/*` (no color/token changes) · print/PDF · package/lock/deps · `.env`/secrets · `scripts/*` ·
reviewer reports · control docs (Tera writes those) · Aiven/live DB writes by the executor.

## 4. Live-shared-DB procedure (Tera executes, NOT the executor)
Executor computes the post-change md5 on its OWN throwaway scratch and hands the exact one-transaction
SQL (`ALTER TABLE clients ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'ge';` +
`UPDATE app_schema_versions SET structure_checksum='<new>' WHERE version='B17_U2D';`).
Tera: `pg_dump` backup → run that transaction on `127.0.0.1:55432/b17_showcase` → verify
`assertB17Ready` green by booting the app. Executor never touches the live DB.

## 5. Evidence before done
`npm run lint` 0 · `npm test` green · `npm run build` 0 · fresh scratch: schema→U1→content applies with
shape == new constant, `theme` defaults `'ge'` · unit tests above · grep on touched frontend files:
zero `bg-white|text-black|slate-|gray-|zinc-|neutral-|stone-|dark:|#[0-9a-fA-F]{6}` · zero `?theme=`
references remain anywhere in `src/` · provider order verified by reading `main.tsx`/`App.tsx` ·
`git status` == ratified set only · Semgrep local rules + gitleaks on the diff.

## 6. Classification / rounds / reviews
SDA: REQUIRED but satisfied by this contract (no new architecture; bounded, owner-decided behaviour).
Security: MEDIUM (auth payload echo + platform write path) → QA_REQUIRED (execution) + Shield REVIEW
after landing. Rounds: 2 max (impl + fix buffer); 3rd only with recorded operational risk.
Session NEW, WRITE_CODE + local RUN_TESTS. Strong tier acceptable with safeguards.

## 7. فهم القرار
فهمي: الثيم يصبح خاصية المستأجر يضبطها GE فقط، وتصل للعميل عبر جلسته، والمعاينة بـURL تُحذف نهائياً.
الافتراضات: ge_admin بلا مستأجر = ge؛ الترتيب الثابت للأدوار/الأقواس محفوظ؛ إضافة العمود تفرض تحديث بصمة
الجاهزية وصفّ ledger على القاعدة المشتركة (بعده فقط يقلع التطبيق).
ما سيكشفه القبول: أن الثلاثة تظهر فعلاً من الخادم، وأن الواجهة لا تحمل أي مسار معاينة أو لون محلي.

## 8. Pre-Execution Gate Result
| Check | Result |
|---|---|
| Smallest safe unit / one objective | PASS |
| No deferrable extras (no picker, no self-service) | PASS |
| No new routes/API surface | PASS (extends existing PATCH) |
| Schema change explicitly owner-authorized (decision أ) | PASS |
| No secrets / no dependency / no style-token changes | PASS |
| Testable acceptance + rollback (column additive, revert = drop + ledger restore) | PASS |
| Style contract binding stated | PASS |
Gate Status: **PASS** (bounded to §3 targets; live DB step retained by Tera).

## 9. COMPLETE — accepted (2026-11-16)
- **Round 1** (specialist): 10 modified + `src/lib/themeSession.test.ts`; all three structure constants measured on own scratch with falsifiability (dropping the column reproduces the exact pre-H12 content constant); ledger-drift refusal + recovery proven; ASK resolved by Tera: the live transaction must update **both** rows (`B17_U1` structure_checksum too — `verifyB17` line 152 compares it to `B17_SHAPE`), and the two extra constants (PREDECESSOR/B17_SHAPE) are ratified within the allowed file.
- **Live shared DB (Tera, §4):** backup `pg_dump` 582 KB → one transaction `ALTER TABLE clients ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'ge'` + U1/U2D structure_checksum updates → committed; boot with new code green (no drift); credentials unchanged.
- **Live behaviour verified (Tera):** owner login `theme=ge`; PATCH lime → 200 + RETURNING; invalid `blue` → 400 `theme.invalid`; client login & `/auth/me` → `lime`; employee → `lime`; employee PATCH → 403; restore `ge`.
- **Round 2** (fix, test-only): `auth.ts` re-frozen at post-H12 sha256 `2b349cd4…` (SHIELD-H12-01); changed-set guard excludes exactly the two H12 reviewer report paths (SHIELD-H12-02/QA LOW). 5/5 single-file, **234/234**, lint 0.
- **Reviews:** QA **PASS** (`project-control/qa-reports/TASK-PROTO-H12-QA.md`, 53/53 executed, independent falsifiability) · Shield **0H/0M/2Low/2Info** (`security-reports/TASK-PROTO-H12-fix-review.md`; both Lows closed above; Info = audit carries no previous value, client enum literal — accepted).
- **Evidence:** `project-control/prototypes/task-proto-h12/theme-{ge,lime,dark}.png` — captured logged-in as client_admin with DOM assertion `data-theme` ∈ the three values, dark verified free of white surfaces.
- **Accepted residuals:** invalid stored theme (direct-DB only) is served as `ge` until a P PATCH repairs it (no CHECK by design); client-admin cannot self-serve theme (decision أ); P GET /clients list does not yet expose `theme` (needed when the U3 settings surface lands).
- Round cap: 2/2 used. No push/deploy. Parent app track continues (functional session per PROJECT_STATE §4).
