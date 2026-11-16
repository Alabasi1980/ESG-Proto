# TASK-PROTO-U4-1b — typed answers + independent mandatory attachment (server rules)

Status: AUTHORISED — OD-12. Base: expect `d53d8ef`.
Governing: OD-12 §1–2, B17 spec §3.3 (evaluations), existing attachments caps (5 MB, MIME allowlist, freeze/append-only).

## 1. Rules (server-enforced; UI is U4-3)
1. **Answer value is typed** by `items.answer_type`: `text` (non-empty trimmed string, ≤ 10 000 chars), `number` (finite numeric, signed), `boolean` (true/false), `date` (ISO `YYYY-MM-DD`), `file` (no text value — the attachment IS the answer). Invalid → `400 answer.type_invalid`.
2. `items.attachment_required` is **independent**: at **submit** (not draft), the answer must have ≥1 attachment even if a text answer exists → `400 answer.attachment_required`.
3. `answer_type='file'`: submit requires ≥1 attachment; text value must be empty/absent.
4. N/A-with-reason path unchanged (satisfies the answer requirement; attachments not required unless item also `attachment_required` — decide and document consistently).
5. Drafts: attachments optional; typed value validated only when present.
6. Freeze, version pair, append-only, 5 MB/MIME caps, department/client scoping unchanged. No scoring change.

## 2. Targets
`src/server/routes/evaluations.ts` (write path only) · `src/lib/*` new validator module + tests · `src/lib/*.test.ts` (new tests + enumerated pins) · error-envelope via existing `writeFailure`/own-code pattern.
Forbidden: schema/db changes, UI/views, other routes, deps, `.env`, live DB, control docs.

## 3. Evidence
Unit matrix: all types × valid/invalid; attachment_required blocks submit but not draft; file-type; N/A; existing lifecycle E2E unaffected (save→submit→approve→correct→client confirm) re-run on own scratch; lint/tests/build; enumerate pins.
## 4. Reviews
QA execution + Shield (submit gate + evidence path). Rounds 2.
## 5. فهم القرار
فهمي: الإجابة تُتحقق بنوعها، والمرفق شرط مستقل عند الإرسال، والإرسال بلا مرفق إجباري مرفوض صراحةً.
الافتراضات: الواجهة لاحقاً تعرض الإدخال المطابق؛ لا تغيير للتقييم؛ N/A يبقى مساراً صريحاً بسبب.
ما سيكشفه القبول: أن النظام يمنع فعلياً إرسالاً ناقصاً بلا كسر دورة العمل الحالية.

## 6. COMPLETE — accepted for local integration (2026-11-16)
- Rounds 1-3: typed answer validation per answer_type (text/number/boolean/date/file, no free-form answer), independent attachment_required enforced at submit only, file-type requires attachment and no text, N/A satisfies the answer but NOT attachment_required, evidence DELETE locked once answer leaves draft, POST assignments/na refuses attachment_required items, fail-closed submit metadata, invisible/NUL text refused (all Unicode Cf), correct-to-N/A gated when attachment required, N/A shortcut stores type-appropriate value.
- OD-12 §2 clarified and applied: attachment requirement holds even with N/A.
- QA PASS (round 1) and RECHECK PASS R1-R5 (round 2) and round-3 E2E (N/A-bypass 409 with zero state; Cf matrix) · Shield 0 High/2 Medium closed (M-01 evidence lock, M-02 N/A shortcut) + Low residuals recorded.
- Accepted residuals: rework loop (returned to draft) reopens deletion by design and re-gates at submit; post-approval uploads allowed (append-only) per instruction; position-based pins (known); 10k cap counts UTF-16 units; number stored non-canonically for exponent forms.
- Round cap: 3 used, third justified by a recorded owner-rule bypass. No push. Test count final: 353/353.
