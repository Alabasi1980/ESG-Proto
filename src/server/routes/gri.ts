// B12 (R-01) — GRI sub-router: import preview/commit, template, standards
// listing, dashboard stats. Mounted by src/server/routes.ts under /api.
// Moved verbatim; B12 wiring: POST /gri/commit carries requireFreshPassword
// (F-03). POST /gri/preview stays ungated (F-03 allowlist: unauthenticated
// parse-only preview — no user exists to check).

import express, { type Request, type Response } from 'express';
import multer from 'multer';
import {
  isDatabaseConfigured,
  withTenantContext,
  recordAuditLog,
} from '../../db/index.ts';
import {
  authMiddleware,
  optionalAuthMiddleware,
  type AuthenticatedRequest,
} from '../auth.ts';
import { parseGRIFile, type ParsedGRIStandard } from '../../lib/griParser.ts';
import { calculateAggregateScore, gateDraftEvaluations, type DashboardSourceRow } from '../../lib/scoring.ts';
import { resolveImportTenant } from '../../lib/tenantAccess.ts';
import { contextFromUser, readContext, requireFreshPassword, B16_CLIENT_GRI_REFUSAL } from './_shared.ts';

const router = express.Router();

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  storage: multer.memoryStorage(),
});

/** Deterministic department code from a workbook department name. */
function normalizeDepartmentCode(name: string): string {
  const code = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return code || 'dept';
}

/** Weight is derived from priority (mirrors enforce_item_weight_priority in schema). */
function weightForPriority(priority?: string): number {
  return priority === 'high' ? 3 : priority === 'low' ? 1 : 2;
}

// ----------------------------------------------------------------------
// 4. Import GRI Data (.xlsx / .csv)
// ----------------------------------------------------------------------
router.post('/gri/preview', upload.single('file'), (req: Request, res: Response) => {
  try {
    if (!req.file && !req.body.csvContent) {
      return res.status(400).json({ error: 'No file or CSV content provided.' });
    }

    const content = req.file ? req.file.buffer : req.body.csvContent;
    const parseResult = parseGRIFile(content);

    res.json(parseResult);
  } catch (err: any) {
    console.error('GRI preview parse error:', err);
    res.status(500).json({ error: err.message || 'Failed to parse GRI file' });
  }
});

router.post('/gri/commit', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    // B16-B2: GRI import is GE-only. Client roles review imports read-only.
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: B16_CLIENT_GRI_REFUSAL });
    }

    const { standards, clientId: rawClientId } = req.body as { standards: ParsedGRIStandard[]; clientId?: unknown };
    if (!standards || !Array.isArray(standards) || standards.length === 0) {
      return res.status(400).json({ error: 'No valid standards provided for commit.' });
    }

    // B1/B2: ge_admin may target any tenant explicitly; client_admin always
    // uses their own tenant (another tenant → 403); tenant-less ge_admin
    // without clientId → 400 "choose a tenant" (never orphan rows).
    const tenantResolution = resolveImportTenant(
      { id: user.id, role: user.role, clientId: user.clientId ?? null },
      rawClientId
    );
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const effectiveClientId = tenantResolution.effectiveClientId;
    const explicitTenant = tenantResolution.explicit;

    // Run in tenant context to enforce RLS and audit log
    const result = await withTenantContext(
      contextFromUser(user),
      async (client) => {
        // The explicit tenant must exist (ge_admin names it by id).
        const tenantCheck = await client.query('SELECT id, code, name FROM clients WHERE id = $1', [effectiveClientId]);
        if ((tenantCheck.rowCount ?? 0) === 0) {
          throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
        }
        let standardsProcessed = 0;
        let disclosuresProcessed = 0;
        let inserted = 0;
        let updated = 0;
        let skipped = 0;
        // B9-B3: frozen rows are skipped with reason, never touched.
        let skippedFrozen = 0;
        const seenItemKeys = new Set<string>();
        const importBatchId = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        // normCode -> { display name from payload, item ids needing assignment }
        const deptToItemIds = new Map<string, { name: string; itemIds: string[] }>();

        // B9-B3: snapshot-derived frozen scopes for the effective tenant.
        const frozenSnapRes = await client.query(
          'SELECT scope_type, scope_ref FROM review_snapshots WHERE client_id = $1',
          [effectiveClientId]
        );
        const tenantFrozen = frozenSnapRes.rows.some((r) => r.scope_type === 'tenant');
        const frozenDisclosureIds = new Set(
          frozenSnapRes.rows.filter((r) => r.scope_type === 'disclosure').map((r) => String(r.scope_ref))
        );

        for (const std of standards) {
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

              // B9-B3 (WF-05): re-imports must NEVER touch frozen rows. Frozen
              // items skip tenant provisioning (departments/assignments) and
              // are counted as skipped with reason. The shared catalog upsert
              // below stays descriptive-only (never touches tenant rows).
              if (tenantFrozen || frozenDisclosureIds.has(disclosureId)) {
                skipped++;
                skippedFrozen++;
                continue;
              }

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
              const row = upsertRes.rows[0];
              if (row.was_inserted) {
                inserted++;
              } else {
                updated++;
              }

              const deptName = (item.department || '').trim();
              if (deptName) {
                const normCode = normalizeDepartmentCode(deptName);
                const entry = deptToItemIds.get(normCode) || { name: deptName, itemIds: [] };
                entry.itemIds.push(row.id);
                deptToItemIds.set(normCode, entry);
              }
            }
          }
        }

        // Auto-provision tenant departments + assignments for departments named
        // in the payload. Uses the EFFECTIVE tenant (the explicit one for
        // ge_admin). Departments upsert on (client_id, code); assignments are
        // INSERT ... ON CONFLICT DO NOTHING, so re-imports change nothing.
        let departmentsUpserted = 0;
        let assignmentsCreated = 0;
        if (deptToItemIds.size > 0) {
          for (const [deptCode, entry] of deptToItemIds) {
            const deptRes = await client.query(
              `INSERT INTO departments (client_id, code, name)
               VALUES ($1, $2, $3)
               ON CONFLICT (client_id, code) DO UPDATE SET name = EXCLUDED.name
               RETURNING id`,
              [effectiveClientId, deptCode, entry.name]
            );
            departmentsUpserted++;
            const departmentId = deptRes.rows[0].id;
            if (entry.itemIds.length > 0) {
              const params: any[] = [effectiveClientId, departmentId, ...entry.itemIds];
              const placeholders = entry.itemIds.map((_, i) => `($1, $${i + 3}, $2)`).join(', ');
              const assignRes = await client.query(
                `INSERT INTO assignments (client_id, item_id, department_id)
                 VALUES ${placeholders}
                 ON CONFLICT DO NOTHING
                 RETURNING id`,
                params
              );
              assignmentsCreated += assignRes.rowCount || 0;
            }
          }
        }

        // Record in append-only audit log (explicit-tenant commits carry
        // actor + targetTenant + counts per B1).
        await recordAuditLog(client, {
          clientId: effectiveClientId,
          userId: user.id,
          action: 'IMPORT_GRI_DISCLOSURES',
          entityType: 'standards',
          payload: {
            actor: user.id,
            actorRole: user.role,
            targetTenant: effectiveClientId,
            explicitTenant,
            standardsCount: standardsProcessed,
            disclosuresCount: disclosuresProcessed,
            inserted,
            updated,
            skipped,
            skippedFrozen,
            skippedFrozenReason: skippedFrozen > 0 ? 'frozen-scope (GE final snapshot): rows skipped, never touched' : null,
            importBatchId,
            departmentsUpserted,
            assignmentsCreated,
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
          skippedFrozenReason: skippedFrozen > 0 ? 'frozen-scope (GE final snapshot): rows skipped, never touched' : null,
          importBatchId,
          departmentsUpserted,
          assignmentsCreated,
        };
      }
    );

    res.json({
      success: true,
      message: 'GRI standard disclosures committed successfully.',
      ...result,
    });
  } catch (err: any) {
    console.error('Commit GRI error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to commit GRI data' });
  }
});

// Download sample GRI template (.csv)
router.get('/gri/template', (_req: Request, res: Response) => {
  const sampleCsv = `Standard Code,Standard Title,Category,Disclosure Code,Disclosure Title,Item Code,Requirement,Priority,ESG Class,Weight,Answer Type,Hint
GRI 2,General Disclosures 2021,Universal,2-1,Organizational details,2-1-a,Report legal name of the organization,high,governance,1.0,text,Provide registered commercial name
GRI 2,General Disclosures 2021,Universal,2-1,Organizational details,2-1-b,Report the nature of ownership and legal form,mid,governance,1.0,text,e.g. Private LLC, Public Joint Stock
GRI 2,General Disclosures 2021,Universal,2-6,Activities and supply chain,2-6-a,Report the sectors in which the organization is active,mid,general,1.0,text,List primary business activities
GRI 305,Emissions 2016,Environmental,305-1,Direct (Scope 1) GHG emissions,305-1-a,Gross direct GHG emissions in metric tons of CO2 equivalent,high,environmental,2.0,number,Include fuel consumption, refrigerants, company vehicles
GRI 305,Emissions 2016,Environmental,305-2,Energy indirect (Scope 2) GHG emissions,305-2-a,Gross location-based energy indirect GHG emissions,high,environmental,2.0,number,Electricity purchased from grid
GRI 401,Employment 2016,Social,401-1,New employee hires and turnover,401-1-a,Total number and rate of new employee hires during reporting period,mid,social,1.5,number,Breakdown by age and gender
GRI 403,Occupational Health and Safety 2018,Social,403-1,OHS management system,403-1-a,Statement on whether an OHS management system has been implemented,high,social,1.5,boolean,Covering legal requirements and recognized standards
`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="GRI_Disclosure_Template.csv"');
  res.send(sampleCsv);
});

// ----------------------------------------------------------------------
// 5. Standards & Items Listing
// ----------------------------------------------------------------------
router.get('/standards', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isDatabaseConfigured()) {
      return res.json([]);
    }

    // Explicit tenant context (caller's, or empty for anonymous): under
    // FORCE RLS the items join only sees rows the caller may see.
    const rows = await withTenantContext(readContext(req), async (client) => {
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
    });

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch standards' });
  }
});

// ----------------------------------------------------------------------
// 6. Dashboard Stats (Evaluations, Review Coverage, Gap Analysis)
// ----------------------------------------------------------------------
router.get('/dashboard/stats', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
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

    const user = req.user;

    const data = await withTenantContext(readContext(req), async (client) => {
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
        LEFT JOIN evaluations e ON e.item_id = i.id
      `;
      const params: any[] = [];
      if (user?.clientId) {
        evalQuery += ` AND e.client_id = $1`;
        params.push(user.clientId);
      }

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

      return {
        hasData: true,
        standardsCount,
        itemsCount,
        ...scoreResult,
      };
    });

    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch dashboard stats' });
  }
});

export default router;
