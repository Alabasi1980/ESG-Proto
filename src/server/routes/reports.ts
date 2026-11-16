import express, { type Response } from 'express';
import { authMiddleware, type AuthenticatedRequest } from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import { resolveLinkedService, scopeError, serviceFieldMask } from '../scope.ts';
import { isReportLevel, indexToCSV } from '../../lib/reports.ts';
import { stripMaskedFields } from '../../lib/clientFieldMask.ts';
import { domainTransaction, domainTenant, domainFailure, textFilter, validateDomainIds } from './initiativeScope.ts';
import { registerReportSettings } from './reportSettings.ts';
import { buildReportPayload } from './reportData.ts';

const router = express.Router();
registerReportSettings(router);

async function report(req: AuthenticatedRequest) {
  validateDomainIds(req);
  const level = textFilter(req.query.level);
  if (!isReportLevel(level)) throw Object.assign(new Error('level is required, one of: L1, L2, L3.'), { statusCode:400,code:'reports.level_invalid' });
  return domainTransaction(req, async client => {
    const tenant = domainTenant(req, req.query.clientId);
    const service = await resolveLinkedService(client, req.access!, req.query.serviceId);
    const payload = await buildReportPayload(client, req.user!, tenant, service, level);
    // U4-1a §6: the report index is an item projection for C — strip the masked
    // item columns from the served rows (aggregates were computed above, so a
    // hidden weight never changes a returned score). W/P are unaffected.
    if (req.access!.mode === 'client' && service) {
      const mask = await serviceFieldMask(client, req.access!, service);
      if (mask.size) for (const row of payload.index)
        stripMaskedFields(row as unknown as Record<string, unknown>, mask);
    }
    return payload;
  });
}
function failure(res: Response, err: any) {
  if (err?.statusCode === 422) return res.status(422).json({ error:err.message,code:'reports.index_incomplete',
    offendingCodes:err.offendingCodes ?? [],index:err.index ?? [] });
  return domainFailure(res, err, 'Failed to build report');
}

router.get('/reports/index', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try { res.json(await report(req)); } catch (err) { failure(res, err); }
});

router.get('/reports/export', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const format = textFilter(req.query.format, 'json').toLowerCase();
    if (!['json','csv'].includes(format)) throw scopeError(400, 'reports.format_invalid');
    const payload = await report(req);
    const file = `gri-report-${payload.clientId.slice(0,8)}-${payload.serviceId.slice(0,8)}-${payload.level}`;
    res.setHeader('Content-Disposition', `attachment; filename="${file}.${format}"`);
    if (format === 'csv') { res.type('text/csv; charset=utf-8').send(indexToCSV(payload.index)); return; }
    res.json(payload);
  } catch (err) { failure(res, err); }
});

export default router;
