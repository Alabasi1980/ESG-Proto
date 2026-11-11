import express, { type Request, type Response } from 'express';
import multer from 'multer';
import {
  clientApproveGate,
  clientApproveRefusalMessage,
  geFinalGate,
  isGeFinalScope,
  checkVersion,
  validateAttachment,
  MAX_ATTACHMENT_BYTES,
  STORAGE_WARN_BYTES,
  formatBytes,
  snapshotContentHash,
} from '../lib/approvalChain.ts';
import {
  isDatabaseConfigured,
  withTenantContext,
  recordAuditLog,
  runMigrations,
  checkDatabaseHealth,
} from '../db/index.ts';
import type { TenantContext } from '../db/index.ts';
import {
  authMiddleware,
  optionalAuthMiddleware,
  hashPassword,
  comparePassword,
  generateToken,
  type AuthenticatedRequest,
  type AuthUser,
} from './auth.ts';
import { parseGRIFile, type ParsedGRIStandard } from '../lib/griParser.ts';
import { calculateAggregateScore, gateDraftEvaluations, type DashboardSourceRow } from '../lib/scoring.ts';import { resolveImportTenant, validateNewUser } from '../lib/tenantAccess.ts';
import {
  ACTION_STATUSES,
  actionTransitionRequiresAdmin,
  actionTransitionRequiresReason,
  canTransitionAction,
  isActionStatus,
  type ActionStatus,
} from '../lib/actions.ts';
import {
  REPORT_GATE_CODE,
  REPORT_GATE_REFUSAL,
  applyDepartmentVisibility,
  applyShowGapFlags,
  buildDisclosureIndex,
  indexIncompleteMessage,
  indexToCSV,
  isNotifiedState,
  isReportLevel,
  reportGateStatus,
  validateReportSettingsInput,
} from '../lib/reports.ts';
import { calculateEsgProfileScore } from '../lib/esgProfile.ts';
import { esgProfileTextToRating, initiativeNaturalKey } from '../lib/initiatives.ts';

const router = express.Router();
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  storage: multer.memoryStorage(),
});

// OD-06 (demo-scale): evidence attachments stay in DB bytea with a 5 MB cap.
// Production object-storage migration is explicitly out of scope. The limit is
// enforced twice: multer rejects oversize streams early, and the route
// re-checks size + mime via validateAttachment() (never trust the client).
const attachmentUpload = multer({
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  storage: multer.memoryStorage(),
});

// ----------------------------------------------------------------------
// Tenant-context helpers (fix batch 1: every data query runs under an
// explicit RLS context because the app connects as table owner and
// FORCE ROW LEVEL SECURITY is now enabled).
// ----------------------------------------------------------------------

/**
 * Elevated service context (ge_admin). Used ONLY for bootstrap/health
 * internals that must see true counts under FORCE RLS:
 * users-count checks, the pre-authentication login lookup, and
 * unauthenticated health counters. It is never used to return tenant rows.
 */
const ELEVATED_CONTEXT: TenantContext = {
  tenantId: null,
  role: 'ge_admin',
  departmentId: null,
  userId: null,
};

function contextFromUser(user?: AuthUser | null): TenantContext {
  return {
    tenantId: user?.clientId ?? null,
    role: user?.role ?? '',
    departmentId: user?.departmentId ?? null,
    userId: user?.id ?? null,
  };
}

/** Context for optional-auth reads: caller's context, or an empty one (global rows only). */
function readContext(req: AuthenticatedRequest): TenantContext {
  return req.user ? contextFromUser(req.user) : { tenantId: null, role: '', departmentId: null, userId: null };
}

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
// 1. Database & Health Status
// ----------------------------------------------------------------------
router.get('/db/status', async (_req: Request, res: Response) => {
  try {
    const configured = isDatabaseConfigured();
    if (!configured) {
      return res.json({
        configured: false,
        connected: false,
        tableCount: 0,
        tables: [],
        userCount: 0,
        error: 'DATABASE_URL environment variable is missing.',
      });
    }

    const health = await checkDatabaseHealth();
    let userCount = 0;

    if (health.connected && health.tables.includes('users')) {
      // Explicit elevated context so the count stays correct under FORCE RLS.
      userCount = await withTenantContext(ELEVATED_CONTEXT, async (client) => {
        const countRes = await client.query('SELECT COUNT(*)::int as count FROM users');
        return countRes.rows[0]?.count || 0;
      });
    }

    res.json({
      configured: true,
      connected: health.connected,
      tableCount: health.tableCount,
      tables: health.tables,
      userCount,
      error: health.error,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Database status check failed' });
  }
});

// Run migrations (Create tables, RLS policies, triggers)
router.post('/db/migrate', async (_req: Request, res: Response) => {
  try {
    if (!isDatabaseConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'DATABASE_URL environment variable is not defined.',
      });
    }

    const result = await runMigrations();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Migration failed' });
  }
});

// ----------------------------------------------------------------------
// 2. Initial Setup (First Admin Bootstrap — exactly once)
// ----------------------------------------------------------------------
router.get('/setup/status', async (_req: Request, res: Response) => {
  try {
    if (!isDatabaseConfigured()) {
      return res.json({ canSetup: false, reason: 'Database is not configured' });
    }

    const health = await checkDatabaseHealth();
    if (!health.connected || !health.tables.includes('users')) {
      return res.json({ canSetup: true, needsMigration: true });
    }

    // Elevated context: the users table is FORCE RLS; only an explicit
    // ge_admin context sees the true count for the bootstrap guard.
    const userCount = await withTenantContext(ELEVATED_CONTEXT, async (client) => {
      const countRes = await client.query('SELECT COUNT(*)::int as count FROM users');
      return countRes.rows[0]?.count || 0;
    });

    res.json({
      canSetup: userCount === 0,
      userCount,
      needsMigration: false,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/setup/admin', async (req: Request, res: Response) => {
  try {
    const { email, password, name, role = 'ge_admin', clientName, clientCode } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    // Ensure tables exist (DDL as owner; unaffected by RLS)
    await runMigrations();

    // Bootstrap guard: works exactly once while users is empty.
    // Count runs under an elevated context so FORCE RLS cannot hide existing users.
    const existingCount = await withTenantContext(ELEVATED_CONTEXT, async (client) => {
      const userCheck = await client.query('SELECT COUNT(*)::int as count FROM users');
      return userCheck.rows[0]?.count || 0;
    });
    if (existingCount > 0) {
      return res.status(403).json({ error: 'Initial setup has already been completed.' });
    }

    const passwordHash = await hashPassword(password);

    const created = await withTenantContext(ELEVATED_CONTEXT, async (client) => {
      let createdClientId: string | null = null;
      let finalRole: 'ge_admin' | 'client_admin' | 'employee' = role;

      // If client details are provided, create client tenant
      if (clientName && clientCode) {
        const clientRes = await client.query(
          `INSERT INTO clients (code, name) VALUES ($1, $2) RETURNING id`,
          [clientCode.trim(), clientName.trim()]
        );
        createdClientId = clientRes.rows[0].id;
        finalRole = 'client_admin';
      }

      const userRes = await client.query(
        `INSERT INTO users (email, password_hash, name, role, client_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, name, role, client_id`,
        [email.toLowerCase().trim(), passwordHash, name.trim(), finalRole, createdClientId]
      );

      const newUser = userRes.rows[0];

      // Record in audit log
      await recordAuditLog(client, {
        clientId: createdClientId,
        userId: newUser.id,
        action: 'BOOTSTRAP_INITIAL_ADMIN',
        entityType: 'users',
        entityId: newUser.id,
        payload: { email: newUser.email, role: newUser.role },
      });

      return { newUser, createdClientId };
    });

    const authUser: AuthUser = {
      id: created.newUser.id,
      email: created.newUser.email,
      name: created.newUser.name,
      role: created.newUser.role,
      clientId: created.newUser.client_id,
      clientName: clientName || null,
    };

    const token = generateToken(authUser);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ token, user: authUser });
  } catch (err: any) {
    console.error('Setup admin error:', err);
    res.status(500).json({ error: err.message || 'Failed to create initial admin user' });
  }
});

// ----------------------------------------------------------------------
// 3. Authentication (Login, Logout, Change Password, Me)
// ----------------------------------------------------------------------
router.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    if (!isDatabaseConfigured()) {
      return res.status(503).json({ error: 'Database connection is not configured.' });
    }

    // Pre-authentication lookup runs under an elevated context: the users
    // table is FORCE RLS and there is no caller context yet. Password
    // verification still applies; RLS scoping resumes after login.
    const outcome = await withTenantContext(ELEVATED_CONTEXT, async (client) => {
      const result = await client.query(
        `SELECT u.id, u.email, u.name, u.password_hash, u.role, u.client_id, u.department_id, u.is_active,
                c.name as client_name, d.name as department_name
         FROM users u
         LEFT JOIN clients c ON u.client_id = c.id
         LEFT JOIN departments d ON u.department_id = d.id
         WHERE LOWER(u.email) = LOWER($1)`,
        [email.trim()]
      );

      const userRow = result.rows[0];
      if (!userRow) {
        return null;
      }

      const valid = await comparePassword(password, userRow.password_hash);
      if (!valid) {
        return null;
      }

      // C1: deactivated accounts fail closed with a human message (still 401,
      // only after a correct password so the existence signal stays minimal).
      if (userRow.is_active === false) {
        return { deactivated: true as const };
      }

      const authUser: AuthUser = {
        id: userRow.id,
        email: userRow.email,
        name: userRow.name,
        role: userRow.role,
        clientId: userRow.client_id,
        clientName: userRow.client_name,
        departmentId: userRow.department_id,
        departmentName: userRow.department_name,
      };

      const token = generateToken(authUser);

      // Record audit log
      await recordAuditLog(client, {
        clientId: authUser.clientId,
        userId: authUser.id,
        action: 'USER_LOGIN',
        entityType: 'users',
        entityId: authUser.id,
      });

      return { token, authUser };
    });

    if (!outcome) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if ('deactivated' in outcome) {
      return res.status(401).json({ error: 'Your account has been deactivated. Please contact your administrator.' });
    }

    res.cookie('token', outcome.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ token: outcome.token, user: outcome.authUser });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message || 'Login failed' });
  }
});

router.post('/auth/logout', (req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully.' });
});

router.get('/auth/me', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  res.json({ user: req.user });
});

router.post('/auth/change-password', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const user = req.user!;

    await withTenantContext(contextFromUser(user), async (client) => {
      const userQuery = await client.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
      const currentHash = userQuery.rows[0]?.password_hash;
      if (!currentHash) {
        throw Object.assign(new Error('User not found.'), { statusCode: 404 });
      }

      const matches = await comparePassword(currentPassword, currentHash);
      if (!matches) {
        throw Object.assign(new Error('Current password is incorrect.'), { statusCode: 400 });
      }

      const newHash = await hashPassword(newPassword);
      await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, user.id]);

      await recordAuditLog(client, {
        clientId: user.clientId,
        userId: user.id,
        action: 'PASSWORD_CHANGED',
        entityType: 'users',
        entityId: user.id,
      });
    });

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err: any) {
    console.error('Change password error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update password' });
  }
});

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

router.post('/gri/commit', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin' && user.role !== 'client_admin') {
      return res.status(403).json({ error: 'Only administrators can import GRI standard disclosures.' });
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
             ON CONFLICT (code) DO UPDATE
             SET title = EXCLUDED.title, category = EXCLUDED.category, version = EXCLUDED.version
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
               ON CONFLICT (standard_id, code) DO UPDATE
               SET title = EXCLUDED.title, description = EXCLUDED.description
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
      // F-01 (binding OD-03 follow-up): aggregates AND coverage count only
      // evaluations whose linked answers.status IN ('submitted','approved').
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
                   AND a2.status IN ('submitted', 'approved')
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

// ----------------------------------------------------------------------
// 6B. Evaluation Workflow (FIX BATCH 3)
//
// One evaluation per (client, item); one answer per (client, item,
// department). Score scale: 0 = full gap, 50 = partial, 100 = no gap
// (higher is better, never inverted). "Not evaluated" rows are excluded
// from averages (never treated as zero); N/A rows are excluded from
// averages and counters and always carry one of four stored reasons.
// Submitted/approved answers are immutable except via appended revision
// (PUT .../correct) — the answers correction-history trigger is the
// backstop. Self-approval is forbidden.
// ----------------------------------------------------------------------

const EVALUATION_SCORES = [0, 50, 100] as const;

const NA_REASONS = [
  'not-applicable',
  'legal-prohibitions',
  'confidentiality-constraints',
  'information-unavailable-incomplete',
] as const;

type QueueStatus = 'not_evaluated' | 'draft' | 'submitted' | 'approved' | 'client_approved' | 'returned' | 'not_applicable';

function queueStatusFor(row: {
  not_applicable?: boolean | null;
  not_evaluated?: boolean | null;
  evaluation_id?: string | null;
  answer_status?: string | null;
}): QueueStatus {
  if (row.not_applicable) return 'not_applicable';
  if (row.not_evaluated || !row.evaluation_id) return 'not_evaluated';
  const s = row.answer_status;
  if (s === 'client_approved') return 'client_approved';
  if (s === 'submitted' || s === 'approved' || s === 'returned') return s;
  return 'draft';
}

/** Tenant scope for evaluation endpoints. ge_admin may name a client explicitly. */
function evalClientScope(user: AuthUser, explicit?: unknown): string | null {
  if (typeof explicit === 'string' && explicit.trim()) {
    if (user.role !== 'ge_admin' && explicit.trim() !== user.clientId) {
      return null; // cross-tenant access — caller rejects with 403
    }
    return explicit.trim();
  }
  return user.clientId ?? null;
}

/**
 * Department scope for evaluation reads/writes. Employees are pinned to
 * their own department: naming any other department is a 403, not a filter.
 */
function evalDepartmentScope(user: AuthUser, explicit?: unknown): { departmentId: string } | { error: string } {
  const named = typeof explicit === 'string' && explicit.trim() ? explicit.trim() : null;
  if (user.role === 'employee') {
    if (!user.departmentId) return { error: 'Your user account has no department assignment.' };
    if (named && named !== user.departmentId) {
      return { error: 'Employees may only access items assigned to their own department.' };
    }
    return { departmentId: user.departmentId };
  }
  if (named) return { departmentId: named };
  if (user.departmentId) return { departmentId: user.departmentId };
  return { error: 'A departmentId is required for this operation.' };
}

/**
 * Loads an evaluation plus its draft answer row. The answer row is the one
 * the evaluator wrote (submitted_by = evaluator_id): drafts are filed under
 * an explicit department, which need not equal the evaluator's own
 * department (tenant admins may draft on a department's behalf).
 */
async function loadEvaluationWithAnswer(
  db: { query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }> },
  evaluationId: string
): Promise<{ evaluation: any; answer: any | null; evaluatorDepartmentId: string | null }> {
  const evalRes = await db.query('SELECT * FROM evaluations WHERE id = $1', [evaluationId]);
  if (!evalRes.rows[0]) {
    throw Object.assign(new Error('Evaluation not found.'), { statusCode: 404 });
  }
  const evaluation = evalRes.rows[0];
  const ansRes = await db.query(
    'SELECT * FROM answers WHERE client_id = $1 AND item_id = $2 AND submitted_by = $3',
    [evaluation.client_id, evaluation.item_id, evaluation.evaluator_id]
  );
  const answer: any | null = ansRes.rows[0] ?? null;
  return { evaluation, answer, evaluatorDepartmentId: answer?.department_id ?? null };
}

// ----------------------------------------------------------------------
// FIX BATCH 9 helpers: freeze pre-checks + optimistic-locking conflict payloads.
//
// Freeze rule (WF-05): any evaluation/answer/correction/profile write touching
// a snapshotted scope is refused with a human 409/403 — EXCEPT append-only
// snapshot notes. The API pre-checks below return the human message; the
// is_scope_frozen triggers in schema.sql are the second line of defence.
// Version rule (A-15): the evaluations+answers pair carries lockstep versions;
// every mutation requires the caller's version and bumps both rows.
// ----------------------------------------------------------------------

type DbClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

async function isFrozenScope(db: DbClient, clientId: string, itemId?: string | null): Promise<boolean> {
  const res = await db.query('SELECT is_scope_frozen($1, $2) AS frozen', [clientId, itemId ?? null]);
  return res.rows[0]?.frozen === true;
}

function frozenWriteError(): Error & { statusCode?: number } {
  return Object.assign(
    new Error(
      'This scope is frozen by GE final approval. Editing is disabled; only append-only snapshot notes are allowed.'
    ),
    { statusCode: 409 }
  );
}

function isFrozenDbError(err: any): boolean {
  return typeof err?.message === 'string' && err.message.includes('FROZEN_SCOPE');
}

function toFrozenError(err: any): Error & { statusCode?: number } {
  return isFrozenDbError(err) ? frozenWriteError() : err;
}

/** Best-effort actor names for the mine-vs-theirs conflict payload. */
async function versionedSnapshots(
  db: DbClient,
  evaluation: any | null,
  answer: any | null
): Promise<{ evaluation: any | null; answer: any | null }> {
  let evaluatorName: string | null = null;
  let submitterName: string | null = null;
  try {
    if (evaluation?.evaluator_id) {
      const r = await db.query('SELECT name FROM users WHERE id = $1', [evaluation.evaluator_id]);
      evaluatorName = r.rows[0]?.name ?? null;
    }
    if (answer?.submitted_by) {
      const r = await db.query('SELECT name FROM users WHERE id = $1', [answer.submitted_by]);
      submitterName = r.rows[0]?.name ?? null;
    }
  } catch {
    // Names are best-effort; ids + timestamps are always present.
  }
  return {
    evaluation: evaluation
      ? {
          version: evaluation.version ?? 1,
          score: evaluation.score ?? null,
          notEvaluated: evaluation.not_evaluated ?? null,
          notApplicable: evaluation.not_applicable ?? null,
          naReason: evaluation.na_reason ?? null,
          evidenceNote: evaluation.justification ?? null,
          actorId: evaluation.evaluator_id ?? null,
          actorName: evaluatorName,
          updatedAt: evaluation.updated_at ?? null,
        }
      : null,
    answer: answer
      ? {
          version: answer.version ?? 1,
          status: answer.status ?? null,
          evidenceNote: answer.value ?? null,
          actorId: answer.submitted_by ?? null,
          actorName: submitterName,
          updatedAt: answer.updated_at ?? null,
        }
      : null,
  };
}

/**
 * Enforces the caller's version against the lockstep pair. Returns null when
 * the caller may proceed; otherwise sends the 400/409 response (with BOTH
 * versions' {score, flags, evidence note, actor, time}) and returns the
 * snapshot for logging. Missing version → 400 (reload); mismatch → 409 (diff).
 */
async function enforcePairVersion(
  res: Response,
  db: DbClient,
  evaluation: any | null,
  answer: any | null,
  provided: unknown,
  attempted: Record<string, unknown>
): Promise<{ expectedVersion: number } | null> {
  const expected = evaluation?.version ?? 1;
  const answerVersion = answer?.version ?? 1;
  const snaps = await versionedSnapshots(db, evaluation, answer);
  const outcome = {
    version: expected,
    score: evaluation?.score ?? null,
    notEvaluated: evaluation?.not_evaluated ?? null,
    notApplicable: evaluation?.not_applicable ?? null,
    naReason: evaluation?.na_reason ?? null,
    evidenceNote: evaluation?.justification ?? answer?.value ?? null,
    actorId: evaluation?.evaluator_id ?? null,
    actorName: (snaps.evaluation as any)?.actorName ?? null,
    updatedAt: evaluation?.updated_at ?? null,
  };
  // Lockstep invariant: both rows bump together. A divergence is fail-closed.
  if (expected !== answerVersion) {
    return void res.status(409).json({
      error:
        'This evaluation changed on the server (version drift). Reload the item to see the latest values, then retry.',
      code: 'version.conflict',
      conflict: { expectedVersion: expected, providedVersion: typeof provided === 'number' ? provided : null, ...snaps, attempted },
    }) as unknown as null;
  }
  const check = checkVersion(outcome, provided, attempted);
  if (!check.ok) {
    const status = check.status;
    return void res.status(status).json({
      error:
        status === 409
          ? 'Someone else updated this evaluation while you were editing (version conflict). Compare your values with the current ones below, reload, then retry.'
          : 'A version is required to save (optimistic locking). Reload the item and retry.',
      code: status === 409 ? 'version.conflict' : 'version.required',
      conflict: { expectedVersion: expected, providedVersion: check.conflict.providedVersion, ...snaps, attempted },
    }) as unknown as null;
  }
  return { expectedVersion: expected };
}

// A1. Department queue: items assigned to the caller's department with
// current evaluation + answer state. Employees are pinned to their own
// department; client_admin sees the tenant queue (optional departmentId
// filter); ge_admin sees all (optional clientId + departmentId filters).
router.get('/queue', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const namedDept = typeof req.query.departmentId === 'string' && req.query.departmentId.trim()
      ? req.query.departmentId.trim()
      : null;
    const namedClient = typeof req.query.clientId === 'string' && req.query.clientId.trim()
      ? req.query.clientId.trim()
      : null;

    if (user.role === 'employee' && !user.departmentId) {
      return res.status(400).json({ error: 'Your user account has no department assignment.' });
    }
    if (user.role === 'employee' && namedDept && namedDept !== user.departmentId) {
      return res.status(403).json({ error: 'Employees may only access items assigned to their own department.' });
    }
    if (user.role === 'client_admin' && namedClient && namedClient !== user.clientId) {
      return res.status(403).json({ error: 'Client administrators may only access their own tenant queue.' });
    }
    if (!user.clientId && user.role !== 'ge_admin') {
      return res.status(400).json({ error: 'No tenant context for this user.' });
    }

    const deptFilter = user.role === 'employee' ? user.departmentId! : namedDept;
    const clientFilter = user.role === 'ge_admin' ? namedClient : null;

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      const params: any[] = [];
      let where = '';
      if (deptFilter) {
        params.push(deptFilter);
        where += ` AND a.department_id = $${params.length}`;
      }
      if (clientFilter) {
        params.push(clientFilter);
        where += ` AND a.client_id = $${params.length}`;
      }
      const result = await client.query(
        `SELECT i.id AS item_id, i.code, i.requirement, i.priority, i.weight,
                i.esg_class, i.topic, i.objective,
                d.code AS disclosure_code, d.title AS disclosure_title,
                s.code AS standard_code, s.category AS pillar,
                dep.id AS department_id, dep.code AS department_code, dep.name AS department_name,
                e.id AS evaluation_id, e.score, e.not_evaluated, e.not_applicable, e.na_reason,
                e.justification, e.evaluator_id, e.previous_score, e.version AS evaluation_version,
                e.updated_at AS evaluation_updated_at,
                ans.id AS answer_id, ans.status AS answer_status, ans.submitted_by AS answer_submitted_by,
                ans.version AS answer_version, ans.updated_at AS answer_updated_at
         FROM assignments a
         JOIN items i ON i.id = a.item_id
         JOIN disclosures d ON d.id = i.disclosure_id
         JOIN standards s ON s.id = d.standard_id
         JOIN departments dep ON dep.id = a.department_id
         LEFT JOIN evaluations e ON e.item_id = i.id AND e.client_id = a.client_id
         LEFT JOIN answers ans ON ans.item_id = i.id AND ans.client_id = a.client_id
                              AND ans.department_id = a.department_id
         WHERE 1 = 1${where}
         ORDER BY s.code ASC, d.code ASC, i.code ASC`
        ,
        params
      );
      return result.rows.map((row) => ({ ...row, status: queueStatusFor(row) }));
    });

    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    console.error('Queue fetch error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch evaluation queue' });
  }
});

// A2. Create-or-update DRAFT evaluation + answer in one transaction.
// Body: exactly one of {score} XOR {notEvaluated:true} XOR {notApplicable:true, naReason}.
router.post('/evaluations', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body ?? {};
    const { itemId, score, notEvaluated, notApplicable, naReason, evidenceNote } = body;

    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({ error: 'itemId is required.' });
    }

    const modeCount = [
      score !== undefined && score !== null,
      notEvaluated === true,
      notApplicable === true,
    ].filter(Boolean).length;
    if (modeCount !== 1) {
      return res.status(400).json({
        error: 'Provide exactly one of: a score (0, 50, or 100), notEvaluated: true, or notApplicable: true with an naReason.',
      });
    }

    let finalScore: number | null = null;
    let finalNotEvaluated = false;
    let finalNotApplicable = false;
    let finalNaReason: string | null = null;

    if (score !== undefined && score !== null) {
      if (!(EVALUATION_SCORES as readonly unknown[]).includes(score)) {
        return res.status(400).json({ error: 'Score must be one of 0 (full gap), 50 (partial gap), or 100 (no gap).' });
      }
      finalScore = score;
    } else if (notApplicable === true) {
      finalNotApplicable = true;
      if (typeof naReason !== 'string' || !(NA_REASONS as readonly string[]).includes(naReason)) {
        return res.status(400).json({
          error: `notApplicable requires an naReason, one of: ${NA_REASONS.join(', ')}.`,
        });
      }
      finalNaReason = naReason;
    } else {
      finalNotEvaluated = true;
    }

    const clientId = evalClientScope(user, body.clientId);
    if (!clientId) {
      return res.status(403).json({ error: 'Cross-tenant evaluation writes are forbidden.' });
    }
    const deptScope = evalDepartmentScope(user, body.departmentId);
    if ('error' in deptScope) {
      return res.status(user.role === 'employee' ? 403 : 400).json({ error: deptScope.error });
    }
    const departmentId = deptScope.departmentId;
    const note = typeof evidenceNote === 'string' ? evidenceNote : '';

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const assignRes = await client.query(
        'SELECT id FROM assignments WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
        [clientId, itemId, departmentId]
      );
      if ((assignRes.rowCount ?? 0) === 0) {
        throw Object.assign(new Error('This item is not assigned to the department.'), { statusCode: 403 });
      }

      // B9-B (WF-05): frozen scope refuses evaluation writes.
      if (await isFrozenScope(client, clientId, itemId)) {
        throw frozenWriteError();
      }

      const existingAnswer = await client.query(
        'SELECT id, status, version FROM answers WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
        [clientId, itemId, departmentId]
      );
      const currentStatus: string | undefined = existingAnswer.rows[0]?.status;
      if (currentStatus === 'submitted' || currentStatus === 'approved' || currentStatus === 'client_approved') {
        throw Object.assign(
          new Error('This evaluation is already submitted. Post-submit changes must go through PUT /api/evaluations/:id/correct with a reason.'),
          { statusCode: 409 }
        );
      }

      // B9-C (A-15): an existing draft requires the caller's version.
      const existingEval = await client.query(
        'SELECT * FROM evaluations WHERE client_id = $1 AND item_id = $2',
        [clientId, itemId]
      );
      if (existingEval.rows[0]) {
        const existingAnsRes = existingAnswer.rows[0]
          ? await client.query('SELECT * FROM answers WHERE id = $1', [existingAnswer.rows[0].id])
          : { rows: [] };
        const gate = await enforcePairVersion(
          res,
          client,
          existingEval.rows[0],
          existingAnsRes.rows[0] ?? null,
          body.version,
          { score, notEvaluated: finalNotEvaluated, notApplicable: finalNotApplicable, evidenceNote: note }
        );
        if (!gate) {
          throw Object.assign(new Error('__VERSION_CONFLICT_RESPONSE_SENT__'), { statusCode: 499 });
        }
      }

      const evalRes = await client.query(
        `INSERT INTO evaluations (client_id, item_id, evaluator_id, score, not_evaluated, not_applicable, na_reason, justification)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (client_id, item_id) DO UPDATE SET
            evaluator_id = EXCLUDED.evaluator_id,
            score = EXCLUDED.score,
            not_evaluated = EXCLUDED.not_evaluated,
            not_applicable = EXCLUDED.not_applicable,
            na_reason = EXCLUDED.na_reason,
            justification = EXCLUDED.justification,
            version = evaluations.version + 1,
            updated_at = NOW()
          RETURNING *`,
        [clientId, itemId, user.id, finalScore, finalNotEvaluated, finalNotApplicable, finalNaReason, note || null]
      );

      // Draft upsert: never resets correction_history on conflict — the
      // trigger guards submitted rows and history only ever grows via A5.
      const ansRes = await client.query(
        `INSERT INTO answers (client_id, item_id, department_id, submitted_by, status, value, correction_history)
          VALUES ($1, $2, $3, $4, 'draft', $5, '[]'::jsonb)
          ON CONFLICT (client_id, item_id, department_id) DO UPDATE SET
            value = EXCLUDED.value,
            status = 'draft',
            submitted_by = EXCLUDED.submitted_by,
            version = answers.version + 1,
            updated_at = NOW()
          RETURNING *`,
        [clientId, itemId, departmentId, user.id, note]
      );

      await recordAuditLog(client, {
        clientId,
        userId: user.id,
        action: 'EVALUATION_DRAFT_SAVED',
        entityType: 'evaluations',
        entityId: evalRes.rows[0].id,
        payload: {
          itemId,
          departmentId,
          score: finalScore,
          notEvaluated: finalNotEvaluated,
          notApplicable: finalNotApplicable,
          naReason: finalNaReason,
        },
      });

      return { evaluation: evalRes.rows[0], answer: ansRes.rows[0] };
    });

    res.status(201).json(result);
  } catch (err: any) {
    // B9-C: the version gate already sent the 400/409 response with the diff.
    if (err?.message === '__VERSION_CONFLICT_RESPONSE_SENT__') return;
    console.error('Evaluation save error:', err);
    const mapped = toFrozenError(err);
    res.status(mapped.statusCode || 500).json({ error: mapped.message || 'Failed to save evaluation draft' });
  }
});

// A3. Submit a draft evaluation. Double submit is refused (409).
router.post('/evaluations/:id/submit', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const evaluationId = req.params.id;

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);

      if (user.role === 'employee' && user.id !== evaluation.evaluator_id) {
        throw Object.assign(new Error('Only the evaluator or a tenant administrator may submit this evaluation.'), {
          statusCode: 403,
        });
      }
      if (!answer) {
        throw Object.assign(new Error('No draft answer exists for this evaluation yet. Save a draft first.'), {
          statusCode: 400,
        });
      }
      if (answer.status === 'submitted' || answer.status === 'approved' || answer.status === 'client_approved') {
        throw Object.assign(new Error('This evaluation has already been submitted.'), { statusCode: 409 });
      }

      // B9-B (WF-05): frozen scope refuses evaluation writes.
      if (await isFrozenScope(client, evaluation.client_id, evaluation.item_id)) {
        throw frozenWriteError();
      }

      // B9-C (A-15): submit requires the caller's answer version.
      const gate = await enforcePairVersion(
        res,
        client,
        evaluation,
        answer,
        req.body?.version,
        { action: 'submit' }
      );
      if (!gate) {
        throw Object.assign(new Error('__VERSION_CONFLICT_RESPONSE_SENT__'), { statusCode: 499 });
      }

      const updRes = await client.query(
        `UPDATE answers SET status = 'submitted', version = version + 1, updated_at = NOW()
          WHERE id = $1 AND version = $2 RETURNING *`,
        [answer.id, gate.expectedVersion]
      );
      if ((updRes.rowCount ?? 0) === 0) {
        const fresh = await loadEvaluationWithAnswer(client, evaluationId).catch(() => null);
        const snaps = await versionedSnapshots(client, fresh?.evaluation ?? evaluation, fresh?.answer ?? answer);
        throw Object.assign(
          new Error('Someone else updated this evaluation while you were editing (version conflict). Reload, then retry.'),
          { statusCode: 409, conflictPayload: { code: 'version.conflict', conflict: { ...snaps, attempted: { action: 'submit' } } } }
        );
      }
      // Lockstep bump: the pair versions move together.
      await client.query('UPDATE evaluations SET version = version + 1, updated_at = NOW() WHERE id = $1', [
        evaluation.id,
      ]);

      await recordAuditLog(client, {
        clientId: evaluation.client_id,
        userId: user.id,
        action: 'EVALUATION_SUBMITTED',
        entityType: 'evaluations',
        entityId: evaluation.id,
        payload: { itemId: evaluation.item_id, answerId: answer.id },
      });

      return { evaluation, answer: updRes.rows[0] };
    });

      res.json(result);
    } catch (err: any) {
      // B9-C: the version gate already sent the 400/409 response with the diff.
      if (err?.message === '__VERSION_CONFLICT_RESPONSE_SENT__') return;
      console.error('Evaluation submit error:', err);
      if (err?.statusCode === 409 && err?.conflictPayload) {
        return res.status(409).json({ error: err.message, ...err.conflictPayload });
      }
      const mappedSubmit = toFrozenError(err);
      res.status(mappedSubmit.statusCode || 500).json({ error: mappedSubmit.message || 'Failed to submit evaluation' });
    }
  });

// A4. Approve / return a submitted evaluation (admins only, never self).
async function handleEvaluationDecision(
  req: AuthenticatedRequest,
  res: Response,
  decision: 'approve' | 'return'
) {
  try {
    const user = req.user!;
    if (user.role !== 'client_admin' && user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only tenant or platform administrators may approve or return evaluations.' });
    }
    const evaluationId = req.params.id;
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (decision === 'return' && !comment) {
      return res.status(400).json({ error: 'A return comment is required so the department knows what to rework.' });
    }

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);

      if (user.id === evaluation.evaluator_id || (answer && user.id === answer.submitted_by)) {
        throw Object.assign(new Error('Self-approval is forbidden: the approver must differ from the evaluator and the submitter.'), {
          statusCode: 403,
        });
      }
      if (!answer || answer.status !== 'submitted') {
        throw Object.assign(new Error('Only a submitted evaluation can be approved or returned.'), { statusCode: 409 });
      }

      // B9-B (WF-05): frozen scope refuses evaluation writes.
      if (await isFrozenScope(client, evaluation.client_id, evaluation.item_id)) {
        throw frozenWriteError();
      }

      // B9-C (A-15): approve/return requires the caller's answer version.
      const gate = await enforcePairVersion(
        res,
        client,
        evaluation,
        answer,
        req.body?.version,
        { decision, comment: comment || null }
      );
      if (!gate) {
        throw Object.assign(new Error('__VERSION_CONFLICT_RESPONSE_SENT__'), { statusCode: 499 });
      }

      const nextStatus = decision === 'approve' ? 'approved' : 'returned';
      const approvalStatus = decision === 'approve' ? 'approved' : 'rejected';
      const level = user.role === 'ge_admin' ? 'ge' : 'client';

      const updRes = await client.query(
        `UPDATE answers SET status = $1, version = version + 1, updated_at = NOW()
          WHERE id = $2 AND version = $3 RETURNING *`,
        [nextStatus, answer.id, gate.expectedVersion]
      );
      if ((updRes.rowCount ?? 0) === 0) {
        const fresh = await loadEvaluationWithAnswer(client, evaluationId).catch(() => null);
        const snaps = await versionedSnapshots(client, fresh?.evaluation ?? evaluation, fresh?.answer ?? answer);
        throw Object.assign(
          new Error('Someone else updated this evaluation while you were editing (version conflict). Reload, then retry.'),
          { statusCode: 409, conflictPayload: { code: 'version.conflict', conflict: { ...snaps, attempted: { decision } } } }
        );
      }
      // Lockstep bump: the pair versions move together.
      await client.query('UPDATE evaluations SET version = version + 1, updated_at = NOW() WHERE id = $1', [
        evaluation.id,
      ]);
      const apprRes = await client.query(
        `INSERT INTO approvals (client_id, answer_id, approver_id, level, status, comments)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [evaluation.client_id, answer.id, user.id, level, approvalStatus, comment || null]
      );

      await recordAuditLog(client, {
        clientId: evaluation.client_id,
        userId: user.id,
        action: decision === 'approve' ? 'EVALUATION_APPROVED' : 'EVALUATION_RETURNED',
        entityType: 'evaluations',
        entityId: evaluation.id,
        payload: { itemId: evaluation.item_id, answerId: answer.id, comment: comment || null },
      });

      return { evaluation, answer: updRes.rows[0], approval: apprRes.rows[0] };
    });

      res.json(result);
    } catch (err: any) {
      // B9-C: the version gate already sent the 400/409 response with the diff.
      if (err?.message === '__VERSION_CONFLICT_RESPONSE_SENT__') return;
      console.error('Evaluation decision error:', err);
      if (err?.statusCode === 409 && err?.conflictPayload) {
        return res.status(409).json({ error: err.message, ...err.conflictPayload });
      }
      const mappedDecision = toFrozenError(err);
      res.status(mappedDecision.statusCode || 500).json({ error: mappedDecision.message || 'Failed to record evaluation decision' });
    }
  }

router.post('/evaluations/:id/approve', authMiddleware, (req: AuthenticatedRequest, res: Response) =>
  handleEvaluationDecision(req, res, 'approve')
);

router.post('/evaluations/:id/return', authMiddleware, (req: AuthenticatedRequest, res: Response) =>
  handleEvaluationDecision(req, res, 'return')
);

// A5. Post-submit correction: appended revision only. Requires a reason;
// grows answers.correction_history (trigger-enforced) and stamps
// evaluations.previous_score. Drafts must use POST /api/evaluations.
router.put('/evaluations/:id/correct', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const evaluationId = req.params.id;
    const body = req.body ?? {};
    const { newScore, notEvaluated, notApplicable, naReason, reason } = body;

    if (typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({ error: 'A correction reason is required.' });
    }
    const modeCount = [
      newScore !== undefined && newScore !== null,
      notEvaluated === true,
      notApplicable === true,
    ].filter(Boolean).length;
    if (modeCount !== 1) {
      return res.status(400).json({
        error: 'Provide exactly one corrected outcome: newScore, notEvaluated: true, or notApplicable: true with naReason.',
      });
    }

    let afterScore: number | null = null;
    let afterNotEvaluated = false;
    let afterNotApplicable = false;
    let afterNaReason: string | null = null;
    if (newScore !== undefined && newScore !== null) {
      if (!(EVALUATION_SCORES as readonly unknown[]).includes(newScore)) {
        return res.status(400).json({ error: 'newScore must be one of 0 (full gap), 50 (partial gap), or 100 (no gap).' });
      }
      afterScore = newScore;
    } else if (notApplicable === true) {
      afterNotApplicable = true;
      if (typeof naReason !== 'string' || !(NA_REASONS as readonly string[]).includes(naReason)) {
        return res.status(400).json({
          error: `notApplicable requires an naReason, one of: ${NA_REASONS.join(', ')}.`,
        });
      }
      afterNaReason = naReason;
    } else {
      afterNotEvaluated = true;
    }

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);

      const isEvaluator = user.id === evaluation.evaluator_id;
      const isAdmin = user.role === 'client_admin' || user.role === 'ge_admin';
      if (!isEvaluator && !isAdmin) {
        throw Object.assign(new Error('Only the evaluator or a tenant administrator may correct this evaluation.'), {
          statusCode: 403,
        });
      }
      if (!answer || (answer.status !== 'submitted' && answer.status !== 'approved' && answer.status !== 'client_approved')) {
        throw Object.assign(
          new Error('Only a submitted or approved evaluation can be corrected. Edit the draft instead.'),
          { statusCode: 409 }
        );
      }

      // B9-B (WF-05): frozen scope refuses corrections (use snapshot notes).
      if (await isFrozenScope(client, evaluation.client_id, evaluation.item_id)) {
        throw frozenWriteError();
      }

      // B9-C (A-15): correction requires the caller's version.
      const gate = await enforcePairVersion(
        res,
        client,
        evaluation,
        answer,
        body.version,
        { newScore, notEvaluated, notApplicable, naReason, reason: reason.trim() }
      );
      if (!gate) {
        throw Object.assign(new Error('__VERSION_CONFLICT_RESPONSE_SENT__'), { statusCode: 499 });
      }

      const before = {
        score: evaluation.score,
        notEvaluated: evaluation.not_evaluated,
        notApplicable: evaluation.not_applicable,
        naReason: evaluation.na_reason,
      };
      const after = {
        score: afterScore,
        notEvaluated: afterNotEvaluated,
        notApplicable: afterNotApplicable,
        naReason: afterNaReason,
      };

      const evalRes = await client.query(
        `UPDATE evaluations
          SET score = $1, not_evaluated = $2, not_applicable = $3, na_reason = $4,
              previous_score = score, version = version + 1, updated_at = NOW()
          WHERE id = $5 AND version = $6 RETURNING *`,
        [afterScore, afterNotEvaluated, afterNotApplicable, afterNaReason, evaluation.id, gate.expectedVersion]
      );
      if ((evalRes.rowCount ?? 0) === 0) {
        const fresh = await loadEvaluationWithAnswer(client, evaluationId).catch(() => null);
        const snaps = await versionedSnapshots(client, fresh?.evaluation ?? evaluation, fresh?.answer ?? answer);
        throw Object.assign(
          new Error('Someone else updated this evaluation while you were editing (version conflict). Reload, then retry.'),
          { statusCode: 409, conflictPayload: { code: 'version.conflict', conflict: { ...snaps, attempted: { action: 'correct' } } } }
        );
      }

      const historyEntry = [{ before, after, actor: user.id, reason: reason.trim(), at: new Date().toISOString() }];
      const ansRes = await client.query(
        `UPDATE answers
          SET correction_history = COALESCE(correction_history, '[]'::jsonb) || $1::jsonb,
              version = version + 1, updated_at = NOW()
          WHERE id = $2 RETURNING *`,
        [JSON.stringify(historyEntry), answer.id]
      );

      await recordAuditLog(client, {
        clientId: evaluation.client_id,
        userId: user.id,
        action: 'EVALUATION_CORRECTED',
        entityType: 'evaluations',
        entityId: evaluation.id,
        payload: { itemId: evaluation.item_id, answerId: answer.id, before, after, actor: user.id, reason: reason.trim() },
      });

      return { evaluation: evalRes.rows[0], answer: ansRes.rows[0], before, after };
    });

    res.json(result);
  } catch (err: any) {
    // B9-C: the version gate already sent the 400/409 response with the diff.
    if (err?.message === '__VERSION_CONFLICT_RESPONSE_SENT__') return;
    console.error('Evaluation correction error:', err);
    if (err?.statusCode === 409 && err?.conflictPayload) {
      return res.status(409).json({ error: err.message, ...err.conflictPayload });
    }
    res.status(err.statusCode || 500).json({ error: toFrozenError(err).message || 'Failed to correct evaluation' });
  }
});

// A6. Full history for one item: current evaluation + answers in scope +
// related audit_log revision entries (submit / approve / return / correct).
router.get('/evaluations', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const itemId = req.query.itemId;
    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({ error: 'itemId query parameter is required.' });
    }

    const clientId = evalClientScope(user, req.query.clientId);
    if (!clientId && user.role !== 'ge_admin') {
      return res.status(400).json({ error: 'No tenant context for this user.' });
    }
    if (user.role === 'employee') {
      if (!user.departmentId) {
        return res.status(400).json({ error: 'Your user account has no department assignment.' });
      }
      const namedDept = typeof req.query.departmentId === 'string' && req.query.departmentId.trim()
        ? req.query.departmentId.trim()
        : null;
      if (namedDept && namedDept !== user.departmentId) {
        return res.status(403).json({ error: 'Employees may only access items assigned to their own department.' });
      }
    }

    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const itemRes = await client.query(
        `SELECT i.id, i.code, i.requirement, i.priority, i.weight, i.esg_class, i.topic,
                d.code AS disclosure_code, s.code AS standard_code
         FROM items i
         JOIN disclosures d ON d.id = i.disclosure_id
         JOIN standards s ON s.id = d.standard_id
         WHERE i.id = $1`,
        [itemId]
      );
      if (!itemRes.rows[0]) {
        throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
      }

      if (user.role === 'employee') {
        const assignRes = await client.query(
          'SELECT id FROM assignments WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
          [clientId, itemId, user.departmentId]
        );
        if ((assignRes.rowCount ?? 0) === 0) {
          throw Object.assign(new Error('This item is not assigned to your department.'), { statusCode: 403 });
        }
      }

      const evalQuery = clientId
        ? client.query('SELECT * FROM evaluations WHERE client_id = $1 AND item_id = $2', [clientId, itemId])
        : client.query('SELECT * FROM evaluations WHERE item_id = $1', [itemId]);
      const evalRes = await evalQuery;
      const evaluation = evalRes.rows[0] ?? null;

      const ansQuery = clientId
        ? client.query('SELECT * FROM answers WHERE client_id = $1 AND item_id = $2 ORDER BY updated_at ASC', [clientId, itemId])
        : client.query('SELECT * FROM answers WHERE item_id = $1 ORDER BY updated_at ASC', [itemId]);
      const ansRes = await ansQuery;

      let history: any[] = [];
      if (evaluation) {
        const histRes = await client.query(
          `SELECT al.id, al.action, al.entity_type, al.entity_id, al.user_id,
                  u.name AS actor_name, al.payload, al.created_at
           FROM audit_log al
           LEFT JOIN users u ON u.id = al.user_id
           WHERE al.entity_type = 'evaluations' AND al.entity_id = $1
           ORDER BY al.created_at ASC`,
          [evaluation.id]
        );
        history = histRes.rows;
      }

      return { item: itemRes.rows[0], evaluation, answers: ansRes.rows, history };
    });

    res.json(data);
  } catch (err: any) {
    console.error('Evaluation history error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch evaluation history' });
  }
});

// ----------------------------------------------------------------------
// 6C. Client approval + GE final freeze + attachments (FIX BATCH 9)
//
// WF-02 chain: draft → submitted → dept-approved ('approved') →
// client-approved ('client_approved') → ready-for-review (GE FinalApproval +
// immutable snapshot freezes the tenant copy, WF-03/WF-05). Client approval
// is disclosure-scoped: every department in the disclosure must be at least
// dept-approved (or N/A with reason) or the 409 names the incomplete ones.
// ----------------------------------------------------------------------

// B9-A1. Client approve: client_admin (own tenant) or ge_admin (any tenant).
// Allowed ONLY when every assignment/department evaluation for the SAME
// DISCLOSURE is at least dept-approved; otherwise 409 naming departments.
router.post('/evaluations/:id/client-approve', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'client_admin' && user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only tenant or platform administrators may client-approve evaluations.' });
    }
    const evaluationId = req.params.id;

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);

      if (user.role === 'client_admin' && evaluation.client_id !== user.clientId) {
        throw Object.assign(new Error('Client administrators may only client-approve their own tenant.'), {
          statusCode: 403,
        });
      }
      if (user.id === evaluation.evaluator_id || (answer && user.id === answer.submitted_by)) {
        throw Object.assign(new Error('Self-approval is forbidden: the approver must differ from the evaluator and the submitter.'), {
          statusCode: 403,
        });
      }
      if (!answer || answer.status !== 'approved') {
        throw Object.assign(
          new Error('Only a dept-approved evaluation can be client-approved. It must be approved at department scope first.'),
          { statusCode: 409 }
        );
      }

      // B9-B (WF-05): frozen scope refuses evaluation writes.
      if (await isFrozenScope(client, evaluation.client_id, evaluation.item_id)) {
        throw frozenWriteError();
      }

      // B9-C (A-15): client approval requires the caller's version.
      const gate = await enforcePairVersion(
        res,
        client,
        evaluation,
        answer,
        req.body?.version,
        { action: 'client-approve' }
      );
      if (!gate) {
        throw Object.assign(new Error('__VERSION_CONFLICT_RESPONSE_SENT__'), { statusCode: 499 });
      }

      // Disclosure scope: every department assignment under the same disclosure.
      const itemRes = await client.query('SELECT disclosure_id FROM items WHERE id = $1', [evaluation.item_id]);
      const disclosureId = itemRes.rows[0]?.disclosure_id;
      if (!disclosureId) {
        throw Object.assign(new Error('Item disclosure not found.'), { statusCode: 404 });
      }
      const scopeRes = await client.query(
        `SELECT dep.id AS department_id, dep.name AS department_name,
                ans.status AS answer_status, e.not_applicable AS not_applicable
          FROM assignments a
          JOIN departments dep ON dep.id = a.department_id
          JOIN items i ON i.id = a.item_id
          LEFT JOIN answers ans ON ans.client_id = a.client_id AND ans.item_id = a.item_id AND ans.department_id = a.department_id
          LEFT JOIN evaluations e ON e.client_id = a.client_id AND e.item_id = a.item_id
          WHERE a.client_id = $1 AND i.disclosure_id = $2`,
        [evaluation.client_id, disclosureId]
      );
      const decision = clientApproveGate(
        scopeRes.rows.map((r) => ({
          departmentId: r.department_id,
          departmentName: r.department_name,
          answerStatus: r.answer_status,
          notApplicable: r.not_applicable === true,
        }))
      );
      if (!decision.ok) {
        throw Object.assign(new Error(clientApproveRefusalMessage(decision.incomplete)), { statusCode: 409 });
      }

      const updRes = await client.query(
        `UPDATE answers SET status = 'client_approved', version = version + 1, updated_at = NOW()
          WHERE id = $1 AND version = $2 RETURNING *`,
        [answer.id, gate.expectedVersion]
      );
      if ((updRes.rowCount ?? 0) === 0) {
        const fresh = await loadEvaluationWithAnswer(client, evaluationId).catch(() => null);
        const snaps = await versionedSnapshots(client, fresh?.evaluation ?? evaluation, fresh?.answer ?? answer);
        throw Object.assign(
          new Error('Someone else updated this evaluation while you were editing (version conflict). Reload, then retry.'),
          { statusCode: 409, conflictPayload: { code: 'version.conflict', conflict: { ...snaps, attempted: { action: 'client-approve' } } } }
        );
      }
      await client.query('UPDATE evaluations SET version = version + 1, updated_at = NOW() WHERE id = $1', [
        evaluation.id,
      ]);

      const apprRes = await client.query(
        `INSERT INTO approvals (client_id, answer_id, approver_id, level, status, comments)
          VALUES ($1, $2, $3, 'client', 'approved', $4) RETURNING *`,
        [evaluation.client_id, answer.id, user.id, typeof req.body?.comment === 'string' ? req.body.comment.trim() || null : null]
      );

      await recordAuditLog(client, {
        clientId: evaluation.client_id,
        userId: user.id,
        action: 'EVALUATION_CLIENT_APPROVED',
        entityType: 'evaluations',
        entityId: evaluation.id,
        payload: { itemId: evaluation.item_id, answerId: answer.id, disclosureId },
      });

      return { evaluation, answer: updRes.rows[0], approval: apprRes.rows[0] };
    });

    res.json(result);
  } catch (err: any) {
    if (err?.message === '__VERSION_CONFLICT_RESPONSE_SENT__') return;
    console.error('Client approval error:', err);
    if (err?.statusCode === 409 && err?.conflictPayload) {
      return res.status(409).json({ error: err.message, ...err.conflictPayload });
    }
    const mapped = toFrozenError(err);
    res.status(mapped.statusCode || 500).json({ error: mapped.message || 'Failed to client-approve evaluation' });
  }
});

// B9-A2. Client return: client_admin (own tenant) or ge_admin (any tenant).
// Comment is required; the item goes back to dept scope with reason preserved.
router.post('/evaluations/:id/client-return', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'client_admin' && user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only tenant or platform administrators may return evaluations from client scope.' });
    }
    const evaluationId = req.params.id;
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (!comment) {
      return res.status(400).json({ error: 'A return comment is required so the department knows what to rework.' });
    }

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);

      if (user.role === 'client_admin' && evaluation.client_id !== user.clientId) {
        throw Object.assign(new Error('Client administrators may only return evaluations in their own tenant.'), {
          statusCode: 403,
        });
      }
      if (user.id === evaluation.evaluator_id || (answer && user.id === answer.submitted_by)) {
        throw Object.assign(new Error('Self-approval is forbidden: the approver must differ from the evaluator and the submitter.'), {
          statusCode: 403,
        });
      }
      if (!answer || (answer.status !== 'approved' && answer.status !== 'client_approved')) {
        throw Object.assign(
          new Error('Only a dept-approved or client-approved evaluation can be returned from client scope.'),
          { statusCode: 409 }
        );
      }

      if (await isFrozenScope(client, evaluation.client_id, evaluation.item_id)) {
        throw frozenWriteError();
      }

      const gate = await enforcePairVersion(
        res,
        client,
        evaluation,
        answer,
        req.body?.version,
        { action: 'client-return', comment }
      );
      if (!gate) {
        throw Object.assign(new Error('__VERSION_CONFLICT_RESPONSE_SENT__'), { statusCode: 499 });
      }

      const updRes = await client.query(
        `UPDATE answers SET status = 'returned', version = version + 1, updated_at = NOW()
          WHERE id = $1 AND version = $2 RETURNING *`,
        [answer.id, gate.expectedVersion]
      );
      if ((updRes.rowCount ?? 0) === 0) {
        const fresh = await loadEvaluationWithAnswer(client, evaluationId).catch(() => null);
        const snaps = await versionedSnapshots(client, fresh?.evaluation ?? evaluation, fresh?.answer ?? answer);
        throw Object.assign(
          new Error('Someone else updated this evaluation while you were editing (version conflict). Reload, then retry.'),
          { statusCode: 409, conflictPayload: { code: 'version.conflict', conflict: { ...snaps, attempted: { action: 'client-return' } } } }
        );
      }
      await client.query('UPDATE evaluations SET version = version + 1, updated_at = NOW() WHERE id = $1', [
        evaluation.id,
      ]);

      const apprRes = await client.query(
        `INSERT INTO approvals (client_id, answer_id, approver_id, level, status, comments)
          VALUES ($1, $2, $3, 'client', 'rejected', $4) RETURNING *`,
        [evaluation.client_id, answer.id, user.id, comment]
      );

      await recordAuditLog(client, {
        clientId: evaluation.client_id,
        userId: user.id,
        action: 'EVALUATION_CLIENT_RETURNED',
        entityType: 'evaluations',
        entityId: evaluation.id,
        payload: { itemId: evaluation.item_id, answerId: answer.id, comment },
      });

      return { evaluation, answer: updRes.rows[0], approval: apprRes.rows[0] };
    });

    res.json(result);
  } catch (err: any) {
    if (err?.message === '__VERSION_CONFLICT_RESPONSE_SENT__') return;
    console.error('Client return error:', err);
    if (err?.statusCode === 409 && err?.conflictPayload) {
      return res.status(409).json({ error: err.message, ...err.conflictPayload });
    }
    const mapped = toFrozenError(err);
    res.status(mapped.statusCode || 500).json({ error: mapped.message || 'Failed to return evaluation from client scope' });
  }
});

// B9-A3. Client-review queue: pending client approval grouped by disclosure,
// with a completeness bar per group. client_admin sees own tenant; ge_admin
// may name any tenant explicitly.
router.get('/client-review', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'client_admin' && user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only tenant or platform administrators may view the client-review queue.' });
    }
    const namedClient = typeof req.query.clientId === 'string' && req.query.clientId.trim() ? req.query.clientId.trim() : null;
    if (user.role === 'client_admin' && namedClient && namedClient !== user.clientId) {
      return res.status(403).json({ error: 'Client administrators may only access their own tenant queue.' });
    }
    const tenantId = user.role === 'ge_admin' ? namedClient ?? user.clientId ?? null : user.clientId ?? null;
    if (!tenantId) {
      return res.status(400).json({ error: 'No tenant selected. As a platform admin, choose a tenant (clientId).' });
    }

    const groups = await withTenantContext(contextFromUser(user), async (client) => {
      const rowsRes = await client.query(
        `SELECT d.id AS disclosure_id, d.code AS disclosure_code, d.title AS disclosure_title,
                s.code AS standard_code,
                dep.id AS department_id, dep.name AS department_name,
                ans.id AS answer_id, ans.status AS answer_status, ans.version AS answer_version,
                e.id AS evaluation_id, e.version AS evaluation_version,
                e.score, e.not_evaluated, e.not_applicable, e.na_reason
          FROM assignments a
          JOIN items i ON i.id = a.item_id
          JOIN disclosures d ON d.id = i.disclosure_id
          JOIN standards s ON s.id = d.standard_id
          JOIN departments dep ON dep.id = a.department_id
          LEFT JOIN answers ans ON ans.client_id = a.client_id AND ans.item_id = a.item_id AND ans.department_id = a.department_id
          LEFT JOIN evaluations e ON e.client_id = a.client_id AND e.item_id = a.item_id
          WHERE a.client_id = $1
          ORDER BY s.code ASC, d.code ASC, dep.name ASC`,
        [tenantId]
      );
      const byDisclosure = new Map<string, any>();
      for (const r of rowsRes.rows) {
        let g = byDisclosure.get(r.disclosure_id);
        if (!g) {
          g = {
            disclosureId: r.disclosure_id,
            disclosureCode: r.disclosure_code,
            disclosureTitle: r.disclosure_title,
            standardCode: r.standard_code,
            departments: [],
          };
          byDisclosure.set(r.disclosure_id, g);
        }
        g.departments.push({
          departmentId: r.department_id,
          departmentName: r.department_name,
          answerId: r.answer_id,
          answerStatus: r.answer_status,
          answerVersion: r.answer_version,
          evaluationId: r.evaluation_id,
          evaluationVersion: r.evaluation_version,
          score: r.score,
          notEvaluated: r.not_evaluated,
          notApplicable: r.not_applicable,
          naReason: r.na_reason,
        });
      }
      return [...byDisclosure.values()].map((g) => {
        const total = g.departments.length;
        const approved = g.departments.filter((x: any) => x.answerStatus === 'approved' || x.answerStatus === 'client_approved').length;
        const clientApproved = g.departments.filter((x: any) => x.answerStatus === 'client_approved').length;
        const na = g.departments.filter((x: any) => x.notApplicable === true).length;
        const gate = clientApproveGate(
          g.departments.map((x: any) => ({
            departmentId: x.departmentId,
            departmentName: x.departmentName,
            answerStatus: x.answerStatus,
            notApplicable: x.notApplicable === true,
          }))
        );
        return {
          ...g,
          total,
          approved,
          clientApproved,
          notApplicable: na,
          completeness: total === 0 ? 0 : Math.round(((approved + na) / total) * 100),
          readyForClient: gate.ok && g.departments.some((x: any) => x.answerStatus === 'approved'),
          fullyClientApproved: total > 0 && g.departments.every((x: any) => x.answerStatus === 'client_approved' || x.notApplicable === true),
          incompleteDepartments: gate.ok ? [] : (gate as { ok: false; incomplete: string[] }).incomplete,
        };
      });
    });

    res.json({ tenantId, groups, count: groups.length });
  } catch (err: any) {
    console.error('Client-review queue error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch client-review queue' });
  }
});

// ----------------------------------------------------------------------
// 6D. GE final + freeze (MP-45, S-18/M-10, WF-03/WF-05)
// ----------------------------------------------------------------------

/** Shared scope-row loader for ge-check and ge-final. */
async function loadGeScopeRows(
  client: DbClient,
  tenantId: string,
  scope: 'disclosure' | 'tenant',
  scopeRef: string
): Promise<{ items: any[]; disclosureCode?: string }> {
  const params: any[] = [tenantId];
  let disclosureFilter = '';
  if (scope === 'disclosure') {
    params.push(scopeRef);
    disclosureFilter = 'AND i.disclosure_id = $2';
  }
  const rowsRes = await client.query(
    `SELECT i.id AS item_id, i.code AS item_code, i.weight::float AS weight,
            i.disclosure_id, d.code AS disclosure_code, d.title AS disclosure_title,
            ans.id AS answer_id, ans.status AS answer_status,
            e.id AS evaluation_id, e.score, e.not_evaluated, e.not_applicable, e.na_reason,
            e.justification, e.evaluator_id, e.updated_at AS evaluation_updated_at
      FROM assignments a
      JOIN items i ON i.id = a.item_id
      JOIN disclosures d ON d.id = i.disclosure_id
      LEFT JOIN answers ans ON ans.client_id = a.client_id AND ans.item_id = a.item_id AND ans.department_id = a.department_id
      LEFT JOIN evaluations e ON e.client_id = a.client_id AND e.item_id = a.item_id
      WHERE a.client_id = $1 ${disclosureFilter}
      ORDER BY d.code ASC, i.code ASC`,
    params
  );
  // One row per (item, department): collapse to one row per item, keeping the
  // weakest client-approval state across departments.
  const byItem = new Map<string, any>();
  for (const r of rowsRes.rows) {
    let entry = byItem.get(r.item_id);
    if (!entry) {
      entry = {
        itemId: r.item_id,
        code: r.item_code,
        weight: r.weight,
        disclosureId: r.disclosure_id,
        disclosureCode: r.disclosure_code,
        disclosureTitle: r.disclosure_title,
        statuses: [] as string[],
        evaluation: null as any,
      };
      byItem.set(r.item_id, entry);
    }
    entry.statuses.push(r.answer_status);
    if (!entry.evaluation && r.evaluation_id) {
      entry.evaluation = {
        id: r.evaluation_id,
        score: r.score,
        notEvaluated: r.not_evaluated,
        notApplicable: r.not_applicable,
        naReason: r.na_reason,
        justification: r.justification,
      };
    }
  }
  const items = [...byItem.values()].map((entry) => {
    const statuses: (string | null)[] = entry.statuses;
    const notApplicable = entry.evaluation?.notApplicable === true;
    // Item counts as client-approved only when EVERY department answer is.
    const allClientApproved = statuses.length > 0 && statuses.every((s) => s === 'client_approved');
    return {
      itemId: entry.itemId,
      code: entry.code,
      weight: entry.weight,
      disclosureCode: entry.disclosureCode,
      answerStatus: allClientApproved ? 'client_approved' : statuses.includes('client_approved') ? 'mixed' : statuses.find((s) => s) ?? null,
      notApplicable,
      naReason: entry.evaluation?.naReason ?? null,
      score: entry.evaluation?.score ?? null,
      notEvaluated: entry.evaluation?.notEvaluated ?? null,
      evaluation: entry.evaluation,
    };
  });
  return { items };
}

// B9-B4. GE final-review completeness checklist (read-only).
router.get('/reviews/ge-check', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only platform administrators may run the GE final review.' });
    }
    const scopeRaw = req.query.scope;
    if (!isGeFinalScope(scopeRaw)) {
      return res.status(400).json({ error: 'scope must be disclosure or tenant.' });
    }
    const clientId = typeof req.query.clientId === 'string' && req.query.clientId.trim() ? req.query.clientId.trim() : null;
    if (!clientId) {
      return res.status(400).json({ error: 'No tenant selected. Choose a tenant (clientId) to review.' });
    }
    const scopeRef =
      scopeRaw === 'tenant'
        ? clientId
        : typeof req.query.scopeRef === 'string' && req.query.scopeRef.trim()
          ? req.query.scopeRef.trim()
          : null;
    if (!scopeRef) {
      return res.status(400).json({ error: 'scopeRef (disclosure id) is required for disclosure scope.' });
    }

    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const { items } = await loadGeScopeRows(client, clientId, scopeRaw, scopeRef);
      const gate = geFinalGate(
        items.map((it) => ({
          itemId: it.itemId,
          code: it.code,
          answerStatus: it.answerStatus,
          notApplicable: it.notApplicable,
          naReason: it.naReason,
        }))
      );
      const snapRes = await client.query(
        'SELECT id, scope_type, scope_ref, created_at FROM review_snapshots WHERE client_id = $1 AND scope_type = $2 AND scope_ref = $3',
        [clientId, scopeRaw, scopeRef]
      );
      return {
        clientId,
        scope: scopeRaw,
        scopeRef,
        items,
        total: items.length,
        gate,
        alreadyFrozen: (snapRes.rowCount ?? 0) > 0,
        snapshot: snapRes.rows[0] ?? null,
      };
    });

    res.json(data);
  } catch (err: any) {
    console.error('GE check error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to run GE final checklist' });
  }
});

// B9-B1. GE final + freeze (ge_admin only): requires all in-scope evaluations
// client-approved (or N/A with reason); stamps FinalApproval (approvals
// level='ge') and creates an immutable snapshot row.
router.post('/reviews/ge-final', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only platform administrators may freeze a GE final review.' });
    }
    const body = req.body ?? {};
    if (!isGeFinalScope(body.scope)) {
      return res.status(400).json({ error: 'scope must be disclosure or tenant.' });
    }
    const scope = body.scope;
    const clientId = typeof body.clientId === 'string' && body.clientId.trim() ? body.clientId.trim() : null;
    if (!clientId) {
      return res.status(400).json({ error: 'No tenant selected. Choose a tenant (clientId) to freeze.' });
    }
    const scopeRef =
      scope === 'tenant'
        ? clientId
        : typeof body.scopeRef === 'string' && body.scopeRef.trim()
          ? body.scopeRef.trim()
          : null;
    if (!scopeRef) {
      return res.status(400).json({ error: 'scopeRef (disclosure id) is required for disclosure scope.' });
    }
    if (typeof body.confirm !== 'boolean' || body.confirm !== true) {
      return res.status(400).json({ error: 'Explicit confirmation is required: pass { confirm: true } to freeze.' });
    }

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const tenantRes = await client.query('SELECT id FROM clients WHERE id = $1', [clientId]);
      if (!tenantRes.rows[0]) {
        throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
      }

      const existing = await client.query(
        'SELECT id FROM review_snapshots WHERE client_id = $1 AND scope_type = $2 AND scope_ref = $3',
        [clientId, scope, scopeRef]
      );
      if ((existing.rowCount ?? 0) > 0) {
        throw Object.assign(new Error('This scope is already frozen (a snapshot exists). Post-freeze notes are append-only.'), {
          statusCode: 409,
        });
      }

      const { items } = await loadGeScopeRows(client, clientId, scope, scopeRef);
      if (items.length === 0) {
        throw Object.assign(new Error('Nothing to freeze: this scope has no assigned items.'), { statusCode: 400 });
      }
      const gate = geFinalGate(
        items.map((it) => ({
          itemId: it.itemId,
          code: it.code,
          answerStatus: it.answerStatus,
          notApplicable: it.notApplicable,
          naReason: it.naReason,
        }))
      );
      if (!gate.ok) {
        throw Object.assign(
          new Error(
            `GE final approval is blocked: ${gate.incomplete.length} item(s) are not client-approved yet: ` +
              gate.incomplete.join(', ') +
              `. Every in-scope item must be client-approved (or N/A with a reason) first.`
          ),
          { statusCode: 409 }
        );
      }

      // Aggregate over the frozen numbers (same weighted rule as the dashboard).
      const scoreRows = items.map((it) => ({
        itemId: it.itemId,
        weight: it.weight || 2,
        score: it.score as 0 | 50 | 100 | null,
        notEvaluated: Boolean(it.notEvaluated),
        notApplicable: Boolean(it.notApplicable),
        justification: it.evaluation?.justification,
        hasEvaluation: it.evaluation !== null,
        hasSubmittedAnswer: true,
      }));
      const aggregate = calculateAggregateScore(gateDraftEvaluations(scoreRows));

      // Stamp FinalApproval (approvals level='ge') on every client-approved answer.
      const finalApprovals: any[] = [];
      for (const it of items) {
        if (it.notApplicable) continue;
        const ansRes = await client.query(
          `SELECT id FROM answers
            WHERE client_id = $1 AND item_id = $2 AND status = 'client_approved'`,
          [clientId, it.itemId]
        );
        for (const a of ansRes.rows) {
          const apprRes = await client.query(
            `INSERT INTO approvals (client_id, answer_id, approver_id, level, status, comments)
              VALUES ($1, $2, $3, 'ge', 'approved', 'GE FinalApproval (freeze)') RETURNING *`,
            [clientId, a.id, user.id]
          );
          finalApprovals.push(apprRes.rows[0]);
        }
      }

      const now = new Date().toISOString();
      const payload = {
        scope,
        scopeRef,
        clientId,
        frozenBy: user.id,
        frozenAt: now,
        items: items.map((it) => ({
          itemId: it.itemId,
          code: it.code,
          score: it.score,
          notEvaluated: it.notEvaluated,
          notApplicable: it.notApplicable,
          naReason: it.naReason,
          weight: it.weight,
        })),
        aggregate: aggregate.aggregateScore,
        coveragePercentage: aggregate.coveragePercentage,
        counts: {
          total: aggregate.totalCount,
          evaluated: aggregate.evaluatedCount,
          applicable: aggregate.applicableCount,
          notApplicable: aggregate.notApplicableCount,
          notEvaluated: aggregate.notEvaluatedCount,
          fullGap: aggregate.fullGapCount,
          partialGap: aggregate.partialGapCount,
          noGap: aggregate.noGapCount,
        },
      };
      const contentHash = snapshotContentHash(payload);
      const snapRes = await client.query(
        `INSERT INTO review_snapshots (client_id, scope_type, scope_ref, payload, content_hash, created_by)
          VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [clientId, scope, scopeRef, JSON.stringify(payload), contentHash, user.id]
      );

      await recordAuditLog(client, {
        clientId,
        userId: user.id,
        action: 'GE_FINAL_FROZEN',
        entityType: 'review_snapshots',
        entityId: snapRes.rows[0].id,
        payload: { scope, scopeRef, contentHash, aggregate: aggregate.aggregateScore, coverage: aggregate.coveragePercentage },
      });

      return { snapshot: snapRes.rows[0], aggregate, finalApprovals: finalApprovals.length };
    });

    res.status(201).json(result);
  } catch (err: any) {
    console.error('GE final error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to freeze GE final review' });
  }
});

// B9-B4. Snapshot list + viewer (frozen numbers + hash + actor + time).
router.get('/reviews/snapshots', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const namedClient = typeof req.query.clientId === 'string' && req.query.clientId.trim() ? req.query.clientId.trim() : null;
    if (user.role !== 'ge_admin' && namedClient && namedClient !== user.clientId) {
      return res.status(403).json({ error: 'Cross-tenant snapshot access is forbidden.' });
    }
    const tenantId = user.role === 'ge_admin' ? namedClient ?? user.clientId ?? null : user.clientId ?? null;
    if (!tenantId && user.role === 'ge_admin') {
      return res.status(400).json({ error: 'No tenant selected. As a platform admin, choose a tenant (clientId).' });
    }
    if (!tenantId) {
      return res.status(400).json({ error: 'No tenant context for this user.' });
    }

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      const result = await client.query(
        `SELECT s.id, s.client_id, s.scope_type, s.scope_ref, s.payload, s.content_hash,
                s.created_by, u.name AS created_by_name, s.created_at,
                (SELECT COUNT(*)::int FROM snapshot_notes n WHERE n.snapshot_id = s.id) AS notes_count
          FROM review_snapshots s
          LEFT JOIN users u ON u.id = s.created_by
          WHERE s.client_id = $1
          ORDER BY s.created_at DESC`,
        [tenantId]
      );
      return result.rows;
    });

    res.json({ tenantId, items: rows, count: rows.length });
  } catch (err: any) {
    console.error('Snapshots list error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch snapshots' });
  }
});

router.get('/reviews/snapshots/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const snapRes = await client.query(
        `SELECT s.id, s.client_id, s.scope_type, s.scope_ref, s.payload, s.content_hash,
                s.created_by, u.name AS created_by_name, s.created_at
          FROM review_snapshots s
          LEFT JOIN users u ON u.id = s.created_by
          WHERE s.id = $1`,
        [req.params.id]
      );
      const snapshot = snapRes.rows[0];
      if (!snapshot) {
        throw Object.assign(new Error('Snapshot not found.'), { statusCode: 404 });
      }
      if (user.role !== 'ge_admin' && snapshot.client_id !== user.clientId) {
        throw Object.assign(new Error('Cross-tenant snapshot access is forbidden.'), { statusCode: 403 });
      }
      const notesRes = await client.query(
        `SELECT n.id, n.note, n.created_by, u.name AS created_by_name, n.created_at
          FROM snapshot_notes n
          LEFT JOIN users u ON u.id = n.created_by
          WHERE n.snapshot_id = $1
          ORDER BY n.created_at ASC`,
        [snapshot.id]
      );
      return { snapshot, notes: notesRes.rows };
    });

    res.json(data);
  } catch (err: any) {
    console.error('Snapshot view error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch snapshot' });
  }
});

// B9-B2. Post-freeze append-only note: the ONLY write allowed on frozen scope.
router.post('/reviews/snapshots/:id/notes', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) {
      return res.status(400).json({ error: 'note is required.' });
    }
    if (note.length > 2000) {
      return res.status(400).json({ error: 'note must be at most 2000 characters.' });
    }

    const created = await withTenantContext(contextFromUser(user), async (client) => {
      const snapRes = await client.query('SELECT id, client_id FROM review_snapshots WHERE id = $1', [req.params.id]);
      const snapshot = snapRes.rows[0];
      if (!snapshot) {
        throw Object.assign(new Error('Snapshot not found.'), { statusCode: 404 });
      }
      if (user.role !== 'ge_admin' && snapshot.client_id !== user.clientId) {
        throw Object.assign(new Error('Cross-tenant snapshot access is forbidden.'), { statusCode: 403 });
      }
      const insRes = await client.query(
        `INSERT INTO snapshot_notes (snapshot_id, client_id, note, created_by)
          VALUES ($1, $2, $3, $4) RETURNING *`,
        [snapshot.id, snapshot.client_id, note, user.id]
      );

      await recordAuditLog(client, {
        clientId: snapshot.client_id,
        userId: user.id,
        action: 'SNAPSHOT_NOTE_ADDED',
        entityType: 'review_snapshots',
        entityId: snapshot.id,
        payload: { noteLength: note.length },
      });

      return insRes.rows[0];
    });

    res.status(201).json(created);
  } catch (err: any) {
    console.error('Snapshot note error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to add snapshot note' });
  }
});

// ----------------------------------------------------------------------
// 6E. Evidence attachments, 5 MB cap (MP-47, S-15, OD-06)
// ----------------------------------------------------------------------

/** Loads an answer the caller may see (RLS applies); employees: own dept only. */
async function loadVisibleAnswer(client: DbClient, user: AuthUser, answerId: string): Promise<any> {
  const ansRes = await client.query('SELECT * FROM answers WHERE id = $1', [answerId]);
  const answer = ansRes.rows[0];
  if (!answer) {
    throw Object.assign(new Error('Answer not found.'), { statusCode: 404 });
  }
  if (user.role === 'employee') {
    if (!user.departmentId || answer.department_id !== user.departmentId) {
      throw Object.assign(new Error('Employees may only manage attachments for their own department.'), {
        statusCode: 403,
      });
    }
  }
  return answer;
}

// B9-D2. Upload (multipart). Multer enforces the 5 MB stream cap first; the
// route re-checks size + allowlist via validateAttachment (never trust client).
router.post('/answers/:id/attachments', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  attachmentUpload.single('file')(req, res, async (multerErr: any) => {
    try {
      if (multerErr) {
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'File is too large. Evidence attachments are limited to 5 MB per file.',
            code: 'attachments.oversize',
          });
        }
        return res.status(400).json({ error: multerErr.message || 'Upload failed.', code: 'attachments.upload' });
      }
      const user = req.user!;
      const file = (req as any).file;
      if (!file) {
        return res.status(400).json({ error: 'A file field named "file" is required.', code: 'attachments.missing' });
      }
      const check = validateAttachment({ mime: file.mimetype, sizeBytes: file.size });
      if (!check.ok) {
        return res.status(400).json({
          error:
            check.code === 'attachments.oversize'
              ? 'File is too large. Evidence attachments are limited to 5 MB per file.'
              : 'File type not allowed. Accepted types: PDF, PNG, JPEG, XLSX, CSV, TXT.',
          code: check.code,
        });
      }

      const created = await withTenantContext(contextFromUser(user), async (client) => {
        const answer = await loadVisibleAnswer(client, user, req.params.id);
        if (await isFrozenScope(client, answer.client_id, answer.item_id)) {
          throw frozenWriteError();
        }
        const insRes = await client.query(
          `INSERT INTO evidence_attachments (answer_id, file_name, mime, size_bytes, data, uploaded_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, answer_id, file_name, mime, size_bytes, uploaded_by, created_at`,
          [answer.id, String(file.originalname).slice(0, 255), file.mimetype, file.size, file.buffer, user.id]
        );

        await recordAuditLog(client, {
          clientId: answer.client_id,
          userId: user.id,
          action: 'ATTACHMENT_UPLOADED',
          entityType: 'evidence_attachments',
          entityId: insRes.rows[0].id,
          payload: { answerId: answer.id, fileName: insRes.rows[0].file_name, mime: insRes.rows[0].mime, sizeBytes: file.size },
        });

        return insRes.rows[0];
      });

      res.status(201).json(created);
    } catch (err: any) {
      console.error('Attachment upload error:', err);
      const mapped = toFrozenError(err);
      res.status(mapped.statusCode || 500).json({ error: mapped.message || 'Failed to upload attachment' });
    }
  });
});

// B9-D2. List metadata (never bulk bytes).
router.get('/answers/:id/attachments', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      await loadVisibleAnswer(client, user, req.params.id);
      const result = await client.query(
        `SELECT ea.id, ea.answer_id, ea.file_name, ea.mime, ea.size_bytes,
                ea.uploaded_by, u.name AS uploaded_by_name, ea.created_at
          FROM evidence_attachments ea
          LEFT JOIN users u ON u.id = ea.uploaded_by
          WHERE ea.answer_id = $1
          ORDER BY ea.created_at ASC`,
        [req.params.id]
      );
      return result.rows;
    });

    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    console.error('Attachments list error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch attachments' });
  }
});

// B9-D2. Single-file download stream.
router.get('/answers/:id/attachments/:attachId/download', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const file = await withTenantContext(contextFromUser(user), async (client) => {
      const answer = await loadVisibleAnswer(client, user, req.params.id);
      const fileRes = await client.query('SELECT * FROM evidence_attachments WHERE id = $1 AND answer_id = $2', [
        req.params.attachId,
        answer.id,
      ]);
      if (!fileRes.rows[0]) {
        throw Object.assign(new Error('Attachment not found.'), { statusCode: 404 });
      }
      return fileRes.rows[0];
    });

    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(file.size_bytes));
    res.setHeader('Content-Disposition', `attachment; filename="${String(file.file_name).replace(/"/g, '')}"`);
    res.send(file.data);
  } catch (err: any) {
    console.error('Attachment download error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to download attachment' });
  }
});

// B9-D2. Delete (uploader or admin; audited).
router.delete('/answers/:id/attachments/:attachId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    await withTenantContext(contextFromUser(user), async (client) => {
      const answer = await loadVisibleAnswer(client, user, req.params.id);
      if (await isFrozenScope(client, answer.client_id, answer.item_id)) {
        throw frozenWriteError();
      }
      const fileRes = await client.query('SELECT * FROM evidence_attachments WHERE id = $1 AND answer_id = $2', [
        req.params.attachId,
        answer.id,
      ]);
      const file = fileRes.rows[0];
      if (!file) {
        throw Object.assign(new Error('Attachment not found.'), { statusCode: 404 });
      }
      const isAdmin = user.role === 'client_admin' || user.role === 'ge_admin';
      if (!isAdmin && file.uploaded_by !== user.id) {
        throw Object.assign(new Error('Only the uploader or an administrator may delete this attachment.'), {
          statusCode: 403,
        });
      }
      await client.query('DELETE FROM evidence_attachments WHERE id = $1', [file.id]);

      await recordAuditLog(client, {
        clientId: answer.client_id,
        userId: user.id,
        action: 'ATTACHMENT_DELETED',
        entityType: 'evidence_attachments',
        entityId: file.id,
        payload: { answerId: answer.id, fileName: file.file_name, sizeBytes: file.size_bytes },
      });
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Attachment delete error:', err);
    const mapped = toFrozenError(err);
    res.status(mapped.statusCode || 500).json({ error: mapped.message || 'Failed to delete attachment' });
  }
});

// B9-D3. Storage monitor readout (bytes + files + cap note), shown in Settings.
router.get('/storage/usage', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const namedClient = typeof req.query.clientId === 'string' && req.query.clientId.trim() ? req.query.clientId.trim() : null;
    if (user.role !== 'ge_admin' && namedClient && namedClient !== user.clientId) {
      return res.status(403).json({ error: 'Cross-tenant storage access is forbidden.' });
    }
    const tenantId = user.role === 'ge_admin' ? namedClient ?? user.clientId ?? null : user.clientId ?? null;
    if (!tenantId) {
      return res.status(400).json({ error: 'No tenant selected. As a platform admin, choose a tenant (clientId).' });
    }

    const usage = await withTenantContext(contextFromUser(user), async (client) => {
      const result = await client.query(
        `SELECT COUNT(*)::int AS files, COALESCE(SUM(ea.size_bytes), 0)::int AS bytes
          FROM evidence_attachments ea
          JOIN answers a ON a.id = ea.answer_id
          WHERE a.client_id = $1`,
        [tenantId]
      );
      const row = result.rows[0] ?? { files: 0, bytes: 0 };
      const bytes = Number(row.bytes) || 0;
      return {
        tenantId,
        bytes,
        files: Number(row.files) || 0,
        formatted: formatBytes(bytes),
        warnThresholdBytes: STORAGE_WARN_BYTES,
        warn: bytes >= STORAGE_WARN_BYTES,
        capNote: 'Demo database capacity is 1 GB. Attachments warn at 800 MB; production object-storage migration is out of scope (OD-06).',
      };
    });

    res.json(usage);
  } catch (err: any) {
    console.error('Storage usage error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch storage usage' });
  }
});

// ----------------------------------------------------------------------
// 7. Clients & Departments (for Administration)
// ----------------------------------------------------------------------
router.get('/clients', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      let query = 'SELECT id, code, name, industry, contact_email, created_at FROM clients';
      const params: any[] = [];

      if (user.role !== 'ge_admin') {
        if (!user.clientId) {
          return [];
        }
        query += ' WHERE id = $1';
        params.push(user.clientId);
      }

      query += ' ORDER BY name ASC';
      const result = await client.query(query, params);
      return result.rows;
    });

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clients', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only platform administrators can create new client tenants.' });
    }

    const { code, name, industry, contactEmail } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: 'Client code and name are required.' });
    }

    const newClient = await withTenantContext(contextFromUser(user), async (client) => {
      const result = await client.query(
        `INSERT INTO clients (code, name, industry, contact_email)
         VALUES ($1, $2, $3, $4)
         RETURNING id, code, name, industry, contact_email, created_at`,
        [code.trim(), name.trim(), industry || null, contactEmail || null]
      );

      const created = result.rows[0];

      await recordAuditLog(client, {
        clientId: created.id,
        userId: user.id,
        action: 'CREATE_CLIENT',
        entityType: 'clients',
        entityId: created.id,
        payload: { code: created.code, name: created.name },
      });

      return created;
    });

    res.json(newClient);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create client tenant' });
  }
});

router.get('/departments', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      let query = 'SELECT id, client_id, code, name, description FROM departments';
      const params: any[] = [];

      if (user.role !== 'ge_admin' && user.clientId) {
        query += ' WHERE client_id = $1';
        params.push(user.clientId);
      }

      query += ' ORDER BY name ASC';
      const result = await client.query(query, params);
      return result.rows;
    });

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------
// 8. Minimal User Management (FIX BATCH 4, demo only)
//
// The demo ships exactly one bootstrap account (/setup/admin is once-only),
// so admins need list + create + deactivate. Accounts are never deleted;
// deactivated logins fail closed with a human 401 (see /auth/login).
// Every write is audit-logged under the effective tenant.
// ----------------------------------------------------------------------

const SAFE_USER_COLUMNS = `
  u.id, u.email, u.name, u.role, u.is_active, u.client_id, u.department_id,
  u.created_at, c.name AS client_name, d.name AS department_name
`;

function requireUserAdmin(user: AuthUser, res: Response): boolean {
  if (user.role !== 'ge_admin' && user.role !== 'client_admin') {
    res.status(403).json({ error: 'Only administrators can manage users.' });
    return false;
  }
  return true;
}

// C1. List users — ge_admin: all; client_admin: own tenant.
router.get('/users', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!requireUserAdmin(user, res)) return;

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      let query = `SELECT ${SAFE_USER_COLUMNS} FROM users u
                   LEFT JOIN clients c ON u.client_id = c.id
                   LEFT JOIN departments d ON u.department_id = d.id`;
      const params: any[] = [];
      if (user.role !== 'ge_admin') {
        if (!user.clientId) return [];
        query += ' WHERE u.client_id = $1';
        params.push(user.clientId);
      }
      query += ' ORDER BY u.created_at ASC';
      const result = await client.query(query, params);
      return result.rows;
    });

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch users' });
  }
});

// C1. Create user — ge_admin: any tenant (explicit clientId); client_admin:
// own tenant only. Duplicate e-mail → 409. Audit-logged.
router.post('/users', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const creator = req.user!;
    if (!requireUserAdmin(creator, res)) return;

    const validation = validateNewUser(
      { id: creator.id, role: creator.role, clientId: creator.clientId ?? null },
      req.body ?? {}
    );
    if (!validation.ok) {
      return res.status(validation.status).json({ error: validation.error });
    }
    const input = validation.user;

    const created = await withTenantContext(contextFromUser(creator), async (client) => {
      // E-mail uniqueness is case-insensitive (C3 → 409).
      const dupe = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [input.email]);
      if ((dupe.rowCount ?? 0) > 0) {
        throw Object.assign(new Error('A user with this email already exists.'), { statusCode: 409 });
      }

      // Target tenant must exist for tenant-scoped roles.
      if (input.effectiveClientId) {
        const tenantCheck = await client.query('SELECT id FROM clients WHERE id = $1', [input.effectiveClientId]);
        if ((tenantCheck.rowCount ?? 0) === 0) {
          throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
        }
      }

      // Employee departments must exist inside the effective tenant.
      if (input.role === 'employee' && input.departmentId) {
        const deptCheck = await client.query(
          'SELECT id, client_id FROM departments WHERE id = $1',
          [input.departmentId]
        );
        const dept = deptCheck.rows[0];
        if (!dept) {
          throw Object.assign(new Error('Department not found for the given departmentId.'), { statusCode: 404 });
        }
        if (dept.client_id !== input.effectiveClientId) {
          throw Object.assign(new Error('Department does not belong to the target tenant.'), { statusCode: 400 });
        }
      }

      const passwordHash = await hashPassword(input.password);
      let createdRow;
      try {
        const insertRes = await client.query(
          `INSERT INTO users (email, password_hash, name, role, client_id, department_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, email, name, role, is_active, client_id, department_id, created_at`,
          [input.email, passwordHash, input.name, input.role, input.effectiveClientId, input.departmentId]
        );
        createdRow = insertRes.rows[0];
      } catch (dbErr: any) {
        // Race on the unique e-mail index still surfaces as 409, never 500.
        if (dbErr?.code === '23505') {
          throw Object.assign(new Error('A user with this email already exists.'), { statusCode: 409 });
        }
        throw dbErr;
      }

      await recordAuditLog(client, {
        clientId: input.effectiveClientId,
        userId: creator.id,
        action: 'USER_CREATED',
        entityType: 'users',
        entityId: createdRow.id,
        payload: {
          actor: creator.id,
          actorRole: creator.role,
          targetTenant: input.effectiveClientId,
          createdRole: createdRow.role,
          email: createdRow.email,
        },
      });

      return createdRow;
    });

    res.status(201).json(created);
  } catch (err: any) {
    console.error('Create user error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create user' });
  }
});

// C1. Deactivate (or reactivate) — never delete. Self-deactivation is refused.
router.patch('/users/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    if (!requireUserAdmin(actor, res)) return;

    const { isActive } = req.body ?? {};
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive (boolean) is required.' });
    }
    const targetId = req.params.id;
    if (targetId === actor.id) {
      return res.status(400).json({ error: 'You cannot change your own active status.' });
    }

    const updated = await withTenantContext(contextFromUser(actor), async (client) => {
      const found = await client.query(
        `SELECT ${SAFE_USER_COLUMNS} FROM users u
         LEFT JOIN clients c ON u.client_id = c.id
         LEFT JOIN departments d ON u.department_id = d.id
         WHERE u.id = $1`,
        [targetId]
      );
      const target = found.rows[0];
      // Outside the caller's tenant scope the row is simply not visible.
      if (!target) {
        throw Object.assign(new Error('User not found.'), { statusCode: 404 });
      }
      if (actor.role === 'client_admin' && target.role === 'ge_admin') {
        throw Object.assign(new Error('Client administrators cannot change platform administrator accounts.'), {
          statusCode: 403,
        });
      }

      const updRes = await client.query(
        'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, role, is_active, client_id, department_id, created_at',
        [isActive, targetId]
      );

      await recordAuditLog(client, {
        clientId: target.client_id,
        userId: actor.id,
        action: isActive ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
        entityType: 'users',
        entityId: targetId,
        payload: { actor: actor.id, actorRole: actor.role, targetTenant: target.client_id, isActive },
      });

      return updRes.rows[0];
    });

    res.json(updated);
  } catch (err: any) {
    console.error('Update user error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update user' });
  }
});

// ----------------------------------------------------------------------
// 9. Actions — Corrective Action lifecycle (FIX BATCH 8 / MP-40, WF-04)
//
// open → in_progress → awaiting_verification → closed
// awaiting_verification → closed | reopened (reason required)
// closed → reopened (reason required); reopened → in_progress
// Anything else is refused (409). Verify/close/reopen are admin-only
// (client_admin / ge_admin); employees work their own department only.
// Evidence is a TEXT reference (DV-01: no binary upload). Closing an action
// only UPDATEs actions — evaluations are never touched.
// ----------------------------------------------------------------------

// B1. List actions in scope, optional status/department filters.
router.get('/actions', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const namedStatus = typeof req.query.status === 'string' && req.query.status.trim()
      ? req.query.status.trim()
      : null;
    const namedDept = typeof req.query.departmentId === 'string' && req.query.departmentId.trim()
      ? req.query.departmentId.trim()
      : null;
    const namedClient = typeof req.query.clientId === 'string' && req.query.clientId.trim()
      ? req.query.clientId.trim()
      : null;

    if (namedStatus && !isActionStatus(namedStatus)) {
      return res.status(400).json({ error: 'Unknown action status filter.' });
    }
    if (user.role === 'employee') {
      if (!user.departmentId) {
        return res.status(400).json({ error: 'Your user account has no department assignment.' });
      }
      if (namedDept && namedDept !== user.departmentId) {
        return res.status(403).json({ error: 'Employees may only access actions assigned to their own department.' });
      }
    }
    if ((user.role === 'client_admin' || user.role === 'employee') && namedClient && namedClient !== user.clientId) {
      return res.status(403).json({ error: 'Cross-tenant action access is forbidden.' });
    }
    const deptFilter = user.role === 'employee' ? user.departmentId! : namedDept;
    const clientFilter = user.role === 'ge_admin' ? namedClient : null;

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      const params: any[] = [];
      let where = '';
      if (namedStatus) {
        params.push(namedStatus);
        where += ` AND a.status = $${params.length}`;
      }
      if (deptFilter) {
        params.push(deptFilter);
        where += ` AND a.owner_department_id = $${params.length}`;
      }
      if (clientFilter) {
        params.push(clientFilter);
        where += ` AND a.client_id = $${params.length}`;
      }
      const result = await client.query(
        `SELECT a.id, a.client_id, a.item_id, a.owner_department_id,
                d.code AS department_code, d.name AS department_name,
                i.code AS item_code,
                a.title, a.description, a.due_date, a.status, a.evidence_note,
                a.created_at, a.updated_at
         FROM actions a
         JOIN departments d ON d.id = a.owner_department_id
         LEFT JOIN items i ON i.id = a.item_id
         WHERE 1 = 1${where}
         ORDER BY a.created_at DESC`,
        params
      );
      return result.rows;
    });

    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    console.error('Actions list error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch actions' });
  }
});

// B1. Create an action (status starts at open). Employees: own department only.
router.post('/actions', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const body = req.body ?? {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const departmentId = typeof body.departmentId === 'string' ? body.departmentId.trim() : '';
    const itemId = typeof body.itemId === 'string' && body.itemId.trim() ? body.itemId.trim() : null;
    const dueDate = typeof body.dueDate === 'string' && body.dueDate.trim() ? body.dueDate.trim() : null;

    if (!title) {
      return res.status(400).json({ error: 'title is required.' });
    }
    if (!departmentId) {
      return res.status(400).json({ error: 'departmentId is required.' });
    }
    if (user.role === 'employee') {
      if (!user.departmentId) {
        return res.status(400).json({ error: 'Your user account has no department assignment.' });
      }
      if (departmentId !== user.departmentId) {
        return res.status(403).json({ error: 'Employees may only create actions for their own department.' });
      }
    }
    if (dueDate && Number.isNaN(Date.parse(dueDate))) {
      return res.status(400).json({ error: 'dueDate must be a valid date.' });
    }

    // Effective tenant: same explicit-tenant pattern as /gri/commit.
    const tenantResolution = resolveImportTenant(
      { id: user.id, role: user.role, clientId: user.clientId ?? null },
      body.clientId
    );
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const effectiveClientId = tenantResolution.effectiveClientId;

    const created = await withTenantContext(contextFromUser(user), async (client) => {
      const deptRes = await client.query(
        'SELECT id, client_id FROM departments WHERE id = $1',
        [departmentId]
      );
      if (!deptRes.rows[0]) {
        throw Object.assign(new Error('Department not found for the given departmentId.'), { statusCode: 404 });
      }
      if (deptRes.rows[0].client_id !== effectiveClientId) {
        throw Object.assign(new Error('Department does not belong to the target tenant.'), { statusCode: 400 });
      }
      if (itemId) {
        const itemRes = await client.query('SELECT id FROM items WHERE id = $1', [itemId]);
        if (!itemRes.rows[0]) {
          throw Object.assign(new Error('Item not found for the given itemId.'), { statusCode: 404 });
        }
      }

      const insRes = await client.query(
        `INSERT INTO actions (client_id, item_id, owner_department_id, title, description, due_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'open')
         RETURNING *`,
        [effectiveClientId, itemId, departmentId, title, description || null, dueDate]
      );

      await recordAuditLog(client, {
        clientId: effectiveClientId,
        userId: user.id,
        action: 'ACTION_CREATED',
        entityType: 'actions',
        entityId: insRes.rows[0].id,
        payload: { itemId, departmentId, title, explicitTenant: tenantResolution.explicit },
      });

      return insRes.rows[0];
    });

    res.status(201).json(created);
  } catch (err: any) {
    console.error('Action create error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create action' });
  }
});

// B1. Patch an action: WF-04 transition and/or evidence note.
// Closing NEVER touches evaluations — this handler UPDATEs actions only.
router.patch('/actions/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const actionId = req.params.id;
    const body = req.body ?? {};
    const hasStatus = body.status !== undefined && body.status !== null;
    const hasEvidence = typeof body.evidenceNote === 'string';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    if (!hasStatus && !hasEvidence) {
      return res.status(400).json({ error: 'Provide status and/or evidenceNote.' });
    }
    let nextStatus: ActionStatus | null = null;
    if (hasStatus) {
      if (!isActionStatus(body.status)) {
        return res.status(400).json({
          error: `Unknown status. Allowed: ${ACTION_STATUSES.join(', ')}.`,
        });
      }
      nextStatus = body.status;
    }

    const updated = await withTenantContext(contextFromUser(user), async (client) => {
      const found = await client.query('SELECT * FROM actions WHERE id = $1', [actionId]);
      const action = found.rows[0];
      // Outside the caller's RLS scope the row is simply not visible.
      if (!action) {
        throw Object.assign(new Error('Action not found.'), { statusCode: 404 });
      }

      if (user.role === 'employee') {
        if (!user.departmentId || action.owner_department_id !== user.departmentId) {
          throw Object.assign(new Error('Employees may only update actions assigned to their own department.'), {
            statusCode: 403,
          });
        }
      }

      if (nextStatus) {
        if (!canTransitionAction(action.status as ActionStatus, nextStatus)) {
          throw Object.assign(
            new Error(`Illegal transition ${action.status} → ${nextStatus} (WF-04).`),
            { statusCode: 409 }
          );
        }
        if (actionTransitionRequiresReason(nextStatus) && !reason) {
          throw Object.assign(new Error('A reason is required to reopen an action.'), { statusCode: 400 });
        }
        if (actionTransitionRequiresAdmin(nextStatus) && user.role === 'employee') {
          throw Object.assign(new Error('Only tenant or platform administrators may verify, close, or reopen actions.'), {
            statusCode: 403,
          });
        }
      }

      const sets: string[] = ['updated_at = NOW()'];
      const params: any[] = [];
      if (nextStatus) {
        params.push(nextStatus);
        sets.push(`status = $${params.length}`);
      }
      if (hasEvidence) {
        params.push(body.evidenceNote);
        sets.push(`evidence_note = $${params.length}`);
      }
      params.push(actionId);
      const updRes = await client.query(
        `UPDATE actions SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );

      if (nextStatus) {
        await recordAuditLog(client, {
          clientId: action.client_id,
          userId: user.id,
          action: 'ACTION_STATUS_CHANGED',
          entityType: 'actions',
          entityId: action.id,
          payload: { from: action.status, to: nextStatus, reason: reason || null },
        });
      }
      if (hasEvidence) {
        await recordAuditLog(client, {
          clientId: action.client_id,
          userId: user.id,
          action: 'ACTION_EVIDENCE_UPDATED',
          entityType: 'actions',
          entityId: action.id,
          payload: { hasEvidence: body.evidenceNote.length > 0 },
        });
      }

      return updRes.rows[0];
    });

    res.json(updated);
  } catch (err: any) {
    console.error('Action patch error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update action' });
  }
});

// ----------------------------------------------------------------------
// 10. Initiatives library (FIX BATCH 8 / MP-41)
//
// initiatives_library is tenant-neutral GLOBAL (like standards): readable by
// every authenticated role. Selection links (client_initiatives) are
// per-tenant. Only admins select for a tenant; only ge_admin edits the
// library. Creates upsert on the natural key (title, sector) so re-imports
// add 0 duplicates.
// ----------------------------------------------------------------------

function initiativeSelectionScope(
  user: AuthUser,
  explicit: unknown
): { effectiveClientId: string | null } | { error: string; status: number } {
  const named = typeof explicit === 'string' && explicit.trim() ? explicit.trim() : null;
  if (user.role === 'ge_admin') {
    return { effectiveClientId: named ?? user.clientId ?? null };
  }
  if (named && named !== user.clientId) {
    return { error: 'Cross-tenant initiative selection is forbidden.', status: 403 };
  }
  return { effectiveClientId: user.clientId ?? null };
}

// B3. Browse the library with filters; `selected` reflects the effective tenant.
router.get('/initiatives', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const sector = typeof req.query.sector === 'string' ? req.query.sector.trim() : '';
    const esg = typeof req.query.esg === 'string' ? req.query.esg.trim() : '';
    const department = typeof req.query.department === 'string' ? req.query.department.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const scope = initiativeSelectionScope(user, req.query.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    const tenantId = scope.effectiveClientId;

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      const params: any[] = [];
      let where = '';
      if (sector) {
        params.push(sector);
        where += ` AND lib.sector = $${params.length}`;
      }
      if (esg) {
        params.push(esg);
        where += ` AND lib.esg_class = $${params.length}`;
      }
      if (department) {
        params.push(department);
        where += ` AND lib.department = $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        where += ` AND lib.title ILIKE $${params.length}`;
      }
      let selectExtra = 'FALSE AS selected, NULL::timestamptz AS selected_at';
      if (tenantId) {
        params.push(tenantId);
        selectExtra = `EXISTS (SELECT 1 FROM client_initiatives ci WHERE ci.initiative_id = lib.id AND ci.client_id = $${params.length}) AS selected,
          (SELECT ci2.selected_at FROM client_initiatives ci2 WHERE ci2.initiative_id = lib.id AND ci2.client_id = $${params.length}) AS selected_at`;
      }
      const result = await client.query(
        `SELECT lib.id, lib.title, lib.sector, lib.department, lib.esg_class,
                lib.standards_ref, lib.notes, lib.sort_order, ${selectExtra}
         FROM initiatives_library lib
         WHERE 1 = 1${where}
         ORDER BY lib.sort_order ASC NULLS LAST, lib.title ASC`,
        params
      );
      return result.rows;
    });

    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    console.error('Initiatives browse error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch initiatives' });
  }
});

// B3. GE-only library create (upsert on natural key — the import path).
router.post('/initiatives', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only platform administrators may edit the initiatives library.' });
    }
    const body = req.body ?? {};
    const key = initiativeNaturalKey(body.title, body.sector);
    if (!key.title) {
      return res.status(400).json({ error: 'title is required.' });
    }
    const department = typeof body.department === 'string' ? body.department.trim() : '';
    const esgClass = typeof body.esgClass === 'string' ? body.esgClass.trim() : '';
    const standardsRef = typeof body.standardsRef === 'string' ? body.standardsRef.trim() : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    const sortOrder =
      body.sortOrder === null || body.sortOrder === undefined || body.sortOrder === ''
        ? null
        : Number(body.sortOrder);
    if (sortOrder !== null && !Number.isInteger(sortOrder)) {
      return res.status(400).json({ error: 'sortOrder must be an integer.' });
    }
    const importBatchId = typeof body.importBatchId === 'string' ? body.importBatchId : null;

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const upsertRes = await client.query(
        `INSERT INTO initiatives_library (title, sector, department, esg_class, standards_ref, notes, sort_order, import_batch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (title, sector) DO UPDATE SET
           department = EXCLUDED.department,
           esg_class = EXCLUDED.esg_class,
           standards_ref = EXCLUDED.standards_ref,
           notes = EXCLUDED.notes,
           sort_order = EXCLUDED.sort_order,
           import_batch_id = EXCLUDED.import_batch_id,
           updated_at = NOW()
         RETURNING *, (xmax = 0) AS was_inserted`,
        [key.title, key.sector, department, esgClass, standardsRef, notes, sortOrder, importBatchId]
      );
      const row = upsertRes.rows[0];
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'INITIATIVE_UPSERTED',
        entityType: 'initiatives_library',
        entityId: row.id,
        payload: { title: key.title, sector: key.sector, created: row.was_inserted },
      });
      return { initiative: row, created: row.was_inserted };
    });

    res.status(result.created ? 201 : 200).json(result);
  } catch (err: any) {
    console.error('Initiative upsert error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to save initiative' });
  }
});

// B3. GE-only library patch.
router.patch('/initiatives/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only platform administrators may edit the initiatives library.' });
    }
    const body = req.body ?? {};
    const allowed: Record<string, string> = {
      title: 'title',
      sector: 'sector',
      department: 'department',
      esgClass: 'esg_class',
      standardsRef: 'standards_ref',
      notes: 'notes',
    };
    const sets: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    for (const [bodyKey, column] of Object.entries(allowed)) {
      if (body[bodyKey] !== undefined) {
        if (typeof body[bodyKey] !== 'string') {
          return res.status(400).json({ error: `${bodyKey} must be a string.` });
        }
        params.push(body[bodyKey].trim());
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (body.sortOrder !== undefined) {
      if (body.sortOrder !== null && !Number.isInteger(Number(body.sortOrder))) {
        return res.status(400).json({ error: 'sortOrder must be an integer.' });
      }
      params.push(body.sortOrder === null ? null : Number(body.sortOrder));
      sets.push(`sort_order = $${params.length}`);
    }
    if (sets.length === 1) {
      return res.status(400).json({ error: 'No editable field provided.' });
    }
    if (params.length === 0) {
      return res.status(400).json({ error: 'No editable field provided.' });
    }

    const updated = await withTenantContext(contextFromUser(user), async (client) => {
      params.push(req.params.id);
      let row;
      try {
        const updRes = await client.query(
          `UPDATE initiatives_library SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params
        );
        row = updRes.rows[0];
      } catch (dbErr: any) {
        if (dbErr?.code === '23505') {
          throw Object.assign(new Error('Another initiative already uses this title and sector.'), { statusCode: 409 });
        }
        throw dbErr;
      }
      if (!row) {
        throw Object.assign(new Error('Initiative not found.'), { statusCode: 404 });
      }
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'INITIATIVE_UPDATED',
        entityType: 'initiatives_library',
        entityId: row.id,
        payload: { title: row.title, sector: row.sector },
      });
      return row;
    });

    res.json(updated);
  } catch (err: any) {
    console.error('Initiative patch error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update initiative' });
  }
});

// B3. Select a library initiative for a tenant (admins only).
router.post('/initiatives/select', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin' && user.role !== 'client_admin') {
      return res.status(403).json({ error: 'Only administrators may select initiatives for a tenant.' });
    }
    const body = req.body ?? {};
    const initiativeId = typeof body.initiativeId === 'string' ? body.initiativeId.trim() : '';
    if (!initiativeId) {
      return res.status(400).json({ error: 'initiativeId is required.' });
    }
    const scope = initiativeSelectionScope(user, body.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    if (!scope.effectiveClientId) {
      return res.status(400).json({ error: 'No tenant selected. As a platform admin, choose a tenant (clientId) to select for.' });
    }
    const effectiveClientId = scope.effectiveClientId;

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const libRes = await client.query('SELECT id FROM initiatives_library WHERE id = $1', [initiativeId]);
      if (!libRes.rows[0]) {
        throw Object.assign(new Error('Initiative not found in the library.'), { statusCode: 404 });
      }
      const tenantRes = await client.query('SELECT id FROM clients WHERE id = $1', [effectiveClientId]);
      if (!tenantRes.rows[0]) {
        throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
      }
      // B9-B3: frozen tenants keep their selection links untouched.
      if (await isFrozenScope(client, effectiveClientId, null)) {
        throw Object.assign(
          new Error('This tenant is frozen by GE final approval. Initiative selection is disabled; only append-only snapshot notes are allowed.'),
          { statusCode: 409 }
        );
      }
      const linkRes = await client.query(
        `INSERT INTO client_initiatives (client_id, initiative_id, selected_by)
          VALUES ($1, $2, $3)
          ON CONFLICT (client_id, initiative_id) DO NOTHING
          RETURNING *`,
        [effectiveClientId, initiativeId, user.id]
      );
      const alreadySelected = (linkRes.rowCount ?? 0) === 0;
      await recordAuditLog(client, {
        clientId: effectiveClientId,
        userId: user.id,
        action: 'INITIATIVE_SELECTED',
        entityType: 'client_initiatives',
        entityId: initiativeId,
        payload: { initiativeId, targetTenant: effectiveClientId, alreadySelected },
      });
      return { selected: true, alreadySelected };
    });

    res.json(result);
  } catch (err: any) {
    console.error('Initiative select error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to select initiative' });
  }
});

// B3. Unselect a library initiative for a tenant (admins only).
router.delete('/initiatives/select/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin' && user.role !== 'client_admin') {
      return res.status(403).json({ error: 'Only administrators may unselect initiatives for a tenant.' });
    }
    const initiativeId = req.params.id;
    const scope = initiativeSelectionScope(user, req.query.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    if (!scope.effectiveClientId) {
      return res.status(400).json({ error: 'No tenant selected. As a platform admin, choose a tenant (clientId) to unselect for.' });
    }
    const effectiveClientId = scope.effectiveClientId;

    await withTenantContext(contextFromUser(user), async (client) => {
      // B9-B3: frozen tenants keep their selection links untouched.
      if (await isFrozenScope(client, effectiveClientId, null)) {
        throw Object.assign(
          new Error('This tenant is frozen by GE final approval. Initiative selection is disabled; only append-only snapshot notes are allowed.'),
          { statusCode: 409 }
        );
      }
      const delRes = await client.query(
        'DELETE FROM client_initiatives WHERE client_id = $1 AND initiative_id = $2',
        [effectiveClientId, initiativeId]
      );
      if ((delRes.rowCount ?? 0) === 0) {
        throw Object.assign(new Error('This initiative is not selected for the tenant.'), { statusCode: 404 });
      }
      await recordAuditLog(client, {
        clientId: effectiveClientId,
        userId: user.id,
        action: 'INITIATIVE_UNSELECTED',
        entityType: 'client_initiatives',
        entityId: initiativeId,
        payload: { initiativeId, targetTenant: effectiveClientId },
      });
    });

    res.json({ selected: false });
  } catch (err: any) {
    console.error('Initiative unselect error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to unselect initiative' });
  }
});

// ----------------------------------------------------------------------
// 11. ESG Profile (FIX BATCH 8 / MP-42)
//
// Per-tenant rows keyed by (pillar, department, topic, parameter); import
// upserts idempotently. GET returns rows + the sheet's own DD-02 aggregate
// (score + coverage). GE sees every tenant explicitly; client_admin sees
// their own tenant; employees read their own tenant.
// ----------------------------------------------------------------------

// C3. Import rows (ge_admin: explicit clientId; client_admin: own tenant).
router.post('/esg-profile/import', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin' && user.role !== 'client_admin') {
      return res.status(403).json({ error: 'Only administrators may import the ESG profile.' });
    }
    const body = req.body ?? {};
    const rows = Array.isArray(body.rows) ? body.rows : null;
    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'rows (non-empty array) is required.' });
    }

    const tenantResolution = resolveImportTenant(
      { id: user.id, role: user.role, clientId: user.clientId ?? null },
      body.clientId
    );
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const effectiveClientId = tenantResolution.effectiveClientId;
    const importBatchId = `esg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const tenantRes = await client.query('SELECT id FROM clients WHERE id = $1', [effectiveClientId]);
      if (!tenantRes.rows[0]) {
        throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
      }

      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      // B9-B3 (WF-05): a tenant-frozen scope skips profile rows with reason.
      let skippedFrozen = 0;
      const tenantFrozen = await isFrozenScope(client, effectiveClientId, null);
      if (tenantFrozen) {
        skippedFrozen = rows.length;
        skipped = rows.length;
      }
      const seen = new Set<string>();
      for (const [index, row] of rows.entries()) {
        if (tenantFrozen) continue;
        const pillar = typeof row.pillar === 'string' ? row.pillar.trim() : '';
        const department = typeof row.department === 'string' ? row.department.trim() : '';
        const topic = typeof row.topic === 'string' ? row.topic.trim() : '';
        const parameter = typeof row.parameter === 'string' ? row.parameter.trim() : '';
        if (!pillar || !department || !topic || !parameter) {
          throw Object.assign(
            new Error(`Row ${index + 1}: pillar, department, topic, and parameter are all required.`),
            { statusCode: 400 }
          );
        }
        const dedupeKey = [pillar, department, topic, parameter].join('::');
        if (seen.has(dedupeKey)) {
          skipped++;
          continue;
        }
        seen.add(dedupeKey);

        // profile_rating 1..3; when only PROFILE text is given, map it.
        let profileRating: number | null = null;
        if (row.profileRating !== undefined && row.profileRating !== null && row.profileRating !== '') {
          profileRating = Number(row.profileRating);
        } else if (typeof row.profile === 'string' && row.profile.trim()) {
          profileRating = esgProfileTextToRating(row.profile);
        }
        if (profileRating !== null && ![1, 2, 3].includes(profileRating)) {
          throw Object.assign(
            new Error(`Row ${index + 1}: profileRating must be one of 1, 2, 3.`),
            { statusCode: 400 }
          );
        }
        const rating =
          row.rating === null || row.rating === undefined || row.rating === '' ? null : Number(row.rating);
        const maxRating =
          row.maxRating === null || row.maxRating === undefined || row.maxRating === '' ? null : Number(row.maxRating);
        if (rating !== null && !Number.isFinite(rating)) {
          throw Object.assign(new Error(`Row ${index + 1}: rating must be numeric.`), { statusCode: 400 });
        }
        if (maxRating !== null && !Number.isFinite(maxRating)) {
          throw Object.assign(new Error(`Row ${index + 1}: maxRating must be numeric.`), { statusCode: 400 });
        }
        const sortOrder =
          row.sortOrder === null || row.sortOrder === undefined || row.sortOrder === ''
            ? null
            : Number(row.sortOrder);

        const upsertRes = await client.query(
          `INSERT INTO esg_profile (client_id, pillar, department, topic, parameter,
                                    observations, market_scenario, profile, profile_rating,
                                    timeline, eco_impact, rating, max_rating, sort_order, import_batch_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (client_id, pillar, department, topic, parameter) DO UPDATE SET
             observations = EXCLUDED.observations,
             market_scenario = EXCLUDED.market_scenario,
             profile = EXCLUDED.profile,
             profile_rating = EXCLUDED.profile_rating,
             timeline = EXCLUDED.timeline,
             eco_impact = EXCLUDED.eco_impact,
             rating = EXCLUDED.rating,
             max_rating = EXCLUDED.max_rating,
             sort_order = EXCLUDED.sort_order,
             import_batch_id = EXCLUDED.import_batch_id,
             updated_at = NOW()
           RETURNING (xmax = 0) AS was_inserted`,
          [
            effectiveClientId, pillar, department, topic, parameter,
            typeof row.observations === 'string' ? row.observations.trim() || null : null,
            typeof row.marketScenario === 'string' ? row.marketScenario.trim() || null : null,
            typeof row.profile === 'string' ? row.profile.trim() || null : null,
            profileRating,
            typeof row.timeline === 'string' ? row.timeline.trim() || null : null,
            typeof row.ecoImpact === 'string' ? row.ecoImpact.trim() || null : null,
            rating, maxRating, sortOrder, importBatchId,
          ]
        );
        if (upsertRes.rows[0].was_inserted) inserted++;
        else updated++;
      }

      await recordAuditLog(client, {
        clientId: effectiveClientId,
        userId: user.id,
        action: 'ESG_PROFILE_IMPORTED',
        entityType: 'esg_profile',
        payload: {
          actor: user.id,
          actorRole: user.role,
          targetTenant: effectiveClientId,
          explicitTenant: tenantResolution.explicit,
          inserted,
          updated,
          skipped,
          skippedFrozen,
          skippedFrozenReason: skippedFrozen > 0 ? 'frozen-scope (GE final tenant snapshot): rows skipped, never touched' : null,
          importBatchId,
        },
      });

      const allRes = await client.query(
        'SELECT profile_rating FROM esg_profile WHERE client_id = $1',
        [effectiveClientId]
      );
      const score = calculateEsgProfileScore(allRes.rows);

      return {
        inserted,
        updated,
        skipped,
        skippedFrozen,
        skippedFrozenReason: skippedFrozen > 0 ? 'frozen-scope (GE final tenant snapshot): rows skipped, never touched' : null,
        count: inserted + updated,
        importBatchId,
        ...score,
      };
    });

    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('ESG profile import error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to import ESG profile' });
  }
});

// C3. Read the tenant profile: rows + DD-02 score + coverage.
router.get('/esg-profile', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const clientId = evalClientScope(user, req.query.clientId);
    if (!clientId) {
      if (user.role === 'ge_admin') {
        return res.status(400).json({ error: 'No tenant selected. As a platform admin, choose a tenant (clientId).' });
      }
      return res.status(403).json({ error: 'Cross-tenant ESG profile access is forbidden.' });
    }

    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const rowsRes = await client.query(
        `SELECT id, pillar, department, topic, parameter, observations, market_scenario,
                profile, profile_rating, timeline, eco_impact, rating, max_rating,
                sort_order, updated_at
         FROM esg_profile
         WHERE client_id = $1
         ORDER BY sort_order ASC NULLS LAST, pillar ASC, department ASC, topic ASC, parameter ASC`,
        [clientId]
      );
      const score = calculateEsgProfileScore(rowsRes.rows);
      return { rows: rowsRes.rows, ...score };
    });

    res.json(data);
  } catch (err: any) {
    console.error('ESG profile fetch error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch ESG profile' });
  }
});

// ----------------------------------------------------------------------
// 12. Reports — D-038 gate, disclosure index, level views + export
// (FIX BATCH 10 / MP-47/48/49/50, A-09..A-13, M-11/10 §6, OD-05, 04 §4)
//
// - Report level is stored per (client × service), NO default (A-09).
// - Every report/export endpoint checks the gate FIRST → 409 + the unified
//   bilingual refusal when unset (M-11/10 §6, MP-47).
// - The disclosure index enforces the HARD RULE server-side: an omitted row
//   without BOTH reason and explanation is RETURNED flagged incomplete and
//   the endpoint answers 422 naming the disclosure codes (MP-48, A-13).
// - Notification is a RECORD only (A-11, MP-49): stored, rendered, exported.
//   No sending code and no mailer dependency exist anywhere in this path.
// - L1/L2/L3 views share one number source (dashboard math: drafts excluded,
//   N/A excluded, coverage beside every score — A-12).
// - 04 §4: screen, JSON/CSV export, and print all enforce tenant +
//   department + show/hide flags (no privileged leak through export).
// ----------------------------------------------------------------------

/** Tenant scope for report reads/writes. ge_admin may name any tenant. */
function reportTenantScope(
  user: AuthUser,
  explicit: unknown
): { clientId: string } | { error: string; status: number } {
  const named = typeof explicit === 'string' && explicit.trim() ? explicit.trim() : null;
  if (user.role === 'ge_admin') {
    if (named) return { clientId: named };
    if (user.clientId) return { clientId: user.clientId };
    return { error: 'No tenant selected. As a platform admin, choose a tenant (clientId).', status: 400 };
  }
  if (named && named !== user.clientId) {
    return { error: 'Cross-tenant report access is forbidden.', status: 403 };
  }
  if (!user.clientId) {
    return { error: 'No tenant context for this user.', status: 400 };
  }
  return { clientId: user.clientId };
}

/**
 * Service scope for the (client × service) D-038 setting. Explicit serviceId
 * wins (must exist); otherwise a single settings row for the client decides;
 * zero rows → null (the gate will refuse); several rows → 400 (ambiguous).
 */
async function resolveReportService(
  client: DbClient,
  clientId: string,
  explicit: unknown
): Promise<string | null> {
  const named = typeof explicit === 'string' && explicit.trim() ? explicit.trim() : null;
  if (named) {
    const svcRes = await client.query('SELECT id FROM services WHERE id = $1', [named]);
    if (!svcRes.rows[0]) {
      throw Object.assign(new Error('Service not found for the given serviceId.'), { statusCode: 404 });
    }
    return named;
  }
  const rowsRes = await client.query('SELECT service_id FROM report_settings WHERE client_id = $1', [clientId]);
  if (rowsRes.rows.length === 1) {
    return rowsRes.rows[0].service_id ?? null;
  }
  if (rowsRes.rows.length > 1) {
    throw Object.assign(
      new Error('This client has report settings for several services. Pass serviceId explicitly.'),
      { statusCode: 400 }
    );
  }
  return null;
}

async function loadReportSettings(client: DbClient, clientId: string, serviceId: string | null) {
  const res = await client.query(
    `SELECT id, client_id, service_id, disclosure_level, report_level,
            statement_name, statement_period, notified, notified_date, notify_ref,
            notification_recorded, level, created_at, updated_at
       FROM report_settings
      WHERE client_id = $1 AND service_id IS NOT DISTINCT FROM $2`,
    [clientId, serviceId]
  );
  return res.rows[0] ?? null;
}

/** show/hide flags for this client×service (default: everything visible). */
async function loadReportVisibilityFlags(
  client: DbClient,
  clientId: string,
  serviceId: string | null
): Promise<{ showGap: boolean; showCorrective: boolean }> {
  if (!serviceId) return { showGap: true, showCorrective: true };
  const res = await client.query(
    'SELECT show_gap, show_corrective FROM client_services WHERE client_id = $1 AND service_id = $2',
    [clientId, serviceId]
  );
  const row = res.rows[0];
  return {
    showGap: row ? row.show_gap !== false : true,
    showCorrective: row ? row.show_corrective !== false : true,
  };
}

function sendReportGateRefusal(res: Response) {
  return res.status(409).json({ error: REPORT_GATE_REFUSAL, code: REPORT_GATE_CODE });
}

/**
 * Timezone-proof DATE formatting. node-pg returns DATE columns as midnight
 * LOCAL Dates; slicing their UTC ISO string shifts the calendar day on
 * UTC+X hosts. Local getters preserve the true stored calendar date.
 */
function formatDateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10) || null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

/** Public settings shape: notified_date always leaves as calendar YYYY-MM-DD. */
function publicReportSettings(row: any) {
  if (!row) return row;
  return { ...row, notified_date: formatDateOnly(row.notified_date) };
}

// B10-A1. Read the D-038 settings for a client×service (all tenant roles).
router.get('/report-settings', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const scope = reportTenantScope(user, req.query.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const serviceId = await resolveReportService(client, scope.clientId, req.query.serviceId);
      const settings = await loadReportSettings(client, scope.clientId, serviceId);
      const gate = reportGateStatus(settings);
      return {
        clientId: scope.clientId,
        serviceId,
        settings: publicReportSettings(settings),
        gate: gate.ok ? { ok: true } : { ok: false, code: REPORT_GATE_CODE, refusal: REPORT_GATE_REFUSAL },
      };
    });
    res.json(data);
  } catch (err: any) {
    console.error('Report settings fetch error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch report settings' });
  }
});

// B10-A1. Store the D-038 level + statement + notification record for a
// client×service (ge_admin / client_admin own tenant). Missing required
// fields → 409 with the unified refusal (no default, A-09).
router.put('/report-settings', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin' && user.role !== 'client_admin') {
      return res.status(403).json({ error: 'Only tenant or platform administrators may set report levels.' });
    }
    const scope = reportTenantScope(user, req.body?.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    const body = req.body ?? {};
    const validation = validateReportSettingsInput(body);
    if (!validation.ok) {
      return res.status(409).json({
        error: REPORT_GATE_REFUSAL,
        code: REPORT_GATE_CODE,
        detail: validation.error,
      });
    }
    if (body.serviceId !== undefined && body.serviceId !== null && body.serviceId !== '') {
      if (typeof body.serviceId !== 'string') {
        return res.status(400).json({ error: 'serviceId must be a string.' });
      }
    }

    const saved = await withTenantContext(contextFromUser(user), async (client) => {
      const tenantRes = await client.query('SELECT id FROM clients WHERE id = $1', [scope.clientId]);
      if (!tenantRes.rows[0]) {
        throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
      }
      const serviceId: string | null =
        typeof body.serviceId === 'string' && body.serviceId.trim() ? body.serviceId.trim() : null;
      if (serviceId) {
        const svcRes = await client.query('SELECT id FROM services WHERE id = $1', [serviceId]);
        if (!svcRes.rows[0]) {
          throw Object.assign(new Error('Service not found for the given serviceId.'), { statusCode: 404 });
        }
      }
      const statementName: string = body.statementName.trim();
      const statementPeriod: string = body.statementPeriod.trim();
      const notified: string | null = isNotifiedState(body.notified) ? body.notified : null;
      const notifiedDate: string | null =
        typeof body.notifiedDate === 'string' && body.notifiedDate.trim()
          ? body.notifiedDate.trim().slice(0, 10)
          : null;
      const notifyRef: string | null =
        typeof body.notifyRef === 'string' && body.notifyRef.trim() ? body.notifyRef.trim() : null;

      const existing = await loadReportSettings(client, scope.clientId, serviceId);
      let row;
      if (existing) {
        const updRes = await client.query(
          `UPDATE report_settings
              SET disclosure_level = $1, report_level = $2,
                  statement_name = $3, statement_period = $4,
                  notified = $5, notified_date = $6, notify_ref = $7,
                  notification_recorded = $8, level = $9,
                  updated_at = NOW()
            WHERE id = $10 RETURNING *`,
          [
            body.disclosureLevel,
            body.reportLevel,
            statementName,
            statementPeriod,
            notified,
            notifiedDate,
            notifyRef,
            notified === 'done',
            body.disclosureLevel === 'in-accordance' ? 'in_accordance' : 'with_reference',
            existing.id,
          ]
        );
        row = updRes.rows[0];
      } else {
        const insRes = await client.query(
          `INSERT INTO report_settings
             (client_id, service_id, disclosure_level, report_level,
              statement_name, statement_period, notified, notified_date, notify_ref,
              notification_recorded, level)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            scope.clientId,
            serviceId,
            body.disclosureLevel,
            body.reportLevel,
            statementName,
            statementPeriod,
            notified,
            notifiedDate,
            notifyRef,
            notified === 'done',
            body.disclosureLevel === 'in-accordance' ? 'in_accordance' : 'with_reference',
          ]
        );
        row = insRes.rows[0];
      }

      await recordAuditLog(client, {
        clientId: scope.clientId,
        userId: user.id,
        action: 'REPORT_SETTINGS_SAVED',
        entityType: 'report_settings',
        entityId: row.id,
        payload: {
          targetTenant: scope.clientId,
          serviceId,
          disclosureLevel: body.disclosureLevel,
          reportLevel: body.reportLevel,
          notified,
        },
      });
      return row;
    });

    res.json({ settings: publicReportSettings(saved), gate: { ok: true } });
  } catch (err: any) {
    console.error('Report settings save error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to save report settings' });
  }
});

// Shared report payload builder: gate FIRST, then one number source for
// L1/L2/L3, visibility bounds applied (04 §4), HARD-RULE 422 on violations.
async function buildReportPayload(
  client: DbClient,
  user: AuthUser,
  clientId: string,
  serviceId: string | null,
  level: string
) {
  const settings = await loadReportSettings(client, clientId, serviceId);
  const gate = reportGateStatus(settings);
  if (!gate.ok) {
    throw Object.assign(new Error(REPORT_GATE_REFUSAL), { statusCode: 409, gateCode: REPORT_GATE_CODE });
  }
  const flags = await loadReportVisibilityFlags(client, clientId, serviceId);

  // One query feeds the index, the aggregate, and the per-department
  // breakdown — every level renders the SAME numbers (A-12).
  const srcRes = await client.query(
    `SELECT d.id AS disclosure_id, d.code AS disclosure_code, d.title AS disclosure_title,
            s.code AS standard_code, s.title AS standard_title,
            i.id AS item_id, i.code AS item_code, i.weight::float AS weight,
            dep.id AS department_id, dep.name AS department_name,
            e.score, e.not_evaluated, e.not_applicable, e.na_reason, e.justification,
            ans.value AS answer_value, ans.status AS answer_status
       FROM disclosures d
       JOIN standards s ON s.id = d.standard_id
       JOIN items i ON i.disclosure_id = d.id
       LEFT JOIN assignments a ON a.item_id = i.id AND a.client_id = $1
       LEFT JOIN departments dep ON dep.id = a.department_id
       LEFT JOIN evaluations e ON e.item_id = i.id AND e.client_id = $1
       LEFT JOIN answers ans ON ans.item_id = i.id AND ans.client_id = $1 AND ans.department_id = a.department_id
      ORDER BY s.code ASC, d.code ASC, i.code ASC`,
    [clientId]
  );

  const built = buildDisclosureIndex(
    srcRes.rows.map((r) => ({
      disclosureId: String(r.disclosure_id),
      disclosureCode: r.disclosure_code,
      disclosureTitle: r.disclosure_title,
      standardCode: r.standard_code,
      standardTitle: r.standard_title,
      itemId: String(r.item_id),
      itemCode: r.item_code,
      weight: r.weight === null || r.weight === undefined ? null : Number(r.weight),
      departmentId: r.department_id ? String(r.department_id) : null,
      departmentName: r.department_name ?? null,
      score: r.score === null || r.score === undefined ? null : (Number(r.score) as 0 | 50 | 100),
      notEvaluated: Boolean(r.not_evaluated),
      notApplicable: Boolean(r.not_applicable),
      naReason: r.na_reason ?? null,
      justification: r.justification ?? null,
      answerValue: r.answer_value ?? null,
      answerStatus: r.answer_status ?? null,
    }))
  );

  // HARD RULE (MP-48): omitted without BOTH reason and explanation → 422
  // naming the disclosure codes. Rows are returned flagged, never dropped.
  if (built.offendingCodes.length > 0) {
    throw Object.assign(new Error(indexIncompleteMessage(built.offendingCodes)), {
      statusCode: 422,
      code: 'reports.index_incomplete',
      offendingCodes: built.offendingCodes,
      index: built.rows,
    });
  }

  // Dashboard-traceable aggregate: drafts excluded (only submitted/approved/
  // client-approved answers count), N/A excluded — same rule as /dashboard/stats.
  const SUBMITTED = ['submitted', 'approved', 'client_approved'];
  const byItem = new Map<string, { weight: number; score: 0 | 50 | 100 | null; notEvaluated: boolean; notApplicable: boolean; submitted: boolean }>();
  for (const r of srcRes.rows) {
    const key = String(r.item_id);
    if (!byItem.has(key)) {
      byItem.set(key, {
        weight: Number(r.weight) || 2,
        score: r.score === null || r.score === undefined ? null : (Number(r.score) as 0 | 50 | 100),
        notEvaluated: Boolean(r.not_evaluated),
        notApplicable: Boolean(r.not_applicable),
        submitted: false,
      });
    }
    if (r.answer_status && SUBMITTED.includes(r.answer_status)) {
      byItem.get(key)!.submitted = true;
    }
  }
  const aggregate = calculateAggregateScore(
    gateDraftEvaluations(
      [...byItem.entries()].map(([itemId, v]) => ({
        itemId,
        weight: v.weight,
        score: v.score,
        notEvaluated: v.notEvaluated,
        notApplicable: v.notApplicable,
        hasEvaluation: v.score !== null || v.notEvaluated || v.notApplicable,
        hasSubmittedAnswer: v.submitted,
      }))
    )
  );

  // L2 by-department breakdown (same weighted rule, per department).
  const deptBuckets = new Map<string, { departmentId: string; departmentName: string; weightedSum: number; weightTotal: number; evaluated: number; applicable: number }>();
  for (const r of srcRes.rows) {
    if (!r.department_id) continue;
    const depId = String(r.department_id);
    let b = deptBuckets.get(depId);
    if (!b) {
      b = { departmentId: depId, departmentName: r.department_name, weightedSum: 0, weightTotal: 0, evaluated: 0, applicable: 0 };
      deptBuckets.set(depId, b);
    }
    if (r.not_applicable) continue;
    b.applicable++;
    if (r.not_evaluated || r.score === null || r.score === undefined) continue;
    if (!r.answer_status || !SUBMITTED.includes(r.answer_status)) continue; // drafts excluded
    b.evaluated++;
    const w = Number(r.weight) || 2;
    b.weightedSum += w * Number(r.score);
    b.weightTotal += w;
  }
  const departments = [...deptBuckets.values()]
    .map((b) => ({
      departmentId: b.departmentId,
      departmentName: b.departmentName,
      score: b.weightTotal > 0 ? Math.round((b.weightedSum / b.weightTotal) * 10) / 10 : null,
      coveragePercentage: b.applicable > 0 ? Math.round((b.evaluated / b.applicable) * 1000) / 10 : 0,
      evaluatedItems: b.evaluated,
      applicableItems: b.applicable,
    }))
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName));

  // L2 actions summary (RLS already scopes: employees see own department).
  const actRes = await client.query(
    `SELECT status, COUNT(*)::int AS count FROM actions WHERE client_id = $1 GROUP BY status`,
    [clientId]
  );
  const actionsByStatus: Record<string, number> = {};
  for (const r of actRes.rows) actionsByStatus[r.status] = r.count;

  // Visibility bounds (04 §4): department subset for employees, then
  // show/hide flags. Same function shapes screen, export, and print.
  const visibleIndex = applyDepartmentVisibility(
    built.rows,
    user.role,
    user.departmentId ?? null,
    null
  );
  // Department names for the employee filter: resolve via departmentIds
  // (RLS already removed other departments' assignment rows, so the id
  // filter is exact even without the name).
  const visibleDepartments =
    user.role === 'employee'
      ? departments.filter((d) => (user.departmentId ? d.departmentId === user.departmentId : false))
      : departments;
  const flaggedIndex = applyShowGapFlags(visibleIndex, flags);
  const flaggedDepartments = applyShowGapFlags(visibleDepartments, flags);
  const flaggedAggregate = flags.showGap
    ? aggregate
    : { ...aggregate, aggregateScore: null, fullGapCount: 0, partialGapCount: 0, noGapCount: 0 };

  const omissions = flaggedIndex
    .filter((r) => r.omitted)
    .map((r) => ({
      disclosureCode: r.disclosureCode,
      disclosureTitle: r.disclosureTitle,
      reason: r.omissionReason,
      explanation: r.omissionExplanation,
    }));
  const locationGaps = flaggedIndex.filter((r) => !r.locationComplete).map((r) => r.disclosureCode);
  const topGaps = [...flaggedIndex]
    .filter((r) => !r.omitted && r.score !== null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 10);

  return {
    clientId,
    serviceId,
    level,
    settings: {
      disclosureLevel: settings.disclosure_level,
      reportLevel: settings.report_level,
      statementName: settings.statement_name,
      statementPeriod: settings.statement_period,
      notified: settings.notified,
      notifiedDate: formatDateOnly(settings.notified_date),
      notifyRef: settings.notify_ref,
    },
    visibility: { role: user.role, showGap: flags.showGap, showCorrective: flags.showCorrective },
    aggregate: flaggedAggregate,
    departments: flaggedDepartments,
    actions: { byStatus: actionsByStatus, showCorrective: flags.showCorrective },
    omissions,
    topGaps,
    index: flaggedIndex,
    meta: {
      disclosureCount: flaggedIndex.length,
      omittedCount: omissions.length,
      locationGaps,
    },
  };
}

// B10-D. Level payload: L1 headline + coverage + top gaps, L2 by
// department/standard + actions + omissions, L3 full index + statement +
// notification — all from ONE builder (same numbers, UI slices per level).
router.get('/reports/index', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const scope = reportTenantScope(user, req.query.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    const levelRaw = typeof req.query.level === 'string' ? req.query.level.trim() : '';
    if (!isReportLevel(levelRaw)) {
      return res.status(400).json({ error: 'level is required, one of: L1, L2, L3.' });
    }

    const payload = await withTenantContext(contextFromUser(user), async (client) => {
      if (user.role === 'employee' && !user.departmentId) {
        throw Object.assign(new Error('Your user account has no department assignment.'), { statusCode: 400 });
      }
      const serviceId = await resolveReportService(client, scope.clientId, req.query.serviceId);
      return buildReportPayload(client, user, scope.clientId, serviceId, levelRaw);
    });

    res.json(payload);
  } catch (err: any) {
    console.error('Report index error:', err);
    if (err?.statusCode === 422) {
      return res.status(422).json({
        error: err.message,
        code: 'reports.index_incomplete',
        offendingCodes: err.offendingCodes ?? [],
        index: err.index ?? [],
      });
    }
    if (err?.gateCode === REPORT_GATE_CODE) {
      return sendReportGateRefusal(res);
    }
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to build report index' });
  }
});

// B10-D2. Structured export (JSON default, CSV tabular). Same gate + same
// visibility bounds as the screen — no privileged leak through export.
// Print uses the browser (print-optimized views, bilingual RTL-safe);
// no heavy PDF library is introduced.
router.get('/reports/export', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const scope = reportTenantScope(user, req.query.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    const levelRaw = typeof req.query.level === 'string' ? req.query.level.trim() : '';
    if (!isReportLevel(levelRaw)) {
      return res.status(400).json({ error: 'level is required, one of: L1, L2, L3.' });
    }
    const formatRaw = typeof req.query.format === 'string' ? req.query.format.trim().toLowerCase() : 'json';
    if (formatRaw !== 'json' && formatRaw !== 'csv') {
      return res.status(400).json({ error: 'format must be json or csv.' });
    }

    const payload = await withTenantContext(contextFromUser(user), async (client) => {
      if (user.role === 'employee' && !user.departmentId) {
        throw Object.assign(new Error('Your user account has no department assignment.'), { statusCode: 400 });
      }
      const serviceId = await resolveReportService(client, scope.clientId, req.query.serviceId);
      return buildReportPayload(client, user, scope.clientId, serviceId, levelRaw);
    });

    const fileBase = `gri-report-${payload.clientId.slice(0, 8)}-${payload.serviceId ? payload.serviceId.slice(0, 8) : 'default'}-${payload.level}`;
    if (formatRaw === 'csv') {
      const csv = indexToCSV(payload.index);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
      res.send(csv);
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.json"`);
    res.json(payload);
  } catch (err: any) {
    console.error('Report export error:', err);
    if (err?.statusCode === 422) {
      return res.status(422).json({
        error: err.message,
        code: 'reports.index_incomplete',
        offendingCodes: err.offendingCodes ?? [],
      });
    }
    if (err?.gateCode === REPORT_GATE_CODE) {
      return sendReportGateRefusal(res);
    }
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to export report' });
  }
});

export default router;
