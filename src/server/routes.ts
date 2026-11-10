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
import { calculateAggregateScore, type EvaluationRecord } from '../lib/scoring.ts';

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
        `SELECT u.id, u.email, u.name, u.password_hash, u.role, u.client_id, u.department_id,
                c.name as client_name, d.name as department_name
         FROM users u
         LEFT JOIN clients c ON u.client_id = c.id
         LEFT JOIN departments d ON u.department_id = d.id
         WHERE LOWER(u.email) = LOWER($1) AND u.is_active = true`,
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

    const { standards } = req.body as { standards: ParsedGRIStandard[] };
    if (!standards || !Array.isArray(standards) || standards.length === 0) {
      return res.status(400).json({ error: 'No valid standards provided for commit.' });
    }

    // Run in tenant context to enforce RLS and audit log
    const result = await withTenantContext(
      contextFromUser(user),
      async (client) => {
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
        // in the payload. Tenant-scoped: only when the caller has a tenant.
        // Departments upsert on (client_id, code); assignments are
        // INSERT ... ON CONFLICT DO NOTHING, so re-imports change nothing.
        let departmentsUpserted = 0;
        let assignmentsCreated = 0;
        if (user.clientId && deptToItemIds.size > 0) {
          for (const [deptCode, entry] of deptToItemIds) {
            const deptRes = await client.query(
              `INSERT INTO departments (client_id, code, name)
               VALUES ($1, $2, $3)
               ON CONFLICT (client_id, code) DO UPDATE SET name = EXCLUDED.name
               RETURNING id`,
              [user.clientId, deptCode, entry.name]
            );
            departmentsUpserted++;
            const departmentId = deptRes.rows[0].id;
            if (entry.itemIds.length > 0) {
              const params: any[] = [user.clientId, departmentId, ...entry.itemIds];
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

        // Record in append-only audit log
        await recordAuditLog(client, {
          clientId: user.clientId,
          userId: user.id,
          action: 'IMPORT_GRI_DISCLOSURES',
          entityType: 'standards',
          payload: {
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
    res.status(500).json({ error: err.message || 'Failed to commit GRI data' });
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

      // Fetch evaluations if tenant is present
      let evalQuery = `
        SELECT i.id as item_id, i.weight::float as weight,
               e.score, e.not_evaluated, e.not_applicable, e.justification, e.note
        FROM items i
        LEFT JOIN evaluations e ON e.item_id = i.id
      `;
      const params: any[] = [];
      if (user?.clientId) {
        evalQuery += ` AND e.client_id = $1`;
        params.push(user.clientId);
      }

      const evalRes = await client.query(evalQuery, params);
      const evalRecords: EvaluationRecord[] = evalRes.rows.map((row) => ({
        itemId: row.item_id,
        weight: row.weight || 1.0,
        score: row.score !== null ? Number(row.score) as 0 | 50 | 100 : null,
        notEvaluated: Boolean(row.not_evaluated),
        notApplicable: Boolean(row.not_applicable),
        justification: row.justification,
        note: row.note,
      }));

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

export default router;
