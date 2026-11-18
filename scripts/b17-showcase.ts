// B17 LOCAL showcase runner — local browser demo ONLY. No deploy, no Studio,
// no Aiven: the script creates/reuses ONLY the named `b17-showcase` PG18
// container, boots the repo's own server.ts in sanctioned scratch mode
// (B17_SCRATCH_OPT_IN=YES => 127.0.0.1 + PORT=0, binding logic untouched) and
// seeds exclusively over HTTP after activation, except the minimal
// pre-content inventory bootstrap (Tera Option A ruling: same pattern as
// scripts/b17-domain-d-fixture.ts — required because every mutating route is
// 401'd pre-content by the fresh gate and /gri/commit needs b17_content_fact).
//
//   npm run showcase              # up (default): ensure DB, seed, serve
//   npm run showcase -- reset     # wipe container + DB, then up
//   npm run showcase -- up --wipe # same as reset
//   npm run showcase -- persistent            # adopt-or-create the shared DB (volume b17-showcase-data,
//                                            # 127.0.0.1:55432; secrets in repo-root .env), then seed + serve
//   npm run showcase -- persistent-reset --wipe # DESTROYS shared-DB data (container+volume kept),
//                                            # then full re-apply + re-seed + serve
//
// Required env (values never written to any file, never logged):
//   SHOWCASE_GE_EMAIL / SHOWCASE_GE_PASSWORD
//   SHOWCASE_CLIENT_ADMIN_EMAIL / SHOWCASE_CLIENT_ADMIN_PASSWORD
//   SHOWCASE_EMPLOYEE_EMAIL / SHOWCASE_EMPLOYEE_PASSWORD
// Optional: SHOWCASE_GRI_CSV (default ../prototype/GRI_SOURCE_EXTRACT.csv).
//
// Order: container -> schema -> bootstrap (pre-U1, inventory minimum only)
// -> applyB17Offline (U1) -> applyB17ContentOffline -> boot server
// -> HTTP seeding (setup/admin, users, full GRI CSV commit, mappings,
// ESG import, report settings) -> verification -> SHOWCASE_URL, foreground.
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import * as XLSX from 'xlsx';
import { runMigrations, getPool, withTenantContext } from '../src/db/index.ts';
import { applyB17Offline, B17_CONTENT_VERSION } from '../src/db/b17Readiness.ts';
import {
  parseB17ContentSources, inventoryB17ContentOffline, applyB17ContentOffline,
  type ContentTarget,
} from '../src/db/b17ContentMigration.ts';
import { parseGRIFile } from '../src/lib/griParser.ts';
import { validateSelfChosenPassword } from '../src/lib/password.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const CONTAINER = 'b17-showcase';
const ROLE = 'b17showcaseowner';
const DB_NAME = 'b17_showcase';
// Deterministic ids: the tenant must be addressable AFTER U1, where clients
// are invisible to every pre-content context — so no cross-run state file.
const TENANT_ID = 'b175c0a1-0000-4000-8000-000000000000';
const REPORT_SETTING_ID = 'b175c0a1-0000-4000-8000-000000000001';
const REPORT_AUDIT_ID = 'b175c0a1-0000-4000-8000-000000000002';
const GRI_AUDIT_ID = 'b175c0a1-0000-4000-8000-000000000003';
const ESG_AUDIT_ID = 'b175c0a1-0000-4000-8000-000000000004';
const GRI_BATCH = 'b17-showcase-bootstrap-gri';
const PROFILE_BATCH = 'b17-showcase-bootstrap-esg';
const TENANT_CODE = 'DEMO-CLIENT';
const TENANT_NAME = 'Demo Client';
const DEFAULT_GRI_CSV = path.join(SCRIPT_DIR, '..', '..', 'prototype', 'GRI_SOURCE_EXTRACT.csv');
const ESG_CSV = path.join(SCRIPT_DIR, '..', '..', 'prototype', 'ESG_PROFILE_EXTRACT.csv');

const log = (...a: unknown[]) => console.log('[showcase]', ...a);
const die = (msg: string): never => {
  console.error('[showcase] FAILED:', msg);
  process.exit(1);
};

function requireEnv(): Record<string, string> {
  const names = ['SHOWCASE_GE_EMAIL', 'SHOWCASE_GE_PASSWORD',
    'SHOWCASE_CLIENT_ADMIN_EMAIL', 'SHOWCASE_CLIENT_ADMIN_PASSWORD',
    'SHOWCASE_EMPLOYEE_EMAIL', 'SHOWCASE_EMPLOYEE_PASSWORD'];
  const missing = names.filter(n => !process.env[n]?.trim());
  if (missing.length) {
    die(`missing required env var(s): ${missing.join(', ')} — set all six SHOWCASE_* credentials before running (no defaults, no fallbacks).`);
  }
  for (const n of names.filter(n => n.endsWith('_PASSWORD'))) {
    const check = validateSelfChosenPassword(process.env[n]);
    if (!check.ok) die(`${n} does not meet the app password rule: ${check.error}`);
  }
  for (const n of names.filter(n => n.endsWith('_EMAIL'))) {
    const v = process.env[n]!;
    if (!v.includes('@') || v.length > 320) die(`${n} is not a valid e-mail address.`);
  }
  const griCsv = process.env.SHOWCASE_GRI_CSV?.trim() || DEFAULT_GRI_CSV;
  if (!existsSync(griCsv)) die(`GRI CSV not found: ${griCsv}`);
  if (!existsSync(ESG_CSV)) die(`ESG profile CSV not found: ${ESG_CSV} (required by the content inventory).`);
  return {
    geEmail: process.env.SHOWCASE_GE_EMAIL!.trim(), gePassword: process.env.SHOWCASE_GE_PASSWORD!,
    caEmail: process.env.SHOWCASE_CLIENT_ADMIN_EMAIL!.trim(), caPassword: process.env.SHOWCASE_CLIENT_ADMIN_PASSWORD!,
    empEmail: process.env.SHOWCASE_EMPLOYEE_EMAIL!.trim(), empPassword: process.env.SHOWCASE_EMPLOYEE_PASSWORD!,
    griCsv,
  };
}

const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

async function ensureContainer(): Promise<{ port: number; pgPassword: string }> {
  const existing = docker('ps', '-a', '--filter', `name=^${CONTAINER}$`, '--format', '{{.Names}}');
  let pgPassword: string;
  if (existing === CONTAINER) {
    if (docker('inspect', '-f', '{{.State.Running}}', CONTAINER) !== 'true') docker('start', CONTAINER);
    pgPassword = docker('exec', CONTAINER, 'printenv', 'POSTGRES_PASSWORD');
    log('reusing container', CONTAINER);
  } else {
    pgPassword = randomBytes(24).toString('hex');
    docker('run', '--detach', '--rm', '--name', CONTAINER,
      '-e', `POSTGRES_PASSWORD=${pgPassword}`, '-p', '127.0.0.1::5432', 'postgres:18');
    log('created container', CONTAINER);
  }
  const binding = docker('port', CONTAINER, '5432/tcp');
  if (!/^127\.0\.0\.1:\d+$/.test(binding)) die(`unexpected non-loopback binding: ${binding}`);
  return { port: Number(binding.split(':')[1]), pgPassword };
}

async function waitPg(port: number, pgPassword: string): Promise<pg.Client> {
  for (let i = 0; i < 60; i++) {
    const c = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: pgPassword, database: 'postgres' });
    try { await c.connect(); return c; }
    catch { await c.end().catch(() => {}); await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('PostgreSQL did not become ready in 30s');
}

async function ensureRoleAndDb(admin: pg.Client, pgPassword: string, port: number): Promise<string> {
  if (!(await admin.query(`SELECT 1 FROM pg_roles WHERE rolname='${ROLE}'`)).rowCount)
    await admin.query(`CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${pgPassword}'`);
  if (!(await admin.query(`SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`)).rowCount)
    await admin.query(`CREATE DATABASE ${DB_NAME} OWNER ${ROLE}`);
  await admin.end();
  return `postgresql://${ROLE}:${pgPassword}@127.0.0.1:${port}/${DB_NAME}`;
}

/** Inventory minimum ONLY (fixture pattern): tenant + one GRI marker item +
 * one ESG row + one report row + the three lineage audit rows. All idempotent. */
async function bootstrap(griKeys: readonly string[], profileKeys: readonly string[]): Promise<void> {
  const [sc, dc, ic, requirement] = JSON.parse(griKeys[0]) as string[];
  const [pillar, department, topic, parameter] = JSON.parse(profileKeys[0]) as string[];
  await withTenantContext({ role: 'ge_admin' }, async c => {
    await c.query(`INSERT INTO clients(id,code,name) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
      [TENANT_ID, TENANT_CODE, TENANT_NAME]);
    let std = (await c.query('SELECT id FROM standards WHERE code=$1', [sc])).rows[0];
    if (!std) std = (await c.query(`INSERT INTO standards(code,title,category) VALUES($1,$1,'Governance') RETURNING id`, [sc])).rows[0];
    let disc = (await c.query('SELECT id FROM disclosures WHERE standard_id=$1 AND code=$2', [std.id, dc])).rows[0];
    if (!disc) disc = (await c.query(`INSERT INTO disclosures(standard_id,code,title) VALUES($1,$2,$2) RETURNING id`, [std.id, dc])).rows[0];
    if (!(await c.query('SELECT 1 FROM items WHERE disclosure_id=$1 AND code=$2', [disc.id, ic])).rowCount)
      await c.query(`INSERT INTO items(disclosure_id,code,requirement,priority,esg_class,import_batch_id)
        VALUES($1,$2,$3,'high','governance',$4)`, [disc.id, ic, requirement, GRI_BATCH]);
    await c.query(`INSERT INTO esg_profile(client_id,pillar,department,topic,parameter,profile_rating,import_batch_id)
      VALUES($1,$2,$3,$4,$5,3,$6) ON CONFLICT (client_id,pillar,department,topic,parameter) DO NOTHING`,
      [TENANT_ID, pillar, department, topic, parameter, PROFILE_BATCH]);
    await c.query(`INSERT INTO report_settings(id,client_id,level,disclosure_level,report_level,statement_name,
      statement_period,notified,notified_date,notify_ref,notification_recorded)
      VALUES($1,$2,'in_accordance','in-accordance','L3',$3,'2026','done','2026-11-14','showcase-bootstrap',true)
      ON CONFLICT (id) DO NOTHING`, [REPORT_SETTING_ID, TENANT_ID, TENANT_NAME]);
    // entity_id is mandatory on the report lineage row: capture() matches the
    // REPORT_SETTINGS_SAVED audit by (client, entity_type, entity_id, action).
    const audit = (id: string, action: string, entityType: string, payload: object,
      entityId: string | null = null) =>
      c.query(`INSERT INTO audit_log(id,client_id,user_id,action,entity_type,entity_id,payload)
        SELECT $1,$2,NULL,$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE id=$1)`,
        [id, TENANT_ID, action, entityType, entityId, JSON.stringify(payload)]);
    await audit(GRI_AUDIT_ID, 'IMPORT_GRI_DISCLOSURES', 'standards',
      { targetTenant: TENANT_ID, importBatchId: GRI_BATCH });
    await audit(ESG_AUDIT_ID, 'ESG_PROFILE_IMPORTED', 'esg_profile',
      { targetTenant: TENANT_ID, importBatchId: PROFILE_BATCH });
    await audit(REPORT_AUDIT_ID, 'REPORT_SETTINGS_SAVED', 'report_settings',
      { targetTenant: TENANT_ID, serviceId: null, disclosureLevel: 'in-accordance', reportLevel: 'L3', notified: 'done' },
      REPORT_SETTING_ID);
  });
}

async function migrate(griCsv: string, esgCsv: string): Promise<void> {
  const state = (await getPool().query(`SELECT
    to_regclass('public.clients') IS NOT NULL AS schema_present,
    to_regclass('public.app_schema_versions') IS NOT NULL AS u1_present`)).rows[0];
  if (!state.schema_present) {
    const r = await runMigrations();
    if (!r.success) die(`schema initialization refused: ${r.message}`);
    log('base schema applied');
  }
  if (!state.u1_present) {
    // Pre-U1: the only state where the inventory bootstrap can write (post-U1
    // the catalog/tenant tables have no admissible policy until content).
    const sources = parseB17ContentSources(readFileSync(griCsv, 'utf8'), readFileSync(esgCsv, 'utf8'));
    await bootstrap(sources.griKeys, sources.profileKeys);
    log('content-inventory bootstrap applied (inventory minimum)');
    const c = await getPool().connect();
    try { log('U1 activation:', await applyB17Offline(c)); }
    finally { c.release(); }
  }
  const hasContent = (await getPool().query('SELECT EXISTS(SELECT 1 FROM app_schema_versions WHERE version=$1) AS ok',
    [B17_CONTENT_VERSION])).rows[0].ok;
  if (!hasContent) {
    const griText = readFileSync(griCsv, 'utf8');
    const sources = parseB17ContentSources(griText, readFileSync(esgCsv, 'utf8'));
    const targets: ContentTarget[] = [{ clientId: TENANT_ID, griBatchId: GRI_BATCH,
      profileBatchId: PROFILE_BATCH, reportSettingId: REPORT_SETTING_ID, reportAuditId: REPORT_AUDIT_ID }];
    const c = await getPool().connect();
    try {
      const inventory = await inventoryB17ContentOffline(c, targets, sources);
      log('content activation:', await applyB17ContentOffline(c, inventory, sources));
    } catch (err: any) {
      die(`content migration failed: ${err.message} (bootstrap rows missing?)`);
    } finally { c.release(); }
  } else {
    log('content activation: already applied (skipped)');
  }
}

interface Reply { status: number; json: any }
class Api {
  token = ''; tab = ''; gen = 0;
  constructor(private base: string) {}
  private headers(useTab: boolean): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (useTab && this.tab) {
      h['X-Workspace-Tab'] = this.tab;
      h['X-Workspace-Version'] = String(this.gen);
    }
    return h;
  }
  async call(method: string, p: string, body?: unknown, useTab = false): Promise<Reply> {
    const res = await fetch(this.base + p, { method, headers: this.headers(useTab),
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body kept as null */ }
    if (json && typeof json.generation === 'number') this.gen = json.generation;
    return { status: res.status, json };
  }
  async ok(method: string, p: string, body?: unknown, useTab = false, allow = [200, 201]): Promise<Reply> {
    const r = await this.call(method, p, body, useTab);
    if (!allow.includes(r.status))
      die(`${method} ${p} -> ${r.status} ${JSON.stringify(r.json)?.slice(0, 300)}`);
    return r;
  }
  async login(email: string, password: string): Promise<any> {
    const r = await this.ok('POST', '/api/auth/login', { email, password }, false, [200]);
    this.token = r.json.token;
    return r.json.user;
  }
}

async function seed(base: string, creds: ReturnType<typeof requireEnv>): Promise<void> {
  const api = new Api(base);
  const griText = readFileSync(creds.griCsv, 'utf8');
  const parsed = parseGRIFile(griText);
  if (parsed.errors.length || !parsed.standards.length) die(`GRI CSV parse failed: ${parsed.errors.join('; ')}`);
  log(`GRI CSV parsed: ${parsed.summary.totalStandards} standards / ${parsed.summary.totalDisclosures} disclosures / ${parsed.summary.totalItems} items`);

  const setup = await api.ok('GET', '/api/setup/status', undefined, false, [200]);
  if (setup.json.canSetup) {
    await api.ok('POST', '/api/setup/admin',
      { email: creds.geEmail, password: creds.gePassword, name: 'Platform Admin' }, false, [200]);
    log('setup/admin -> 200 (ge_admin created)');
  } else {
    log('setup/admin -> skipped (users already exist)');
  }
  const ge = await api.login(creds.geEmail, creds.gePassword);
  // The workspace tab is bound to THIS session — keep its token for the
  // final enter/exit checks even after the client/employee logins overwrite it.
  const geToken = api.token;
  log(`ge_admin login -> 200 (role=${ge.role})`);
  const tab = await api.ok('POST', '/api/workspace/tab', {}, false, [201]);
  api.tab = tab.json.tabHandle; api.gen = tab.json.generation;
  log(`workspace tab -> 201 (mode=${tab.json.mode}, generation=${api.gen})`);

  const services = await api.ok('GET', '/api/services', undefined, true, [200]);
  const griService = (services.json as any[]).find(s => s.code === 'GRI');
  if (!griService) die('GRI service not found in catalog');
  const link = await api.ok('POST', `/api/clients/${TENANT_ID}/services`, { serviceId: griService.id }, true);
  log(`client service link -> ${link.status} (${link.json.existed ? 'already linked' : 'linked'})`);

  // U4-1c (OD-12 §7): every service owns a general bucket — standard
  // `GENERAL-<SLUG>-<ID>` with `category = 'general'`, one disclosure
  // `GENERAL`, and (until a free question is authored) zero items. That row is
  // catalog content created by the service, NOT GRI-CSV content, so every CSV
  // comparison below excludes exactly the standards whose `category` is
  // `general` (trim + lowercase compare) and, transitively, their disclosures
  // and items (`item_count`/`disclosure_count` are per-standard aggregates).
  const isGeneralCategory = (row: any): boolean =>
    String(row?.category ?? '').trim().toLowerCase() === 'general';
  const countsOf = (rows: any[]) => ({ standards: rows.length,
    disclosures: rows.reduce((n, r) => n + Number(r.disclosure_count || 0), 0),
    items: rows.reduce((n, r) => n + Number(r.item_count || 0), 0) });
  const standardsSum = async () => {
    const r = await api.ok('GET', '/api/standards', undefined, true, [200]);
    const rows = r.json as any[];
    const generalRows = rows.filter(isGeneralCategory);
    return { catalog: countsOf(rows.filter(row => !isGeneralCategory(row))), raw: countsOf(rows),
      general: countsOf(generalRows),
      // `/api/items` carries no category: an item is out of the CSV catalog when
      // its `standard_code` is one of the general-category standards read above.
      generalStandardCodes: new Set(generalRows.map(row => String(row.code))) };
  };
  const before = await standardsSum();
  log(`catalog before GRI commit: ${before.raw.standards} standards / ${before.raw.disclosures} disclosures / ${before.raw.items} items`);
  if (before.general.standards) log(`excluding ${before.general.standards} general bucket(s) from the CSV comparison (${before.catalog.standards}/${before.catalog.disclosures}/${before.catalog.items} comparable)`);

  // TASK-PROTO-U4-2-FIX P3S: catalog-only import — NO clientId on this path
  // (400 import.client_forbidden). Tenant provisioning is explicit below.
  const commit = await api.ok('POST', '/api/import/commit',
    { standards: parsed.standards, serviceId: griService.id, importBatchId: GRI_BATCH }, true, [200]);
  log(`GRI commit -> 200 (catalog-only): standards=${commit.json.standardsCount} disclosures=${commit.json.disclosuresCount} items=${commit.json.itemsCount} inserted=${commit.json.inserted} updated=${commit.json.updated} skipped=${commit.json.skipped} mapped=${commit.json.mappedStandards} unmapped=${commit.json.unmappedStandards} (updated>0 proves the HTTP upsert overwrote the bootstrap marker rows)`);
  if (commit.json.setupNotice) log(`import setup notice: ${commit.json.setupNotice}`);

  const after = await standardsSum();
  log(`catalog after GRI commit: ${after.raw.standards} standards / ${after.raw.disclosures} disclosures / ${after.raw.items} items`);
  if (after.general.standards) log(`excluding ${after.general.standards} general bucket(s) from the CSV comparison (${after.catalog.standards}/${after.catalog.disclosures}/${after.catalog.items} comparable)`);
  if (after.catalog.items !== parsed.summary.totalItems || after.catalog.standards !== parsed.summary.totalStandards
    || after.catalog.disclosures !== parsed.summary.totalDisclosures)
    die(`catalog counts mismatch the CSV: got ${after.raw.standards}/${after.raw.disclosures}/${after.raw.items} raw (${after.catalog.standards}/${after.catalog.disclosures}/${after.catalog.items} excluding ${after.general.standards} general bucket(s)), CSV ${parsed.summary.totalStandards}/${parsed.summary.totalDisclosures}/${parsed.summary.totalItems}`);

  // TASK-PROTO-U4-2-FIX P3S: explicit tenant provisioning (INV-IMPORT-SAFE).
  // There is NO POST /departments route (admin.ts mounts GET + PATCH head
  // only), so departments are upserted by seed-script SQL under the explicit
  // platform.config(T) target — the same (client_id, code) upsert the removed
  // import auto-provisioning performed. Assignments DO have an explicit
  // route (POST /api/assignments) and go through it below, after mapping.
  const normalizeSeedDeptCode = (name: string): string => {
    const code = name.trim().toLowerCase().replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}\-_]/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return code || 'dept';
  };
  const deptNameByCode = new Map<string, string>();
  for (const std of parsed.standards) {
    for (const disc of std.disclosures) {
      for (const item of disc.items) {
        const deptName = (item.department || '').trim();
        if (!deptName) continue;
        const code = normalizeSeedDeptCode(deptName);
        if (!deptNameByCode.has(code)) deptNameByCode.set(code, deptName);
      }
    }
  }
  const deptIdByCode = new Map<string, string>();
  // The RLS configuration gate (b17_platform_config) needs purpose +
  // ge_admin role + a real actor: the just-logged-in platform admin.
  await withTenantContext({ role: 'ge_admin', mode: 'platform', purpose: 'platform.config',
    tenantId: TENANT_ID, targetId: TENANT_ID, userId: ge.id }, async c => {
    for (const [code, name] of deptNameByCode) {
      const r = await c.query(
        `INSERT INTO departments (client_id, code, name) VALUES ($1, $2, $3)
         ON CONFLICT (client_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [TENANT_ID, code, name]);
      deptIdByCode.set(code, r.rows[0].id);
    }
  });
  log(`departments seeded (explicit SQL, no route): ${deptIdByCode.size}`);

  const depts = await api.ok('GET', `/api/departments?clientId=${TENANT_ID}`, undefined, true, [200]);
  const deptRows = depts.json as any[];
  if (!deptRows.length) die('seed departments missing after explicit provisioning');
  const legal = deptRows.find(d => String(d.name).toLowerCase() === 'legal') ?? deptRows[0];
  log(`departments provisioned: ${deptRows.length} (${deptRows.map((d: any) => d.name).join(', ')}); employee department = ${legal.name}`);

  const findUser = async (email: string) => {
    const r = await api.ok('GET', `/api/users?clientId=${TENANT_ID}`, undefined, true, [200]);
    return (r.json as any[]).find(u => String(u.email).toLowerCase() === email.toLowerCase());
  };
  const ensureUser = async (label: string, email: string, password: string, name: string,
    role: string, departmentId?: string) => {
    const body: any = { email, password, name, role, clientId: TENANT_ID };
    if (departmentId) body.departmentId = departmentId;
    const r = await api.call('POST', '/api/users', body, true);
    if (r.status === 201) { log(`POST /users (${label}) -> 201`); return r.json.id as string; }
    if (r.status === 409) {
      const existing = await findUser(email);
      if (!existing) die(`POST /users (${label}) -> 409 but the user is not listed`);
      log(`POST /users (${label}) -> 409 (already exists, skipped)`);
      return existing.id as string;
    }
    die(`POST /users (${label}) -> ${r.status} ${JSON.stringify(r.json)?.slice(0, 300)}`);
  };
  await ensureUser('client_admin', creds.caEmail, creds.caPassword, 'Client Admin', 'client_admin');
  const employeeId = await ensureUser('employee', creds.empEmail, creds.empPassword, 'Demo Employee', 'employee', legal.id);
  await api.ok('PATCH', `/api/departments/${legal.id}/head`,
    { clientId: TENANT_ID, headUserId: employeeId }, true, [200]);
  log(`department head -> 200 (${legal.name} head = employee)`);

  let mapped = 0, alreadyMapped = 0;
  const standardsList = (await api.ok('GET', '/api/standards', undefined, true, [200])).json as any[];
  // The general bucket IS listed here on purpose: it stays mapped to its own
  // service (U4-1c), so this idempotent pass just reports it as already linked
  // and no count is asserted on the total.
  for (const s of standardsList) {
    const r = await api.ok('POST', `/api/services/${griService.id}/standards`, { standardId: s.id }, true, [200, 201]);
    if (r.json.existed) alreadyMapped++; else mapped++;
  }
  log(`service<->standards mapping: ${mapped} linked, ${alreadyMapped} already linked`);

  // TASK-PROTO-U4-2-FIX P3S: explicit assignment provisioning through the
  // same POST /api/assignments route the app uses (P@T; the item must belong
  // to the linked+mapped service — hence after the mapping pass above).
  const catalogItems = (await api.ok('GET', '/api/items', undefined, true, [200])).json as any[];
  const itemIdByKey = new Map<string, string>();
  for (const row of catalogItems) itemIdByKey.set(`${row.disclosure_code}::${row.code}`, row.id);
  const seenPairs = new Set<string>();
  const pairQueue: Array<{ itemId: string; departmentId: string }> = [];
  for (const std of parsed.standards) {
    for (const disc of std.disclosures) {
      for (const item of disc.items) {
        const deptName = (item.department || '').trim();
        if (!deptName) continue;
        const deptId = deptIdByCode.get(normalizeSeedDeptCode(deptName));
        const itemId = itemIdByKey.get(`${disc.code}::${item.code}`);
        if (!deptId || !itemId) die(`seed pair unresolvable: item ${disc.code}/${item.code} dept '${deptName}'`);
        const key = `${itemId}::${deptId}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        pairQueue.push({ itemId: itemId!, departmentId: deptId! });
      }
    }
  }
  let assignCreated = 0, assignExisted = 0;
  for (let i = 0; i < pairQueue.length; i += 8) {
    const chunk = pairQueue.slice(i, i + 8);
    const results = await Promise.all(chunk.map(p =>
      api.ok('POST', '/api/assignments', { clientId: TENANT_ID, itemId: p.itemId, departmentId: p.departmentId }, true, [200, 201])));
    for (const r of results) { if (r.status === 201) assignCreated++; else assignExisted++; }
  }
  log(`tenant assignments -> route-provisioned: ${assignCreated} created, ${assignExisted} already existed (${pairQueue.length} pairs)`);

  const esgBook = XLSX.read(readFileSync(ESG_CSV, 'utf8').replace(/^\uFEFF/, ''), { type: 'string', raw: true });
  const esgRows = XLSX.utils.sheet_to_json<Record<string, any>>(esgBook.Sheets[esgBook.SheetNames[0]], { defval: '' });
  const required = ['pillar', 'department', 'topic', 'parameter'];
  const valid = esgRows.filter(r => required.every(k => String(r[k] ?? '').trim()));
  const rows = valid.map(r => ({ pillar: r.pillar, department: r.department, topic: r.topic, parameter: r.parameter,
    observations: r.observations, marketScenario: r.market_scenario, profile: r.profile,
    profileRating: r.profile_rating, timeline: r.timeline, ecoImpact: r.eco_impact,
    rating: r.rating, maxRating: r.max_rating, sortOrder: r.sort_order }));
  const esg = await api.ok('POST', '/api/esg-profile/import',
    { clientId: TENANT_ID, serviceId: griService.id, rows }, true, [200]);
  log(`ESG profile import -> 200: rows=${rows.length} inserted=${esg.json.inserted} updated=${esg.json.updated} skipped=${esg.json.skipped}${esgRows.length !== valid.length ? ` (${esgRows.length - valid.length} incomplete CSV rows skipped)` : ''}`);

  const report = await api.ok('PUT', '/api/report-settings',
    { clientId: TENANT_ID, serviceId: griService.id, disclosureLevel: 'in-accordance',
      reportLevel: 'L3', statementName: TENANT_NAME, statementPeriod: '2026', notified: 'done' }, true, [200]);
  if (!report.json.gate?.ok) die('report settings saved but the export gate is not open');
  log('report settings -> 200 (D-038 gate open)');

  await api.login(creds.caEmail, creds.caPassword);
  const items = await api.ok('GET', '/api/items', undefined, false, [200]);
  // Same exclusion as the standards comparison: `/api/items` exposes
  // `standard_code` but no category, so an item is CSV-catalog content iff its
  // standard_code is NOT one of the general-category standards read above.
  const clientItemRows = (items.json as any[]);
  const csvCatalogItems = clientItemRows.filter(row => !after.generalStandardCodes.has(String(row.standard_code ?? '')));
  log(`client_admin login -> 200; GET /api/items -> ${clientItemRows.length} items (${csvCatalogItems.length} outside ${after.general.standards} general bucket(s))`);
  if (csvCatalogItems.length !== parsed.summary.totalItems)
    die(`client_admin sees ${csvCatalogItems.length} CSV-catalog items, expected ${parsed.summary.totalItems} (predicate: item.standard_code is not a standard whose category = 'general')`);
  const settings = await api.ok('GET', '/api/report-settings', undefined, false, [200]);
  if (!settings.json.settings) die('client_admin cannot read the saved report settings');
  const profile = await api.ok('GET', '/api/esg-profile', undefined, false, [200]);
  log(`client_admin surfaces: report settings OK, ESG profile rows=${profile.json.rows.length}`);

  const emp = await api.login(creds.empEmail, creds.empPassword);
  if (emp.role !== 'employee' || !emp.departmentId) die(`employee login bound incorrectly: ${JSON.stringify({ role: emp.role, departmentId: emp.departmentId })}`);
  const empDepts = await api.ok('GET', '/api/departments', undefined, false, [200]);
  if (!(empDepts.json as any[]).length) die('employee department surface returned an empty list');
  log(`employee login -> 200 (department=${emp.departmentName ?? emp.departmentId}); GET /api/departments -> ${JSON.stringify((empDepts.json as any[]).map(d => d.name))}`);

  api.token = geToken;
  const enter = await api.ok('POST', '/api/workspace/enter', { clientId: TENANT_ID }, true, [200]);
  if (enter.json.mode !== 'consultant') die(`workspace enter -> mode ${enter.json.mode}`);
  const exit = await api.ok('POST', '/api/workspace/exit', {}, true, [200]);
  if (exit.json.mode !== 'platform') die(`workspace exit -> mode ${exit.json.mode}`);
  log(`workspace enter/exit -> 200 (generation ${enter.json.generation} -> ${exit.json.generation})`);

  const home = await fetch(base + '/');
  if (home.status !== 200 || !(await home.text()).includes('<!doctype html'))
    die(`GET / -> ${home.status}, expected SPA HTML`);
  log('GET / -> 200 (SPA HTML)');
  log(`SUMMARY items=${after.catalog.items} standards=${after.catalog.standards} disclosures=${after.catalog.disclosures} departments=${deptRows.length} assignments=${assignCreated + assignExisted} esgRows=${profile.json.rows.length}`);
}

// ---- PERSISTENT shared-DB mode (owner-approved permanent on-machine DB) ----
// WHY a separate path with shared seed logic: every session reaches one
// durable local DB (named volume, no --rm) instead of a per-run throwaway
// container, while migrate() + seed() stay shared so both modes prove the
// same content. Secrets live ONLY in the repo-root .env (gitignored via
// .env*); SHOWCASE_* account passwords stay runtime-env per run (the owner's
// showcase password differs from live by design) and are never persisted.
// B17_PERSISTENT_* overrides exist so verification can run entirely on
// throwaway names/ports/files without touching the real shared DB.
const PERSISTENT_CONTAINER_DEFAULT = 'b17-showcase';
const PERSISTENT_VOLUME_DEFAULT = 'b17-showcase-data';
const PERSISTENT_PORT_DEFAULT = 55432;
const PERSISTENT_ENV_FILE_DEFAULT = path.join(ROOT, '.env');
const PERSISTENT_DB_URL_KEY = 'B17_DEMO_DATABASE_URL';
const PERSISTENT_JWT_KEY = 'B17_DEMO_JWT_SECRET';
const PERSISTENT_PG_PASSWORD_KEY = 'B17_DEMO_PG_PASSWORD';

interface PersistentConfig {
  container: string;
  volume: string;
  port: number;
  envFile: string;
}

interface PersistentSecrets {
  databaseUrl: string;
  jwtSecret: string;
  pgPassword: string;
  rolePassword: string;
}

function resolvePersistentConfig(): PersistentConfig {
  const container = process.env.B17_PERSISTENT_CONTAINER?.trim() || PERSISTENT_CONTAINER_DEFAULT;
  const volume = process.env.B17_PERSISTENT_VOLUME?.trim() || PERSISTENT_VOLUME_DEFAULT;
  const rawPort = process.env.B17_PERSISTENT_PORT?.trim() || '';
  const port = rawPort ? Number(rawPort) : PERSISTENT_PORT_DEFAULT;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    die(`invalid B17_PERSISTENT_PORT=${JSON.stringify(rawPort)} — expected a TCP port number.`);
  const envFile = process.env.B17_PERSISTENT_ENV_FILE?.trim() || PERSISTENT_ENV_FILE_DEFAULT;
  return { container, volume, port, envFile };
}

/** Parse KEY=value lines (skips blanks/comments, strips matching quotes). */
function parseEnvText(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    let key = t.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice('export '.length).trim();
    let val = t.slice(eq + 1).trim();
    if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))))
      val = val.slice(1, -1);
    if (!out.has(key)) out.set(key, val);
  }
  return out;
}

/** Read the persisted secrets file (missing file = all keys absent). Values are never logged. */
function readPersistedSecrets(envFile: string): Map<string, string> {
  if (!existsSync(envFile)) return new Map();
  return parseEnvText(readFileSync(envFile, 'utf8'));
}

/** Append ONLY missing keys (creates the file when absent). Logs key names, never values. */
function persistMissingSecrets(envFile: string, missing: Array<[string, string]>): void {
  if (!missing.length) return;
  const block = missing.map(([k, v]) => `${k}=${v}`).join('\n');
  if (!existsSync(envFile)) {
    writeFileSync(envFile, `# B17 showcase persistent secrets (generated locally; never commit — .env* is gitignored).\n${block}\n`);
  } else {
    const cur = readFileSync(envFile, 'utf8');
    appendFileSync(envFile, `${cur.length === 0 || cur.endsWith('\n') ? '' : '\n'}${block}\n`);
  }
  log(`persisted ${missing.length} secret(s) to ${envFile} (keys: ${missing.map(([k]) => k).join(', ')}; values never printed)`);
}

/** WHY a TCP probe before `docker run`: a taken port must fail fast with a
 * clear message — never silently fall back to another port. */
function isPortListening(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const sock = new net.Socket();
    const done = (v: boolean) => { try { sock.destroy(); } catch { /* already closed */ } resolve(v); };
    sock.setTimeout(500);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(port, host);
  });
}

function persistentContainerExists(cfg: PersistentConfig): boolean {
  return docker('ps', '-a', '--filter', `name=^${cfg.container}$`, '--format', '{{.Names}}') === cfg.container;
}

/** Adopt an existing same-named container, or refuse it when it is NOT the
 * persistent one. WHY refuse: a container without the named volume is a live
 * ephemeral from another session (--rm); adopting it would hijack its DB and
 * destroying it would wipe that session's data — so stop/remove first. */
async function adoptPersistentContainer(cfg: PersistentConfig): Promise<void> {
  const autoRemove = docker('inspect', '-f', '{{.HostConfig.AutoRemove}}', cfg.container);
  const mounts = docker('inspect', '-f', '{{range .Mounts}}{{.Name}} {{end}}', cfg.container);
  if (autoRemove === 'true' || !mounts.split(/\s+/).includes(cfg.volume))
    die(`refusing persistent adoption: container '${cfg.container}' exists WITHOUT the named volume '${cfg.volume}' (likely a live ephemeral from another session). Stop/remove it first, then re-run — nothing was adopted or destroyed.`);
  if (docker('inspect', '-f', '{{.State.Running}}', cfg.container) !== 'true') {
    docker('start', cfg.container);
    log('started existing persistent container', cfg.container);
  } else {
    log('reusing persistent container', cfg.container);
  }
  await assertPersistentBinding(cfg);
}

async function assertPersistentBinding(cfg: PersistentConfig): Promise<void> {
  // WHY poll: `docker run --detach` returns before the port mapping is
  // queryable; one immediate `docker port` would race container start.
  for (let i = 0; i < 30; i++) {
    try {
      const binding = docker('port', cfg.container, '5432/tcp');
      if (binding === `127.0.0.1:${cfg.port}`) return;
      die(`unexpected binding for '${cfg.container}': ${binding} (expected exactly 127.0.0.1:${cfg.port}); refusing to use another port.`);
    } catch { /* not published yet — keep polling */ }
    await new Promise(r => setTimeout(r, 500));
  }
  die(`port mapping for '${cfg.container}' never appeared (expected 127.0.0.1:${cfg.port}); inspect the container, then re-run.`);
}

async function createPersistentContainer(cfg: PersistentConfig, pgPassword: string): Promise<void> {
  if (await isPortListening('127.0.0.1', cfg.port))
    die(`port 127.0.0.1:${cfg.port} is already in use — refusing to silently pick another port. Free it and re-run (or point B17_PERSISTENT_PORT at a throwaway for verification).`);
  try {
    // WHY /var/lib/postgresql (not .../data): postgres:18 keeps PGDATA in a
    // versioned subdirectory for pg_upgrade; mounting .../data aborts init.
    docker('run', '--detach', '--name', cfg.container,
      '-e', `POSTGRES_PASSWORD=${pgPassword}`, '-v', `${cfg.volume}:/var/lib/postgresql`,
      '-p', `127.0.0.1:${cfg.port}:5432`, 'postgres:18');
  } catch (err: any) {
    const firstLine = String(err?.message ?? err).split('\n')[0].split(pgPassword).join('<redacted>');
    die(`could not create persistent container '${cfg.container}' on 127.0.0.1:${cfg.port} (name or port taken?): ${firstLine}`);
  }
  log('created persistent container', cfg.container);
  await assertPersistentBinding(cfg);
}

/** Resolve the three persistent secrets: read from the env file when present,
 * else recover-or-generate (the superuser password is recoverable from an
 * adopted container via printenv like the ephemeral flow; a missing role URL
 * is rebuilt and the live role re-converged by ALTER below), then append only
 * the missing keys. Values are never printed. */
function ensurePersistentSecrets(cfg: PersistentConfig, containerExists: boolean): PersistentSecrets {
  const existing = readPersistedSecrets(cfg.envFile);
  let pgPassword = existing.get(PERSISTENT_PG_PASSWORD_KEY) ?? '';
  if (!pgPassword) {
    pgPassword = containerExists
      ? docker('exec', cfg.container, 'printenv', 'POSTGRES_PASSWORD').trim()
      : randomBytes(24).toString('hex');
    if (!pgPassword) die(`container '${cfg.container}' has no POSTGRES_PASSWORD to recover — remove the container or repair ${cfg.envFile}, then re-run.`);
  }
  let jwtSecret = existing.get(PERSISTENT_JWT_KEY) ?? '';
  if (!jwtSecret) jwtSecret = randomBytes(32).toString('hex'); // stable across restarts so sessions survive
  let databaseUrl = existing.get(PERSISTENT_DB_URL_KEY) ?? '';
  if (!databaseUrl)
    databaseUrl = `postgresql://${ROLE}:${randomBytes(24).toString('hex')}@127.0.0.1:${cfg.port}/${DB_NAME}`;
  // WHY validate shape before use: a hand-edited URL pointing elsewhere must
  // fail fast here, never silently seed the wrong database.
  let rolePassword = '';
  try {
    const u = new URL(databaseUrl);
    if (u.hostname !== '127.0.0.1' || Number(u.port) !== cfg.port
      || u.pathname.replace(/^\//, '') !== DB_NAME || !u.password)
      die(`secret ${PERSISTENT_DB_URL_KEY} in ${cfg.envFile} does not point at 127.0.0.1:${cfg.port}/${DB_NAME} — fix or remove that line, then re-run.`);
    try { rolePassword = decodeURIComponent(u.password); } catch { rolePassword = u.password; }
  } catch (err: any) {
    if (err?.message?.startsWith('secret ')) throw err;
    die(`secret ${PERSISTENT_DB_URL_KEY} in ${cfg.envFile} is not a valid URL — fix or remove that line, then re-run.`);
  }
  if (!rolePassword) die(`secret ${PERSISTENT_DB_URL_KEY} in ${cfg.envFile} carries no password — remove that line, then re-run.`);
  const missing: Array<[string, string]> = [];
  if (!existing.get(PERSISTENT_PG_PASSWORD_KEY)) missing.push([PERSISTENT_PG_PASSWORD_KEY, pgPassword]);
  if (!existing.get(PERSISTENT_JWT_KEY)) missing.push([PERSISTENT_JWT_KEY, jwtSecret]);
  if (!existing.get(PERSISTENT_DB_URL_KEY)) missing.push([PERSISTENT_DB_URL_KEY, databaseUrl]);
  persistMissingSecrets(cfg.envFile, missing);
  return { databaseUrl, jwtSecret, pgPassword, rolePassword };
}

/** Persistent twin of ensureRoleAndDb: identical create path, plus ALTER
 * convergence so a rebuilt role URL always matches the live role (a no-op
 * rewrite when the password already matches). */
async function ensurePersistentRoleAndDb(admin: pg.Client, rolePassword: string): Promise<void> {
  const esc = rolePassword.replace(/'/g, "''"); // interpolated like the ephemeral flow; hex has no quotes, belt kept
  if (!(await admin.query(`SELECT 1 FROM pg_roles WHERE rolname='${ROLE}'`)).rowCount)
    await admin.query(`CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${esc}'`);
  else
    await admin.query(`ALTER ROLE ${ROLE} WITH PASSWORD '${esc}'`);
  if (!(await admin.query(`SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`)).rowCount)
    await admin.query(`CREATE DATABASE ${DB_NAME} OWNER ${ROLE}`);
  await admin.end();
}

/** persistent-reset data wipe: database rows go, container + volume stay. */
async function dropAndRecreatePersistentDb(admin: pg.Client, cfg: PersistentConfig): Promise<void> {
  // WHY print first: persistent-reset destroys data by design; the operator
  // sees exactly what goes (database rows) and what stays (container+volume).
  log(`persistent-reset will DESTROY: every row in database '${DB_NAME}' on container '${cfg.container}' (container + volume '${cfg.volume}' are KEPT).`);
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB_NAME} OWNER ${ROLE}`);
  log(`database '${DB_NAME}' dropped + recreated (container + volume kept)`);
}

/** Last line group of every persistent run: routable facts only, never values. */
function printPersistentCard(base: string, cfg: PersistentConfig): void {
  log('— persistent connection card —');
  log(`endpoint: ${base}`);
  log(`database: host=127.0.0.1 port=${cfg.port} name=${DB_NAME}`);
  log(`storage : container=${cfg.container} volume=${cfg.volume}`);
  log(`secrets : ${cfg.envFile} (values never printed)`);
}

/** Boot the repo server in sanctioned scratch mode; shared by both flows. */
async function bootServer(databaseUrl: string, jwtSecret: string): Promise<{ base: string; child: ChildProcess; killChild: () => void }> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: ROOT,
    env: { ...process.env, B17_SCRATCH_OPT_IN: 'YES', JWT_SECRET: jwtSecret, DATABASE_URL: databaseUrl, NODE_ENV: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const killChild = () => { try { child.kill(); } catch { /* already gone */ } };
  process.on('exit', killChild);
  let out = '';
  const base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server start timeout; output:\n${out}`)), 90000);
    const onData = (buf: Buffer) => {
      out += buf.toString();
      const m = out.match(/running on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); }
      const fatal = out.match(/Fatal server startup error:[\s\S]*/);
      if (fatal) { clearTimeout(timer); reject(new Error(fatal[0])); }
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code} before listen; output:\n${out}`)); });
  });
  log('server booted (scratch mode, Vite dev SPA):', base);
  return { base, child, killChild };
}

async function persistentMain(cmd: 'persistent' | 'persistent-reset', wipe: boolean, creds: ReturnType<typeof requireEnv>): Promise<void> {
  if (cmd === 'persistent-reset' && !wipe)
    die(`'persistent-reset' destroys ALL data in database '${DB_NAME}' — re-run as: npm run showcase -- persistent-reset --wipe`);
  if (cmd === 'persistent' && wipe)
    die(`'persistent' never accepts --wipe (that would risk the shared DB) — use 'persistent-reset --wipe' to rebuild data.`);
  const cfg = resolvePersistentConfig();
  const containerExists = persistentContainerExists(cfg);
  if (containerExists) await adoptPersistentContainer(cfg);
  else if (await isPortListening('127.0.0.1', cfg.port)) // WHY probe before secrets: a doomed run must not persist anything
    die(`port 127.0.0.1:${cfg.port} is already in use — refusing to silently pick another port. Free it and re-run (or point B17_PERSISTENT_PORT at a throwaway for verification).`);
  const secrets = ensurePersistentSecrets(cfg, containerExists);
  if (!containerExists) await createPersistentContainer(cfg, secrets.pgPassword);
  const admin = await waitPg(cfg.port, secrets.pgPassword);
  if (cmd === 'persistent-reset') await dropAndRecreatePersistentDb(admin, cfg);
  await ensurePersistentRoleAndDb(admin, secrets.rolePassword);
  process.env.DATABASE_URL = secrets.databaseUrl; // in-memory only; replaces any ambient value
  await migrate(creds.griCsv, ESG_CSV);

  const { base, child, killChild } = await bootServer(secrets.databaseUrl, secrets.jwtSecret);
  log(`persistent database: 127.0.0.1:${cfg.port}/${DB_NAME} (container=${cfg.container} volume=${cfg.volume})`);
  try {
    await seed(base, creds);
  } catch (err: any) {
    killChild();
    die(err?.message ?? String(err));
  }
  printPersistentCard(base, cfg);
  await serve(base, child);
}

async function serve(base: string, child: ChildProcess): Promise<void> {
  log('showcase is running - press Ctrl+C to stop.');
  log(`SHOWCASE_URL=${base}`); // required final line for the operator
  await new Promise<void>(resolve => {
    const stop = () => { try { child.kill(); } catch { /* already gone */ } resolve(); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    child.on('exit', code => { log(`server process exited (code=${code})`); resolve(); });
  });
}

async function main(): Promise<void> {
  process.chdir(ROOT);
  const args = process.argv.slice(2);
  const cmd = args.find(a => !a.startsWith('-')) ?? 'up';
  const wipe = args.includes('--wipe') || cmd === 'reset';
  if (cmd !== 'up' && cmd !== 'reset' && cmd !== 'persistent' && cmd !== 'persistent-reset')
    die(`unknown subcommand '${cmd}' — usage: npm run showcase [up|reset|persistent|persistent-reset] [--wipe]`);
  const creds = requireEnv();

  if (cmd === 'persistent' || cmd === 'persistent-reset') return persistentMain(cmd, wipe, creds);

  if (wipe) {
    try { docker('rm', '-f', CONTAINER); log('wiped container', CONTAINER); }
    catch { /* not present */ }
  }
  const { port, pgPassword } = await ensureContainer();
  const admin = await waitPg(port, pgPassword);
  const databaseUrl = await ensureRoleAndDb(admin, pgPassword, port);
  process.env.DATABASE_URL = databaseUrl; // in-memory only; replaces any ambient value
  await migrate(creds.griCsv, ESG_CSV);

  const jwtSecret = randomBytes(32).toString('hex'); // never logged, never written
  const { base, child, killChild } = await bootServer(databaseUrl, jwtSecret);

  try {
    await seed(base, creds);
  } catch (err: any) {
    killChild();
    die(err?.message ?? String(err));
  }
  await serve(base, child);
}

main().catch(err => die(err?.message ?? String(err)));
