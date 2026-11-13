// B12 (R-01) — GRI sub-router: import preview/commit, template, standards
// listing, dashboard stats. B17 U2-C (task §22/§24): all 5 declarations are
// retrofitted through requireDomainAccess and activated —
// - POST /gri/preview: P ONLY, authenticated BEFORE the upload parser
//   (the optional-auth public path is closed; F-03 allowlist entry stays
//   because the wrapper itself enforces fresh identity and nothing is written).
// - POST /gri/commit: P explicit T + EXPLICIT linked serviceId, everything
//   under platform.config(T): catalog upsert, target-tenant department/
//   assignment provisioning via the ratified C1 policies, freeze via the
//   fact-gated is_scope_frozen, truthful unmapped-standard notice; NO
//   client_services mutation and NO guessed standards→service mapping.
// - GET /gri/template: P ONLY (auth + wrapper before download).
// - GET /standards: P catalog / W-C L / E L+D content metadata (optional auth
//   removed); counts are computed over RLS-authorized rows only.
// - GET /dashboard/stats: W/C L+V ONLY (matrix refuses P/E/anonymous); every
//   score/gap field is redacted to null for C when show_gap hides gaps (§6/D3);
//   numerator AND denominator come from RLS-scoped rows, so overlapping
//   service mappings can never duplicate an item; show_corrective is
//   NOT-APPLICABLE to stats (§23 D3, recorded).

import express, { type Response } from 'express';
import multer from 'multer';
import {
  isDatabaseConfigured,
  withTenantContext,
  recordAuditLog,
} from '../../db/index.ts';
import { authMiddleware, type AuthenticatedRequest } from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import { parseGRIFile, type ParsedGRIStandard } from '../../lib/griParser.ts';
import { calculateAggregateScore, gateDraftEvaluations, type DashboardSourceRow } from '../../lib/scoring.ts';
import { resolveImportTenant } from '../../lib/tenantAccess.ts';
import { scopeId, scopeError } from '../scope.ts';
import { readContext, platformConfigContext, requireFreshPassword, B16_CLIENT_GRI_REFUSAL } from './_shared.ts';

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
// 4. Import GRI Data (.xlsx / .csv) — P only, AUTHENTICATED BEFORE the parser
// (§3.2: the previous public preview closes; auth + the domain wrapper —
// including fresh-identity and suspension gates — run before multer or
// parseGRIFile ever touch the payload).
// ----------------------------------------------------------------------
router.post('/gri/preview', authMiddleware, requireDomainAccess, upload.single('file'),
  (req: AuthenticatedRequest, res: Response) => {
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

router.post('/gri/commit', authMiddleware, requireFreshPassword, requireDomainAccess,
  async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    // B16-B2: GRI import is GE-only (the wrapper's P-only matrix already
    // refuses client roles; this keeps the bilingual refusal as defence-in-depth).
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: B16_CLIENT_GRI_REFUSAL });
    }

    const { standards, clientId: rawClientId, serviceId: rawServiceId } =
      req.body as { standards: ParsedGRIStandard[]; clientId?: unknown; serviceId?: unknown };
    if (!standards || !Array.isArray(standards) || standards.length === 0) {
      return res.status(400).json({ error: 'No valid standards provided for commit.' });
    }
    // §22/§3.2: EXPLICIT linked serviceId is mandatory — missing -> 400
    // scope.id_required, malformed -> 400 scope.id_invalid (scope.ts codes).
    const serviceId = scopeId(rawServiceId, true)!;

    // B1/B2: ge_admin may target any tenant explicitly; tenant-less ge_admin
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

    // §24 R5 invariant: purpose/target are SERVER-selected here — target T is
    // the validated explicit clientId, purpose the constant platform.config.
    // Runs in the C1 target-bound configuration context (RLS + audit).
    const result = await withTenantContext(
      platformConfigContext(req, effectiveClientId),
      async (client) => {
        // The explicit tenant must exist (ge_admin names it by id).
        const tenantCheck = await client.query('SELECT id, code, name FROM clients WHERE id = $1', [effectiveClientId]);
        if ((tenantCheck.rowCount ?? 0) === 0) {
          throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
        }
        // §22: the service must ALREADY be linked to T — selecting it never
        // grants a subscription (row-free fact check under platform.config(T);
        // zero client_services mutation on every path, denied otherwise).
        const linked = await client.query(
          "SELECT b17_content_fact('service', $1, $2) AS ok", [effectiveClientId, serviceId]);
        if (!linked.rows[0]?.ok) {
          throw scopeError(403, 'scope.service_unlinked');
        }
        let standardsProcessed = 0;
        let disclosuresProcessed = 0;
        let inserted = 0;
        let updated = 0;
        let skipped = 0;
        // B9-B3: frozen rows are skipped with reason, never touched.
        let skippedFrozen = 0;
        const seenItemKeys = new Set<string>();
        // Payload standards (for the truthful mapped/unmapped setup notice, §6).
        const payloadStandardIds: string[] = [];
        const importBatchId = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        // normCode -> { display name from payload, item ids needing assignment }
        const deptToItemIds = new Map<string, { name: string; itemIds: string[] }>();

        // B9-B3 / §23 D2 (U2-C2): freeze detection runs through the FACT-GATED
        // is_scope_frozen under platform.config(T) — raw snapshot rows stay
        // invisible to every context (C1 proved), while the boolean semantics
        // are unchanged: a tenant-scope snapshot freezes the whole import and a
        // disclosure-scope snapshot skips that disclosure's rows.
        const frozenRes = await client.query('SELECT is_scope_frozen($1) AS frozen', [effectiveClientId]);
        const tenantFrozen = frozenRes.rows[0]?.frozen === true;
        const disclosureFrozenCache = new Map<string, boolean>();
        const disclosureFrozen = async (disclosureId: string): Promise<boolean> => {
          if (tenantFrozen) return true;
          const cached = disclosureFrozenCache.get(disclosureId);
          if (cached !== undefined) return cached;
          // A disclosure-scope snapshot implies evaluations existed, so at least
          // one catalog item is already present; without items nothing can
          // reference this disclosure and it is not frozen.
          const anyItem = await client.query('SELECT id FROM items WHERE disclosure_id = $1 LIMIT 1', [disclosureId]);
          let frozen = false;
          if (anyItem.rows[0]) {
            const r = await client.query('SELECT is_scope_frozen($1, $2) AS frozen',
              [effectiveClientId, anyItem.rows[0].id]);
            frozen = r.rows[0]?.frozen === true;
          }
          disclosureFrozenCache.set(disclosureId, frozen);
          return frozen;
        };

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

              // B9-B3 (WF-05): re-imports must NEVER touch frozen rows. Frozen
              // items skip tenant provisioning (departments/assignments) and
              // are counted as skipped with reason. The shared catalog upsert
              // below stays descriptive-only (never touches tenant rows).
              if (await disclosureFrozen(disclosureId)) {
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

        // §6 setup notice: TRUTHFUL mapped/unmapped counts for this payload
        // against the already-linked target service — no mapping is ever
        // guessed or created here (POST /services/:id/standards owns mapping).
        const mappedRes = await client.query(
          'SELECT standard_id FROM service_standards WHERE service_id = $1 AND standard_id = ANY($2::uuid[])',
          [serviceId, payloadStandardIds]);
        const mappedStandards = mappedRes.rows.length;
        const unmappedStandards = payloadStandardIds.length - mappedStandards;
        const setupNotice = unmappedStandards > 0
          ? `${unmappedStandards} imported standard(s) are not yet mapped to the target service — link them via POST /api/services/:id/standards before tenant assignments become authorized.`
          : null;

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
          serviceId,
          mappedStandards,
          unmappedStandards,
          setupNotice,
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

// Download sample GRI template (.csv) — P only: authenticated fetch (with the
// platform tab through the wrapper) THEN download; the unauthenticated
// window.location bypass no longer resolves (§3.2).
router.get('/gri/template', authMiddleware, requireDomainAccess, (_req: AuthenticatedRequest, res: Response) => {
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
// 5. Standards & Items Listing — §3.2 (U2-C): P catalog / W-C L / E L+D
// content metadata only; the optional-auth mount is GONE (authenticated P/W/
// C/E callers only). The C1 catalog policies scope every joined row, so
// disclosure_count/item_count are computed over AUTHORIZED rows only —
// zero links returns an empty list, never global content or foreign counts.
// ----------------------------------------------------------------------
router.get('/standards', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isDatabaseConfigured()) {
      return res.json([]);
    }

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
// §3.2 (U2-C): W/C L+V ONLY — no P, no E, no anonymous (the matrix refuses
// them before this handler runs); optional-auth mount removed. §6/D3:
// show_gap is enforced SERVER-SIDE — for C every score/gap field returns
// null when the tenant's linked services hide gaps (the RLS evaluations
// policy hides the rows at the same time). Numerator AND denominator come
// from RLS-scoped rows, so overlapping service mappings never duplicate an
// item. show_corrective has no metric here: N/A for stats (§23 D3, recorded).
// ----------------------------------------------------------------------
router.get('/dashboard/stats', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
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

    const access = req.access!;

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
    });

    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch dashboard stats' });
  }
});

export default router;
