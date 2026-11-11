// B12 (R-01) — system sub-router: database/health + initial setup.
// Mounted by src/server/routes.ts under the /api prefix. Moved verbatim;
// B12 change: POST /setup/admin enforces the shared S-02 complexity rule.

import express, { type Request, type Response } from 'express';
import {
  isDatabaseConfigured,
  withTenantContext,
  recordAuditLog,
  runMigrations,
  checkDatabaseHealth,
} from '../../db/index.ts';
import type { AuthUser } from '../auth.ts';
import { hashPassword, generateToken } from '../auth.ts';
import { validateSelfChosenPassword } from '../../lib/password.ts';
import { ELEVATED_CONTEXT } from './_shared.ts';

const router = express.Router();

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

    // B12 (S-02 completion): self-chosen bootstrap passwords use the shared
    // complexity rule (≥10 + upper/lower/digit/symbol). F-03 allowlist: the
    // fresh gate does not apply here (no session exists yet).
    const pwCheck = validateSelfChosenPassword(password);
    if (!pwCheck.ok) {
      return res.status(400).json({ error: pwCheck.error });
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

export default router;
