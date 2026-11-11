import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalLinkPair,
  isEsgClass,
  isItemAnswerType,
  isItemPriority,
  itemDeleteRefusal,
  validateNewItem,
  weightForPriority,
} from './taxonomy';

// --- weight derivation (mirrors enforce_item_weight_priority) ---

test('weight is derived from priority: high=3, mid=2, low=1', () => {
  assert.equal(weightForPriority('high'), 3);
  assert.equal(weightForPriority('mid'), 2);
  assert.equal(weightForPriority('low'), 1);
  assert.equal(weightForPriority(undefined), 2);
  assert.equal(weightForPriority('nonsense'), 2);
});

// --- canonical link pair (S-08: unordered, no self-link) ---

test('canonicalLinkPair sorts both directions to one row', () => {
  const ab = canonicalLinkPair('aaa', 'bbb');
  const ba = canonicalLinkPair('bbb', 'aaa');
  assert.deepEqual(ab, ['aaa', 'bbb']);
  assert.deepEqual(ba, ['aaa', 'bbb']);
});

test('canonicalLinkPair refuses self-links and junk', () => {
  assert.equal(canonicalLinkPair('x', 'x'), null);
  assert.equal(canonicalLinkPair('x', ' x '), null);
  assert.equal(canonicalLinkPair('', 'y'), null);
  assert.equal(canonicalLinkPair(null, 'y'), null);
  assert.equal(canonicalLinkPair(undefined, undefined), null);
});

// --- item input validation (S-06) ---

test('validateNewItem accepts a minimal body with sane defaults', () => {
  const res = validateNewItem({ disclosureId: 'd1', code: '2-1-a', requirement: 'Do the thing' });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.answerType, 'text');
    assert.equal(res.value.priority, 'mid');
    assert.equal(res.value.esgClass, 'general');
    assert.equal(res.value.sortOrder, null);
    assert.equal(res.value.departmentId, null);
  }
});

test('validateNewItem refuses missing disclosureId/code/requirement', () => {
  for (const body of [
    { code: 'c', requirement: 'r' },
    { disclosureId: 'd', requirement: 'r' },
    { disclosureId: 'd', code: 'c' },
    { disclosureId: 'd', code: '  ', requirement: 'r' },
  ]) {
    const res = validateNewItem(body);
    assert.equal(res.ok, false);
  }
});

test('validateNewItem refuses out-of-domain priority/esgClass/answerType/sortOrder', () => {
  const base = { disclosureId: 'd', code: 'c', requirement: 'r' };
  assert.equal(validateNewItem({ ...base, priority: 'urgent' }).ok, false);
  assert.equal(validateNewItem({ ...base, esgClass: 'planet' }).ok, false);
  assert.equal(validateNewItem({ ...base, answerType: 'essay' }).ok, false);
  assert.equal(validateNewItem({ ...base, sortOrder: -1 }).ok, false);
  assert.equal(validateNewItem({ ...base, sortOrder: 1.5 }).ok, false);
});

// --- domain guards ---

test('domain guards accept only known values', () => {
  assert.equal(isItemPriority('high'), true);
  assert.equal(isItemPriority('HIGH'), false);
  assert.equal(isEsgClass('governance'), true);
  assert.equal(isEsgClass('gov'), false);
  assert.equal(isItemAnswerType('boolean'), true);
  assert.equal(isItemAnswerType('essay'), false);
});

// --- delete refusal names the blockers ---

test('itemDeleteRefusal names every referencing child kind', () => {
  const msg = itemDeleteRefusal({ answers: 2, evaluations: 0, assignments: 1 });
  assert.match(msg, /2 answer\(s\)/);
  assert.match(msg, /1 assignment\(s\)/);
  assert.doesNotMatch(msg, /evaluation/);
});
