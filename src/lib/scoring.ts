export interface EvaluationRecord {
  itemId: string;
  weight: number;
  score?: 0 | 50 | 100 | null;
  notEvaluated: boolean;
  notApplicable: boolean;
  justification?: string;
  note?: string;
}

export interface AggregateScoreResult {
  /** Weighted average score from 0 to 100 over applicable and evaluated items */
  aggregateScore: number | null;
  /** Evaluated applicable items count */
  evaluatedCount: number;
  /** Total applicable items count (all items excluding not_applicable) */
  applicableCount: number;
  /** Total items count */
  totalCount: number;
  /** Excluded items marked not applicable */
  notApplicableCount: number;
  /** Items marked not evaluated or without evaluation */
  notEvaluatedCount: number;
  /** Review coverage ratio: evaluatedCount / applicableCount (0.0 to 1.0) */
  coverageRatio: number;
  /** Review coverage percentage (0 to 100) */
  coveragePercentage: number;
  /** Gap distribution counts */
  fullGapCount: number; // score === 0
  partialGapCount: number; // score === 50
  noGapCount: number; // score === 100
}

/**
 * Calculates aggregate ESG/GRI scores and review coverage strictly adhering to domain rules:
 * - 0 means full gap, 50 partial gap, 100 no gap; higher is better.
 * - not_evaluated is not zero and must be excluded from every average.
 * - not_applicable is excluded from averages and counters, with its reason stored.
 * - Any aggregate = sum(weight * score) / sum(weight) over applicable AND evaluated items.
 * - Review coverage = evaluated applicable items / all applicable items.
 */
export function calculateAggregateScore(evaluations: EvaluationRecord[]): AggregateScoreResult {
  const totalCount = evaluations.length;
  let notApplicableCount = 0;
  let notEvaluatedCount = 0;
  let evaluatedCount = 0;
  let weightedScoreSum = 0;
  let totalApplicableWeight = 0;

  let fullGapCount = 0;
  let partialGapCount = 0;
  let noGapCount = 0;

  for (const item of evaluations) {
    if (item.notApplicable) {
      notApplicableCount++;
      continue;
    }

    // Item is applicable. Check if evaluated.
    if (item.notEvaluated || item.score === null || item.score === undefined) {
      notEvaluatedCount++;
      continue;
    }

    // Item is applicable AND evaluated
    evaluatedCount++;
    const weight = typeof item.weight === 'number' && item.weight > 0 ? item.weight : 1.0;
    weightedScoreSum += weight * item.score;
    totalApplicableWeight += weight;

    if (item.score === 0) {
      fullGapCount++;
    } else if (item.score === 50) {
      partialGapCount++;
    } else if (item.score === 100) {
      noGapCount++;
    }
  }

  const applicableCount = totalCount - notApplicableCount;
  const coverageRatio = applicableCount > 0 ? evaluatedCount / applicableCount : 0;
  const coveragePercentage = Math.round(coverageRatio * 1000) / 10; // e.g. 75.5%

  const aggregateScore = totalApplicableWeight > 0
    ? Math.round((weightedScoreSum / totalApplicableWeight) * 10) / 10
    : null;

  return {
    aggregateScore,
    evaluatedCount,
    applicableCount,
    totalCount,
    notApplicableCount,
    notEvaluatedCount,
    coverageRatio,
    coveragePercentage,
    fullGapCount,
    partialGapCount,
    noGapCount,
  };
}
