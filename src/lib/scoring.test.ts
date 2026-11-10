import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAggregateScore, EvaluationRecord } from './scoring';

test('calculates correct score with pure 0, 50, 100 evaluations', () => {
  const records: EvaluationRecord[] = [
    { itemId: '1', weight: 1, score: 100, notEvaluated: false, notApplicable: false },
    { itemId: '2', weight: 1, score: 50, notEvaluated: false, notApplicable: false },
    { itemId: '3', weight: 1, score: 0, notEvaluated: false, notApplicable: false },
  ];

  const result = calculateAggregateScore(records);
  assert.equal(result.aggregateScore, 50); // (100 + 50 + 0) / 3 = 50
  assert.equal(result.evaluatedCount, 3);
  assert.equal(result.applicableCount, 3);
  assert.equal(result.coveragePercentage, 100);
  assert.equal(result.fullGapCount, 1);
  assert.equal(result.partialGapCount, 1);
  assert.equal(result.noGapCount, 1);
});

test('rule: not_evaluated is NOT zero and must be excluded from average and included in coverage deficit', () => {
  const records: EvaluationRecord[] = [
    { itemId: '1', weight: 2, score: 100, notEvaluated: false, notApplicable: false },
    // Item marked not_evaluated: must NOT pull average down as a 0
    { itemId: '2', weight: 2, score: null, notEvaluated: true, notApplicable: false },
  ];

  const result = calculateAggregateScore(records);
  // Evaluated: only item 1 with score 100.
  // Average is 100, not (100+0)/2 = 50!
  assert.equal(result.aggregateScore, 100);
  assert.equal(result.evaluatedCount, 1);
  assert.equal(result.applicableCount, 2);
  assert.equal(result.notEvaluatedCount, 1);
  assert.equal(result.coveragePercentage, 50); // 1 / 2 = 50%
});

test('rule: not_applicable is excluded from averages and counters', () => {
  const records: EvaluationRecord[] = [
    { itemId: '1', weight: 1, score: 100, notEvaluated: false, notApplicable: false },
    { itemId: '2', weight: 1, score: 50, notEvaluated: false, notApplicable: false },
    // Item marked not_applicable with reason
    {
      itemId: '3',
      weight: 10,
      score: null,
      notEvaluated: false,
      notApplicable: true,
      justification: 'Client has no maritime operations',
    },
  ];

  const result = calculateAggregateScore(records);
  // Applicable items are only 2. Aggregate is (100 + 50) / 2 = 75
  assert.equal(result.aggregateScore, 75);
  assert.equal(result.totalCount, 3);
  assert.equal(result.applicableCount, 2);
  assert.equal(result.notApplicableCount, 1);
  assert.equal(result.evaluatedCount, 2);
  assert.equal(result.coveragePercentage, 100);
});

test('rule: weighted average sum(weight * score) / sum(weight)', () => {
  const records: EvaluationRecord[] = [
    { itemId: '1', weight: 3, score: 100, notEvaluated: false, notApplicable: false }, // 3 * 100 = 300
    { itemId: '2', weight: 1, score: 0, notEvaluated: false, notApplicable: false },   // 1 * 0 = 0
  ];

  const result = calculateAggregateScore(records);
  // Total weight: 4. Sum = 300. Aggregate = 300 / 4 = 75
  assert.equal(result.aggregateScore, 75);
  assert.equal(result.coveragePercentage, 100);
});

test('empty evaluations return null aggregate and 0 coverage', () => {
  const result = calculateAggregateScore([]);
  assert.equal(result.aggregateScore, null);
  assert.equal(result.coveragePercentage, 0);
  assert.equal(result.applicableCount, 0);
  assert.equal(result.totalCount, 0);
});
