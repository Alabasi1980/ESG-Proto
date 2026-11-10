import express, { Request, Response } from 'express';
import multer from 'multer';
import {
  getPool,
  isDatabaseConfigured,
  withTenantContext,
  recordAuditLog,
  runMigrations,
  checkDatabaseHealth,
} from '../db/index.ts';
import {
  authMiddleware,
  optionalAuthMiddleware,
  hashPassword,
  comparePassword,
  generateToken,
  AuthenticatedRequest,
  AuthUser,
} from './auth.ts';
import { parseGRIFile, ParsedGRIStandard } from '../lib/griParser.ts';
import { calculateAggregateScore, EvaluationRecord } from '../lib/scoring.ts';

const router = express.Router();
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  storage: multer.memoryStorage(),
});

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
      const pool = getPool();
      const countRes = await pool.query('SELECT COUNT(*)::int as count FROM users');
      userCount = countRes.rows[0]?.count || 0;
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
// 2. Initial Setup (First Admin Bootstrap)
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

    const pool = getPool();
    const countRes = await pool.query('SELECT COUNT(*)::int as count FROM users');
    const userCount = countRes.rows[0]?.count || 0;

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

    const pool = getPool();
    // Ensure tables exist
    await runMigrations();

    // Check if any user already exists
    const userCheck = await pool.query('SELECT COUNT(*)::int as count FROM users');
    if (userCheck.rows[0]?.count > 0) {
      return res.status(403).json({ error: 'Initial setup has already been completed.' });
    }

    const passwordHash = await hashPassword(password);

    let createdClientId: string | null = null;
    let finalRole: 'ge_admin' | 'client_admin' | 'employee' = role;

    // If client details are provided, create client tenant
    if (clientName && clientCode) {
      const clientRes = await pool.query(
        `INSERT INTO clients (code, name) VALUES ($1, $2) RETURNING id`,
        [clientCode.trim(), clientName.trim()]
      );
      createdClientId = clientRes.rows[0].id;
      finalRole = 'client_admin';
    }

    const userRes = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, client_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role, client_id`,
      [email.toLowerCase().trim(), passwordHash, name.trim(), finalRole, createdClientId]
    );

    const newUser = userRes.rows[0];

    const authUser: AuthUser = {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      clientId: newUser.client_id,
      clientName: clientName || null,
    };

    const token = generateToken(authUser);

    // Record in audit log
    await recordAuditLog(pool, {
      clientId: createdClientId,
      userId: newUser.id,
      action: 'BOOTSTRAP_INITIAL_ADMIN',
      entityType: 'users',
      entityId: newUser.id,
      payload: { email: newUser.email, role: newUser.role },
    });

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

    const pool = getPool();
    const result = await pool.query(
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
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await comparePassword(password, userRow.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
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
    await recordAuditLog(pool, {
      clientId: authUser.clientId,
      userId: authUser.id,
      action: 'USER_LOGIN',
      entityType: 'users',
      entityId: authUser.id,
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ token, user: authUser });
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
    const pool = getPool();

    const userQuery = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    const currentHash = userQuery.rows[0]?.password_hash;
    if (!currentHash) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const matches = await comparePassword(currentPassword, currentHash);
    if (!matches) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const newHash = await hashPassword(newPassword);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, user.id]);

    await recordAuditLog(pool, {
      clientId: user.clientId,
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      entityType: 'users',
      entityId: user.id,
    });

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err: any) {
    console.error('Change password error:', err);
    res.status(500).json({ error: err.message || 'Failed to update password' });
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
      {
        tenantId: user.clientId,
        role: user.role,
        departmentId: user.departmentId,
        userId: user.id,
      },
      async (client) => {
        let insertedStandards = 0;
        let insertedDisclosures = 0;
        let insertedItems = 0;

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
          insertedStandards++;

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
            insertedDisclosures++;

            for (const item of disc.items) {
              // Insert item
              await client.query(
                `INSERT INTO items (disclosure_id, code, requirement, answer_type, hint, priority, esg_class, weight)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                  disclosureId,
                  item.code,
                  item.requirement,
                  item.answerType || 'text',
                  item.hint || null,
                  item.priority || 'mid',
                  item.esgClass || 'general',
                  item.weight || 1.0,
                ]
              );
              insertedItems++;
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
            standardsCount: insertedStandards,
            disclosuresCount: insertedDisclosures,
            itemsCount: insertedItems,
          },
        });

        return {
          standardsCount: insertedStandards,
          disclosuresCount: insertedDisclosures,
          itemsCount: insertedItems,
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

    const user = req.user;
    const pool = getPool();

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

    const result = await pool.query(query);
    res.json(result.rows);
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

    const pool = getPool();
    const user = req.user;

    // Check if standards and items exist
    const itemsCountRes = await pool.query('SELECT COUNT(*)::int as count FROM items');
    const itemsCount = itemsCountRes.rows[0]?.count || 0;

    const stdCountRes = await pool.query('SELECT COUNT(*)::int as count FROM standards');
    const standardsCount = stdCountRes.rows[0]?.count || 0;

    if (itemsCount === 0) {
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

    const evalRes = await pool.query(evalQuery, params);
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

    res.json({
      hasData: true,
      standardsCount,
      itemsCount,
      ...scoreResult,
    });
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
    const pool = getPool();

    let query = 'SELECT id, code, name, industry, contact_email, created_at FROM clients';
    const params: any[] = [];

    if (user.role !== 'ge_admin') {
      if (!user.clientId) {
        return res.json([]);
      }
      query += ' WHERE id = $1';
      params.push(user.clientId);
    }

    query += ' ORDER BY name ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clients', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only GreenEdge Super Admins can create new client tenants.' });
    }

    const { code, name, industry, contactEmail } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: 'Client code and name are required.' });
    }

    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO clients (code, name, industry, contact_email)
       VALUES ($1, $2, $3, $4)
       RETURNING id, code, name, industry, contact_email, created_at`,
      [code.trim(), name.trim(), industry || null, contactEmail || null]
    );

    const newClient = result.rows[0];

    await recordAuditLog(pool, {
      clientId: newClient.id,
      userId: user.id,
      action: 'CREATE_CLIENT',
      entityType: 'clients',
      entityId: newClient.id,
      payload: { code: newClient.code, name: newClient.name },
    });

    res.json(newClient);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create client tenant' });
  }
});

router.get('/departments', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const pool = getPool();

    let query = 'SELECT id, client_id, code, name, description FROM departments';
    const params: any[] = [];

    if (user.role !== 'ge_admin' && user.clientId) {
      query += ' WHERE client_id = $1';
      params.push(user.clientId);
    }

    query += ' ORDER BY name ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
