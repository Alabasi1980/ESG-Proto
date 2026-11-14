// Real dispatcher/handlers + nonbypass PG18 FORCE RLS. Fresh loopback scratch
// only, fixture INSERTs and API operations on those fixtures; never live/.env.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import { getPool, runMigrations, withTenantContext, setTenantContext } from '../src/db/index.ts';
import { applyB17Offline, assertB17Ready, verifyB17Content, STRUCTURE_SQL, B17_CONTENT_SHAPE } from '../src/db/b17Readiness.ts';
import { inventoryB17ContentOffline, applyB17ContentOffline } from '../src/db/b17ContentMigration.ts';
import apiRouter from '../src/server/routes.ts';
import { jsonInput } from '../src/server/jsonInput.ts';
import { globalJsonErrorHandler } from '../src/server/errorHandler.ts';
import { LEGACY_ROUTES } from '../src/server/accessRegistry.ts';
import { activeBusinessCapabilities } from '../src/lib/capabilities.ts';
import { calculateEsgProfileScore } from '../src/lib/esgProfile.ts';
import { indexToCSV } from '../src/lib/reports.ts';
import { seedDomainD } from './b17-domain-d-fixture.ts';

function guardedUrl() {
  const args = process.argv.slice(2), urls = args.filter(a => a.startsWith('--database-url='));
  if (!args.includes('--allow-disposable-b17') || urls.length !== 1 || existsSync('.env') || process.env.DATABASE_URL)
    throw new Error('Explicit empty-ambient disposable opt-in required');
  const url = new URL(urls[0].slice(15));
  if (!['postgres:','postgresql:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)
    || !/^\/b17_[a-z0-9_]*scratch[a-z0-9_]*$/.test(url.pathname) || url.search || url.hash || !url.username || url.username === 'postgres')
    throw new Error('Only named loopback scratch owner accepted');
  const oracleArgs = args.filter(a => a.startsWith('--oracle-url='));
  if (oracleArgs.length !== 1) throw new Error('Explicit same-scratch preservation oracle required');
  const oracle = new URL(oracleArgs[0].slice(13));
  if (oracle.protocol !== url.protocol || oracle.hostname !== url.hostname || oracle.port !== url.port
    || oracle.pathname !== url.pathname || oracle.username !== 'postgres' || oracle.search || oracle.hash)
    throw new Error('Oracle must target the exact same loopback scratch');
  return { owner:url.toString(),oracle:oracle.toString() };
}
const urls = guardedUrl();
process.env.DATABASE_URL = urls.owner;
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.B17_SCRATCH_OPT_IN = 'YES';
const pass = (message: string) => console.log(`PASS ${message}`);

// Independent CSV syntax decoder; no spreadsheet engine/evaluation involved.
function csvCells(csv: string): string[][] {
  const rows: string[][] = [];
  let row = [''], quoted = false;
  for (let i=0;i<csv.length;i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i+1] === '"') { row[row.length-1] += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && ch === ',') row.push('');
    else if (!quoted && ch === '\n') { rows.push(row); row = ['']; }
    else row[row.length-1] += ch;
  }
  assert.equal(quoted,false); rows.push(row); return rows;
}

async function main() {
  const pool = getPool(), oracle = new pg.Client({ connectionString:urls.oracle });
  await oracle.connect();
  const role = (await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert.deepEqual(role,{ rolsuper:false,rolbypassrls:false });
  assert.equal(Math.floor(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num)/10000),18);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
  assert.equal((await runMigrations()).success,true);
  const seed = await seedDomainD(), { tenants:t,services:s,users:u } = seed;
  const protectedTables = ['client_services','service_standards','assignments','answers','evaluations','review_snapshots','snapshot_notes','evidence_attachments'];
  const census = async () => {
    const result: Record<string,unknown> = {};
    for (const table of protectedTables) result[table] = (await oracle.query(`SELECT coalesce(jsonb_agg(r ORDER BY r::text),'[]') rows FROM (SELECT to_jsonb(t) r FROM ${table} t) q`)).rows[0].rows;
    return result;
  };
  const c = await pool.connect();
  try {
    assert.equal(await applyB17Offline(c),'applied');
    const inventory = await inventoryB17ContentOffline(c,seed.targets,seed.sources);
    assert.equal(await applyB17ContentOffline(c,inventory,seed.sources),'applied');
    assert.equal(await applyB17ContentOffline(c,inventory,seed.sources),'verified');
  } finally { c.release(); }
  await assertB17Ready();
  assert.equal((await pool.query(STRUCTURE_SQL)).rows[0].checksum,B17_CONTENT_SHAPE);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace
    AND relrowsecurity AND NOT relforcerowsecurity`)).rows[0].n,0);
  const before = await census();
  pass('D0 fresh loopback PG18, non-superuser/NOBYPASSRLS owner, FORCE RLS, both offline versions twice safe');

  assert.equal(LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED').length,25);
  assert.ok(LEGACY_ROUTES.filter(r => ['initiatives','reports'].includes(r.capability)).every(r => r.activation === 'U1'));
  assert.deepEqual(activeBusinessCapabilities(),['taxonomy','gri','evaluations','actions','initiatives','reports','storage','audit','notifications']);
  const app = express(); app.use(jsonInput,cookieParser()); app.use('/api',apiRouter); app.use(globalJsonErrorHandler);
  const server = app.listen(0,'127.0.0.1'); await new Promise<void>(resolve => server.once('listening',resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  type Ctx = { token:string;tabHandle?:string;generation?:number };
  const contexts: Record<string,Ctx> = {};
  const allowed = new Set<string>();
  async function request(who: string, method: string, path: string, body?: unknown, expected?: number) {
    const ctx = contexts[who], headers: Record<string,string> = { 'Content-Type':'application/json' };
    if (ctx) headers.Authorization = `Bearer ${ctx.token}`;
    if (ctx?.tabHandle) { headers['X-Workspace-Tab'] = ctx.tabHandle; headers['X-Workspace-Version'] = String(ctx.generation); }
    const response = await fetch(base+path,{ method,headers,...(body === undefined ? {} : { body:JSON.stringify(body) }) });
    const text = await response.text(); let data: any;
    try { data = JSON.parse(text); } catch { data = text; }
    if (expected !== undefined) assert.equal(response.status,expected,`${who} ${method} ${path.split('?')[0]}: ${text.slice(0,400)}`);
    assert.ok(!text.includes('invalid input syntax') && !text.includes(' at Parser.') && !text.includes('password_hash'),'no raw PG/credential leakage');
    if (response.status >= 200 && response.status < 300) {
      const declaration = matrix.find(row => row[0] === method && new RegExp('^'+row[1].replace(':id','[^/]+')+'$').test(path.split('?')[0]));
      if (declaration) allowed.add(`${who}:${method}:${declaration[1]}`);
    }
    return { status:response.status,data,text };
  }
  const matrix: [string,string,string[]][] = [
    ['GET','/initiatives',['P','W','C']],['POST','/initiatives',['P']],['PATCH','/initiatives/:id',['P']],
    ['POST','/initiatives/select',['W']],['DELETE','/initiatives/select/:id',['W']],
    ['POST','/esg-profile/import',['P']],['GET','/esg-profile',['W','C']],
    ['GET','/report-settings',['P','W','C']],['PUT','/report-settings',['P']],
    ['GET','/reports/index',['W','C']],['GET','/reports/export',['W','C']],
  ];
  try {
    for (const name of ['ge','cA','cB','cZ','cH','cF','eA']) {
      const login = await request('', 'POST','/auth/login',{ email:`${name}@domain-d.invalid`,password:seed.password },200);
      contexts[name] = { token:login.data.token };
    }
    contexts.C = contexts.cA; contexts.E = contexts.eA;
    for (const [name,tenant] of [['P',null],['W',t.A],['WB',t.B],['WZ',t.Z],['WH',t.H],['WF',t.F]] as const) {
      contexts[name] = { token:contexts.ge.token };
      const tab = await request(name,'POST','/workspace/tab',{},201);
      Object.assign(contexts[name],tab.data);
      if (tenant) { const enter = await request(name,'POST','/workspace/enter',{ clientId:tenant },200); contexts[name].generation = enter.data.generation; }
    }
    const deniedBefore = await census();
    for (const [method,path,yes] of matrix) for (const who of ['P','W','C','E','anon']) if (!yes.includes(who)) {
      const r = await request(who,method,path.replace(':id',randomUUID()),method === 'GET' || method === 'DELETE' ? undefined : {},who === 'anon' ? 401 : 403);
      assert.equal(r.data.code,who === 'anon' ? 'auth.invalid' : 'workspace.mode_mismatch');
    }
    assert.deepEqual(await census(),deniedBefore);
    contexts.noTab = { token:contexts.ge.token };
    for (const [method,path] of matrix) await request('noTab',method,path.replace(':id',randomUUID()),
      ['GET','DELETE'].includes(method) ? undefined : {},409);
    pass('D1 all eleven denied-context matrix (P/W/C/E/anonymous) via actual dispatcher/wrapper, no side effects');

    const create = async (title: string, serviceIds: string[]) => (await request('P','POST','/initiatives',{ title,sector:'Fixture',serviceIds },201)).data.initiative.id as string;
    const selected = await create('Selected linked',[s.GRI,s.S2]), unselected = await create('Unselected linked',[s.GRI]);
    const unlinked = await create('Selected unlinked',[s.UNLINKED]), unmapped = await create('No mapping',[]);
    assert.equal((await request('P','POST','/initiatives',{ title:'Selected linked',sector:'Fixture',serviceIds:[s.GRI,s.S2] },200)).data.created,false);
    await request('P','PATCH',`/initiatives/${unselected}`,{ notes:'Definition edit',serviceIds:[s.GRI] },200);
    // Deliberate fixture-only legacy selections for A/B on unlinked/mapped rows.
    await oracle.query('INSERT INTO client_initiatives(client_id,initiative_id,selected_by) VALUES($1,$2,$3),($1,$4,$3),($5,$2,$3)', [t.A,unlinked,u.ge,unmapped,t.B]);
    await request('W','POST','/initiatives/select',{ initiativeId:selected,clientId:t.A },200);
    assert.equal((await request('W','POST','/initiatives/select',{ initiativeId:selected },200)).data.alreadySelected,true);
    const ciBefore = (await oracle.query('SELECT * FROM client_initiatives ORDER BY id')).rows;
    for (const who of ['W','C']) {
      const list = (await request(who,'GET','/initiatives',undefined,200)).data;
      assert.deepEqual(list.items.map((r: any) => r.id),[selected]); assert.equal(list.count,1); assert.equal(list.items[0].selected,true);
      assert.equal((await request(who,'GET','/initiatives?search=Unselected',undefined,200)).data.count,0);
    }
    const eligible = (await request('W','GET','/initiatives?view=eligible',undefined,200)).data.items;
    assert.deepEqual(eligible.map((r:any) => r.id).sort(),[selected,unselected].sort());
    assert.equal(eligible.find((r:any) => r.id === unselected).selected,false);
    for (const view of ['eligible','library']) await request('C','GET',`/initiatives?view=${view}`,undefined,403);
    await request('W','GET','/initiatives?view=library',undefined,403);
    await request('P','GET','/initiatives',undefined,200);
    await request('P','PATCH',`/initiatives/${selected}`,{ notes:'Library only' },200);
    assert.deepEqual((await oracle.query('SELECT * FROM client_initiatives ORDER BY id')).rows,ciBefore);
    for (const id of [unlinked,unmapped,randomUUID()]) await request('W','POST','/initiatives/select',{ initiativeId:id },404);
    await request('W','POST','/initiatives/select',{ initiativeId:unselected,clientId:t.B },403);
    await request('W','DELETE',`/initiatives/select/${selected}?clientId=${t.B}`,undefined,403);
    await request('W','DELETE',`/initiatives/select/${selected}`,undefined,200);
    await request('W','DELETE',`/initiatives/select/${selected}`,undefined,404);
    assert.equal((await oracle.query('SELECT count(*)::int n FROM client_initiatives WHERE client_id=$1 AND initiative_id=$2',[t.B,unlinked])).rows[0].n,1);
    await request('W','POST','/initiatives/select',{ initiativeId:selected },200);
    await request('WF','POST','/initiatives/select',{ initiativeId:selected },409);
    await request('WF','DELETE',`/initiatives/select/${selected}`,undefined,409);
    assert.equal((await request('WZ','GET','/initiatives?view=eligible',undefined,200)).data.count,0);
    for (const value of [[s.GRI,s.GRI],['bad-id'],[s.GRI,randomUUID()]]) {
      const expected = value[1] && value[1] !== s.GRI ? 404 : 400;
      await request('P','POST','/initiatives',{ title:'Must roll back',sector:'Fixture',serviceIds:value },expected);
    }
    assert.equal((await oracle.query("SELECT count(*)::int n FROM initiatives_library WHERE title='Must roll back'")).rows[0].n,0);
    // QA F1 / round-3 ruling: exact AND case-variant serviceIds duplicates ->
    // 400 scope.duplicate_id BEFORE any business SQL (pg.Client instrumented),
    // no partial write; DISTINCT unknown ids keep 404 after their SQL path.
    assert.notEqual(s.S2, s.S2.toUpperCase(), 'case-variant fixture must differ by case');
    const dupTitle = 'DUP-ROL3';
    const dupRowsBefore = (await oracle.query('SELECT count(*)::int n FROM initiatives_library WHERE title=$1',[dupTitle])).rows[0].n;
    const originalClientQuery = (pg.Client.prototype as any).query;
    let businessSql = 0;
    (pg.Client.prototype as any).query = function (this: unknown, ...args: any[]) {
      const text = typeof args[0] === 'string' ? args[0] : String(args[0]?.text ?? '');
      if (/initiatives_library|service_initiatives/.test(text)) businessSql++;
      return (originalClientQuery as any).apply(this, args);
    };
    try {
      const caseDup = await request('P','POST','/initiatives',{ title:dupTitle, sector:'Fixture', serviceIds:[s.S2, s.S2.toUpperCase()] },400);
      assert.equal(caseDup.data.code,'scope.duplicate_id');
      const exactDup = await request('P','POST','/initiatives',{ title:dupTitle, sector:'Fixture', serviceIds:[s.GRI,s.GRI] },400);
      assert.equal(exactDup.data.code,'scope.duplicate_id');
      const patchCaseDup = await request('P','PATCH',`/initiatives/${selected}`,{ serviceIds:[s.S2, s.S2.toUpperCase()] },400);
      assert.equal(patchCaseDup.data.code,'scope.duplicate_id');
      assert.equal(businessSql,0,'duplicate serviceIds must execute zero business SQL statements');
    } finally { (pg.Client.prototype as any).query = originalClientQuery; }
    const distinctUnknown = await request('P','POST','/initiatives',{ title:dupTitle, sector:'Fixture', serviceIds:[s.GRI,randomUUID()] },404);
    assert.equal(distinctUnknown.data.code,'scope.not_found');
    assert.equal((await oracle.query('SELECT count(*)::int n FROM initiatives_library WHERE title=$1',[dupTitle])).rows[0].n,dupRowsBefore,
      'duplicate + unknown-distinct refusals leave no partial initiative write');
    pass('F1/QA round 3: case-insensitive + exact duplicate serviceIds -> 400 scope.duplicate_id before any business SQL; unknown DISTINCT -> 404; no partial write');
    const definitionBefore = (await oracle.query('SELECT * FROM initiatives_library WHERE id=$1',[selected])).rows[0];
    await request('P','PATCH',`/initiatives/${selected}`,{ title:'Must roll back patch',serviceIds:[s.GRI,randomUUID()] },404);
    assert.deepEqual((await oracle.query('SELECT * FROM initiatives_library WHERE id=$1',[selected])).rows[0],definitionBefore);
    pass('D2 library/mapping atomic/idempotent; W eligible own selections; C selected+linked only; empty/unlinked/filters/freeze/mismatch');

    const profileBody = { clientId:t.A,serviceId:s.GRI,rows:[{ pillar:'New',department:'One',topic:'Topic',parameter:'Parameter',profileRating:1 }] };
    const griBefore = (await request('W','GET',`/reports/index?serviceId=${s.GRI}&level=L3`,undefined,200)).data;
    const imported = (await request('P','POST','/esg-profile/import',profileBody,200)).data;
    assert.equal(imported.inserted,1);
    const profileId = (await oracle.query("SELECT id FROM esg_profile WHERE client_id=$1 AND pillar='New'",[t.A])).rows[0].id;
    const repeat = (await request('P','POST','/esg-profile/import',profileBody,200)).data;
    assert.equal(repeat.inserted,0); assert.equal(repeat.updated,1);
    assert.equal((await oracle.query("SELECT id FROM esg_profile WHERE client_id=$1 AND pillar='New'",[t.A])).rows[0].id,profileId);
    for (const who of ['W','C']) {
      const result = (await request(who,'GET',`/esg-profile?serviceId=${s.GRI}`,undefined,200)).data;
      assert.equal(result.rows.length,2); assert.deepEqual({ ...result,rows:undefined },{ ...calculateEsgProfileScore(result.rows),rows:undefined });
    }
    assert.deepEqual((await request('W','GET',`/reports/index?serviceId=${s.GRI}&level=L3`,undefined,200)).data,griBefore);
    await request('P','POST','/esg-profile/import',{ ...profileBody,serviceId:s.UNLINKED },403);
    await request('P','POST','/esg-profile/import',{ ...profileBody,serviceId:s.S2 },409);
    await request('P','POST','/esg-profile/import',{ ...profileBody,rows:[profileBody.rows[0],{}] },400);
    await request('P','POST','/esg-profile/import',{ ...profileBody,rows:[{ ...profileBody.rows[0],profileRating:4 }] },400);
    const frozenProfile = (await request('P','POST','/esg-profile/import',{ ...profileBody,clientId:t.F },200)).data;
    assert.equal(frozenProfile.skippedFrozen,1);
    assert.equal((await request('WZ','GET','/esg-profile',undefined,200)).data.rows.length,0);
    await request('W','GET','/esg-profile',undefined,400);
    await request('W','GET',`/esg-profile?clientId=${t.B}&serviceId=${s.GRI}`,undefined,403);
    pass('D3 explicit linked Profile import/repeat/natural-key identity/freeze, W/C read DD-02 independent of GRI');

    const setting = { clientId:t.A,serviceId:s.GRI,disclosureLevel:'in-accordance',reportLevel:'L3',statementName:'Original statement',
      statementPeriod:'2026',notified:'done',notifiedDate:'2026-11-12',notifyRef:'Original reference' };
    for (const who of ['P','W','C']) {
      const q = who === 'P' ? `&clientId=${t.A}` : '';
      const settings = (await request(who,'GET',`/report-settings?serviceId=${s.GRI}${q}`,undefined,200)).data.settings;
      assert.equal(settings.id,seed.report); assert.equal(settings.notified_date,'2026-11-12');
    }
    assert.equal((await request('P','PUT','/report-settings',setting,200)).data.settings.id,seed.report);
    await request('P','PUT','/report-settings',{ ...setting,reportLevel:'invalid' },409);
    await request('P','PUT','/report-settings',{ ...setting,statementName:'' },409);
    await request('P','PUT','/report-settings',{ ...setting,serviceId:s.UNLINKED },403);
    await request('P','PUT','/report-settings',{ ...setting,clientId:randomUUID() },404);
    await request('W','GET','/report-settings',undefined,400);
    await request('P','GET','/report-settings',undefined,400);
    for (const service of [s.S2,s.EMPTY]) await request('W','GET',`/reports/index?serviceId=${service}&level=L3`,undefined,409);
    for (const tenant of [t.A,t.H]) await request('P','PUT','/report-settings',{ ...setting,clientId:tenant,serviceId:tenant === t.A ? s.S2 : s.GRI },200);
    // Fixture-only explicit service binding on an overlapping item: reports for
    // GRI must not include S2-owned corrective work just because it overlaps.
    await oracle.query(`INSERT INTO actions(client_id,item_id,owner_department_id,title,status,service_id)
      VALUES($1,$2,$3,'S2-specific fixture','closed',$4)`,[t.A,seed.scored,seed.departments.A,s.S2]);
    await request('P','PUT','/report-settings',{ ...setting,serviceId:s.EMPTY },200);
    const emptyReport = (await request('W','GET',`/reports/index?serviceId=${s.EMPTY}&level=L3`,undefined,200)).data;
    assert.deepEqual(emptyReport.index,[]); assert.equal(emptyReport.aggregate.totalCount,0);
    for (const who of ['W','C']) {
      const payloads = [];
      for (const level of ['L1','L2','L3']) {
        const index = (await request(who,'GET',`/reports/index?serviceId=${s.GRI}&level=${level}`,undefined,200)).data;
        const json = (await request(who,'GET',`/reports/export?serviceId=${s.GRI}&level=${level}`,undefined,200)).data;
        assert.deepEqual(index,json); payloads.push(index);
        assert.equal(index.aggregate.totalCount,5); assert.equal(index.aggregate.applicableCount,4);
        assert.equal(index.aggregate.evaluatedCount,1); assert.equal(index.aggregate.aggregateScore,50); assert.equal(index.aggregate.coveragePercentage,25);
        assert.equal(index.index.find((r:any) => r.disclosureCode === 'D-OK').score,50);
        assert.deepEqual(index.actions.byStatus,{ open:1 });
        assert.ok(!JSON.stringify(index).includes('D-AUTHORISED-BAD')); assert.ok(!JSON.stringify(index).includes('D-FOREIGN-SECRET-CODE'));
        const csv = (await request(who,'GET',`/reports/export?serviceId=${s.GRI}&level=${level}&format=csv`,undefined,200)).text;
        assert.equal(csv,indexToCSV(index.index));
        // SHIELD-U2DR-01: actual handler output, checked independently of the
        // encoder. JSON is still the original report text, CSV adds only the
        // literal marker while preserving quotes/commas/CRLF within each cell.
        const ok = index.index.find((r:any) => r.disclosureCode === 'D-OK');
        assert.equal(ok.standardTitle,seed.csvText.standardTitle);
        assert.equal(ok.disclosureTitle,seed.csvText.disclosureTitle);
        // Disclosure rows de-duplicate per item by FIRST row, ordered by random
        // fixture department UUIDs: the surviving D-SCORE department row may or
        // may not carry the answer. Assert the security invariant independent of
        // that pick â€” location contains ONLY stored answer text, in 1 or 2 rows.
        const locationParts = ok.location.split(' | ');
        assert.ok(locationParts.length >= 1 && locationParts.every((seg: string) => seg === seed.csvText.location),
          `location must contain only stored answer text, got ${JSON.stringify(ok.location)}`);
        assert.ok(ok.departments.includes(seed.csvText.department));
        const decoded = csvCells(csv), exported = decoded.find(r => r[2] === 'D-OK')!;
        assert.equal(decoded.length,index.index.length+1);
        assert.ok(decoded.every(r => r.length === 14));
        for (const [column,raw] of [[1,ok.standardTitle],[3,ok.disclosureTitle],[4,ok.location],[13,ok.departments.join(' | ')]] as const)
          assert.equal(exported[column],`'${raw}`);
        assert.equal(exported[11],'50'); assert.equal(exported[8],'1');
        const omitted = index.index.find((r:any) => r.disclosureCode === 'D-OMITTED');
        assert.equal(omitted.omissionExplanation,seed.csvText.omissionExplanation);
        assert.equal(decoded.find(r => r[2] === 'D-OMITTED')![7],`'${seed.csvText.omissionExplanation}`);
      }
      assert.deepEqual(payloads[0].aggregate,payloads[2].aggregate);
      for (const route of ['index','export']) {
        const err = await request(who,'GET',`/reports/${route}?serviceId=${s.S2}&level=L3`,undefined,422);
        assert.deepEqual(err.data.offendingCodes,['D-AUTHORISED-BAD']); assert.ok(!err.text.includes('D-FOREIGN-SECRET-CODE'));
      }
    }
    for (const who of ['WH','cH']) {
      const hidden = (await request(who,'GET','/reports/index?level=L3',undefined,200)).data;
      for (const key of ['aggregateScore','evaluatedCount','applicableCount','coveragePercentage','notApplicableCount']) assert.equal(hidden.aggregate[key],null);
      assert.deepEqual(hidden.actions.byStatus,{}); assert.deepEqual(hidden.topGaps,[]);
      const csv = (await request(who,'GET','/reports/export?level=L3&format=csv',undefined,200)).text;
      assert.equal(csv,indexToCSV(hidden.index));
    }
    await request('W','GET',`/reports/index?serviceId=${s.UNLINKED}&level=L3`,undefined,403);
    await request('WZ','GET','/reports/index?level=L3',undefined,409);
    await request('W','GET',`/reports/index?clientId=${t.B}&serviceId=${s.GRI}&level=L3`,undefined,403);
    await request('W','GET',`/reports/index?serviceId=${s.GRI}&level=L4`,undefined,400);
    pass('D4 settings identity/date/statement/notification; L1/L2/L3 scoped numerators+denominators; JSON=CSV; 409/422 and hidden flags leak-free');
    assert.equal((await oracle.query('SELECT value FROM answers WHERE client_id=$1 AND item_id=$2',[t.A,seed.scored])).rows[0].value,seed.csvText.location);
    assert.equal((await oracle.query('SELECT justification FROM evaluations WHERE client_id=$1 AND item_id=$2',[t.A,seed.na])).rows[0].justification,seed.csvText.omissionExplanation);
    pass('D4-CSV SHIELD-U2DR-01: W/C x L1/L2/L3 handler CSV literal text with comma/quote/CRLF; typed metrics, JSON and raw DB unchanged; no spreadsheet execution');

    const invalidBefore = await census(), auditBefore = (await oracle.query('SELECT count(*)::int n FROM audit_log')).rows[0].n;
    for (const [who,method,path,body] of [
      ['P','POST','/gri/commit',{ serviceId:s.GRI,standards:[{ code:'BAD',disclosures:[] }] }],
      ['P','POST','/gri/commit',{ clientId:'bad',serviceId:s.GRI,standards:[{ code:'BAD',disclosures:[] }] }],
      ['P','PATCH','/standards/not-a-uuid',{}],['P','PATCH','/services/not-a-uuid',{}],
      ['P','DELETE','/disclosures/not-a-uuid',undefined],['P','GET','/items/not-a-uuid/links',undefined],
      ['W','GET','/items?disclosureId=bad',undefined],['W','GET','/standards?serviceId=bad',undefined],
      ['W','GET','/initiatives?clientId=bad',undefined],['W','GET',`/initiatives?serviceId=${s.GRI}&serviceId=${s.S2}`,undefined],
      ['P','PATCH','/initiatives/not-a-uuid',{}],['W','DELETE','/initiatives/select/not-a-uuid',undefined],
      ['P','POST','/esg-profile/import',{ ...profileBody,clientId:'bad' }],['P','POST','/esg-profile/import',{ ...profileBody,clientId:undefined }],
      ['P','POST','/esg-profile/import',{ ...profileBody,serviceId:undefined }],['W','GET','/esg-profile?serviceId=bad',undefined],
      ['P','PUT','/report-settings',{ ...setting,clientId:undefined }],['P','PUT','/report-settings',{ ...setting,serviceId:undefined }],
      ['C','GET','/reports/index?serviceId=bad&level=L3',undefined],['P','POST',`/items/${seed.scored}/links`,{ otherItemId:'bad' }],
    ] as [string,string,string,unknown][]) await request(who,method,path,body,400);
    assert.deepEqual(await census(),invalidBefore);
    assert.equal((await oracle.query('SELECT count(*)::int n FROM audit_log')).rows[0].n,auditBefore);
    const refusal = await request('P','DELETE',`/items/${seed.actionOnly}`,undefined,409);
    assert.match(refusal.data.error,/1 action\(s\)/);
    assert.equal((await oracle.query('SELECT item_id FROM actions WHERE id=$1',[seed.action])).rows[0].item_id,seed.actionOnly);
    assert.equal((await oracle.query('SELECT count(*)::int n FROM items WHERE id=$1',[seed.actionOnly])).rows[0].n,1);
    const throwaway = (await request('P','POST','/items',{ disclosureId:seed.disc,code:'D-THROWAWAY',requirement:'Scratch only' },201)).data;
    await request('P','DELETE',`/items/${throwaway.id}`,undefined,200);
    pass('D5 carryover: explicit T despite populated GE.clientId, malformed T/path/query 400 unchanged state/audit; actions-only DELETE refused intact');

    // Raw FORCE RLS probes use the runtime owner, not the preservation oracle.
    const config = { role:'ge_admin',mode:'platform',userId:u.ge,purpose:'platform.config',tenantId:t.A,targetId:t.A };
    const work = { role:'ge_admin',mode:'consultant',userId:u.ge,purpose:'work',tenantId:t.A };
    for (const ctx of [{},work,config]) await withTenantContext(ctx, async db => {
      const foreignProfile = await db.query('SELECT id FROM esg_profile WHERE client_id=$1',[t.B]); assert.equal(foreignProfile.rowCount,0);
      if (!('purpose' in ctx)) assert.equal((await db.query('SELECT id FROM esg_profile')).rowCount,0);
      if (ctx === config) assert.equal((await db.query('SELECT id FROM answers')).rowCount,0);
    });
    for (const sql of ["DROP POLICY b17_selection_insert ON client_initiatives",
      'GRANT EXECUTE ON FUNCTION b17_catalog_child_count(text,uuid) TO PUBLIC',
      "INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES('DRIFT',repeat('a',64),repeat('a',32))"]) {
      const db = await pool.connect();
      try {
        await db.query('BEGIN'); await setTenantContext(db,{ purpose:'migration' }); await db.query(sql);
        await assert.rejects(() => verifyB17Content(db),/b17\.(schema_drift|content_authority_drift|version_drift)/);
      } finally { await db.query('ROLLBACK'); db.release(); }
      await assertB17Ready();
    }
    await withTenantContext(config, async db => {
      const count = (await db.query("SELECT b17_catalog_child_count('item.actions',$1) n,b17_setting('current_purpose') purpose",[seed.actionOnly])).rows[0];
      assert.equal(count.n,1); assert.equal(typeof count.n,'number'); assert.equal(count.purpose,'platform.config');
    });
    await assert.rejects(() => withTenantContext(work, db => db.query("SELECT b17_catalog_child_count('item.actions',$1)",[seed.actionOnly])),/b17.count_context/);
    await assert.rejects(() => withTenantContext({ role:'ge_admin',userId:u.ge }, db => db.query("SELECT b17_catalog_child_count('item.actions',$1)",[seed.actionOnly])),/b17.count_context/);
    await assert.rejects(() => withTenantContext(config, db => db.query('SELECT b17_catalog_child_count(NULL,$1)',[seed.actionOnly])),/b17.count_args/);
    const outsiderUrl = new URL(urls.owner); outsiderUrl.username = 'b17domainoutsider';
    const outsider = new pg.Client({ connectionString:outsiderUrl.toString() }); await outsider.connect();
    try {
      for (const sql of ["SELECT b17_content_fact('service',$1,$2)","SELECT b17_catalog_child_count('item.actions',$1)"])
        await assert.rejects(() => outsider.query(sql,sql.includes('content_fact') ? [t.A,s.GRI] : [seed.actionOnly]),(err:any) => err.code === '42501');
    } finally { await outsider.end(); }
    // Ownership is normalized by ledger principal, never accepted from source
    // labels. Change/restore only this scratch function's metadata.
    try {
      await oracle.query('ALTER FUNCTION b17_catalog_child_count(text,uuid) OWNER TO postgres');
      await assert.rejects(() => assertB17Ready(),/b17.content_authority_drift/);
    } finally { await oracle.query('ALTER FUNCTION b17_catalog_child_count(text,uuid) OWNER TO b17domainowner'); }
    await assertB17Ready();
    assert.deepEqual(await census(),before);
    const expectedAllowed = matrix.flatMap(([method,path,who]) => who.map(w => `${w}:${method}:${path}`));
    for (const key of expectedAllowed) assert.ok(allowed.has(key),`Missing positive ${key}`);
    assert.equal(expectedAllowed.length,18);
    pass('D6 RLS no-context/foreign/blob denial; policy/ACL/ledger drift refuses+recovers; integer count/restored purpose; protected rows/grants unchanged');
    pass('D7 all 18 allowed contexts across exact eleven routes exercised; 51->40->34->25; full scoped proof complete, NOT independent review');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); await oracle.end(); await pool.end();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
