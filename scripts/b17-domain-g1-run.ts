// Own PG18 lifecycle only. No pull/install, ambient DSN, shared volume or .env.
import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import pg from 'pg';

if (!process.argv.includes('--allow-disposable-b17')) throw new Error('Explicit opt-in required');
if (existsSync('.env') || process.env.DATABASE_URL || process.env.JWT_SECRET
  || Object.keys(process.env).some(k => /^PG(HOST|PORT|USER|PASSWORD|DATABASE|SERVICE)/.test(k)))
  throw new Error('Refusing ambient database configuration/.env');
const previous=['b17-domain-proof.ts','b17-domain-c-proof.ts','b17-domain-d-proof.ts','b17-domain-e1.ts','b17-domain-e2.ts',
  'b17-domain-e2b.ts','b17-domain-e2c.ts','b17-domain-f1.ts','b17-domain-f2.ts','b17-domain-f3.ts','b17-workspace-proof.ts'];
const selected=process.argv.find(arg=>arg.startsWith('--only='))?.slice('--only='.length);
if (selected && !previous.includes(selected)) throw new Error('Only enumerated safe previous proofs may run');
const proofs=selected?[selected]:process.argv.includes('--previous') ? previous : ['b17-domain-g1-proof.ts'];
const name=`b17-u2g-g1-${Date.now()}-${randomBytes(4).toString('hex')}`;
const password=randomBytes(32).toString('hex');
function docker(...args:string[]) {
  try { return execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim(); }
  catch { throw new Error('Owned scratch Docker operation failed; command/credentials withheld'); }
}
let started=false;
try {
  docker('run','--pull=never','--detach','--rm','--name',name,'-e',`POSTGRES_PASSWORD=${password}`,
    '-p','127.0.0.1::5432','postgres:18');started=true;
  const binding=docker('port',name,'5432/tcp');
  if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('Unexpected binding');
  const port=Number(binding.split(':')[1]);
  let admin:pg.Client|undefined;
  for (let i=0;i<60;i++) {
    const c=new pg.Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'});
    try { await c.connect();admin=c;break; }
    catch { await c.end().catch(() => {});await new Promise(r => setTimeout(r,250)); }
  }
  if (!admin) throw new Error('Owned PG18 unavailable');
  try {
    for (const role of ['b17domainowner','b17domainoutsider']) await admin.query(`CREATE ROLE ${role}
      LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
    for (const [i,proof] of proofs.entries()) {
      const db=`b17_u2g_g1_scratch_${Date.now()}_${i}`;
      await admin.query(`CREATE DATABASE ${db} OWNER b17domainowner`);
      console.log(`RUN ${proof} on OWN fresh ${db}`);
      const url=`postgres://b17domainowner:${password}@127.0.0.1:${port}/${db}`;
      const oracle=`postgres://postgres:${password}@127.0.0.1:${port}/${db}`;
      const code=await new Promise<number|null>((resolve,reject) => {
        const child=spawn(process.execPath,['--import','tsx',`scripts/${proof}`,'--allow-disposable-b17',
          `--database-url=${url}`,`--oracle-url=${oracle}`],
        {stdio:'inherit',env:{...process.env,DATABASE_URL:'',JWT_SECRET:''}});
        child.once('error',reject);child.once('exit',resolve);
      });
      if (code!==0) throw new Error(`Proof failed: ${proof} (exit ${code})`);
    }
    console.log(`COMPLETED ${proofs.length} owned scratch proof(s)`);
  } finally { await admin.end(); }
} finally { if (started) { docker('stop',name);console.log('Owned scratch container removed'); } }
