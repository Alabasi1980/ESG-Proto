// Micro-fix: global JSON error + 404 handlers for the /api router.
//
// WHY this module: the live AI Studio deployment returned a minimal HTML
// 403 page (`<title>403 Forbidden</title>`, `server: Google Frontend`) for
// refused admin-only requests, while the local harness returned the app's
// JSON refusal. Suspected cause is an Express default finalhandler HTML page
// for a thrown error somewhere in the middleware chain (or the preview
// proxy itself). Either way the correct engineering response is the same:
// no Express-default HTML page may ever escape the API.
//
// Contract:
// - apiNotFoundHandler: unknown /api route → 404 JSON (never HTML).
// - globalJsonErrorHandler: 4-argument Express error middleware, mounted LAST
//   (after all routers incl. the 404 handler). It ALWAYS responds JSON
//   `{ error, code? }`, preserves err.statusCode/err.status (default 500),
//   logs the stack server-side via console.error, and never sends it.
// - Existing refusal bodies are untouched: every route keeps its own
//   try/catch with exact messages/codes (D-038 unified refusal, GE_ONLY_*,
//   staff-list pointer, …). This handler only covers errors that would
//   otherwise reach Express's default HTML finalhandler.
//
// Binding (MEDIUM): never log or send passwords/tokens/OTPs here — only the
// human message, status, and existing code are logged/sent.

import type { NextFunction, Request, Response } from 'express';

/** Unknown /api route → JSON 404 (never the default HTML page). */
export function apiNotFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

type ApiError = Error & {
  statusCode?: unknown;
  status?: unknown;
  code?: unknown;
  /** Fail-closed tenant-suspended throws carry this flag (see admin.ts). */
  suspended?: unknown;
};

/** Resolve the HTTP status for an escaped error (default 500, fail-closed). */
export function errorStatus(err: unknown): number {
  const candidate =
    (err as ApiError | null)?.statusCode ?? (err as ApiError | null)?.status;
  return typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= 400 &&
    candidate <= 599
    ? candidate
    : 500;
}

/**
 * Global 4-argument Express error middleware. Mount LAST on the /api router.
 * ALWAYS responds JSON; never leaks stack traces to the client.
 */
export function globalJsonErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = errorStatus(err);
  const message =
    err instanceof Error && typeof err.message === 'string' && err.message
      ? err.message
      : 'Internal server error';
  // Server-side only: stack stays in the logs, never in the response.
  console.error('[API error]', status, message, err instanceof Error ? err.stack : err);
  const body: { error: string; code?: string; suspended?: true } = { error: message };
  const code = (err as ApiError | null)?.code;
  if (typeof code === 'string' && code) body.code = code;
  if ((err as ApiError | null)?.suspended === true) body.suspended = true;
  res.status(status).json(body);
}
