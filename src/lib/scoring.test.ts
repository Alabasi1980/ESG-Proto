import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAggregateScore, EvaluationRecord, gateDraftEvaluations, DashboardSourceRow } from './scoring';

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

// FIX-BATCH-3 C1 scenario (reconstructed from the reported 60.0 / 66.7%):
// 3 applicable items (weights 3/2/1); item1 submitted 100, item2 submitted 0,
// item3 not evaluated. Aggregate = (3*100 + 2*0)/5 = 60.0; coverage 2/3 = 66.7%.
function c1SourceRows(): DashboardSourceRow[] {
  return [
    { itemId: 'i1', weight: 3, score: 100, notEvaluated: false, notApplicable: false, hasEvaluation: true, hasSubmittedAnswer: true },
    { itemId: 'i2', weight: 2, score: 0, notEvaluated: false, notApplicable: false, hasEvaluation: true, hasSubmittedAnswer: true },
    { itemId: 'i3', weight: 1, score: null, notEvaluated: true, notApplicable: false, hasEvaluation: false, hasSubmittedAnswer: false },
  ];
}

test('F-01 C1 baseline: all-submitted scenario aggregates to 60.0 / 66.7%', () => {
  const result = calculateAggregateScore(gateDraftEvaluations(c1SourceRows()));
  assert.equal(result.aggregateScore, 60);
  assert.equal(result.coveragePercentage, 66.7);
  assert.equal(result.evaluatedCount, 2);
  assert.equal(result.applicableCount, 3);
  assert.equal(result.fullGapCount, 1);
  assert.equal(result.noGapCount, 1);
});

test('F-01 A2: leaving one evaluation in DRAFT removes it from numbers (100.0 / 33.3%)', () => {
  const rows = c1SourceRows();
  // Item2 stays a draft: score stored but linked answer still draft.
  rows[1] = { ...rows[1], hasSubmittedAnswer: false };
  const result = calculateAggregateScore(gateDraftEvaluations(rows));
  // Hand computation WITHOUT the draft: only item1 evaluated → 300/3 = 100.0, 1/3 = 33.3%.
  assert.equal(result.aggregateScore, 100);
  assert.equal(result.coveragePercentage, 33.3);
  assert.equal(result.evaluatedCount, 1);
  assert.equal(result.applicableCount, 3);
  assert.equal(result.notEvaluatedCount, 2);
  assert.equal(result.fullGapCount, 0);
  assert.equal(result.noGapCount, 1);
});

test('F-01: draft N/A evaluation is treated as not-evaluated, not as N/A', () => {
  const rows: DashboardSourceRow[] = [
    { itemId: 'i1', weight: 2, score: 100, notEvaluated: false, notApplicable: false, hasEvaluation: true, hasSubmittedAnswer: true },
    // Draft N/A: must NOT shrink the applicable denominator.
    { itemId: 'i2', weight: 2, score: null, notEvaluated: false, notApplicable: true, hasEvaluation: true, hasSubmittedAnswer: false },
  ];
  const result = calculateAggregateScore(gateDraftEvaluations(rows));
  assert.equal(result.applicableCount, 2);
  assert.equal(result.notApplicableCount, 0);
  assert.equal(result.notEvaluatedCount, 1);
  assert.equal(result.coveragePercentage, 50);
});

test('F-01: submitted N/A keeps excluding the item from the denominator', () => {
  const rows: DashboardSourceRow[] = [
    { itemId: 'i1', weight: 2, score: 100, notEvaluated: false, notApplicable: false, hasEvaluation: true, hasSubmittedAnswer: true },
    { itemId: 'i2', weight: 2, score: null, notEvaluated: false, notApplicable: true, hasEvaluation: true, hasSubmittedAnswer: true },
  ];
  const result = calculateAggregateScore(gateDraftEvaluations(rows));
  assert.equal(result.applicableCount, 1);
  assert.equal(result.notApplicableCount, 1);
  assert.equal(result.coveragePercentage, 100);
});

// B11c MICRO-FIX gate matrix (diagnosed 2026-11-11: client_approved rows
// silently dropped out of dashboard aggregates because the dashboard query
// filtered answers.status IN ('submitted','approved') — written before the
// B9 `client_approved` status existed). Final states must always count;
// only drafts/returned/not-evaluated/N-A are excluded per F-01 + BR-01.
import { readFileSync } from 'node:fs';

const COUNTED_STATUSES = ['submitted', 'approved', 'client_approved'] as const;
const EXCLUDED_STATUSES = ['draft', 'returned', 'reopened'] as const;

function gateRow(status: string): DashboardSourceRow {
  return {
    itemId: `m-${status}`, weight: 1, score: 100,
    notEvaluated: false, notApplicable: false,
    hasEvaluation: true,
    // Mirrors the dashboard aggregate predicate (gri.ts dashboard/stats):
    // counted iff linked answers.status is a final state.
    hasSubmittedAnswer: (COUNTED_STATUSES as readonly string[]).includes(status),
  };
}

test('B11c gate matrix: submitted+approved+client_approved count; draft/returned/reopened do not', () => {
  for (const status of COUNTED_STATUSES) {
    const result = calculateAggregateScore(gateDraftEvaluations([gateRow(status)]));
    assert.equal(result.evaluatedCount, 1, `${status} must count toward aggregates`);
    assert.equal(result.coveragePercentage, 100, `${status} must count toward coverage`);
  }
  for (const status of EXCLUDED_STATUSES) {
    const result = calculateAggregateScore(gateDraftEvaluations([gateRow(status)]));
    assert.equal(result.evaluatedCount, 0, `${status} must NOT count toward aggregates`);
    assert.equal(result.coveragePercentage, 0, `${status} must NOT count toward coverage`);
    assert.equal(result.notEvaluatedCount, 1, `${status} surfaces as not-evaluated`);
  }
});

test('B11c: dashboard aggregate predicate in gri.ts carries the three-value gate', () => {
  const src = readFileSync('src/server/routes/gri.ts', 'utf8');
  const m = src.match(/a2\.status IN \(([^)]*)\)/);
  assert.ok(m, 'dashboard/stats must filter on a linked-answers status IN list');
  const list = m[1];
  for (const s of COUNTED_STATUSES) assert.ok(list.includes(`'${s}'`), `gate must include '${s}'`);
  // Guard the exact diagnosed regression: a bare two-value list.
  assert.ok(
    !/IN \(\s*'submitted'\s*,\s*'approved'\s*\)/.test(src),
    'stale two-value gate IN (submitted,approved) must not remain in gri.ts'
  );
});
