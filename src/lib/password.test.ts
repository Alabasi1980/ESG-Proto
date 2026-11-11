import test from 'node:test';
import assert from 'node:assert/strict';
import { SELF_CHOSEN_PASSWORD_MIN_LENGTH, validateSelfChosenPassword } from './password.ts';

test('B12 password: boundary 9 vs 10 chars (S-02)', () => {
  assert.equal(SELF_CHOSEN_PASSWORD_MIN_LENGTH, 10);
  // 9 chars with full complexity still refused (length boundary).
  const nine = validateSelfChosenPassword('Aa1!bcdef');
  assert.equal(nine.ok, false);
  assert.match(nine.error ?? '', /at least 10/);
  // 10 chars with full complexity accepted.
  const ten = validateSelfChosenPassword('Aa1!bcdefg');
  assert.equal(ten.ok, true);
});

test('B12 password: each complexity class required', () => {
  assert.equal(validateSelfChosenPassword('aa1!bcdefg').ok, false); // no upper
  assert.equal(validateSelfChosenPassword('AA1!BCDEFG').ok, false); // no lower
  assert.equal(validateSelfChosenPassword('Aab!cdefgh').ok, false); // no digit
  assert.equal(validateSelfChosenPassword('Aa1bcdefgh').ok, false); // no symbol
  assert.equal(validateSelfChosenPassword('Aa1!bcdefgh').ok, true);
});

test('B12 password: non-string/empty refused without throwing', () => {
  for (const bad of ['', null, undefined, 123, {}, []]) {
    assert.equal(validateSelfChosenPassword(bad).ok, false);
  }
});
