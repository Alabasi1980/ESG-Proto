import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

export interface TenantContext {
  tenantId?: string | null;
  role?: 'ge_admin' | 'client_admin' | 'employee' | string;
  departmentId?: string | null;
  userId?: string | null;
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
  const sslConfig = isLocalhost ? false : { rejectUnauthorized: false };

  pool = new Pool({
    connectionString: databaseUrl,
    max: 5, // Hard constraint: maximum 5 connections
    ssl: sslConfig, // Hard constraint: TLS enabled
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

    // Set RLS session settings for the current transaction
    if (context.tenantId) {
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [context.tenantId]);
    } else {
      await client.query("SELECT set_config('app.current_tenant_id', '', true)");
    }

    if (context.role) {
      await client.query("SELECT set_config('app.current_user_role', $1, true)", [context.role]);
    } else {
      await client.query("SELECT set_config('app.current_user_role', '', true)");
    }

    if (context.departmentId) {
      await client.query("SELECT set_config('app.current_user_department_id', $1, true)", [context.departmentId]);
    } else {
      await client.query("SELECT set_config('app.current_user_department_id', '', true)");
    }

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
 * Runs the initial SQL schema and RLS policies on the database.
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

    await client.query(sql);
    return { success: true, message: 'Schema and RLS policies applied successfully.' };
  } catch (err: any) {
    console.error('Migration execution failed:', err);
    return { success: false, message: err.message || 'Unknown migration error' };
  } finally {
    client.release();
  }
}

/**
 * Health and diagnostics check for database connection
 */
export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  tableCount: number;
  tables: string[];
  error?: string;
}> {
  if (!isDatabaseConfigured()) {
    return {
      connected: false,
      tableCount: 0,
      tables: [],
      error: 'DATABASE_URL environment variable is missing.',
    };
  }

  try {
    const p = getPool();
    const result = await p.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name;`
    );

    const tables = result.rows.map((r) => r.table_name);
    return {
      connected: true,
      tableCount: tables.length,
      tables,
    };
  } catch (err: any) {
    return {
      connected: false,
      tableCount: 0,
      tables: [],
      error: err.message || 'Failed to connect to database',
    };
  }
}
