import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { withTenantContext } from '../src/db/index.ts';
import { hashPassword } from '../src/server/auth.ts';
import { parseB17ContentSources, type ContentTarget } from '../src/db/b17ContentMigration.ts';

export async function seedDomainD() {
  const password = `Aa1!${randomBytes(24).toString('hex')}`;
  // Inert formula-like strings only: no URLs, requests or spreadsheet execution.
  const csvText = { location:'=1+1,"answer"\r\nنص عربي',standardTitle:' +1+1,"standard"\r\nEN',
    disclosureTitle:'\t@SUM(1,2),"disclosure"\r\nAR',department:'-1+1,"department"\r\nالقسم',
    omissionExplanation:'@SUM(1,2),"explanation"\r\nتفسير' };
  const sources = parseB17ContentSources(
    readFileSync(new URL('../../prototype/GRI_SOURCE_EXTRACT.csv', import.meta.url),'utf8'),
    readFileSync(new URL('../../prototype/ESG_PROFILE_EXTRACT.csv', import.meta.url),'utf8'));
  return withTenantContext({ role:'ge_admin' }, async c => {
    const tenants: Record<string,string> = {}, departments: Record<string,string> = {}, users: Record<string,string> = {};
    for (const name of ['A','B','Z','H','F']) {
      tenants[name] = (await c.query('INSERT INTO clients(code,name) VALUES($1,$1) RETURNING id', [`D-${name}`])).rows[0].id;
      departments[name] = (await c.query("INSERT INTO departments(client_id,code,name) VALUES($1,'one','One') RETURNING id", [tenants[name]])).rows[0].id;
    }
    const department2 = (await c.query("INSERT INTO departments(client_id,code,name) VALUES($1,'two','Two') RETURNING id", [tenants.A])).rows[0].id;
    const user = async (name: string, role: string, t: string | null, d: string | null = null) => {
      users[name] = (await c.query(`INSERT INTO users(email,password_hash,name,role,client_id,department_id)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [`${name}@domain-d.invalid`,await hashPassword(password),name,role,t,d])).rows[0].id;
    };
    // Deliberately populated GE.client_id: explicit import T MUST NOT fall back.
    await user('ge','ge_admin',tenants.A);
    for (const name of ['A','B','Z','H','F']) await user(`c${name}`,'client_admin',tenants[name]);
    await user('eA','employee',tenants.A,departments.A);
    const services: Record<string,string> = { GRI:(await c.query("SELECT id FROM services WHERE code='GRI'")).rows[0].id };
    for (const name of ['S2','EMPTY','UNLINKED']) services[name] = (await c.query('INSERT INTO services(code,name) VALUES($1,$1) RETURNING id',[`D-${name}`])).rows[0].id;
    for (const [t,s] of [['A','GRI'],['A','S2'],['A','EMPTY'],['B','S2'],['H','GRI'],['F','GRI']])
      await c.query('INSERT INTO client_services(client_id,service_id,show_gap,show_corrective) VALUES($1,$2,$3,$3)', [tenants[t],services[s],t !== 'H']);
    const standard = async (code: string) => (await c.query("INSERT INTO standards(code,title,category) VALUES($1,$1,'Universal') RETURNING id", [code])).rows[0].id as string;
    const disclosure = async (s: string,code: string) => (await c.query('INSERT INTO disclosures(standard_id,code,title) VALUES($1,$2,$2) RETURNING id', [s,code])).rows[0].id as string;
    const item = async (d: string,code: string,priority: string) => (await c.query(`INSERT INTO items(disclosure_id,code,requirement,priority,esg_class)
      VALUES($1,$2,$2,$3,'general') RETURNING id`, [d,code,priority])).rows[0].id as string;
    const std = await standard('D-STD'), disc = await disclosure(std,'D-OK');
    const omittedDisc = await disclosure(std,'D-OMITTED');
    const scored = await item(disc,'D-SCORE','high'), draft = await item(disc,'D-DRAFT','mid'), na = await item(omittedDisc,'D-NA','low');
    await c.query('UPDATE standards SET title=$1 WHERE id=$2',[csvText.standardTitle,std]);
    await c.query('UPDATE disclosures SET title=$1 WHERE id=$2',[csvText.disclosureTitle,disc]);
    await c.query('UPDATE departments SET name=$1 WHERE id=$2',[csvText.department,departments.A]);
    const badStd = await standard('D-BAD-STD'), badDisc = await disclosure(badStd,'D-AUTHORISED-BAD'), bad = await item(badDisc,'D-BAD','mid');
    const foreignStd = await standard('D-FOREIGN-STD'), foreignDisc = await disclosure(foreignStd,'D-FOREIGN-SECRET-CODE'), foreign = await item(foreignDisc,'D-FOREIGN','mid');
    const actionOnly = await item(disc,'D-ACTION-ONLY','mid');
    await c.query('INSERT INTO service_standards(service_id,standard_id) VALUES($1,$2),($3,$2),($3,$4)', [services.GRI,std,services.S2,badStd]);
    const evaluation = async (t: string,id: string,score: number | null,notApplicable: boolean,reason: string | null,justification: string | null,status='submitted',value='Fixture evidence') => {
      await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)', [tenants[t],id,departments[t]]);
      await c.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value)
        VALUES($1,$2,$3,$4,$5,$6)`, [tenants[t],id,departments[t],users.eA,status,value]);
      await c.query(`INSERT INTO evaluations(client_id,item_id,evaluator_id,score,not_evaluated,not_applicable,na_reason,justification)
        VALUES($1,$2,$3,$4,false,$5,$6,$7)`, [tenants[t],id,users.eA,score,notApplicable,reason,justification]);
    };
    await evaluation('A',scored,50,false,null,null,'submitted',csvText.location);
    await evaluation('A',draft,100,false,null,null,'draft',csvText.location);
    await evaluation('A',na,null,true,'not-applicable',csvText.omissionExplanation);
    // Invalid legacy omission fields are permitted by the schema; the report
    // HARD RULE must name ONLY the chosen service's authorised codes.
    await evaluation('A',bad,null,true,'not-applicable',null);
    await evaluation('A',foreign,null,true,'not-applicable',null);
    await evaluation('H',scored,100,false,null,null);
    await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)', [tenants.A,scored,department2]);
    const action = (await c.query(`INSERT INTO actions(client_id,item_id,owner_department_id,title,status)
      VALUES($1,$2,$3,'Only action reference','open') RETURNING id`, [tenants.A,actionOnly,departments.A])).rows[0].id;
    await c.query(`INSERT INTO actions(client_id,item_id,owner_department_id,title,status)
      VALUES($1,$2,$3,'Hidden score service action','open')`, [tenants.H,scored,departments.H]);
    // Z carries a perfectly complete legacy NULL-service setting, but has no
    // entitlement. It must NOT become a service/default authorization source.
    await c.query(`INSERT INTO report_settings(client_id,level,disclosure_level,report_level,statement_name,statement_period)
      VALUES($1,'in_accordance','in-accordance','L3','Legacy unlinked','2026')`, [tenants.Z]);

    const [sc,dc,ic,requirement] = JSON.parse(sources.griKeys[0]) as string[];
    const provenanceStd = await standard(sc), provenanceDisc = await disclosure(provenanceStd,dc);
    await c.query(`INSERT INTO items(disclosure_id,code,requirement,priority,esg_class,import_batch_id)
      VALUES($1,$2,$3,'high','general','d-gri-batch')`, [provenanceDisc,ic,requirement]);
    const [pillar,department,topic,parameter] = JSON.parse(sources.profileKeys[0]) as string[];
    const profile = (await c.query(`INSERT INTO esg_profile(client_id,pillar,department,topic,parameter,profile_rating,import_batch_id)
      VALUES($1,$2,$3,$4,$5,3,'d-profile-batch') RETURNING id`, [tenants.A,pillar,department,topic,parameter])).rows[0].id;
    const report = (await c.query(`INSERT INTO report_settings(client_id,level,disclosure_level,report_level,statement_name,
      statement_period,notified,notified_date,notify_ref,notification_recorded)
      VALUES($1,'in_accordance','in-accordance','L3','Original statement','2026','done','2026-11-12','Original reference',true) RETURNING id`, [tenants.A])).rows[0].id;
    await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,payload)
      VALUES($1,$2,'IMPORT_GRI_DISCLOSURES','standards',$3),($1,$2,'ESG_PROFILE_IMPORTED','esg_profile',$4)`,
    [tenants.A,users.ge,JSON.stringify({ targetTenant:tenants.A,importBatchId:'d-gri-batch' }),JSON.stringify({ targetTenant:tenants.A,importBatchId:'d-profile-batch' })]);
    const reportAudit = (await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload)
      VALUES($1,$2,'REPORT_SETTINGS_SAVED','report_settings',$3,$4) RETURNING id`,
    [tenants.A,users.ge,report,JSON.stringify({ targetTenant:tenants.A,serviceId:null,disclosureLevel:'in-accordance',reportLevel:'L3',notified:'done' })])).rows[0].id;
    await c.query(`INSERT INTO review_snapshots(client_id,scope_type,scope_ref,payload,content_hash) VALUES($1::uuid,'tenant',$1::uuid::text,'{}','d-frozen')`, [tenants.F]);
    return { password,csvText,sources,tenants,departments,department2,users,services,std,disc,scored,draft,na,bad,foreign,actionOnly,action,profile,report,
      targets:[{ clientId:tenants.A,griBatchId:'d-gri-batch',profileBatchId:'d-profile-batch',reportSettingId:report,reportAuditId:reportAudit } satisfies ContentTarget] };
  });
}
