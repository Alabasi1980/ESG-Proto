import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

export interface TenantContext {
  tenantId?: string | null;
  role?: 'ge_admin' | 'client_admin' | 'employee' | string;
  departmentId?: string | null;
  userId?: string | null;
  mode?: string | null;
  purpose?: string | null;
  sessionId?: string | null;
  tabId?: string | null;
  loginEmail?: string | null;
  targetId?: string | null;
}

export async function setTenantContext(client: pg.PoolClient, context: TenantContext): Promise<void> {
  // Every field is cleared, including when a pooled connection last served another tenant.
  const settings: Record<string, string | null | undefined> = {
    current_tenant_id: context.tenantId, current_user_role: context.role,
    current_user_department_id: context.departmentId, current_actor_id: context.userId,
    current_mode: context.mode, current_purpose: context.purpose,
    current_session_id: context.sessionId, current_tab_id: context.tabId,
    login_email: context.loginEmail, target_id: context.targetId,
  };
  for (const [key, value] of Object.entries(settings)) {
    await client.query('SELECT set_config($1, $2, true)', [`app.${key}`, value ?? '']);
  }
}

// Cached pool instance
let pool: pg.Pool | null = null;

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '');
}

/**
 * Creates or retrieves the singleton PostgreSQL connection pool.
 * Constraints enforced:
 * - Read from process.env.DATABASE_URL only.
 * - Maximum 5 connections.
 * - TLS enabled.
 */
export function getPool(): pg.Pool {
  if (pool) {
    return pool;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not defined.');
  }

  // Enforce TLS connection. Support cloud and standard SSL modes.
  const isLocalhost = databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');

  // Remove url ssl query parameters to prevent overriding explicit ssl: { rejectUnauthorized: false }
  const cleanUrl = isLocalhost
    ? databaseUrl
    : databaseUrl.replace(/[?&]sslmode=[^&#]+/i, '').replace(/[?&]ssl=[^&#]+/i, '');

  pool = new Pool({
    connectionString: cleanUrl,
    max: 5, // Hard constraint: maximum 5 connections
    ssl: isLocalhost ? false : { rejectUnauthorized: false }, // Hard constraint: TLS enabled
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client in pool:', err);
  });

  return pool;
}

/**
 * Runs a query or batch of queries inside a transaction with the tenant & role context
 * set using SET LOCAL / set_config to enforce Row-Level Security (RLS).
 */
export async function withTenantContext<T>(
  context: TenantContext,
  operation: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const p = getPool();
  const client = await p.connect();

  try {
    await client.query('BEGIN');

    await setTenantContext(client, context);

    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Appends an entry to the append-only audit_log table.
 */
export async function recordAuditLog(
  client: pg.PoolClient | pg.Pool,
  entry: {
    clientId?: string | null;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    payload?: any;
  }
) {
  await client.query(
    `INSERT INTO audit_log (client_id, user_id, action, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.clientId || null,
      entry.userId || null,
      entry.action,
      entry.entityType,
      entry.entityId || null,
      entry.payload ? JSON.stringify(entry.payload) : null,
    ]
  );
}

/**
 * Explicit offline empty-install initializer only. Never called by startup or HTTP.
 */
export async function runMigrations(): Promise<{ success: boolean; message: string }> {
  if (!isDatabaseConfigured()) {
    return { success: false, message: 'DATABASE_URL is not configured.' };
  }

  const p = getPool();
  const client = await p.connect();

  try {
    const schemaPath = path.resolve(process.cwd(), 'src/db/schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf-8');

    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(1717001)');
    await client.query(sql);
    await client.query('COMMIT');
    return { success: true, message: 'Schema and RLS policies applied successfully.' };
  } catch (err: any) {
    await client.query('ROLLBACK');
    return { success: false, message: 'Empty-install initialization refused or failed.' };
  } finally {
    client.release();
  }
}
