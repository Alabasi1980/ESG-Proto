// TASK-PROTO-U4-1B — unit matrix for the typed-answer contract (no DB).
//
// Pins the wire codes + text cap, then walks every answer_type × valid/invalid,
// the draft-vs-submit split (blank allowed to draft, refused at submit), the
// INDEPENDENT attachment_required rule, the file-type "attachment is the
// answer" rule, and the N/A decision (N/A satisfies the answer, never the
// independent attachment requirement).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_ATTACHMENT_REQUIRED,
  ANSWER_ATTACHMENT_REQUIRED_MESSAGE,
  ANSWER_ITEM_UNRESOLVED,
  ANSWER_ITEM_UNRESOLVED_MESSAGE,
  ANSWER_TYPE_INVALID,
  ANSWER_TYPE_INVALID_MESSAGE,
  ANSWER_TYPE_UNRESOLVED,
  ANSWER_TYPE_UNRESOLVED_MESSAGE,
  MAX_TEXT_ANSWER_LENGTH,
  isBlankAnswerValue,
  normalizeAnswerType,
  resolveAnswerType,
  validateAnswerValue,
  validateSubmitAnswer,
} from './answerValidation.ts';

// ---- enumerated pins -------------------------------------------------------

test('pins: wire codes, text cap and non-reflective messages', () => {
  assert.equal(ANSWER_TYPE_INVALID, 'answer.type_invalid');
  assert.equal(ANSWER_ATTACHMENT_REQUIRED, 'answer.attachment_required');
  assert.equal(MAX_TEXT_ANSWER_LENGTH, 10_000);
  assert.equal(ANSWER_TYPE_INVALID_MESSAGE, "The answer does not match this item's answer type.");
  assert.equal(
    ANSWER_ATTACHMENT_REQUIRED_MESSAGE,
    'This item requires at least one attachment before it can be submitted.'
  );
  // Messages are fixed text (no interpolation placeholders / reflected input).
  for (const message of [ANSWER_TYPE_INVALID_MESSAGE, ANSWER_ATTACHMENT_REQUIRED_MESSAGE]) {
    assert.ok(!/[$%]|\{|\}/.test(message), 'messages must not be templates');
  }
});

test('normalizeAnswerType reads an unknown stored value defensively as text', () => {
  for (const type of ['text', 'number', 'boolean', 'date', 'file'])
    assert.equal(normalizeAnswerType(type), type);
  for (const junk of [undefined, null, '', 'essay', 7, {}, []])
    assert.equal(normalizeAnswerType(junk), 'text');
});

test('isBlankAnswerValue treats only absent/whitespace as blank (0 and false are answers)', () => {
  assert.equal(isBlankAnswerValue(undefined), true);
  assert.equal(isBlankAnswerValue(null), true);
  assert.equal(isBlankAnswerValue(''), true);
  assert.equal(isBlankAnswerValue('   '), true);
  assert.equal(isBlankAnswerValue(0), false);
  assert.equal(isBlankAnswerValue(false), false);
  assert.equal(isBlankAnswerValue('0'), false);
});

// ---- text ------------------------------------------------------------------

test('text: trimmed non-empty, ≤ 10000 chars', () => {
  const ok = validateAnswerValue('text', '  hello  ');
  assert.deepEqual(ok, { ok: true, value: 'hello', provided: true });
  assert.equal(validateAnswerValue('text', 42).ok, false);
  assert.equal(validateAnswerValue('text', '   ').ok, true);
  const blank = validateAnswerValue('text', '   ');
  assert.ok(blank.ok && blank.provided === false && blank.value === '');

  const atCap = 'a'.repeat(MAX_TEXT_ANSWER_LENGTH);
  const capOk = validateAnswerValue('text', atCap);
  assert.ok(capOk.ok && capOk.value.length === MAX_TEXT_ANSWER_LENGTH);
  assert.equal(validateAnswerValue('text', 'a'.repeat(MAX_TEXT_ANSWER_LENGTH + 1)).ok, false);

  const bad = validateAnswerValue('text', 'b'.repeat(MAX_TEXT_ANSWER_LENGTH + 1));
  assert.ok(!bad.ok && bad.code === 'answer.type_invalid');
});

// ---- number ----------------------------------------------------------------

test('number: finite signed decimal only', () => {
  for (const value of [0, -0, 42, -42, '+7', '3.14', '-0.5', '.5', '1e3', '-2.5E-2']) {
    const res = validateAnswerValue('number', value);
    assert.ok(res.ok && res.provided, `number ${String(value)} must be accepted`);
  }
  // Absent/blank number values are "not provided" (draft leniency).
  for (const value of ['', '   ', undefined, null]) {
    const res = validateAnswerValue('number', value);
    assert.ok(res.ok && res.provided === false, `blank/absent ${String(value)} is "not provided"`);
  }
  // Non-blank junk is a type error, not "absent".
  for (const value of ['Infinity', '-Infinity', 'NaN', '0x10', '1,000', '1 2', 'abc', true, {}, [1]]) {
    const res = validateAnswerValue('number', value);
    assert.ok(!res.ok && res.code === 'answer.type_invalid', `${String(value)} must be refused`);
  }
  const zero = validateAnswerValue('number', 0);
  assert.ok(zero.ok && zero.value === '0' && zero.provided);
  const signed = validateAnswerValue('number', '+7');
  assert.ok(signed.ok && signed.value === '+7');
});

// ---- boolean ---------------------------------------------------------------

test('boolean: only true/false (JSON or canonical string)', () => {
  assert.deepEqual(validateAnswerValue('boolean', true), { ok: true, value: 'true', provided: true });
  assert.deepEqual(validateAnswerValue('boolean', false), { ok: true, value: 'false', provided: true });
  assert.deepEqual(validateAnswerValue('boolean', 'true'), { ok: true, value: 'true', provided: true });
  assert.deepEqual(validateAnswerValue('boolean', 'false'), { ok: true, value: 'false', provided: true });
  for (const value of ['TRUE', 'False', '1', '0', 'yes', 1, 0, 'on', {}]) {
    const res = validateAnswerValue('boolean', value);
    assert.ok(!res.ok && res.code === 'answer.type_invalid', `${String(value)} must be refused`);
  }
});

// ---- date ------------------------------------------------------------------

test('date: ISO YYYY-MM-DD and a real calendar day', () => {
  for (const value of ['2026-11-16', '2024-02-29', '2000-01-01']) {
    assert.deepEqual(validateAnswerValue('date', value), { ok: true, value, provided: true });
  }
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-1-01',
    '2026/11/16', '16-11-2026', '2026-11-16T00:00:00Z', 20261116, true, {}]) {
    const res = validateAnswerValue('date', value);
    assert.ok(!res.ok && res.code === 'answer.type_invalid', `${String(value)} must be refused`);
  }
});

// ---- file ------------------------------------------------------------------

test('file: the attachment IS the answer — no text value, blank is "not provided"', () => {
  assert.deepEqual(validateAnswerValue('file', ''), { ok: true, value: '', provided: false });
  assert.deepEqual(validateAnswerValue('file', undefined), { ok: true, value: '', provided: false });
  for (const value of ['anything', ' ', 0, false, true]) {
    const res = validateAnswerValue('file', value);
    // A whitespace-only string is blank; everything else is a type violation.
    if (typeof value === 'string' && value.trim() === '') assert.ok(res.ok);
    else assert.ok(!res.ok && res.code === 'answer.type_invalid');
  }
});

// ---- submit gate -----------------------------------------------------------

const submit = (over: Partial<Parameters<typeof validateSubmitAnswer>[0]>) =>
  validateSubmitAnswer({
    answerType: 'text',
    notApplicable: false,
    value: 'evidence',
    attachmentCount: 0,
    attachmentRequired: false,
    ...over,
  });

test('submit: every non-file type must carry a valid, non-blank typed value', () => {
  assert.deepEqual(submit({ answerType: 'text', value: 'ok' }), { ok: true });
  assert.deepEqual(submit({ answerType: 'number', value: '12.5' }), { ok: true });
  assert.deepEqual(submit({ answerType: 'boolean', value: 'false' }), { ok: true });
  assert.deepEqual(submit({ answerType: 'date', value: '2026-11-16' }), { ok: true });

  for (const over of [
    { answerType: 'text', value: '' },
    { answerType: 'text', value: '   ' },
    { answerType: 'number', value: 'abc' },
    { answerType: 'number', value: '' },
    { answerType: 'boolean', value: 'maybe' },
    { answerType: 'date', value: '2026-02-30' },
    { answerType: 'file', value: 'text alongside a file' },
    { answerType: 'file', value: 'x', attachmentCount: 1 },
  ]) {
    const res = submit(over);
    assert.ok(!res.ok && res.code === ANSWER_TYPE_INVALID, `${JSON.stringify(over)} -> type_invalid`);
  }
});

test('submit: attachment_required is independent of a valid typed answer', () => {
  const blocked = submit({ answerType: 'text', value: 'valid', attachmentRequired: true, attachmentCount: 0 });
  assert.ok(!blocked.ok && blocked.code === ANSWER_ATTACHMENT_REQUIRED);
  assert.deepEqual(submit({ answerType: 'text', value: 'valid', attachmentRequired: true, attachmentCount: 1 }), { ok: true });
  // Not required -> no attachment needed.
  assert.deepEqual(submit({ answerType: 'text', value: 'valid', attachmentRequired: false }), { ok: true });
});

test('submit: file type requires an attachment and no text value', () => {
  const missing = submit({ answerType: 'file', value: '', attachmentCount: 0 });
  assert.ok(!missing.ok && missing.code === ANSWER_ATTACHMENT_REQUIRED);
  assert.deepEqual(submit({ answerType: 'file', value: '', attachmentCount: 1 }), { ok: true });
  // attachment_required is redundant for file, and still satisfied by ≥1 file.
  assert.deepEqual(submit({ answerType: 'file', value: '', attachmentCount: 1, attachmentRequired: true }), { ok: true });
});

test('submit: N/A satisfies the answer (even file) but never the independent attachment rule', () => {
  // N/A with a reason satisfies a normal typed answer with no value.
  assert.deepEqual(submit({ answerType: 'text', value: '', notApplicable: true }), { ok: true });
  assert.deepEqual(submit({ answerType: 'file', value: '', notApplicable: true }), { ok: true });
  // ... but attachment_required still blocks N/A without an attachment.
  const blocked = submit({ answerType: 'text', notApplicable: true, attachmentRequired: true, attachmentCount: 0 });
  assert.ok(!blocked.ok && blocked.code === ANSWER_ATTACHMENT_REQUIRED);
  assert.deepEqual(submit({ answerType: 'text', notApplicable: true, attachmentRequired: true, attachmentCount: 1 }), { ok: true });
  // A junk attachment count is treated as zero, never as "has one".
  for (const attachmentCount of [-1, Number.NaN, 0.4]) {
    const res = submit({ answerType: 'file', value: '', attachmentCount });
    assert.ok(!res.ok && res.code === ANSWER_ATTACHMENT_REQUIRED, `count ${attachmentCount} -> required`);
  }
});

test('draft leniency: a blank value is "not provided", an invalid provided value is refused', () => {
  // Draft path validates only when present: blank -> ok/provided:false.
  for (const type of ['text', 'number', 'boolean', 'date', 'file']) {
    const res = validateAnswerValue(type, '');
    assert.ok(res.ok && res.provided === false, `${type} blank draft value is allowed`);
  }
  // A provided invalid value is still refused at draft time.
  assert.equal(validateAnswerValue('number', 'not-a-number').ok, false);
  assert.equal(validateAnswerValue('boolean', 'yes').ok, false);
  assert.equal(validateAnswerValue('date', '16/11/2026').ok, false);
  assert.equal(validateAnswerValue('file', 'text').ok, false);
});

// ---- R3 (SHIELD L-03): strict metadata resolution --------------------------

test('R3: resolveAnswerType never substitutes text for an unknown/missing type', () => {
  for (const type of ['text', 'number', 'boolean', 'date', 'file'])
    assert.deepEqual(resolveAnswerType(type), { ok: true, type });
  for (const junk of [undefined, null, '', 'essay', 'TEXT', 7, {}, []]) {
    const res = resolveAnswerType(junk);
    assert.ok(!res.ok && res.code === ANSWER_TYPE_UNRESOLVED, `${String(junk)} -> type_unresolved`);
    assert.equal(res.message, ANSWER_TYPE_UNRESOLVED_MESSAGE);
  }
  // Pins for the fail-closed metadata codes (never a silent text default).
  assert.equal(ANSWER_TYPE_UNRESOLVED, 'answer.type_unresolved');
  assert.equal(ANSWER_ITEM_UNRESOLVED, 'answer.item_unresolved');
  assert.equal(ANSWER_TYPE_UNRESOLVED_MESSAGE, "The item's answer type could not be resolved.");
  assert.equal(ANSWER_ITEM_UNRESOLVED_MESSAGE, 'The item metadata could not be resolved.');
});

// ---- R4 (SHIELD L-04): invisible-only text + NUL ---------------------------

test('R4: text made only of Unicode format/invisible characters is not an answer', () => {
  // R2 (round 3): ALL `\p{Cf}` format chars are invisible for the emptiness
  // check — the task-listed members plus the bidi/isolate representatives.
  const invisible = ['\u200B', '\u200C', '\u200D', '\uFEFF', '\u00AD',
    '\u2060', '\u200E', '\u200F', '\u061C', '\u180E', '\u202E', '\u2066'];
  for (const ch of invisible) {
    const res = validateAnswerValue('text', ch);
    assert.ok(!res.ok && res.code === 'answer.type_invalid', `U+${ch.codePointAt(0)!.toString(16)} alone -> invalid`);
  }
  const combined = validateAnswerValue('text', invisible.join(''));
  assert.ok(!combined.ok && combined.code === 'answer.type_invalid');
  // U+FEFF is eaten by JS trim, so the blank predicate must keep it "present".
  assert.equal(isBlankAnswerValue('\uFEFF'), false);
  assert.equal(isBlankAnswerValue('\u200B'), false);
  assert.equal(isBlankAnswerValue('   '), true);
  const padded = validateAnswerValue('text', `  ${invisible.join('')}  `);
  assert.ok(!padded.ok && padded.code === 'answer.type_invalid');
  // Mixed real content is still a valid answer (invisibles are not stripped from
  // the stored value; only the emptiness test ignores them).
  const mixed = validateAnswerValue('text', '\u200Bok\u200B');
  assert.ok(mixed.ok && mixed.provided && mixed.value === '\u200Bok\u200B');
  const mixedFormat = validateAnswerValue('text', 'a\u2060b');
  assert.ok(mixedFormat.ok && mixedFormat.value === 'a\u2060b');
});

test('R4: a NUL is a 400 own-code type refusal for every type, never a 500 path', () => {
  for (const type of ['text', 'number', 'boolean', 'date', 'file']) {
    const res = validateAnswerValue(type, type === 'text' ? 'a\u0000b' : 'x\u0000y');
    assert.ok(!res.ok && res.code === 'answer.type_invalid', `${type} + NUL -> 400 own code`);
  }
  const only = validateAnswerValue('text', '\u0000');
  assert.ok(!only.ok && only.code === 'answer.type_invalid');
});
