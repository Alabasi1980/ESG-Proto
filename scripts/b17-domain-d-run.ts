// Local test orchestration only. Creates/removes ONLY its own fresh container.
// Generated fixture credentials stay in memory; no .env or ambient DSN reads.
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import pg from 'pg';

if (!process.argv.includes('--allow-disposable-b17')) throw new Error('Explicit opt-in required');
if (existsSync('.env') || process.env.DATABASE_URL || Object.keys(process.env).some(k => /^PG(HOST|PORT|USER|PASSWORD|DATABASE|SERVICE)/.test(k)))
  throw new Error('Refusing ambient database configuration/.env');
const name = `b17-u2d-unit-${Date.now()}`, password = randomBytes(32).toString('hex');
const docker = (...args: string[]) => execFileSync('docker', args, { encoding:'utf8',stdio:['pipe','pipe','pipe'] }).trim();
const proofs = process.argv.includes('--regressions')
  ? ['b17-domain-proof.ts','b17-domain-c-proof.ts','b17-workspace-proof.ts'] : ['b17-domain-d-proof.ts'];
let started = false;
try {
  docker('run','--detach','--rm','--name',name,'-e',`POSTGRES_PASSWORD=${password}`,'-p','127.0.0.1::5432','postgres:18'); started = true;
  const binding = docker('port',name,'5432/tcp');
  if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('Unexpected non-loopback binding');
  const port = binding.split(':')[1];
  let admin: pg.Client | undefined;
  for (let i=0;i<60;i++) {
    const c = new pg.Client({ host:'127.0.0.1',port:Number(port),user:'postgres',password,database:'postgres' });
    try { await c.connect(); admin = c; break; }
    catch { await c.end().catch(() => {}); await new Promise(resolve => setTimeout(resolve,500)); }
  }
  if (!admin) throw new Error('Scratch PG18 unavailable');
  try {
    await admin.query(`CREATE ROLE b17domainowner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    await admin.query(`CREATE ROLE b17domainoutsider LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    for (const [i,proof] of proofs.entries()) {
      const db = `b17_domain_d_scratch_${i}_${Date.now()}`;
      await admin.query(`CREATE DATABASE ${db} OWNER b17domainowner`);
      const url = `postgres://b17domainowner:${password}@127.0.0.1:${port}/${db}`;
      const code = await new Promise<number | null>((resolve,reject) => {
        const args = ['--import','tsx',`scripts/${proof}`,'--allow-disposable-b17',`--database-url=${url}`];
        if (proof === 'b17-domain-d-proof.ts') args.push(`--oracle-url=postgres://postgres:${password}@127.0.0.1:${port}/${db}`);
        const child = spawn(process.execPath,args,
          { stdio:'inherit',env:{ ...process.env,DATABASE_URL:'',JWT_SECRET:'' } });
        child.on('error',reject); child.on('exit',resolve);
      });
      if (code !== 0) throw new Error(`Proof failed: ${proof}, exit ${code}`);
    }
  } finally { await admin.end(); }
} finally { if (started) docker('stop',name); }
