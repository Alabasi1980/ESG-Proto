// B17 U1: keep legacy declarations registered for U2, but never expose a partially
// retrofitted domain. Coverage is asserted and the activation dispatcher runs FIRST.

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
import settingsRouter from './routes/settings.ts';
import serviceVisibilityRouter from './routes/serviceVisibility.ts';
import { apiNotFoundHandler, globalJsonErrorHandler } from './errorHandler.ts';
import workspaceRouter from './workspace.ts';
import { accessDispatcher } from './access.ts';
import { assertRegistryCoverage } from './accessRegistry.ts';

const router = express.Router();

assertRegistryCoverage([taxonomyRouter, systemRouter, sessionRouter, griRouter, evaluationsRouter,
  actionsRouter, initiativesRouter, reportsRouter, storageRouter, adminRouter, auditRouter,
  notificationsRouter, settingsRouter, serviceVisibilityRouter, workspaceRouter]);
router.use(accessDispatcher);
router.use(workspaceRouter);

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
// TASK-PROTO-H13: platform-wide app settings (P only, two declarations).
router.use(settingsRouter);
// TASK-PROTO-U4-1a: W-only client field-mask writer (one declaration).
router.use(serviceVisibilityRouter);

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
