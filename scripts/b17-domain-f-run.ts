// Local test orchestration ONLY for B17 U2-F (task §5 evidence), rounds 1+2.
// Creates/removes ONLY its own disposable PG18 container; every proof gets a
// FRESH named loopback b17_*scratch* database owned by a NOSUPERUSER/
// NOBYPASSRLS role (plus the b17domainoutsider role d-proof needs). Generated
// credentials stay in memory; no .env or ambient DSN reads (the spawned
// children get DATABASE_URL/JWT_SECRET emptied).
//
//   node --import tsx scripts/b17-domain-f-run.ts --allow-disposable-b17
//   node --import tsx scripts/b17-domain-f-run.ts --allow-disposable-b17 --regressions
//   node --import tsx scripts/b17-domain-f-run.ts --allow-disposable-b17 --all
//
// Default = the three U2-F proofs (f1: 22-row matrix + MUST-FIX 1/4, f2:
// progress oracle + MUST-FIX 2 + unlink/NA/staff/suspend, f3: the round-2
// provisioning triple + lock-order/OTP/all-or-nothing). --regressions = the
// workspace/domain/c/d/e1/e2 proofs re-run green AFTER the final flips (their
// flip expectations were updated in-unit).
// scripts/b17-scope-proof.ts is NEVER run here: it contains a
// `DELETE FROM assignments` against shared fixtures (task evidence rule).
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import pg from 'pg';

if (!process.argv.includes('--allow-disposable-b17')) throw new Error('Explicit opt-in required');
if (existsSync('.env') || process.env.DATABASE_URL || Object.keys(process.env).some(k => /^PG(HOST|PORT|USER|PASSWORD|DATABASE|SERVICE)/.test(k)))
  throw new Error('Refusing ambient database configuration/.env');

const ROUND1 = ['b17-domain-f1.ts', 'b17-domain-f2.ts', 'b17-domain-f3.ts'];
const REGRESSIONS = ['b17-domain-proof.ts', 'b17-domain-c-proof.ts', 'b17-domain-d-proof.ts',
  'b17-domain-e1.ts', 'b17-domain-e2.ts', 'b17-domain-e2b.ts', 'b17-domain-e2c.ts',
  'b17-workspace-proof.ts'];
// A bare `<name>.ts` argument runs exactly that one proof (fresh scratch each run).
const only = process.argv.slice(2).find(a => a.endsWith('.ts') && !a.startsWith('-'));
if (only && ![...ROUND1, ...REGRESSIONS].includes(only))
  throw new Error('Only the enumerated non-destructive proofs may run (scope DELETE script is forbidden).');
const proofs = only ? [only]
  : process.argv.includes('--all') ? [...ROUND1, ...REGRESSIONS]
  : process.argv.includes('--regressions') ? REGRESSIONS : ROUND1;

const name = `b17-u2f-${Date.now()}`, password = randomBytes(32).toString('hex');
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
let started = false;
try {
  docker('run', '--detach', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`,
    '-p', '127.0.0.1::5432', 'postgres:18');
  started = true;
  const binding = docker('port', name, '5432/tcp');
  if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('Unexpected non-loopback binding');
  const port = binding.split(':')[1];
  let admin: pg.Client | undefined;
  for (let i = 0; i < 60; i++) {
    const c = new pg.Client({ host: '127.0.0.1', port: Number(port), user: 'postgres', password, database: 'postgres' });
    try { await c.connect(); admin = c; break; }
    catch { await c.end().catch(() => {}); await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!admin) throw new Error('Scratch PG18 unavailable');
  try {
    await admin.query(`CREATE ROLE b17domainowner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    // b17-domain-d-proof's isolated OUTSIDER (second non-bypass role: effective
    // policy checks + refusal/recovery probes) — same as scripts/b17-domain-d-run.ts.
    await admin.query(`CREATE ROLE b17domainoutsider LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    for (const [i, proof] of proofs.entries()) {
      const db = `b17_u2f_scratch_${i}_${Date.now()}`;
      await admin.query(`CREATE DATABASE ${db} OWNER b17domainowner`);
      const url = `postgres://b17domainowner:${password}@127.0.0.1:${port}/${db}`;
      // Same-scratch ORACLE (postgres superuser, same host/port/db): COUNTS
      // ONLY — under FORCE RLS the app pool sees no tenant rows without a
      // server-selected context, so a census measured there would be vacuous.
      // Proofs that ignore the flag are unaffected; f1/f2/d-proof require it.
      const oracle = `postgres://postgres:${password}@127.0.0.1:${port}/${db}`;
      console.log(`RUN ${proof} -> ${db}`);
      const code = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', `scripts/${proof}`, '--allow-disposable-b17',
          `--database-url=${url}`, `--oracle-url=${oracle}`],
          { stdio: 'inherit', env: { ...process.env, DATABASE_URL: '', JWT_SECRET: '' } });
        child.on('error', reject); child.on('exit', resolve);
      });
      if (code !== 0) throw new Error(`Proof failed: ${proof}, exit ${code}`);
    }
    console.log(`ALL GREEN: ${proofs.length} proof(s)`);
  } finally { await admin.end(); }
} finally { if (started) docker('stop', name); }
