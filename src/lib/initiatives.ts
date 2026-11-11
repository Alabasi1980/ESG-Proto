/**
 * Initiatives library natural-key normalization (BATCH B8 / MP-41).
 *
 * Idempotency key is (title, sector): both trimmed, blanks kept as '' and
 * never guessed. The sheet holds 176 distinct (title, sector) pairs, so a
 * re-import through POST /api/initiatives upserts with 0 duplicates.
 */

export interface InitiativeNaturalKey {
  title: string;
  sector: string;
}

function normalizePart(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function initiativeNaturalKey(
  title: unknown,
  sector: unknown
): InitiativeNaturalKey {
  return { title: normalizePart(title), sector: normalizePart(sector) };
}

/** PROFILE text → 1/2/3 mapping read from the ESG Profile sheet (MP-42). */
const ESG_PROFILE_TEXT_TO_RATING: Record<string, 1 | 2 | 3> = {
  'Needs Improvement': 1,
  Moderate: 2,
  Good: 3,
};

export function esgProfileTextToRating(
  profile: unknown
): 1 | 2 | 3 | null {
  if (typeof profile !== 'string') return null;
  return ESG_PROFILE_TEXT_TO_RATING[profile.trim()] ?? null;
}
