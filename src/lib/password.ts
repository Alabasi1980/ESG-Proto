// B12 (S-02 completion) — self-chosen password complexity rule.
//
// WHY a shared lib: the same rule must be enforced identically at every
// self-chosen password entry point (setup/admin, change-password, create-user
// custom passwords). One predicate, unit-tested at the 9-vs-10 boundary, so
// the three call sites cannot drift apart.
//
// Rule: minimum 10 characters + at least one uppercase + one lowercase +
// one digit + one symbol. Existing bcrypt hashes are untouched (they are
// never re-validated); generated OTPs stay 16-char complex (see b11b.ts).
// Never log passwords (MEDIUM binding condition).

export const SELF_CHOSEN_PASSWORD_MIN_LENGTH = 10;

export interface PasswordValidation {
  ok: boolean;
  /** Human-readable refusal (safe to return to the caller; no secrets). */
  error?: string;
}

/**
 * Validates a self-chosen password. Empty/non-string input is refused.
 */
export function validateSelfChosenPassword(input: unknown): PasswordValidation {
  if (typeof input !== 'string' || input.length < SELF_CHOSEN_PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${SELF_CHOSEN_PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  const hasUpper = /[A-Z]/.test(input);
  const hasLower = /[a-z]/.test(input);
  const hasDigit = /[0-9]/.test(input);
  const hasSymbol = /[^A-Za-z0-9]/.test(input);
  if (!hasUpper || !hasLower || !hasDigit || !hasSymbol) {
    return {
      ok: false,
      error: 'Password must include an uppercase letter, a lowercase letter, a digit, and a symbol.',
    };
  }
  return { ok: true };
}

/** Human hint for UIs (both languages are rendered by the caller via i18n). */
export function selfChosenPasswordHint(): string {
  return `Minimum ${SELF_CHOSEN_PASSWORD_MIN_LENGTH} characters with uppercase, lowercase, digit, and symbol.`;
}
