# QA Report — TASK-PROTO-U4-2-FIX-P5 (Execution Mode, independent)

> Filed by TeraAgent from the qa-agent handback (session ses_e13f95f27ffekbVx97sIz2Efcz): the agent collected all evidence independently but has no file-write tool; per handback-recording rules Tera files it verbatim. Executor statements treated as context only.

Status: **FAIL (single red = G1 size-bound guard; all functional pins green)** — verdict per criterion below. Waiver W-P5-01 is Tera's decision (counts reported factually).

## Per-criterion verdicts (contract P5 acceptance surface)
1. Tabs overview·content·settings·import; Rules + JSON editor deleted — PASS (P5 test 1)
2. No client/department controls; no assignment writes — PASS (P5 test 1 pins)
3. friendlyError + frozen-scope banner — PASS (P5 test 2)
4. Rail search AR/EN + counts/status + linked-clients read-only — PASS (P5 tests 3–5)
5. Flexible tree groups/direct; details never a level — PASS (P5 tests 6–7)
6. Archived retention (live-scope split + copy wired) — PASS (P5 test 8)
7. DG-04 reopened status-only — PASS (P5 test 9)
8. CRUD wiring: level search, dirty draft, N-7 conflict, bulk subset — PASS (P5 test 10)
9. Named settings closed set, no raw JSON — PASS (P5 test 11)
10. Import mapping/row-errors/service scope + endpoint bindings — PASS (P5 test 12)
11. i18n keys present interface+EN+AR — PASS (P5 test 13)
12. E-1…E-9 live handler proof — NOT VERIFIED-live (out of scope at this gate, no live env; never PASS)
13. Full-suite green — FAIL: 436/437; red = test #103 G1 guard `ServicesView.tsx: new-file bound`
14. W-P5-01 — factual counts: ServicesView.tsx 940 (HEAD 498), ServiceContentPanel.tsx 842 (HEAD 398), ServiceRail.tsx 258, services.test.ts 203, u42fix-p5.test.ts 296 (new, in-bound), translations.ts 2825

## Commands (independent evidence)
- `npm run lint` → PASS (tsc clean)
- `npm test` → 436/437 (1 red above)
- `npm run build` → PASS (vite 848ms)
- `npx tsx --test src/lib/u42fix-p5.test.ts` → 13/13 PASS
- No 127.0.0.1:55432 / secrets contact. No edits, no commits.
