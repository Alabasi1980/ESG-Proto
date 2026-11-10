import express, { type Request, type Response } from 'express';
import multer from 'multer';
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
import { calculateAggregateScore, gateDraftEvaluations, type DashboardSourceRow } from '../lib/scoring.ts';
import { resolveImportTenant, validateNewUser } from '../lib/tenantAccess.ts';

const router = express.Router();
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
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
        const seenItemKeys = new Set<string>();
        const importBatchId = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        // normCode -> { display name from payload, item ids needing assignment }
        const deptToItemIds = new Map<string, { name: string; itemIds: string[] }>();

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

type QueueStatus = 'not_evaluated' | 'draft' | 'submitted' | 'approved' | 'returned' | 'not_applicable';

function queueStatusFor(row: {
  not_applicable?: boolean | null;
  not_evaluated?: boolean | null;
  evaluation_id?: string | null;
  answer_status?: string | null;
}): QueueStatus {
  if (row.not_applicable) return 'not_applicable';
  if (row.not_evaluated || !row.evaluation_id) return 'not_evaluated';
  const s = row.answer_status;
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
                e.justification, e.evaluator_id, e.previous_score, e.updated_at AS evaluation_updated_at,
                ans.id AS answer_id, ans.status AS answer_status, ans.submitted_by AS answer_submitted_by,
                ans.updated_at AS answer_updated_at
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

      const existingAnswer = await client.query(
        'SELECT id, status FROM answers WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
        [clientId, itemId, departmentId]
      );
      const currentStatus: string | undefined = existingAnswer.rows[0]?.status;
      if (currentStatus === 'submitted' || currentStatus === 'approved') {
        throw Object.assign(
          new Error('This evaluation is already submitted. Post-submit changes must go through PUT /api/evaluations/:id/correct with a reason.'),
          { statusCode: 409 }
        );
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
    console.error('Evaluation save error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to save evaluation draft' });
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
      if (answer.status === 'submitted' || answer.status === 'approved') {
        throw Object.assign(new Error('This evaluation has already been submitted.'), { statusCode: 409 });
      }

      const updRes = await client.query(
        `UPDATE answers SET status = 'submitted', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [answer.id]
      );

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
    console.error('Evaluation submit error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to submit evaluation' });
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

      const nextStatus = decision === 'approve' ? 'approved' : 'returned';
      const approvalStatus = decision === 'approve' ? 'approved' : 'rejected';
      const level = user.role === 'ge_admin' ? 'ge' : 'client';

      const updRes = await client.query(
        `UPDATE answers SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [nextStatus, answer.id]
      );
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
    console.error('Evaluation decision error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to record evaluation decision' });
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
      if (!answer || (answer.status !== 'submitted' && answer.status !== 'approved')) {
        throw Object.assign(
          new Error('Only a submitted or approved evaluation can be corrected. Edit the draft instead.'),
          { statusCode: 409 }
        );
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
             previous_score = score, updated_at = NOW()
         WHERE id = $5 RETURNING *`,
        [afterScore, afterNotEvaluated, afterNotApplicable, afterNaReason, evaluation.id]
      );

      const historyEntry = [{ before, after, actor: user.id, reason: reason.trim(), at: new Date().toISOString() }];
      const ansRes = await client.query(
        `UPDATE answers
         SET correction_history = COALESCE(correction_history, '[]'::jsonb) || $1::jsonb,
             updated_at = NOW()
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
    console.error('Evaluation correction error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to correct evaluation' });
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

export default router;
