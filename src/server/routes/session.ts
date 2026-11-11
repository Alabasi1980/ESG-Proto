// B12 (R-01) — session sub-router: login, logout, change-password, me.
// Mounted by src/server/routes.ts under the /api prefix. Moved verbatim;
// B12 change: change-password enforces the shared S-02 complexity rule.

import express, { type Request, type Response } from 'express';
import {
  isDatabaseConfigured,
  withTenantContext,
  recordAuditLog,
} from '../../db/index.ts';
import {
  authMiddleware,
  hashPassword,
  comparePassword,
  generateToken,
  type AuthenticatedRequest,
  type AuthUser,
} from '../auth.ts';
import {
  suspendedLoginBody,
} from '../../lib/b11b.ts';
import { validateSelfChosenPassword } from '../../lib/password.ts';
import { ELEVATED_CONTEXT, contextFromUser } from './_shared.ts';

const router = express.Router();

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
    // B11b (S-09/S-12): suspended tenants fail closed with 200 {suspended:true}
    // and no data; provisioned accounts carry must_change_password and the
    // login response surfaces mustChangePassword so the UI forces a change.
    const outcome = await withTenantContext(ELEVATED_CONTEXT, async (client) => {
      const result = await client.query(
        `SELECT u.id, u.email, u.name, u.password_hash, u.role, u.client_id, u.department_id, u.is_active,
                u.must_change_password,
                c.name as client_name, c.suspended as client_suspended, d.name as department_name
         FROM users u
         LEFT JOIN clients c ON u.client_id = c.id
         LEFT JOIN departments d ON d.id = u.department_id
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

      // C1: deactivated accounts fail closed with a human 401 (still 401,
      // only after a correct password so the existence signal stays minimal).
      if (userRow.is_active === false) {
        return { deactivated: true as const };
      }

      // S-09: suspended tenant → 200 {suspended:true}, no token, no user data.
      if (userRow.client_id && userRow.client_suspended === true) {
        return { suspended: true as const };
      }

      const mustChange = userRow.must_change_password === true;
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

      // Record audit log (never logs passwords/tokens — MEDIUM binding condition).
      await recordAuditLog(client, {
        clientId: authUser.clientId,
        userId: authUser.id,
        action: 'USER_LOGIN',
        entityType: 'users',
        entityId: authUser.id,
      });

      return { token, authUser, mustChangePassword: mustChange };
    });

    if (!outcome) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if ('deactivated' in outcome) {
      return res.status(401).json({ error: 'Your account has been deactivated. Please contact your administrator.' });
    }
    if ('suspended' in outcome) {
      return res.status(200).json(suspendedLoginBody());
    }

    res.cookie('token', outcome.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      token: outcome.token,
      user: { ...outcome.authUser, mustChangePassword: outcome.mustChangePassword },
      mustChangePassword: outcome.mustChangePassword,
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message || 'Login failed' });
  }
});

router.post('/auth/logout', (req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully.' });
});

router.get('/auth/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const flags = await withTenantContext(contextFromUser(user), async (client) => {
      const uRes = await client.query(
        'SELECT must_change_password FROM users WHERE id = $1',
        [user.id]
      );
      const mustChange = uRes.rows[0]?.must_change_password === true;
      let suspended = false;
      if (user.clientId) {
        const cRes = await client.query('SELECT suspended FROM clients WHERE id = $1', [user.clientId]);
        suspended = cRes.rows[0]?.suspended === true;
      }
      return { mustChangePassword: mustChange, suspended };
    });
    res.json({ user: { ...user, ...flags } });
  } catch {
    res.json({ user: req.user });
  }
});

router.post('/auth/change-password', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }
    // B12 (S-02 completion): self-chosen replacement passwords use the shared
    // complexity rule (≥10 + upper/lower/digit/symbol). F-03 allowlist: this
    // is THE remediation path, so the fresh gate does not apply here.
    const pwCheck = validateSelfChosenPassword(newPassword);
    if (!pwCheck.ok) {
      return res.status(400).json({ error: pwCheck.error });
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
      // B11b (S-12): a successful change clears the forced-change flag.
      await client.query(
        'UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2',
        [newHash, user.id]
      );

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

export default router;
