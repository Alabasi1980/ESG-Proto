// TASK-PROTO-H13 — platform-wide application settings.
//
// Contract §2: exactly TWO declarations, both P only (platform mode, fresh
// identity, the standard wrapper). `GET /settings` is what the platform Settings
// screen reads before the first save, so an absent row must answer 'auto' rather
// than 404. `PUT /settings` is the ONE writer of the global theme: it validates
// the closed option enum here (the schema deliberately has no CHECK — the same
// rule clients.theme follows), stores 'auto' as NULL, and appends the
// APP_THEME_UPDATED audit row inside the same transaction, so the change and its
// trail commit or roll back together.
//
// The tenant theme (clients.theme) keeps its own single writer in
// PATCH /clients/:id (D-H01-01) — this module never touches it. Resolution order
// for a user's effective theme is global -> tenant -> 'ge' (src/server/auth.ts).

import express, { type Response } from 'express';
import { recordAuditLog } from '../../db/index.ts';
import {
  APP_THEME_OPTIONS,
  appThemeStorageValue,
  authMiddleware,
  normalizeAppThemeOption,
  type AppThemeOption,
  type AuthenticatedRequest,
} from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import { platformConfigContext, requireFreshPassword } from './_shared.ts';
import { domainFailure, domainTransaction } from './initiativeScope.ts';

const router = express.Router();

/** GET /settings — P only. Absent row / NULL theme / legacy value === 'auto'. */
export async function readAppSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const theme = await domainTransaction(req, async (client) => {
      const row = (await client.query('SELECT theme FROM app_settings WHERE id = 1')).rows[0];
      return normalizeAppThemeOption(row?.theme);
    }, live => platformConfigContext(live));
    res.json({ theme });
  } catch (err) {
    domainFailure(res, err, 'Failed to read application settings');
  }
}

/** PUT /settings — P only, fresh identity. `{ theme }` -> auto|ge|lime|dark. */
export async function writeAppSettings(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = req.body ?? {};
    // Validation precedes the transaction: one bad value is a clean 400 and never
    // reaches the database (mirrors the single P clients.theme writer).
    if (typeof body.theme !== 'string' || !(APP_THEME_OPTIONS as readonly string[]).includes(body.theme)) {
      res.status(400).json({
        error: 'theme must be one of auto, ge, lime, dark.',
        code: 'settings.theme_invalid',
      });
      return;
    }
    const theme = body.theme as AppThemeOption;
    await domainTransaction(req, async (client) => {
      // Single-row upsert; id is pinned to 1 by the table CHECK, so this can never
      // create a second settings row. 'auto' is stored as NULL.
      await client.query(
        `INSERT INTO app_settings (id, theme) VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET theme = EXCLUDED.theme, updated_at = clock_timestamp()`,
        [appThemeStorageValue(theme)]
      );
      await recordAuditLog(client, {
        clientId: null,
        userId: req.access!.actorId,
        action: 'APP_THEME_UPDATED',
        entityType: 'app_settings',
        entityId: null,
        payload: { theme },
      });
    }, live => platformConfigContext(live));
    res.json({ theme });
  } catch (err) {
    domainFailure(res, err, 'Failed to save application settings');
  }
}

router.get('/settings', authMiddleware, requireDomainAccess, readAppSettings);
router.put('/settings', authMiddleware, requireFreshPassword, requireDomainAccess, writeAppSettings);

export default router;
