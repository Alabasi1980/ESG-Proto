// B12 (R-01) — GRI sub-router: import preview/commit, template, standards
// listing, dashboard stats. B17 U2-C (task §22/§24): all declarations are
// retrofitted through requireDomainAccess and activated.
// TASK-PROTO-U4-2-FIX P3 — service-scoped import redesign (no client):
// - POST /api/import/preview (+ one-release alias POST /gri/preview): P ONLY,
//   authenticated BEFORE the upload parser; accepts {serviceId, file|rows,
//   columnMapping?}; returns {summary, standards, rows, errors[] (row-level:
//   row number + column + code + message), warnings[], unmappedColumns[]}.
// - POST /api/import/commit (+ one-release alias POST /gri/commit): P ONLY,
//   accepts {serviceId, standards[] (mapped), importBatchId?}; clientId is
//   FORBIDDEN (400 import.client_forbidden); catalog-only upsert under the
//   targetless platform.config context; NO department/assignment provisioning,
//   NO tenant advisory lock, NO client_services mutation, NO guessed
//   standards→service mapping; frozen-row skip applies only where
//   determinable without a tenant (see handler note); audit
//   IMPORT_CATALOG_COMMITTED (NULL-tenant platform branch, P1-whitelisted).
// - GET /api/services/:id/import/template (+ alias GET /gri/template):
//   P ONLY per-service CSV template (GRI columns = current sample).
// - GET /standards: P catalog / W-C L / E L+D content metadata (optional auth
//   removed); counts are computed over RLS-authorized rows only.
// - GET /dashboard/stats: W/C L+V ONLY (matrix refuses P/E/anonymous); every
//   score/gap field is redacted to null for C when show_gap hides gaps (§6/D3);
//   numerator AND denominator come from RLS-scoped rows, so overlapping
//   service mappings can never duplicate an item; show_corrective is
//   NOT-APPLICABLE to stats (§23 D3, recorded).

import express, { type Response, type NextFunction } from 'express';
import multer from 'multer';
import {
  isDatabaseConfigured,
  recordAuditLog,
} from '../../db/index.ts';
import { authMiddleware, type AuthenticatedRequest } from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import { domainTransaction, deferredFailure } from './initiativeScope.ts';
import { parseGRIFile, type ImportColumnMapping, type ImportRowError, type ParsedGRIStandard } from '../../lib/griParser.ts';
import { calculateAggregateScore, gateDraftEvaluations, type DashboardSourceRow } from '../../lib/scoring.ts';
import { scopeId } from '../scope.ts';
import { readContext, platformConfigContext, requireFreshPassword } from './_shared.ts';

const router = express.Router();

// G2 E3-02 byte-preserving collapse (see taxonomy catalogFailure): our own
// errors keep today's exact body/status; raw PG or unknown collapses to the
// static fallback so a handler bug can never become a database oracle.
// TASK-PROTO-U4-2-FIX P3: own errors additionally keep their stable `code`
// (API-3 `{error, code?}` shape for import.client_forbidden / import.row_errors
// / scope.* / service.not_found); the SQLSTATE belt is unchanged, so a raw PG
// diagnostic still collapses with NO code key.
function griFailure(res: Response, err: any, fallback: string): void {
  const own = Number.isInteger(err?.statusCode)
    && !(typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code));
  if (own) {
    const body: { error: string; code?: string } = { error: err.message || fallback };
    if (typeof err?.code === 'string') body.code = err.code;
    res.status(err.statusCode as number).json(body);
    return;
  }
  res.status(500).json({ error: fallback });
}

// U2-D carryover: reject malformed scope filters before any business query.
function validateGriIds(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    for (const key of ['clientId','serviceId','standardId','disclosureId','itemId']) {
      if (req.query[key] !== undefined) scopeId(req.query[key], true);
      if (req.body?.[key] !== undefined) scopeId(req.body[key], true);
    }
    next();
  } catch (err: any) {
    // scopeId is the only thrower here (own 400 scope.* codes); the collapse
    // arm is fail-closed defence (E3-02 — never echo a PG diagnostic).
    if (Number.isInteger(err?.statusCode)
      && !(typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code))) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    res.status(400).json({ error: 'Invalid request input.' });
  }
}

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  storage: multer.memoryStorage(),
});

/** Weight is derived from priority (mirrors enforce_item_weight_priority in schema). */
function weightForPriority(priority?: string): number {
  return priority === 'high' ? 3 : priority === 'low' ? 1 : 2;
}

// ----------------------------------------------------------------------
// TASK-PROTO-U4-2-FIX P3 — service-scoped import contract (no client).
// ----------------------------------------------------------------------

/** P3: any client/tenant selector on the import path is forbidden (400). */
function hasImportClientScope(req: AuthenticatedRequest): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const query = (req.query ?? {}) as Record<string, unknown>;
  return body.clientId !== undefined
    || (body as Record<string, unknown>).client_id !== undefined
    || query.clientId !== undefined
    || (query as Record<string, unknown>).client_id !== undefined;
}

function importClientForbidden(res: Response): void {
  res.status(400).json({
    error: 'Import is service-scoped and catalog-only; clientId is forbidden on this path.',
    code: 'import.client_forbidden',
  });
}

/** P3 flattened preview row for the UI column-mapping table (UI-2 data). */
export interface ImportPreviewRow {
  row: number;
  standardCode: string;
  disclosureCode: string;
  itemCode: string;
  requirement: string;
}

function flattenImportRows(standards: ParsedGRIStandard[]): ImportPreviewRow[] {
  const rows: ImportPreviewRow[] = [];
  let n = 0;
  for (const std of standards) {
    for (const disc of std.disclosures) {
      for (const item of disc.items) {
        n++;
        rows.push({
          row: n,
          standardCode: std.code,
          disclosureCode: disc.code,
          itemCode: item.code,
          requirement: item.requirement,
        });
      }
    }
  }
  return rows;
}

/**
 * P3 commit-time validation of already-mapped `standards[]`: every standard /
 * disclosure / item carries its natural key and every item its requirement.
 * Returns row-level errors (row number + column + code + message); a non-empty
 * result refuses the commit (400) with NOTHING written (checked before the
 * transaction opens).
 */
export function validateCommitStandards(standards: unknown): ImportRowError[] {
  const rowErrors: ImportRowError[] = [];
  if (!Array.isArray(standards) || standards.length === 0) {
    return [{ row: 0, column: 'standards', code: 'import.bad_standards', message: 'standards must be a non-empty array.' }];
  }
  let n = 0;
  for (const rawStd of standards) {
    const std = rawStd as Partial<ParsedGRIStandard> | null | undefined;
    if (!std || typeof std.code !== 'string' || !std.code.trim()) {
      rowErrors.push({ row: 0, column: 'standardCode', code: 'import.missing_standard_code', message: 'A standard is missing its code.' });
    }
    const disclosures = Array.isArray(std?.disclosures) ? std!.disclosures! : null;
    if (!disclosures || disclosures.length === 0) {
      rowErrors.push({
        row: 0,
        column: 'disclosures',
        code: 'import.missing_disclosures',
        message: `Standard '${(std as { code?: unknown })?.code ?? '?'}' carries no disclosures.`,
      });
      continue;
    }
    for (const rawDisc of disclosures) {
      const disc = rawDisc as { code?: unknown; items?: unknown } | null | undefined;
      if (!disc || typeof disc.code !== 'string' || !disc.code.trim()) {
        rowErrors.push({ row: 0, column: 'disclosureCode', code: 'import.missing_disclosure_code', message: 'A disclosure is missing its code.' });
      }
      const items = Array.isArray(disc?.items) ? (disc!.items as { code?: unknown; requirement?: unknown }[]) : null;
      if (!items) {
        rowErrors.push({ row: 0, column: 'items', code: 'import.missing_items', message: `Disclosure '${(disc as { code?: unknown })?.code ?? '?'}' carries no items array.` });
        continue;
      }
      for (const item of items) {
        n++;
        if (!item || typeof item.code !== 'string' || !item.code.trim()) {
          rowErrors.push({ row: n, column: 'itemCode', code: 'import.missing_item_code', message: `Row ${n}: item code is missing.` });
        }
        if (!item || typeof item.requirement !== 'string' || !item.requirement.trim()) {
          rowErrors.push({ row: n, column: 'requirement', code: 'import.missing_requirement', message: `Row ${n}: requirement text is missing.` });
        }
      }
    }
  }
  return rowErrors;
}

// ----------------------------------------------------------------------
// 4. Service-scoped import (.xlsx / .csv) — P ONLY, NO client context.
// Canonical paths + one-release /gri/* aliases (same handlers, same auth).
// Preview is parse-only (authenticated BEFORE the upload parser); commit is
// catalog-only under the targetless platform.config context.
// ----------------------------------------------------------------------
function handleImportPreview(req: AuthenticatedRequest, res: Response): void {
  try {
    // INV-IMPORT-SAFE: any client/tenant selector is refused, never honored.
    if (hasImportClientScope(req)) {
      importClientForbidden(res);
      return;
    }
    const body = (req.body ?? {}) as {
      serviceId?: unknown; csvContent?: unknown; content?: unknown; rows?: unknown;
      columnMapping?: unknown; mapping?: unknown;
    };
    // EXPLICIT serviceId is mandatory — missing -> 400 scope.id_required,
    // malformed -> 400 scope.id_invalid (scope.ts codes).
    const serviceId = scopeId(body.serviceId, true)!;
    const mapping = (body.columnMapping ?? body.mapping) as ImportColumnMapping | undefined;
    if (mapping !== undefined && (typeof mapping !== 'object' || mapping === null || Array.isArray(mapping))) {
      res.status(400).json({
        error: 'columnMapping must be an object of canonical column to file header.',
        code: 'import.bad_mapping',
      });
      return;
    }
    const textContent =
      typeof body.csvContent === 'string' ? body.csvContent
      : typeof body.content === 'string' ? body.content
      : typeof body.rows === 'string' ? body.rows : undefined;
    const sendPreview = (raw: Buffer | string): void => {
      const parseResult = parseGRIFile(raw, { columnMapping: mapping });
      res.json({
        serviceId,
        summary: parseResult.summary,
        standards: parseResult.standards,
        rows: flattenImportRows(parseResult.standards),
        errors: parseResult.rowErrors,
        warnings: parseResult.warnings,
        unmappedColumns: parseResult.unmappedColumns,
      });
    };
    if (req.file) {
      sendPreview(req.file.buffer);
      return;
    }
    if (textContent === undefined) {
      if (body.rows !== undefined || body.csvContent !== undefined || body.content !== undefined) {
        res.status(400).json({
          error: 'Import rows must be CSV text or an uploaded file.',
          code: 'import.bad_rows',
        });
        return;
      }
      res.status(400).json({ error: 'No file or CSV content provided.' });
      return;
    }
    sendPreview(textContent);
  } catch (err: any) {
    console.error('Import preview parse error:', err);
    griFailure(res, err, 'Failed to parse import file');
  }
}

// Canonical preview + one-release alias (same handler, same P-only auth).
// The canonical row carries the fresh-password gate (routeGates F-03); the
// legacy alias keeps its parse-only allowlist entry (auth + domain wrapper
// before the parser, nothing written).
router.post('/import/preview', authMiddleware, requireFreshPassword, requireDomainAccess, validateGriIds, upload.single('file'), handleImportPreview);
router.post('/gri/preview', authMiddleware, requireDomainAccess, validateGriIds, upload.single('file'), handleImportPreview);

async function handleImportCommit(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    // INV-IMPORT-SAFE: clientId is DROPPED entirely — supplied -> 400
    // import.client_forbidden (never a tenant write, never provisioning).
    if (hasImportClientScope(req)) {
      importClientForbidden(res);
      return;
    }
    const { standards, serviceId: rawServiceId, importBatchId: rawBatchId } =
      (req.body ?? {}) as { standards?: unknown; serviceId?: unknown; importBatchId?: unknown };
    if (!standards || !Array.isArray(standards) || standards.length === 0) {
      res.status(400).json({ error: 'No valid standards provided for commit.' });
      return;
    }
    // §22/§3.2: EXPLICIT linked serviceId is mandatory — missing -> 400
    // scope.id_required, malformed -> 400 scope.id_invalid (scope.ts codes).
    const serviceId = scopeId(rawServiceId, true)!
    // Row-level validation BEFORE the transaction: any error refuses the
    // commit (400 + per-row errors) with NOTHING written (single txn below).
    const rowErrors = validateCommitStandards(standards);
    if (rowErrors.length > 0) {
      res.status(400).json({
        error: 'Import contains row errors; nothing was written.',
        code: 'import.row_errors',
        rowErrors,
      });
      return;
    }
    const mapped = standards as ParsedGRIStandard[];
    const importBatchId =
      typeof rawBatchId === 'string' && rawBatchId.trim()
        ? rawBatchId.trim().slice(0, 64)
        : `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    // Catalog-only commit under the TARGETLESS platform.config context (P only,
    // RLS + audit). No tenant, no advisory lock, no departments/assignments,
    // no client_services mutation, no guessed standards-to-service mapping.
    const result = await domainTransaction(req,
      async (client) => {
        const user = req.user!;
        // The target service must exist (catalog row, no tenant link needed).
        const svcCheck = await client.query('SELECT id, code FROM services WHERE id = $1', [serviceId]);
        if ((svcCheck.rowCount ?? 0) === 0) {
          throw Object.assign(new Error('Target service not found for the given serviceId.'),
            { statusCode: 404, code: 'service.not_found' });
        }
        let standardsProcessed = 0;
        let disclosuresProcessed = 0;
        let inserted = 0;
        let updated = 0;
        let skipped = 0;
        // P3 frozen-skip (spec API-2 CHANGE, INV-IMPORT-SAFE): catalog rows are
        // GLOBAL, and is_scope_frozen(p_client_id[, p_item_id]) is keyed by
        // tenant — with NO tenant on this path no freeze scope is determinable
        // (a tenant-wide skip loop would need a client; a disclosure-scope
        // check would need one too, and skipping global catalog rows because
        // ANY single tenant froze them would corrupt every other tenant).
        // Therefore skippedFrozen stays 0 here and the reason stays null; the
        // fields + reason are preserved so the response shape is stable if a
        // tenant-independent freeze signal ever exists. Tenant freeze
        // enforcement stays where the tenant exists (answers/evaluations paths
        // + their API/TRIGGER double wall, INV-FREEZE).
        const skippedFrozen = 0;
        const skippedFrozenReason: string | null = null;
        const seenItemKeys = new Set<string>();
        // Payload standards (for the truthful mapped/unmapped notice).
        const payloadStandardIds: string[] = [];

        for (const std of mapped) {
          // Upsert standard
          const stdRes = await client.query(
            `INSERT INTO standards (code, title, category, version)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (code) DO UPDATE SET
             title = EXCLUDED.title, category = EXCLUDED.category, version = EXCLUDED.version
             RETURNING id`,
            [std.code, std.title, std.category, std.version || '2021']
          );
          const standardId = stdRes.rows[0].id;
          payloadStandardIds.push(standardId);
          standardsProcessed++;

          for (const disc of std.disclosures) {
            // Upsert disclosure
            const discRes = await client.query(
              `INSERT INTO disclosures (standard_id, code, title, description)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (standard_id, code) DO UPDATE SET
               title = EXCLUDED.title, description = EXCLUDED.description
               RETURNING id`,
              [standardId, disc.code, disc.title, disc.description || '']
            );
            const disclosureId = discRes.rows[0].id;
            disclosuresProcessed++;

            for (const item of disc.items) {
              const code = (item.code || '').trim();
              if (!code) {
                skipped++;
                continue;
              }
              // De-dupe repeats within a single payload so counts stay accurate.
              const dedupeKey = `${disclosureId}::${code}`;
              if (seenItemKeys.has(dedupeKey)) {
                skipped++;
                continue;
              }
              seenItemKeys.add(dedupeKey);

              // Upsert on the natural key (disclosure_id, code). The UPDATE
              // branch touches descriptive columns ONLY — answers, approvals,
              // evaluations, actions and audit_log rows are never modified.
              // (xmax = 0) is true for freshly inserted rows.
              const upsertRes = await client.query(
                `INSERT INTO items (disclosure_id, code, requirement, answer_type, hint, priority, esg_class, weight,
                                    objective, topic, reference, baseline_gap_percent, baseline_note, sort_order, import_batch_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                 ON CONFLICT (disclosure_id, code) DO UPDATE SET
                   requirement = EXCLUDED.requirement,
                   answer_type = EXCLUDED.answer_type,
                   hint = EXCLUDED.hint,
                   priority = EXCLUDED.priority,
                   esg_class = EXCLUDED.esg_class,
                   weight = EXCLUDED.weight,
                   objective = EXCLUDED.objective,
                   topic = EXCLUDED.topic,
                   reference = EXCLUDED.reference,
                   baseline_gap_percent = EXCLUDED.baseline_gap_percent,
                   baseline_note = EXCLUDED.baseline_note,
                   sort_order = EXCLUDED.sort_order,
                   import_batch_id = EXCLUDED.import_batch_id
                 RETURNING id, (xmax = 0) AS was_inserted`,
                [
                  disclosureId,
                  code,
                  item.requirement,
                  item.answerType || 'text',
                  item.hint || null,
                  item.priority || 'mid',
                  item.esgClass || 'general',
                  weightForPriority(item.priority),
                  item.objective || null,
                  item.topic || null,
                  item.reference || null,
                  item.baselineGapPercent ?? null,
                  item.baselineNote || null,
                  item.sortOrder ?? null,
                  importBatchId,
                ]
              );
              if (upsertRes.rows[0].was_inserted) {
                inserted++;
              } else {
                updated++;
              }
              // P3: NO department auto-provisioning on this path (removed with
              // the client scope). The payload department column, if present,
              // is ignored for writes — it stays visible in preview rows only.
            }
          }
        }

        // Mapped/unmapped notice against the TARGET service (no mapping is ever
        // guessed or created here — POST /services/:id/standards owns mapping).
        // Tenant part of the old setupNotice is REMOVED with the client scope
        // (P3): only the catalog-vs-service mapping remains.
        const mappedRes = await client.query(
          'SELECT standard_id FROM service_standards WHERE service_id = $1 AND standard_id = ANY($2::uuid[])',
          [serviceId, payloadStandardIds]);
        const mappedStandards = mappedRes.rows.length;
        const unmappedStandards = payloadStandardIds.length - mappedStandards;
        const setupNotice = unmappedStandards > 0
          ? `${unmappedStandards} imported standard(s) are not yet mapped to the target service — link them via POST /api/services/:id/standards.`
          : null;

        // Record in the append-only audit log: NULL-tenant platform row
        // (P1-whitelisted IMPORT_CATALOG_COMMITTED branch), same txn.
        await recordAuditLog(client, {
          clientId: null,
          userId: user.id,
          action: 'IMPORT_CATALOG_COMMITTED',
          entityType: 'standards',
          payload: {
            actor: user.id,
            actorRole: user.role,
            serviceId,
            standardsCount: standardsProcessed,
            disclosuresCount: disclosuresProcessed,
            inserted,
            updated,
            skipped,
            skippedFrozen,
            skippedFrozenReason,
            importBatchId,
            mappedStandards,
            unmappedStandards,
          },
        });

        return {
          standardsCount: standardsProcessed,
          disclosuresCount: disclosuresProcessed,
          itemsCount: inserted + updated,
          inserted,
          updated,
          skipped,
          skippedFrozen,
          skippedFrozenReason,
          importBatchId,
          serviceId,
          mappedStandards,
          unmappedStandards,
          setupNotice,
        };
      }, live => platformConfigContext(live)
    );

    res.json({
      success: true,
      message: 'Import committed to the catalog successfully.',
      ...result,
    });
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    console.error('Commit import error:', err);
    griFailure(res, err, 'Failed to commit import data');
  }
}

// Canonical commit + one-release alias (same handler, same P-only auth).
router.post('/import/commit', authMiddleware, requireFreshPassword, requireDomainAccess, validateGriIds, handleImportCommit);
router.post('/gri/commit', authMiddleware, requireFreshPassword, requireDomainAccess, validateGriIds, handleImportCommit);

// Per-service import template (.csv) — P only: authenticated fetch (with the
// platform tab through the wrapper) THEN download; the unauthenticated
// window.location bypass never resolves. GRI columns = current sample; the
// framework serves per-service columns (today: the same GRI adapter).
const IMPORT_TEMPLATE_CSV = `Standard Code,Standard Title,Category,Disclosure Code,Disclosure Title,Item Code,Requirement,Priority,ESG Class,Weight,Answer Type,Hint
GRI 2,General Disclosures 2021,Universal,2-1,Organizational details,2-1-a,Report legal name of the organization,high,governance,1.0,text,Provide registered commercial name
GRI 2,General Disclosures 2021,Universal,2-1,Organizational details,2-1-b,Report the nature of ownership and legal form,mid,governance,1.0,text,e.g. Private LLC, Public Joint Stock
GRI 2,General Disclosures 2021,Universal,2-6,Activities and supply chain,2-6-a,Report the sectors in which the organization is active,mid,general,1.0,text,List primary business activities
GRI 305,Emissions 2016,Environmental,305-1,Direct (Scope 1) GHG emissions,305-1-a,Gross direct GHG emissions in metric tons of CO2 equivalent,high,environmental,2.0,number,Include fuel consumption, refrigerants, company vehicles
GRI 305,Emissions 2016,Environmental,305-2,Energy indirect (Scope 2) GHG emissions,305-2-a,Gross location-based energy indirect GHG emissions,high,environmental,2.0,number,Electricity purchased from grid
GRI 401,Employment 2016,Social,401-1,New employee hires and turnover,401-1-a,Total number and rate of new employee hires during reporting period,mid,social,1.5,number,Breakdown by age and gender
GRI 403,Occupational Health and Safety 2018,Social,403-1,OHS management system,403-1-a,Statement on whether an OHS management system has been implemented,high,social,1.5,boolean,Covering legal requirements and recognized standards
`;

function handleImportTemplate(req: AuthenticatedRequest, res: Response): void {
  try {
    // P3: no client context on this path either.
    if (hasImportClientScope(req)) {
      importClientForbidden(res);
      return;
    }
    // Service id comes from the canonical path param, else an explicit query
    // (alias path); missing -> 400 scope.id_required, malformed -> 400
    // scope.id_invalid (scope.ts codes). Existence is NOT checked here — the
    // template is per-service columns, served without touching catalog rows.
    const rawId = (req.params as Record<string, unknown>).id ?? (req.query as Record<string, unknown>).serviceId;
    scopeId(rawId, true);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="Import_Template.csv"');
    res.send(IMPORT_TEMPLATE_CSV);
  } catch (err: any) {
    griFailure(res, err, 'Failed to fetch import template');
  }
}

// Canonical per-service template + one-release alias (same handler, P only).
router.get('/services/:id/import/template', authMiddleware, requireDomainAccess, validateGriIds, handleImportTemplate);
router.get('/gri/template', authMiddleware, requireDomainAccess, validateGriIds, handleImportTemplate);

// ----------------------------------------------------------------------
// 5. Standards & Items Listing — §3.2 (U2-C): P catalog / W-C L / E L+D
// content metadata only; the optional-auth mount is GONE (authenticated P/W/
// C/E callers only). The C1 catalog policies scope every joined row, so
// disclosure_count/item_count are computed over AUTHORIZED rows only —
// zero links returns an empty list, never global content or foreign counts.
// ----------------------------------------------------------------------
router.get('/standards', authMiddleware, requireDomainAccess, validateGriIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isDatabaseConfigured()) {
      return res.json([]);
    }

    const rows = await domainTransaction(req, async (client) => {
      // Fetch standards with count of disclosures and items
      const query = `
        SELECT s.id, s.code, s.title, s.category, s.version, s.created_at,
               COUNT(DISTINCT d.id)::int as disclosure_count,
               COUNT(DISTINCT i.id)::int as item_count
        FROM standards s
        LEFT JOIN disclosures d ON d.standard_id = s.id
        LEFT JOIN items i ON i.disclosure_id = d.id
        GROUP BY s.id, s.code, s.title, s.category, s.version, s.created_at
        ORDER BY s.code ASC;
      `;

      const result = await client.query(query);
      return result.rows;
    }, readContext);

    res.json(rows);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    griFailure(res, err, 'Failed to fetch standards');
  }
});

// ----------------------------------------------------------------------
// 6. Dashboard Stats (Evaluations, Review Coverage, Gap Analysis)
// §3.2 (U2-C): W/C L+V ONLY — no P, no E, no anonymous (the matrix refuses
// them before this handler runs); optional-auth mount removed. §6/D3:
// show_gap is enforced SERVER-SIDE — for C every score/gap field returns
// null when the tenant's linked services hide gaps (the RLS evaluations
// policy hides the rows at the same time). Numerator AND denominator come
// from RLS-scoped rows, so overlapping service mappings never duplicate an
// item. show_corrective has no metric here: N/A for stats (§23 D3, recorded).
// ----------------------------------------------------------------------
router.get('/dashboard/stats', authMiddleware, requireDomainAccess, validateGriIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isDatabaseConfigured()) {
      return res.json({
        hasData: false,
        standardsCount: 0,
        itemsCount: 0,
        aggregateScore: null,
        coveragePercentage: 0,
        fullGapCount: 0,
        partialGapCount: 0,
        noGapCount: 0,
      });
    }

    const data = await domainTransaction(req, async (client) => {
      const access = req.access!;
      // Check if standards and items exist
      const itemsCountRes = await client.query('SELECT COUNT(*)::int as count FROM items');
      const itemsCount = itemsCountRes.rows[0]?.count || 0;

      const stdCountRes = await client.query('SELECT COUNT(*)::int as count FROM standards');
      const standardsCount = stdCountRes.rows[0]?.count || 0;

      if (itemsCount === 0) {
        return {
          hasData: false,
          standardsCount: 0,
          itemsCount: 0,
          aggregateScore: null,
          coveragePercentage: 0,
          fullGapCount: 0,
          partialGapCount: 0,
          noGapCount: 0,
        };
      }

      // Fetch evaluations if tenant is present.
      // F-01 (binding OD-03 follow-up) + B9 WF-02: aggregates AND coverage
      // count only evaluations whose linked answers.status
      // IN ('submitted','approved','client_approved').
      // Drafts stay visible in the queue/history but are gated out here via
      // gateDraftEvaluations (treated exactly as not-yet-evaluated).
      let evalQuery = `
        SELECT i.id as item_id, i.weight::float as weight,
               e.score, e.not_evaluated, e.not_applicable, e.justification, e.note,
               (e.id IS NOT NULL) AS has_evaluation,
               EXISTS (
                 SELECT 1 FROM answers a2
                 WHERE a2.item_id = i.id
                   AND a2.client_id = e.client_id
                    AND a2.status IN ('submitted', 'approved', 'client_approved')
               ) AS has_submitted
        FROM items i
        LEFT JOIN evaluations e ON e.item_id = i.id AND e.client_id = $1
      `;
      // §5: every W/C statement uses the server-resolved tenant (never a
      // request value); RLS adds the L / show_gap gates on top.
      const params: any[] = [access.tenantId];

      const evalRes = await client.query(evalQuery, params);
      const evalRecords = gateDraftEvaluations(
        evalRes.rows.map((row): DashboardSourceRow => ({
          itemId: row.item_id,
          weight: row.weight || 1.0,
          score: row.score !== null && row.score !== undefined ? (Number(row.score) as 0 | 50 | 100) : null,
          notEvaluated: Boolean(row.not_evaluated),
          notApplicable: Boolean(row.not_applicable),
          justification: row.justification,
          note: row.note,
          hasEvaluation: row.has_evaluation === true,
          hasSubmittedAnswer: row.has_submitted === true,
        }))
      );

      const scoreResult = calculateAggregateScore(evalRecords);

      // show_gap redaction (§6 / §23 D3): for C, once the linked services hide
      // gaps, EVERY score/gap/coverage field returns null — never a fabricated
      // 0 — while the workflow-truthful counts (hasData, standards/items/
      // totalCount) stay. W is not gated (GE review retains access within A).
      if (access.mode === 'client') {
        const flag = await client.query(
          'SELECT COALESCE(bool_or(show_gap), false) AS v FROM client_services WHERE client_id = $1',
          [access.tenantId]);
        if (flag.rows[0]?.v !== true) {
          return {
            hasData: true,
            standardsCount,
            itemsCount,
            aggregateScore: null,
            evaluatedCount: null,
            applicableCount: null,
            totalCount: scoreResult.totalCount,
            notApplicableCount: null,
            notEvaluatedCount: null,
            coverageRatio: null,
            coveragePercentage: null,
            fullGapCount: null,
            partialGapCount: null,
            noGapCount: null,
          };
        }
      }

      return {
        hasData: true,
        standardsCount,
        itemsCount,
        ...scoreResult,
      };
    }, readContext);

    res.json(data);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    griFailure(res, err, 'Failed to fetch dashboard stats');
  }
});

export default router;
