/**
 * ESG Profile aggregate formula DD-02 (BATCH B8 / MP-42) — read from the
 * sheet's own RATING/MAX RATING semantics, documented in
 * prototype/ESG_PROFILE_VALIDATION.md:
 *
 *   rated rows = rows with profile_rating IN (1,2,3)
 *   score      = SUM(profile_rating) / (3 * rated_rows) * 100 (1 decimal)
 *              ≡ SUM(group RATING) / SUM(group MAX RATING) * 100
 *   coverage   = rated_rows / total_rows * 100 (1 decimal)
 *
 * Sheet totals: 155 / 255 → 60.8, coverage 85/85 = 100%.
 */

export interface EsgProfileScoreRow {
  profile_rating: number | null;
}

export interface EsgProfileScoreResult {
  /** 0–100 percentage, 1 decimal; null when nothing is rated yet. */
  score: number | null;
  ratedCount: number;
  totalCount: number;
  /** ratedCount / totalCount * 100, 1 decimal. */
  coveragePercentage: number;
}

export function calculateEsgProfileScore(
  rows: EsgProfileScoreRow[]
): EsgProfileScoreResult {
  const totalCount = rows.length;
  let ratedCount = 0;
  let sum = 0;

  for (const row of rows) {
    const rating = row.profile_rating;
    if (rating === 1 || rating === 2 || rating === 3) {
      ratedCount++;
      sum += rating;
    }
  }

  const coveragePercentage =
    totalCount > 0 ? Math.round((ratedCount / totalCount) * 1000) / 10 : 0;

  const score =
    ratedCount > 0 ? Math.round((sum / (ratedCount * 3)) * 1000) / 10 : null;

  return { score, ratedCount, totalCount, coveragePercentage };
}
