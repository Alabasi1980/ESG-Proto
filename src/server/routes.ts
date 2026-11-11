// B12 (R-01) — thin mount point. All domain routes live in sub-routers
// under src/server/routes/ (system, session, gri, evaluations, actions,
// initiatives, reports, storage, admin, audit, notifications) plus the
// taxonomy router (src/server/taxonomy.ts). This file registers them in the
// original order under the /api prefix and owns no domain handlers itself —
// SAME behavior is proven by the full suite + harness parity re-run.
// Micro-fix: it additionally owns the terminal JSON 404 + global JSON error
// handlers (mounted LAST), which only fire for errors that would otherwise
// reach Express's default HTML finalhandler; all existing refusal
// bodies/statuses are unchanged.

import express from 'express';
import taxonomyRouter from './taxonomy.ts';
import systemRouter from './routes/system.ts';
import sessionRouter from './routes/session.ts';
import griRouter from './routes/gri.ts';
import evaluationsRouter from './routes/evaluations.ts';
import actionsRouter from './routes/actions.ts';
import initiativesRouter from './routes/initiatives.ts';
import reportsRouter from './routes/reports.ts';
import storageRouter from './routes/storage.ts';
import adminRouter from './routes/admin.ts';
import auditRouter from './routes/audit.ts';
import notificationsRouter from './routes/notifications.ts';
import { apiNotFoundHandler, globalJsonErrorHandler } from './errorHandler.ts';

const router = express.Router();

// B11a taxonomy/services/items/equivalent-links endpoints (S-04/S-05/S-06/S-08).
// Mounted here so they share the /api prefix; the module owns its routes.
router.use(taxonomyRouter);

router.use(systemRouter);
router.use(sessionRouter);
router.use(griRouter);
router.use(evaluationsRouter);
router.use(actionsRouter);
router.use(initiativesRouter);
router.use(reportsRouter);
router.use(storageRouter);
router.use(adminRouter);
router.use(auditRouter);
router.use(notificationsRouter);

// Micro-fix: no Express-default HTML page may ever escape the API.
// 404 (unknown /api route) stays JSON, and the global 4-argument error
// middleware is mounted LAST so any thrown/forwarded error on any route
// (sync throw, next(err), …) responds JSON
// { error, code? } with the original status (default 500) and no stack.
// Existing refusal bodies are untouched — each route keeps its own
// try/catch with exact messages/codes.
router.use(apiNotFoundHandler);
router.use(globalJsonErrorHandler);

export default router;
