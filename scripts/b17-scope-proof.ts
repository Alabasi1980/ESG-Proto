// OFFLINE disposable PG18 only. No dotenv, ambient DSN, source upload or live inventory.
// Also requires --untrusted-database-url=<same scratch, separate b17_untrusted login>.
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { getPool,runMigrations,withTenantContext } from '../src/db/index.ts';
import { applyB17Offline,assertB17Ready,verifyB17Content,STRUCTURE_SQL,B17_SHAPE,B17_CONTENT_SHAPE } from '../src/db/b17Readiness.ts';
import { parseB17ContentSources,inventoryB17ContentOffline,applyB17ContentOffline,type ContentTarget } from '../src/db/b17ContentMigration.ts';
import { hashPassword,withSession,type AuthenticatedRequest } from '../src/server/auth.ts';
import { withWorkspace } from '../src/server/access.ts';
import { LEGACY_ROUTES } from '../src/server/accessRegistry.ts';
import { bindB17WorkScope,scopedItems,scopedParents,scopedEvaluations,scopedAnswers,scopedAttachments,scopedScoreInputs,
  scopedInitiatives,scopedProfile,scopedReportSettings,scopedActions,resolveLinkedService,assertActionBinding,
  assertEmployeeEvaluationWritable,SCOPED_ITEM_SQL } from '../src/server/scope.ts';
import { calculateEsgProfileScore } from '../src/lib/esgProfile.ts';
import type { AccessContext } from '../src/lib/capabilities.ts';

export function guardedScopeProofUrl(args: string[], env: NodeJS.ProcessEnv): string {
  if (!args.includes('--allow-disposable-b17')) throw new Error('b17.proof_opt_in_required');
  if (Object.keys(env).some(k => /^(DATABASE_URL|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSERVICE|PGSERVICEFILE)$/i.test(k) && env[k]))
    throw new Error('b17.proof_ambient_dsn_refused');
  const values = args.filter(a => a.startsWith('--database-url='));
  if (values.length !== 1 || args.some(a => !a.startsWith('--database-url=') && a !== '--allow-disposable-b17'))
    throw new Error('b17.proof_explicit_url_required');
  const url = new URL(values[0].slice('--database-url='.length));
  if (!['postgres:','postgresql:'].includes(url.protocol) || !['127.0.0.1','localhost'].includes(url.hostname)
    || !/^\/b17_[a-z0-9_]*scratch[a-z0-9_]*$/.test(url.pathname) || url.search || url.hash
    || !url.port || !url.password || !url.username || url.username === 'postgres')
    throw new Error('b17.proof_disposable_loopback_only');
  return url.toString();
}
const pass = (label: string) => console.log(`PASS ${label}`);
export function guardedScopeProofUrls(args: string[], env: NodeJS.ProcessEnv) {
  const second=args.filter(a=>a.startsWith('--untrusted-database-url='));
  if(second.length!==1) throw new Error('b17.proof_untrusted_url_required');
  const trusted=guardedScopeProofUrl(args.filter(a=>!a.startsWith('--untrusted-database-url=')),env);
  const untrusted=guardedScopeProofUrl(['--allow-disposable-b17',second[0].replace('--untrusted-','--')],env);
  const a=new URL(trusted),b=new URL(untrusted);
  if(a.hostname!==b.hostname || a.port!==b.port || a.pathname!==b.pathname || b.username!=='b17_untrusted'
    || a.username===b.username) throw new Error('b17.proof_second_principal_invalid');
  return {trusted,untrusted};
}

async function main() {
  const {trusted:url,untrusted:untrustedUrl} = guardedScopeProofUrls(process.argv.slice(2),process.env);
  process.env.DATABASE_URL=url;
  process.env.JWT_SECRET=randomBytes(48).toString('hex');
  process.env.B17_SCRATCH_OPT_IN='YES';
  const pool=getPool(), c=await pool.connect();
  let server: ReturnType<typeof spawn> | undefined;
  const shape = async () => (await c.query(STRUCTURE_SQL)).rows[0].checksum;
  try {
    const role=(await c.query(`SELECT r.rolsuper,r.rolbypassrls,
      (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=session_user) AS session_bypass
      FROM pg_roles r WHERE rolname=current_user`)).rows[0];
    assert.deepEqual(role,{rolsuper:false,rolbypassrls:false,session_bypass:false});
    assert.equal(Math.floor(Number((await c.query('SHOW server_version_num')).rows[0].server_version_num)/10000),18);
    assert.equal((await c.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
    assert.equal((await runMigrations()).success,true); // empty install ONCE, never schema replay
    const sources=parseB17ContentSources(readFileSync(new URL('../../prototype/GRI_SOURCE_EXTRACT.csv',import.meta.url),'utf8'),
      readFileSync(new URL('../../prototype/ESG_PROFILE_EXTRACT.csv',import.meta.url),'utf8'));
    const sourceItems=sources.griKeys.slice(0,2).map(k=>JSON.parse(k) as string[]);
    const sourceProfile=JSON.parse(sources.profileKeys[0]) as string[];
    const password=`Aa1!${randomBytes(18).toString('hex')}`;
    const seed=await withTenantContext({role:'ge_admin'},async db=>{
      const tenants: string[]=[],departments: string[][]=[],employees: string[][]=[];
      const mkUser=async (name:string,role:string,tenant:string|null=null,dept:string|null=null) =>
        (await db.query(`INSERT INTO users(email,password_hash,name,role,client_id,department_id)
          VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[`${name}@b17.invalid`,await hashPassword(password),name,role,tenant,dept])).rows[0].id as string;
      const ge=await mkUser('ge','ge_admin');
      for (const name of ['A','B','removed','new','frozen','conflict']) {
        const tenant=(await db.query('INSERT INTO clients(code,name) VALUES($1,$1) RETURNING id',[name])).rows[0].id;
        tenants.push(tenant); const ds:string[]=[],us:string[]=[];
        for (let n=0;n<2;n++) {
          const d=(await db.query('INSERT INTO departments(client_id,code,name) VALUES($1,$2,$2) RETURNING id',[tenant,String(n)])).rows[0].id;
          ds.push(d); us.push(await mkUser(`${name}${n}`,'employee',tenant,d));
        }
        departments.push(ds); employees.push(us);
      }
      // Retains the ORIGINAL department after employees[0][1] transfers below.
      const stay=await mkUser('A1stay','employee',tenants[0],departments[0][1]);
      const ca=await mkUser('client','client_admin',tenants[0]);
      const gri=(await db.query("SELECT id FROM services WHERE code='GRI'")).rows[0].id;
      const service=async (code:string)=>(await db.query('INSERT INTO services(code,name) VALUES($1,$1) RETURNING id',[code])).rows[0].id;
      const overlap=await service('OVERLAP'),unlinked=await service('S2'),empty=await service('EMPTY');
      await db.query(`INSERT INTO client_services(client_id,service_id,show_gap,show_corrective) VALUES
        ($1,$3,true,true),($1,$4,false,true),($1,$5,false,false),($2,$3,false,true)`,[tenants[0],tenants[1],gri,overlap,empty]);
      // Intentionally missing GRI for removed/new tenants, never repaired by content/startup.
      const insertItem=async (sCode:string,dCode:string,iCode:string,requirement:string,batch:string|null)=>{
        const standard=(await db.query(`INSERT INTO standards(code,title,category) VALUES($1,$1,'Governance')
          ON CONFLICT(code) DO UPDATE SET code=EXCLUDED.code RETURNING id`,[sCode])).rows[0].id;
        const disclosure=(await db.query(`INSERT INTO disclosures(standard_id,code,title) VALUES($1,$2,$2)
          ON CONFLICT(standard_id,code) DO UPDATE SET code=EXCLUDED.code RETURNING id`,[standard,dCode])).rows[0].id;
        const item=(await db.query(`INSERT INTO items(disclosure_id,code,requirement,priority,esg_class,import_batch_id)
          VALUES($1,$2,$3,'high','governance',$4) RETURNING id`,[disclosure,iCode,requirement,batch])).rows[0].id;
        return {item,standard,disclosure};
      };
      const imported=[];
      for (const [s,d,i,r] of sourceItems) imported.push(await insertItem(s,d,i,r,'fixture-gri'));
      const overlapItem=await insertItem('OVERLAP','O','O','Overlap fixture',null);
      const hidden=await insertItem('UNLINKED','U','U','Unlinked fixture',null);
      await db.query(`INSERT INTO service_standards(service_id,standard_id) VALUES($1,$3),($2,$3),($4,$5)`,
        [gri,overlap,overlapItem.standard,unlinked,hidden.standard]);
      const answers:string[]=[];
      const pair=async (t:number,d:number,item:string,score:number|null,history=false)=>{
        await db.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)',[tenants[t],item,departments[t][d]]);
        const answer=(await db.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value,correction_history)
          VALUES($1,$2,$3,$4,'submitted','Stored business answer',$5) RETURNING id`,
        [tenants[t],item,departments[t][d],employees[t][d],JSON.stringify(history?[{previous:'old',value:'Stored business answer',reason:'fixture history'}]:[])])).rows[0].id;
        answers.push(answer);
        if (score !== null) await db.query(`INSERT INTO evaluations(client_id,item_id,evaluator_id,score,justification,previous_score)
          VALUES($1,$2,$3,$4,'Stored private justification',$5)`,[tenants[t],item,employees[t][d],score,history?0:null]);
        await db.query(`INSERT INTO approvals(client_id,answer_id,approver_id,level,status,comments)
          VALUES($1,$2,$3,'department','approved','Stored approval')`,[tenants[t],answer,employees[t][d]]);
        await db.query(`INSERT INTO evidence_attachments(answer_id,file_name,mime,size_bytes,data,uploaded_by)
          VALUES($1,'fixture.bin','application/octet-stream',5,$2,$3)`,[answer,Buffer.from([0,1,128,254,255]),employees[t][d]]);
        return answer;
      };
      const ownAnswer=await pair(0,0,imported[0].item,50,true);
      await pair(0,0,imported[1].item,null); const foreignAnswer=await pair(0,1,imported[1].item,0,true);
      await pair(0,0,overlapItem.item,100); await pair(0,0,hidden.item,100);
      await pair(1,0,imported[0].item,100,true);
      const ownershipCases: {name:string;item:string;assigned:boolean;readable:boolean}[]=[];
      for(const name of ['transfer','multi','legacy','missing-answer','missing-assignment','disconnected-pair']) {
        const {item}=await insertItem('OVERLAP','O',name,`Ownership fixture ${name}`,null);
        if(name==='missing-answer') {
          await db.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)',[tenants[0],item,departments[0][0]]);
          await db.query('INSERT INTO evaluations(client_id,item_id,evaluator_id,score) VALUES($1,$2,$3,50)',[tenants[0],item,employees[0][0]]);
        } else {
          await pair(0,name==='transfer'?1:0,item,50,name==='legacy');
          if(name==='multi') await pair(0,1,item,null);
          if(name==='missing-assignment') await db.query('DELETE FROM assignments WHERE client_id=$1 AND item_id=$2',[tenants[0],item]);
          if(name==='transfer') await db.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)',[tenants[0],item,departments[0][0]]);
          if(name==='legacy') {
            await db.query('UPDATE answers SET correction_history=$3,version=2,submitted_by=$4 WHERE client_id=$1 AND item_id=$2',
              [tenants[0],item,JSON.stringify([{before:{score:0},after:{score:50},actor:employees[0][1],reason:'Legacy shared overwrite'}]),employees[0][1]]);
            await db.query('UPDATE evaluations SET version=2 WHERE client_id=$1 AND item_id=$2',[tenants[0],item]);
          }
          if(name==='disconnected-pair') {
            await db.query("UPDATE evaluations SET created_at=created_at-interval '1 day',version=version+1 WHERE client_id=$1 AND item_id=$2",[tenants[0],item]);
            await db.query('UPDATE answers SET version=version+1 WHERE client_id=$1 AND item_id=$2',[tenants[0],item]);
          }
        }
        ownershipCases.push({name,item,assigned:name!=='missing-assignment',readable:name==='disconnected-pair'});
      }
      // Own-department lifecycle FINAL stage (evaluations.ts chain): save(v1)→resave(v2)→submit(v3)→dept approve(v4)→correction(v5).
      const lifeKeys=[tenants[0],imported[0].item];
      const lifeStep=async(a:string,e='version=version+1,updated_at=NOW()')=>{
        await db.query(`UPDATE answers SET ${a} WHERE client_id=$1 AND item_id=$2`,lifeKeys);
        await db.query(`UPDATE evaluations SET ${e} WHERE client_id=$1 AND item_id=$2`,lifeKeys);};
      await lifeStep("status='draft',version=1,updated_at=NOW()",'updated_at=NOW()');
      await lifeStep('version=version+1,updated_at=NOW()');
      await lifeStep("status='submitted',version=version+1,updated_at=NOW()");
      await lifeStep("status='approved',version=version+1,updated_at=NOW()");
      await db.query('UPDATE evaluations SET previous_score=score,score=100,version=version+1,updated_at=NOW() WHERE client_id=$1 AND item_id=$2',lifeKeys);
      await db.query(`UPDATE answers SET correction_history=correction_history||$3::jsonb,version=version+1,updated_at=NOW()
        WHERE client_id=$1 AND item_id=$2`,[...lifeKeys,JSON.stringify([{before:{score:50},after:{score:100},actor:employees[0][0],reason:'Author correction'}])]);
      // Retained B answers/ownership predate the transfer; no evaluation is rekeyed.
      await db.query('UPDATE users SET department_id=$1 WHERE id=$2',[departments[0][0],employees[0][1]]);
      const action=async (t:number,item:string|null,title:string)=>(await db.query(`INSERT INTO actions(client_id,item_id,owner_department_id,title,status,evidence_note)
        VALUES($1,$2,$3,$4,'open','Preserve evidence reference') RETURNING id`,[tenants[t],item,departments[t][t===0?1:0],title])).rows[0].id;
      const linkedAction=await action(0,imported[0].item,'linked'),standalone=await action(0,null,'explicit'),unknownAction=await action(0,null,'unknown');
      await action(0,hidden.item,'unlinked'); await action(1,imported[0].item,'foreign');
      const initiatives:string[]=[];
      for (const name of ['selected','eligible','unlinked','unmapped']) {
        const id=(await db.query('INSERT INTO initiatives_library(title) VALUES($1) RETURNING id',[name])).rows[0].id;
        initiatives.push(id);
        if (name !== 'eligible') await db.query('INSERT INTO client_initiatives(client_id,initiative_id,selected_by) VALUES($1,$2,$3)',[tenants[0],id,ge]);
      }
      const targets:ContentTarget[]=[],profileIds:string[]=[];
      for (const t of [0,2,4,5]) {
        const p=(await db.query(`INSERT INTO esg_profile(client_id,pillar,department,topic,parameter,profile,profile_rating,rating,max_rating,import_batch_id)
          VALUES($1,$2,$3,$4,$5,'Stored independent rating',3,7,19,'fixture-profile') RETURNING id`,[tenants[t],...sourceProfile])).rows[0].id;
        profileIds.push(p);
        const report=(await db.query(`INSERT INTO report_settings(client_id,level,notification_recorded,disclosure_level,report_level,
          statement_name,statement_period,notified,notified_date,notify_ref)
          VALUES($1,'with_reference',true,'with-reference','L3','Chosen statement','2025–2026','done','2026-10-01','Stored ref') RETURNING id`,[tenants[t]])).rows[0].id;
        let auditId='';
        for (const [action,type,entity,payload] of [
          ['IMPORT_GRI_DISCLOSURES','standards',null,{targetTenant:tenants[t],importBatchId:'fixture-gri'}],
          ['ESG_PROFILE_IMPORTED','esg_profile',null,{targetTenant:tenants[t],importBatchId:'fixture-profile'}],
          ['REPORT_SETTINGS_SAVED','report_settings',report,{targetTenant:tenants[t],serviceId:null,disclosureLevel:'with-reference',reportLevel:'L3',notified:'done'}],
        ] as const) auditId=(await db.query('INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
          [tenants[t],ge,action,type,entity,JSON.stringify(payload)])).rows[0].id;
        targets.push({clientId:tenants[t],griBatchId:'fixture-gri',profileBatchId:'fixture-profile',reportSettingId:report,reportAuditId:auditId});
      }
      await db.query(`INSERT INTO report_settings(client_id,service_id,level) VALUES($1,$2,'in_accordance')`,[tenants[5],gri]);
      await db.query(`INSERT INTO esg_profile(client_id,pillar,department,topic,parameter,profile_rating,import_batch_id)
        VALUES($1,'OTHER','OTHER','OTHER','Unidentified',1,'unknown-source')`,[tenants[1]]);
      for (const t of [1,4]) {
        const snap=(await db.query(`INSERT INTO review_snapshots(client_id,scope_type,scope_ref,payload,content_hash,created_by)
          VALUES($1,$2,$3,$4,'Stored immutable hash',$5) RETURNING id`,[tenants[t],t===4?'tenant':'disclosure',t===4?tenants[t]:hidden.disclosure,
        JSON.stringify({frozen:'Original immutable snapshot',answerIds:answers}),ge])).rows[0].id;
        await db.query("INSERT INTO snapshot_notes(client_id,snapshot_id,note,created_by) VALUES($1,$2,'Stored append-only note',$3)",[tenants[t],snap,ge]);
      }
      return {tenants,departments,employees,ge,ca,gri,overlap,unlinked,empty,imported,overlapItem,hidden,ownAnswer,foreignAnswer,
        linkedAction,standalone,unknownAction,initiatives,targets,profileIds,ownershipCases,stay};
    });
    await applyB17Offline(c); assert.equal(await shape(),B17_SHAPE);
    assert.equal((await c.query(`SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity AND pg_get_userbyid(c.relowner)=current_user) AS safe
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'`)).rows[0].safe,true);
    // Independent fixture observer: only business hashes, no security tables/user credentials.
    // Every policy DDL here rolls back; this is not a runtime inventory endpoint.
    const observe=async(normalizeMetadata=true)=>{
      const tables=['clients','departments','client_services','assignments','answers','approvals','evaluations','actions','profile_assessments',
        'report_settings','esg_profile','audit_log','review_snapshots','snapshot_notes','evidence_attachments','client_initiatives',
        'initiatives_library','services','standards','disclosures','items','item_links'];
      try {
        await c.query('BEGIN'); await c.query("SELECT set_config('app.current_purpose','migration.inventory',true)");
        const result:Record<string,unknown>={};
        for (const table of tables) {
          await c.query(`CREATE POLICY b17_proof_observe ON ${table} FOR SELECT USING(b17_setting('current_purpose')='migration.inventory')`);
          const value=normalizeMetadata && ['actions','esg_profile','report_settings'].includes(table)?"to_jsonb(t)-'service_id'":'to_jsonb(t)';
          const where=table==='audit_log'?"WHERE action NOT IN ('USER_LOGIN','WORKSPACE_ENTER','WORKSPACE_EXIT')":'';
          result[table]=(await c.query(`SELECT id,encode(sha256(convert_to((${value})::text,'UTF8')),'hex') AS hash FROM ${table} t ${where} ORDER BY id`)).rows;
        }
        return result;
      } finally { await c.query('ROLLBACK'); }
    };
    const before=await observe(),exactBefore=await observe(false),targets=seed.targets.slice(0,2);
    const inventory=await inventoryB17ContentOffline(c,targets,sources);
    assert.equal(await shape(),B17_SHAPE); assert.deepEqual(await observe(),before);
    assert.deepEqual(await observe(false),exactBefore);
    assert.deepEqual(await inventoryB17ContentOffline(c,targets,sources),inventory);
    assert.ok(!/password_hash|handle_hash|auth_sessions|workspace_tabs/.test(JSON.stringify(inventory)));
    await assert.rejects(()=>verifyB17Content(c),/content_required/);
    for (const [input,evidence,error] of [
      [[seed.targets[2]],sources,/content_frozen/],[[seed.targets[3]],sources,/report_conflict/],
      [targets,parseB17ContentSources('Standard Code,Disclosure Code,Item Code,Requirement\nUNKNOWN,U,U,Unknown',
        'pillar,department,topic,parameter\nUNKNOWN,U,U,Unknown'),/source_unknown/],
      [[{...targets[0],griBatchId:'unknown'}],sources,/lineage_ambiguous/],
    ] as const) {
      await assert.rejects(()=>inventoryB17ContentOffline(c,input,evidence),error);
      assert.equal(await shape(),B17_SHAPE); assert.deepEqual(await observe(),before);
      assert.deepEqual(await observe(false),exactBefore);
    }
    await assert.rejects(()=>applyB17ContentOffline(c,{...inventory,beforeHash:'changed'},sources),/before_state_drift/);
    await assert.rejects(()=>applyB17ContentOffline(c,inventory,parseB17ContentSources(
      'Standard Code,Disclosure Code,Item Code,Requirement\nUNKNOWN,U,U,Unknown',
      'pillar,department,topic,parameter\nUNKNOWN,U,U,Unknown')),/source_unknown/);
    assert.equal(await shape(),B17_SHAPE); assert.deepEqual(await observe(),before);
    const changeFlag=async()=>{
      await c.query('BEGIN');await c.query("SELECT set_config('app.current_purpose','migration.inventory',true)");
      await c.query('CREATE POLICY b17_fixture ON client_services FOR ALL USING(true) WITH CHECK(true)');
      await c.query('UPDATE client_services SET show_gap=NOT show_gap WHERE client_id=$1 AND service_id=$2',[seed.tenants[0],seed.gri]);
      await c.query('DROP POLICY b17_fixture ON client_services');await c.query('COMMIT');
    };
    await changeFlag();const drifted=await observe();
    await assert.rejects(()=>applyB17ContentOffline(c,inventory,sources),/before_state_drift/);
    assert.equal(await shape(),B17_SHAPE);assert.deepEqual(await observe(),drifted);
    await changeFlag();assert.deepEqual(await observe(),before);
    pass('dry-run transactional DDL ALWAYS rolled back: exact U1 fingerprint/business hashes; unknown/conflicting/frozen provenance refused');
    // Real database failure at ledger insertion after metadata changes, not a mocked success.
    const fault=Object.create(c) as pg.PoolClient;
    fault.query=((text: string,...args: unknown[])=>/^INSERT INTO app_schema_versions/.test(text)
      ? c.query('SELECT 1/0') : (c.query as Function).call(c,text,...args)) as typeof c.query;
    await assert.rejects(()=>applyB17ContentOffline(fault,inventory,sources),/division by zero/);
    assert.equal(await shape(),B17_SHAPE); assert.deepEqual(await observe(),before);
    assert.deepEqual(await observe(false),exactBefore);
    assert.equal(await applyB17ContentOffline(c,inventory,sources),'applied');
    assert.equal(await applyB17ContentOffline(c,inventory,sources),'verified');
    assert.equal(await shape(),B17_CONTENT_SHAPE); assert.deepEqual(await observe(),before);
    assert.equal((await c.query("SELECT count(*)::int n FROM pg_policies WHERE policyname LIKE 'b17_inventory%'")).rows[0].n,0);
    await assertB17Ready();
    pass('source-evidenced exact-ID GRI/Profile/report association, same settings/rating/history/bytes, ledger failure rollback and idempotent version');
    // The second principal has CONNECT only, never application authority. GUC
    // spoofing must not turn a direct SQL call into a privileged boolean oracle.
    const outsider=new pg.Client({connectionString:untrustedUrl,ssl:false});await outsider.connect();
    try {
      assert.deepEqual((await outsider.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0],{rolsuper:false,rolbypassrls:false});
      await outsider.query(`SELECT set_config('app.current_tenant_id',$1,false),set_config('app.current_actor_id',$2,false),
        set_config('app.current_mode','employee',false),set_config('app.current_user_role','employee',false),
        set_config('app.current_user_department_id',$3,false),set_config('app.current_purpose','scope.internal',false)`,
      [seed.tenants[0],seed.employees[0][0],seed.departments[0][0]]);
      assert.equal((await outsider.query("SELECT has_function_privilege(current_user,'public.b17_content_fact(text,uuid,uuid,uuid)','EXECUTE') AS allowed")).rows[0].allowed,false);
      for(const kind of ['service','assigned','evaluation','writable','frozen']) await assert.rejects(
        ()=>outsider.query('SELECT public.b17_content_fact($1,$2,$3)',[kind,seed.tenants[0],seed.gri]),{code:'42501'});
      await outsider.query("SELECT set_config('app.current_purpose','work',false)");
      await assert.rejects(()=>outsider.query('SELECT public.b17_item_visible($1,$2)',[seed.tenants[0],seed.overlapItem.item]),{code:'42501'});
    } finally {await outsider.end();}
    for(const statement of [
      'GRANT EXECUTE ON FUNCTION b17_content_fact(text,uuid,uuid,uuid) TO PUBLIC',
      'GRANT EXECUTE ON FUNCTION b17_content_fact(text,uuid,uuid,uuid) TO b17_untrusted',
      'ALTER FUNCTION b17_content_fact(text,uuid,uuid,uuid) OWNER TO b17_untrusted',
    ]) {
      try {
        await c.query('BEGIN');await c.query('GRANT CREATE ON SCHEMA public TO b17_untrusted');await c.query(statement);
        assert.notEqual(await shape(),B17_CONTENT_SHAPE);
        await assert.rejects(()=>verifyB17Content(c),/content_authority_drift/);
      } finally {await c.query('ROLLBACK');}
      assert.equal(await shape(),B17_CONTENT_SHAPE);await assertB17Ready();
    }
    await c.query('GRANT EXECUTE ON FUNCTION b17_content_fact(text,uuid,uuid,uuid) TO PUBLIC');
    try {await assert.rejects(()=>assertB17Ready(),/content_authority_drift/);}
    finally {await c.query('REVOKE ALL ON FUNCTION b17_content_fact(text,uuid,uuid,uuid) FROM PUBLIC');}
    await assertB17Ready();assert.equal(await shape(),B17_CONTENT_SHAPE);
    pass('SHIELD-U2D-01: separate untrusted SQL login cannot EXECUTE with spoofed GUCs; PUBLIC/named ACL and owner drift refuse readiness');
    // Explicit fixture-only platform configuration; NEVER inferred by the content delta.
    await c.query('BEGIN');
    await c.query('CREATE POLICY b17_fixture ON service_initiatives FOR INSERT WITH CHECK(true)');
    await c.query(`INSERT INTO service_initiatives(service_id,initiative_id) VALUES($1,$4),($2,$4),($1,$5),($3,$6)`,
      [seed.gri,seed.overlap,seed.unlinked,...seed.initiatives.slice(0,3)]);
    await c.query('DROP POLICY b17_fixture ON service_initiatives');
    await c.query('CREATE POLICY b17_fixture ON actions FOR ALL USING(true) WITH CHECK(true)');
    await c.query('UPDATE actions SET service_id=$1 WHERE id=$2',[seed.gri,seed.standalone]);
    await c.query('DROP POLICY b17_fixture ON actions'); await c.query('COMMIT');
    assert.equal(await shape(),B17_CONTENT_SHAPE);
    server=spawn(process.execPath,['--import','tsx','server.ts'],{env:{...process.env,NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
    const child=server,output: string[]=[]; child.stderr!.on('data',b=>{output.push(String(b));});
    const base=await new Promise<string>((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill();reject(new Error('b17.proof_startup_timeout'));},20000);
      child.once('error',reject); child.once('exit',()=>{clearTimeout(timer);reject(new Error(`b17.proof_startup_failed:${output.join('')}`));});
      child.stdout!.on('data',b=>{const match=String(b).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]+'/api');}});
    });
    const api=async(method:string,path:string,token?:string,body?:unknown,tab?:{tabHandle:string;generation:number})=>{
      const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,
        ...(tab?{'X-Workspace-Tab':tab.tabHandle,'X-Workspace-Version':String(tab.generation)}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      return {status:r.status,json:await r.json()};
    };
    const login=async(name:string)=>{const r=await api('POST','/auth/login',undefined,{email:`${name}@b17.invalid`,password});assert.equal(r.status,200);return r.json.token as string;};
    const ge=await login('ge'),ca=await login('client'),employee=await login('A0');
    const tab=(await api('POST','/workspace/tab',ge,{})).json;
    const entered=await api('POST','/workspace/enter',ge,{clientId:seed.tenants[0]},tab);assert.equal(entered.status,200);tab.generation=entered.json.generation;
    const fake=(token:string,t?:typeof tab)=>({method:'GET',headers:{authorization:`Bearer ${token}`},rawHeaders:[],
      get:(key:string)=>({'x-workspace-tab':t?.tabHandle,'x-workspace-version':String(t?.generation)})[key.toLowerCase()]} as unknown as AuthenticatedRequest);
    const work=async<T>(token:string,t:typeof tab|undefined,fn:(db:pg.PoolClient,a:AccessContext)=>Promise<T>)=>t
      ? withWorkspace(fake(token,t),'scope.proof',async(db,_i,_t,a)=>{await bindB17WorkScope(db,a);return fn(db,a);})
      : withSession(fake(token),'auth.session',async(db,i)=>{
        const a:AccessContext={actorId:i.user.id,sessionId:i.sid,role:i.user.role,mode:i.user.role==='employee'?'employee':'client',
          tenantId:i.user.clientId!,departmentId:i.user.departmentId??null,tabId:null,generation:null,capability:'scope.proof'};
        await bindB17WorkScope(db,a);return fn(db,a);
      });
    const transferred=await login('A1');await withSession(fake(transferred),'auth.session',async(_db,i)=>{
      assert.equal(i.user.departmentId,seed.departments[0][0]);
    });
    const stay=await login('A1stay');
    await work(ge,tab,async(db,a)=>{
      const items=await scopedItems(db,a); assert.equal(items.length,3+seed.ownershipCases.length);assert.ok(!items.some(i=>i.id===seed.hidden.item));
      const totals=(await db.query(`SELECT count(*)::int n,sum(e.score)::int total FROM evaluations e JOIN items i ON i.id=e.item_id
        WHERE e.client_id=$1 AND ${SCOPED_ITEM_SQL}`,[a.tenantId,null,null])).rows[0];
      assert.deepEqual(totals,{n:3+seed.ownershipCases.length,total:200+50*seed.ownershipCases.length});
      assert.equal((await scopedItems(db,a,{serviceId:seed.empty})).length,0);
      await assert.rejects(()=>scopedItems(db,a,{serviceId:seed.unlinked}),{code:'scope.service_unlinked'});
      assert.equal((await scopedParents(db,a,'services')).length,2);assert.equal((await scopedParents(db,a,'standards')).length,2);
      assert.equal((await scopedParents(db,a,'disclosures')).length,new Set([...seed.imported.map(i=>i.disclosure),seed.overlapItem.disclosure]).size);
      assert.equal((await scopedInitiatives(db,a)).length,1);assert.equal((await scopedInitiatives(db,a,'eligible')).length,2);
      assert.equal((await scopedProfile(db,a,seed.gri))[0].profile_rating,3);
      const p=await scopedProfile(db,a,seed.gri);assert.deepEqual(calculateEsgProfileScore(p),calculateEsgProfileScore([{profile_rating:3}]));
      const settings=(await scopedReportSettings(db,a,seed.gri))[0];assert.equal(settings.id,targets[0].reportSettingId);
      assert.equal(settings.report_level,'L3');assert.equal(settings.notify_ref,'Stored ref');assert.equal(settings.statement_name,'Chosen statement');
      await assert.rejects(()=>resolveLinkedService(db,a),{code:'service.required'});
      const actions=await scopedActions(db,a);assert.deepEqual(actions.map(x=>x.id).sort(),[seed.linkedAction,seed.standalone].sort());
      await assertActionBinding(db,a,{departmentId:seed.departments[0][1],serviceId:seed.gri});
      await assert.rejects(()=>assertActionBinding(db,a,{departmentId:seed.departments[0][1]}),{code:'service.required'});
      await assert.rejects(()=>assertActionBinding(db,a,{departmentId:seed.departments[1][0],serviceId:seed.gri}),{code:'scope.department_mismatch'});
      // D1 (task §20): own-tenant actor rows resolve in work context (audit
      // JOIN, uploader names, notify membership); foreign-tenant and platform
      // actor rows stay invisible — the pre-D1 "users unreadable at all" pin is
      // superseded by the sanctioned narrowly-scoped users SELECT.
      assert.ok((await db.query('SELECT * FROM users WHERE client_id=$1',[a.tenantId])).rows.length>0,'D1 own-tenant actor rows visible');
      assert.equal((await db.query('SELECT * FROM users WHERE client_id IS NOT NULL AND client_id<>$1',[a.tenantId])).rows.length,0);
      assert.equal((await db.query('SELECT * FROM users WHERE client_id IS NULL')).rows.length,0);
      assert.equal((await db.query('SELECT * FROM review_snapshots')).rows.length,0);
      const transfer=seed.ownershipCases.find(t=>t.name==='transfer')!;
      assert.equal((await scopedAnswers(db,a,transfer.item))[0].department_id,seed.departments[0][1]);
      assert.equal((await scopedEvaluations(db,a,transfer.item))[0].evaluator_id,seed.employees[0][1]);
    });
    await work(ca,undefined,async(db,a)=>{
      assert.equal((await scopedInitiatives(db,a)).length,1);
      await assert.rejects(()=>scopedInitiatives(db,a,'eligible'),{code:'scope.initiatives_denied'});
      assert.equal((await scopedActions(db,a)).length,2); // ALL own company departments, not one department
      assert.equal((await scopedAnswers(db,a,seed.imported[1].item)).length,2);
      assert.equal((await scopedScoreInputs(db,a,seed.gri)).length,3+seed.ownershipCases.length);
      assert.equal((await scopedScoreInputs(db,a,seed.overlap)).length,0);
    });
    await work(employee,undefined,async(db,a)=>{
      assert.equal((await scopedEvaluations(db,a,seed.imported[1].item)).length,0);
      assert.equal((await scopedAnswers(db,a,seed.imported[1].item)).length,1);
      assert.equal((await scopedAttachments(db,a,seed.foreignAnswer)).length,0);
      const files=await scopedAttachments(db,a,seed.ownAnswer);assert.equal(files.length,1);assert.equal('data' in files[0],false);
      assert.deepEqual((await scopedAttachments(db,a,seed.ownAnswer,files[0].id))[0].data,Buffer.from([0,1,128,254,255]));
      assert.equal((await scopedAttachments(db,a,seed.foreignAnswer,files[0].id)).length,0);
      assert.equal((await scopedEvaluations(db,a,seed.overlapItem.item))[0].score,100);
      const life=(await scopedEvaluations(db,a,seed.imported[0].item)); // progressed own pair, still readable
      assert.equal(life.length,1);assert.equal(life[0].version,5);assert.equal(life[0].score,100);
      assert.equal(life[0].previous_score,50);
      const lifeAnswer=(await scopedAnswers(db,a,seed.imported[0].item))[0];
      assert.equal(lifeAnswer.status,'approved');assert.equal(lifeAnswer.version,5);
      assert.ok(lifeAnswer.correction_history.length>0);
      await assertEmployeeEvaluationWritable(db,a,seed.imported[0].item); // subsequent pre-final writes allowed
      await assertEmployeeEvaluationWritable(db,a,seed.overlapItem.item);
      await assert.rejects(()=>assertEmployeeEvaluationWritable(db,a,seed.imported[1].item),{code:'scope.shared_ambiguous',statusCode:409});
      assert.equal((await db.query('UPDATE evaluations SET score=100 WHERE client_id=$1 AND item_id=$2',[a.tenantId,seed.imported[1].item])).rowCount,0);
      for (const fn of [()=>scopedInitiatives(db,a),()=>scopedProfile(db,a,seed.gri),()=>scopedActions(db,a)]) await assert.rejects(fn);
      for(const test of seed.ownershipCases) {
        if(!test.assigned) await assert.rejects(()=>scopedEvaluations(db,a,test.item),{code:'scope.not_found'});
        else if(test.readable) {
          assert.equal((await scopedEvaluations(db,a,test.item)).length,1); // ordinary v2/timestamp edit stays readable
          await assertEmployeeEvaluationWritable(db,a,test.item);
        }
        else {
          assert.equal((await scopedItems(db,a,{itemId:test.item})).length,1);
          assert.deepEqual(await scopedEvaluations(db,a,test.item),[]);
          await assert.rejects(()=>assertEmployeeEvaluationWritable(db,a,test.item),{code:'scope.shared_ambiguous',statusCode:409});
        }
        const raw=(await db.query('SELECT * FROM evaluations WHERE client_id=$1 AND item_id=$2',[a.tenantId,test.item])).rows.length;
        assert.equal(raw,test.assigned&&test.readable?1:0); // RLS itself hides every denied row
      }
      assert.equal((await db.query("SELECT b17_setting('current_purpose') AS purpose")).rows[0].purpose,'work');
      // Invoke nested facts repeatedly, then force an internal SELECT failure.
      // Savepoint rollback must preserve purpose and every business value.
      const ownEval=(await scopedEvaluations(db,a,seed.overlapItem.item))[0];
      for(const [kind,id] of [['parent.service',seed.gri],['assigned',seed.overlapItem.item],['evaluation',ownEval.id],['writable',seed.overlapItem.item]]) {
        assert.equal((await db.query('SELECT b17_content_fact($1,$2,$3) AS allowed',[kind,a.tenantId,id])).rows[0].allowed,true);
        assert.equal((await db.query("SELECT b17_setting('current_purpose') AS purpose")).rows[0].purpose,'work');
      }
      await db.query('SAVEPOINT fact_failure');
      await db.query('CREATE POLICY b17_proof_error ON assignments FOR SELECT USING(1/0=0)');
      await assert.rejects(()=>db.query("SELECT b17_content_fact('assigned',$1,$2)",[a.tenantId,seed.overlapItem.item]),{code:'22012'});
      await db.query('ROLLBACK TO SAVEPOINT fact_failure');await db.query('RELEASE SAVEPOINT fact_failure');
      assert.equal((await db.query("SELECT b17_setting('current_purpose') AS purpose")).rows[0].purpose,'work');
      assert.equal((await scopedEvaluations(db,a,seed.overlapItem.item))[0].score,100);
    });
    // Transferred evaluator (author now in dept 0): answer.department governs, not author placement.
    await work(stay,undefined,async(db,a)=>{
      assert.equal(a.departmentId,seed.departments[0][1]);
      const transfer=seed.ownershipCases.find(t=>t.name==='transfer')!;
      const rows=await scopedEvaluations(db,a,transfer.item);
      assert.equal(rows.length,1);assert.equal(rows[0].evaluator_id,seed.employees[0][1]);
      await assertEmployeeEvaluationWritable(db,a,transfer.item); // multi-assigned, single-answer dept work stays writable
      assert.deepEqual(await scopedEvaluations(db,a,seed.ownershipCases.find(t=>t.name==='multi')!.item),[]);
      await assert.rejects(()=>scopedEvaluations(db,a,seed.overlapItem.item),{code:'scope.not_found'});
    });
    pass('real login/session/tab → scoped helpers: linked/empty/unlinked parents, dedup score, selected/eligible initiatives, independent Profile and actions');
    pass('SHIELD-U2D-02 round-4: progressed own-dept lifecycle (v5 correction) and transferred-evaluator retained row readable+writable; parallel/legacy-signature/missing-provenance/foreign rows denied');
    pass('fact recursion/purpose restoration on nested success and forced SQL error; no score/history mutation');
    for (const tenant of seed.tenants) await withTenantContext({role:'ge_admin',userId:seed.ge,mode:'consultant',tenantId:tenant,purpose:'work'},async db=>{
      assert.ok((await db.query('SELECT * FROM answers')).rows.every(r=>r.client_id===tenant));
      if ([seed.tenants[2],seed.tenants[3]].includes(tenant)) {
        assert.equal((await db.query('SELECT * FROM esg_profile')).rows.length,0);
        assert.equal((await db.query('SELECT * FROM report_settings')).rows.length,0);
        assert.equal((await db.query('SELECT * FROM items')).rows.length,0);
      }
    });
    await withTenantContext({role:'ge_admin',userId:seed.ge,mode:'consultant',tenantId:seed.tenants[4],purpose:'work'},async db=>{
      assert.equal((await db.query('SELECT is_scope_frozen($1) AS frozen',[seed.tenants[4]])).rows[0].frozen,true);
      assert.equal((await db.query('SELECT * FROM review_snapshots')).rows.length,0);
    });
    await assert.rejects(()=>withTenantContext({role:'ge_admin',userId:seed.ge,mode:'consultant',tenantId:seed.tenants[4],purpose:'work'},async db=>{
      await db.query('CREATE POLICY b17_fixture ON esg_profile FOR ALL USING(true) WITH CHECK(true)');
      await db.query("UPDATE esg_profile SET profile='must not replace' WHERE client_id=$1",[seed.tenants[4]]);
    }),/FROZEN_SCOPE/);
    try {
      await c.query('BEGIN');await c.query('CREATE POLICY b17_fixture ON actions FOR INSERT WITH CHECK(true)');
      await assert.rejects(()=>c.query(`INSERT INTO actions(client_id,owner_department_id,title,status)
        VALUES($1,$2,'invalid standalone','open')`,[seed.tenants[0],seed.departments[0][0]]),{code:'23514'});
    } finally {await c.query('ROLLBACK');}
    assert.equal(await shape(),B17_CONTENT_SHAPE);
    await withTenantContext({},async db=>{for(const table of ['items','answers','evaluations','esg_profile','client_services'])assert.equal((await db.query(`SELECT * FROM ${table}`)).rows.length,0);});
    await withTenantContext({role:'client_admin',userId:seed.ca,mode:'client',tenantId:seed.tenants[1],purpose:'work'},async db=>{
      assert.equal((await db.query('SELECT * FROM evaluations')).rows.length,0);
      assert.equal((await db.query('SELECT * FROM answers')).rows.length,1);
    });
    assert.equal((await api('GET','/auth/me?purpose=migration.inventory',ge)).status,200);
    const hostile=fake(ge);hostile.body={purpose:'migration.inventory'};hostile.query={purpose:'migration.inventory'};
    await withSession(hostile,'auth.session',async db=>{
      assert.equal((await db.query("SELECT b17_setting('current_purpose') AS purpose")).rows[0].purpose,'auth.session');
      assert.equal((await db.query('SELECT * FROM items')).rows.length,0);
    });
    for (const route of LEGACY_ROUTES.filter(r=>r.activation==='UNACTIVATED')) {
      const path=route.path.replace(/:[^/]+/g,randomUUID());const r=await api(route.method,path+'?purpose=migration.inventory',ge,
        ['GET','HEAD'].includes(route.method)?undefined:{purpose:'migration.inventory'},tab);
      assert.equal(r.status,403);assert.equal(r.json.code,'access.unactivated');
    }
    assert.equal((await api('POST','/db/migrate',ge,{purpose:'migration.inventory'},tab)).status,409);
    assert.equal((await runMigrations()).success,false);
    await assert.rejects(()=>c.query(readFileSync('src/db/schema.sql','utf8')),/schema.empty_install_only/);
    assert.equal(await shape(),B17_CONTENT_SHAPE);
    const final=await observe();assert.deepEqual(final,before);
    await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill();});server=undefined;
    // Restart/readiness has no data/schema repair side effects, including missing GRI/new client links.
    const restart=spawn(process.execPath,['--import','tsx','server.ts'],{env:{...process.env,NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});server=restart;
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{restart.kill();reject(new Error('restart timeout'));},20000);
      restart.once('exit',()=>{clearTimeout(timer);reject(new Error('restart failed'));});
      restart.stdout!.on('data',b=>{if(String(b).includes('http://127.0.0.1:')){clearTimeout(timer);resolve();}});
    });
    await assertB17Ready();assert.equal(await shape(),B17_CONTENT_SHAPE);assert.deepEqual(await observe(),before);
    await c.query('CREATE POLICY b17_proof_drift ON clients FOR SELECT USING(true)');
    await assert.rejects(()=>assertB17Ready(),/schema_drift/);await c.query('DROP POLICY b17_proof_drift ON clients');
    await assertB17Ready();
    pass('A/B/empty pooled context, no request-selected inventory purpose, all legacy APIs unactivated, no old-schema replay/regrant after real restart');
    console.log('B17_U2D local substrate proof complete; NOT full domain/parent acceptance.');
  } finally {
    if(server && server.exitCode === null) await new Promise<void>(resolve=>{server!.once('exit',()=>resolve());server!.kill();});
    c.release();await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(err=>{console.error('B17_U2D proof FAILED:',err instanceof Error?err.message:'unknown');process.exitCode=1;});
