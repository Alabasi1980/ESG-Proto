import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEsgProfileScore } from './esgProfile';
import { esgProfileTextToRating, initiativeNaturalKey } from './initiatives';

// --- DD-02 profile formula ---

test('DD-02: sheet totals 155/255 → score 60.8, coverage 100', () => {
  // Rebuild the sheet distribution from group RATING sums:
  // 16 groups with (sum, size): (9,5) (3,3) (10,4) (8,7) (4,4) (7,5) (4,3)
  // (6,3) (33,14) (9,6) (13,5) (11,6) (10,7) (18,7) (7,4) (3,2)
  const groups: Array<[number, number]> = [
    [9, 5], [3, 3], [10, 4], [8, 7], [4, 4], [7, 5], [4, 3],
    [6, 3], [33, 14], [9, 6], [13, 5], [11, 6], [10, 7], [18, 7], [7, 4], [3, 2],
  ];
  const ratings: number[] = [];
  for (const [sum, size] of groups) {
    // Spread the sum across the group with valid 1..3 values (any
    // distribution with the same sum/size is score-identical).
    let rest = sum;
    for (let i = 0; i < size; i++) {
      const remaining = size - i;
      const v = Math.min(3, Math.max(1, rest - (remaining - 1) * 3, rest - (remaining - 1) * 1));
      ratings.push(v);
      rest -= v;
    }
  }
  assert.equal(ratings.length, 85);
  assert.equal(ratings.reduce((a, b) => a + b, 0), 155);
  const res = calculateEsgProfileScore(ratings.map((profile_rating) => ({ profile_rating })));
  assert.equal(res.score, 60.8);
  assert.equal(res.ratedCount, 85);
  assert.equal(res.totalCount, 85);
  assert.equal(res.coveragePercentage, 100);
});

test('DD-02: unrated rows are excluded from the score but kept in coverage', () => {
  const res = calculateEsgProfileScore([
    { profile_rating: 3 },
    { profile_rating: null },
    { profile_rating: 1 },
  ]);
  // (3+1)/(2*3)*100 = 66.7; coverage 2/3 = 66.7
  assert.equal(res.score, 66.7);
  assert.equal(res.ratedCount, 2);
  assert.equal(res.totalCount, 3);
  assert.equal(res.coveragePercentage, 66.7);
});

test('DD-02: nothing rated → null score, zero coverage', () => {
  const res = calculateEsgProfileScore([{ profile_rating: null }]);
  assert.equal(res.score, null);
  assert.equal(res.coveragePercentage, 0);
});

test('DD-02: empty set → null score', () => {
  const res = calculateEsgProfileScore([]);
  assert.equal(res.score, null);
  assert.equal(res.totalCount, 0);
});

// --- initiatives natural key + profile text mapping ---

test('MP-41: natural key trims and keeps blanks as empty (never guessed)', () => {
  assert.deepEqual(initiativeNaturalKey(' Solar Energy ', ' 1 General '), {
    title: 'Solar Energy',
    sector: '1 General',
  });
  assert.deepEqual(initiativeNaturalKey('X', null), { title: 'X', sector: '' });
});

test('MP-42: PROFILE text maps exactly; trailing space tolerated, unknown → null', () => {
  assert.equal(esgProfileTextToRating('Needs Improvement'), 1);
  assert.equal(esgProfileTextToRating('Moderate'), 2);
  assert.equal(esgProfileTextToRating('Good'), 3);
  assert.equal(esgProfileTextToRating('Good '), 3);
  assert.equal(esgProfileTextToRating('Excellent'), null);
  assert.equal(esgProfileTextToRating(null), null);
});
