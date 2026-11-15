// G1-only fixture additions BEFORE activation. Request inventory is an oracle
// for final-boundary/refusal coverage, NOT a positive mutation claim.
import { withTenantContext } from '../src/db/index.ts';
import { randomUUID } from 'node:crypto';
import { seedDomainD } from './b17-domain-d-fixture.ts';
export async function seedG1() {
  const seed=await seedDomainD();
  const additions=await withTenantContext({role:'ge_admin'},async c => {
    const items:string[]=[];
    for (let i=0;i<8;i++) {
      const item=(await c.query(`INSERT INTO items(disclosure_id,code,requirement,priority,esg_class)
        VALUES($1,$2,'G1 fixture','mid','general') RETURNING id`,[seed.disc,`G1-${i}`])).rows[0].id;
      await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)',
        [seed.tenants.A,item,seed.departments.A]);items.push(item);
    }
    const list=(await c.query(`INSERT INTO staff_lists(client_id,submitted_by,status,note)
      VALUES($1,$2,'submitted','G1 fixture') RETURNING id`,[seed.tenants.A,seed.users.cA])).rows[0].id;
    await c.query(`INSERT INTO staff_list_rows(list_id,email,name,department_id,department_name,role)
      VALUES($1,'g1-otp@g1.invalid','G1 OTP',$2,'One','employee')`,[list,seed.departments.A]);
    const answer=(await c.query('SELECT id FROM answers WHERE client_id=$1 AND item_id=$2',
      [seed.tenants.A,seed.draft])).rows[0].id;
    const evaluation=(await c.query('SELECT id FROM evaluations WHERE client_id=$1 AND item_id=$2',
      [seed.tenants.A,seed.draft])).rows[0].id;
    const attachment=(await c.query(`INSERT INTO evidence_attachments(answer_id,file_name,mime,size_bytes,data,uploaded_by)
      VALUES($1,'g1.txt','text/plain',2,$2,$3) RETURNING id`,[answer,Buffer.from('G1'),seed.users.eA])).rows[0].id;
    const notification=(await c.query(`INSERT INTO notifications(user_id,client_id,type,title,entity_type)
      VALUES($1,$2,'staff.approved','G1 notification','staff_lists') RETURNING id`,[seed.users.cA,seed.tenants.A])).rows[0].id;
    // An unrelated disclosure ref cannot freeze the mutable workflow fixtures.
    const snapshot=(await c.query(`INSERT INTO review_snapshots(client_id,scope_type,scope_ref,payload,content_hash)
      VALUES($1,'disclosure',$2,$3,'g1-fixture') RETURNING id`,
    [seed.tenants.A,randomUUID(),JSON.stringify({items:[{itemId:items[0]}]})])).rows[0].id;
    const scalar=async(sql:string,params:any[]=[]) => (await c.query(sql,params)).rows[0].id as string;
    const standard=async(code:string)=>scalar("INSERT INTO standards(code,title,category) VALUES($1,$1,'Universal') RETURNING id",[code]);
    const disclosure=async(std:string,code:string)=>scalar('INSERT INTO disclosures(standard_id,code,title) VALUES($1,$2,$2) RETURNING id',[std,code]);
    const catalogService=await scalar("INSERT INTO services(code,name) VALUES('G1-CAT','G1 catalog') RETURNING id");
    const editStd=await standard('G1-EDIT'),deleteStd=await standard('G1-DELETE');
    const editDisc=await disclosure(editStd,'G1-EDIT'),deleteDisc=await disclosure(editStd,'G1-DELETE');
    const catalogItems:string[]=[];
    for (let i=0;i<4;i++) catalogItems.push(await scalar(`INSERT INTO items(disclosure_id,code,requirement,priority,esg_class)
      VALUES($1,$2,'G1 catalog','mid','general') RETURNING id`,[editDisc,`G1-CAT-${i}`]));
    const configTenant=await scalar("INSERT INTO clients(code,name) VALUES('G1-CONFIG','G1 config') RETURNING id");
    const configDept=await scalar("INSERT INTO departments(client_id,code,name) VALUES($1,'one','One') RETURNING id",[configTenant]);
    const configUser=await scalar(`INSERT INTO users(email,password_hash,name,role,client_id,department_id)
      SELECT 'g1-config@g1.invalid',password_hash,'G1 config','employee',$1,$2 FROM users WHERE id=$3 RETURNING id`,
    [configTenant,configDept,seed.users.eA]);
    const notificationAll=await scalar(`INSERT INTO notifications(user_id,client_id,type,title,entity_type)
      VALUES($1,$2,'staff.approved','G1 second notification','staff_lists') RETURNING id`,[seed.users.cA,seed.tenants.A]);
    const lists:Record<string,string>={};
    for (const [name,status] of [['submit','draft'],['reject','submitted'],['approve','submitted']]) {
      lists[name]=await scalar('INSERT INTO staff_lists(client_id,submitted_by,status,note) VALUES($1,$2,$3,$4) RETURNING id',
        [seed.tenants.A,seed.users.cA,status,`G1 positive ${name}`]);
      await c.query(`INSERT INTO staff_list_rows(list_id,email,name,department_id,department_name,role)
        VALUES($1,$2,'G1 positive',$3,'One','employee')`,[lists[name],`g1-positive-${name}@g1.invalid`,seed.departments.A]);
    }
    const library=await scalar("INSERT INTO initiatives_library(title,sector) VALUES('G1 eligible','G1') RETURNING id");
    const pairs:Record<string,string>={};
    for (const [name,status] of [['submit','draft'],['approve','submitted'],['return','submitted'],
      ['correct','submitted'],['clientApprove','approved'],['clientReturn','client_approved']]) {
      // Each client-approval disclosure has exactly one assigned pair. This is
      // a complete positive fixture, never a zero-row or incomplete-scope probe.
      const disc=await disclosure(seed.std,`G1-POS-${name}`);
      const it=await scalar("INSERT INTO items(disclosure_id,code,requirement,priority,esg_class) VALUES($1,$2,'G1 lifecycle','mid','general') RETURNING id",[disc,`G1-POS-${name}`]);
      await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)',[seed.tenants.A,it,seed.departments.A]);
      await c.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value)
        VALUES($1,$2,$3,$4,$5,'G1 lifecycle')`,[seed.tenants.A,it,seed.departments.A,seed.users.eA,status]);
      pairs[name]=await scalar(`INSERT INTO evaluations(client_id,item_id,evaluator_id,score,not_evaluated,not_applicable)
        VALUES($1,$2,$3,50,false,false) RETURNING id`,[seed.tenants.A,it,seed.users.eA]);
    }
    const assignable=await scalar("INSERT INTO items(disclosure_id,code,requirement,priority,esg_class) VALUES($1,'G1-ASSIGN','G1 assign','mid','general') RETURNING id",[seed.disc]);
    const naItem=await scalar("INSERT INTO items(disclosure_id,code,requirement,priority,esg_class) VALUES($1,'G1-NA','G1 NA','mid','general') RETURNING id",[seed.disc]);
    await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)',[seed.tenants.A,naItem,seed.departments.A]);
    const freezeTenant=await scalar("INSERT INTO clients(code,name) VALUES('G1-FINAL','G1 final') RETURNING id");
    const freezeDept=await scalar("INSERT INTO departments(client_id,code,name) VALUES($1,'one','One') RETURNING id",[freezeTenant]);
    await c.query('INSERT INTO client_services(client_id,service_id) VALUES($1,$2)',[freezeTenant,seed.services.GRI]);
    const freezeItem=await scalar("INSERT INTO items(disclosure_id,code,requirement,priority,esg_class) VALUES($1,'G1-FINAL','G1 final','mid','general') RETURNING id",[seed.disc]);
    await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)',[freezeTenant,freezeItem,freezeDept]);
    await c.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value)
      VALUES($1,$2,$3,$4,'submitted','G1 final')`,[freezeTenant,freezeItem,freezeDept,seed.users.eA]);
    await c.query(`INSERT INTO evaluations(client_id,item_id,evaluator_id,not_evaluated,not_applicable,na_reason)
      VALUES($1,$2,$3,false,true,'not-applicable')`,[freezeTenant,freezeItem,seed.users.eA]);
    return {items,list,answer,evaluation,attachment,notification,snapshot,notificationAll,catalogService,editStd,deleteStd,
      editDisc,deleteDisc,catalogItems,configTenant,configDept,configUser,lists,library,pairs,assignable,naItem,freezeTenant};
  });
  return {...seed,...additions};
}
export type G1Seed=Awaited<ReturnType<typeof seedG1>>;
export type Case={who:'P'|'W'|'C'|'E';method:string;path:string;body?:unknown;multipart?:boolean;tenant?:string};
export function siteCases(s:G1Seed):Case[] {
  const t=s.tenants.A,d=s.departments.A,service=s.services.GRI,item=s.items[0],evaluation=s.evaluation;
  const config={clientId:t},mapping={...config,itemId:item,departmentId:d};
  const list=s.list;
  const row=(who:Case['who'],method:string,path:string,body?:unknown,multipart=false):Case=>({who,method,path,body,multipart});
  return [
    row('P','GET','/services'),row('P','GET','/disclosures'),row('P','GET','/items'),
    row('P','POST','/services',{code:'G1NEW',name:'G1'}),
    row('P','PATCH',`/services/${service}`,{code:'GRI',name:'G1'}),
    row('P','POST',`/services/${service}/duplicate`,{code:'G1COPY'}),
    row('P','POST',`/services/${service}/standards`,{standardId:s.std}),
    row('P','DELETE',`/services/${service}/standards`,{standardId:s.std}),
    row('P','PATCH',`/standards/${s.std}`,{title:'G1'}),row('P','DELETE',`/standards/${s.std}`),
    row('P','PATCH',`/disclosures/${s.disc}`,{title:'G1'}),row('P','DELETE',`/disclosures/${s.disc}`),
    row('P','POST','/items',{disclosureId:s.disc,code:'G1-new',requirement:'G1'}),
    row('P','PATCH',`/items/${item}`,{requirement:'G1'}),row('P','DELETE',`/items/${item}`),
    row('P','POST',`/items/${item}/links`,{otherItemId:s.items[1]}),
    row('P','DELETE',`/items/${item}/links`,{otherItemId:s.items[1]}),row('P','GET',`/items/${item}/links`),
    row('P','POST','/gri/commit',{...config,serviceId:service,standards:[{code:'G1',title:'G1',category:'Universal',disclosures:[]}]}),
    row('P','GET','/standards'),row('W','GET','/dashboard/stats'),
    row('E','GET','/queue'),row('E','POST','/evaluations',{itemId:item,score:50}),
    row('E','POST',`/evaluations/${evaluation}/submit`,{version:1}),
    row('E','POST',`/evaluations/${evaluation}/approve`,{version:1}),
    row('E','POST',`/evaluations/${evaluation}/return`,{version:1,comment:'G1'}),
    row('W','PUT',`/evaluations/${evaluation}/correct`,{version:1,newScore:50,reason:'G1'}),
    row('E','GET',`/evaluations?itemId=${item}`),
    row('C','POST',`/evaluations/${evaluation}/client-approve`,{version:1}),
    row('C','POST',`/evaluations/${evaluation}/client-return`,{version:1,comment:'G1'}),
    row('C','GET','/client-review'),row('W','GET','/reviews/ge-check?scope=tenant'),
    row('W','POST','/reviews/ge-final',{scope:'tenant',confirm:true}),
    row('W','GET','/reviews/snapshots'),row('W','GET',`/reviews/snapshots/${s.snapshot}`),
    row('W','POST',`/reviews/snapshots/${s.snapshot}/notes`,{note:'G1'}),
    row('W','GET','/actions'),row('W','POST','/actions',{title:'G1',departmentId:d,serviceId:service}),
    row('C','PATCH',`/actions/${s.action}`,{evidenceNote:'G1'}),
    row('E','POST',`/answers/${s.answer}/attachments`,undefined,true),row('E','GET',`/answers/${s.answer}/attachments`),
    row('E','GET',`/answers/${s.answer}/attachments/${s.attachment}/download`),
    row('E','DELETE',`/answers/${s.answer}/attachments/${s.attachment}`),row('P','GET',`/storage/usage?clientId=${t}`),
    row('P','GET','/audit-log'),row('P','GET','/notifications'),row('C','GET','/notifications/unread-count'),
    row('C','POST',`/notifications/${s.notification}/read`,{}),row('C','POST','/notifications/read-all',{}),
    row('P','GET','/clients'),row('C','GET','/clients'),row('P','POST','/clients',{code:'G1',name:'G1'}),
    row('P','GET',`/clients/${t}`),row('P','PATCH',`/clients/${t}`,{name:'G1'}),
    row('P','GET',`/clients/${t}/services`),row('P','POST',`/clients/${t}/services`,{serviceId:service}),
    row('P','PATCH',`/clients/${t}/services/${service}`,{showGap:true}),row('P','DELETE',`/clients/${t}/services/${service}`),
    row('E','GET','/departments'),row('P','PATCH',`/departments/${d}/head`,{...config,headUserId:s.users.eA}),
    row('P','GET','/users'),row('P','GET',`/users?clientId=${t}`),
    row('P','GET',`/assignments?clientId=${t}`),row('P','POST','/assignments',mapping),row('P','DELETE','/assignments',mapping),
    row('W','POST','/assignments/na',{...mapping,naReason:'not-applicable'}),
    row('P','GET',`/staff-lists?clientId=${t}`),row('C','POST','/staff-lists',{rows:[{email:'g1-staff@g1.invalid',name:'G1',departmentId:d,role:'employee'}]}),
    row('C','POST',`/staff-lists/${list}/submit`,{}),row('P','POST',`/staff-lists/${list}/reject`,{...config,reason:'G1'}),
    row('C','GET','/client/dashboard'),row('P','GET','/ge/overview'),row('P','POST','/services/link-all',{serviceId:service,confirm:true}),
    row('P','GET','/initiatives'),row('P','POST','/initiatives',{title:'G1',sector:'G1'}),row('P','PATCH',`/initiatives/${item}`,{title:'G1'}),
    row('W','POST','/initiatives/select',{initiativeId:item}),row('W','DELETE',`/initiatives/select/${item}`),
    row('P','POST','/esg-profile/import',{...config,serviceId:service,rows:[{pillar:'E',department:'G1',topic:'G1',parameter:'G1'}]}),
    row('W','GET',`/esg-profile?serviceId=${service}`),row('P','GET',`/report-settings?clientId=${t}&serviceId=${service}`),
    row('P','PUT','/report-settings',{...config,serviceId:service,disclosureLevel:'in-accordance',reportLevel:'L3',statementName:'G1',statementPeriod:'2026'}),
    row('W','GET',`/reports/index?level=L3&serviceId=${service}`),row('W','GET',`/reports/export?level=L3&serviceId=${service}`),
    row('P','POST','/users',{...config,email:'g1-user@g1.invalid',name:'G1',role:'employee',departmentId:d,password:s.password}),
    row('P','PATCH',`/users/${s.users.eA}`,{...config,isActive:false}),
    row('P','POST',`/staff-lists/${list}/approve`,config),
  ];
}

/** Independent non-noop positive write fixture per route; order encodes only
 * explicit create/link→update→unlink dependencies, never an implicit grant. */
export function positiveWrites(s:G1Seed):Case[] {
  const t=s.tenants.A,d=s.departments.A,service=s.services.GRI,config={clientId:t};
  const row=(who:Case['who'],method:string,path:string,body?:unknown):Case=>({who,method,path,body});
  return [
    row('P','POST','/services',{code:'G1-POS-NEW',name:'G1 positive new'}),
    row('P','PATCH',`/services/${s.catalogService}`,{code:'G1-CAT',name:'G1 positive edit'}),
    row('P','POST',`/services/${s.catalogService}/duplicate`,{code:'G1-POS-COPY'}),
    row('P','POST',`/services/${s.catalogService}/standards`,{standardId:s.editStd}),
    row('P','DELETE',`/services/${s.catalogService}/standards`,{standardId:s.editStd}),
    row('P','PATCH',`/standards/${s.editStd}`,{title:'G1 positive edit'}),row('P','DELETE',`/standards/${s.deleteStd}`),
    row('P','PATCH',`/disclosures/${s.editDisc}`,{title:'G1 positive edit'}),row('P','DELETE',`/disclosures/${s.deleteDisc}`),
    row('P','POST','/items',{disclosureId:s.editDisc,code:'G1-POS-NEW',requirement:'G1 positive new'}),
    row('P','PATCH',`/items/${s.catalogItems[0]}`,{requirement:'G1 positive edit'}),row('P','DELETE',`/items/${s.catalogItems[1]}`),
    row('P','POST',`/items/${s.catalogItems[2]}/links`,{otherItemId:s.catalogItems[3]}),
    row('P','DELETE',`/items/${s.catalogItems[2]}/links`,{otherItemId:s.catalogItems[3]}),
    row('P','POST','/gri/commit',{...config,serviceId:service,standards:[{code:'G1-POS-IMPORT',title:'G1 import',category:'Universal',
      disclosures:[{code:'G1-POS-IMPORT',title:'G1 import',items:[{code:'G1-POS-IMPORT',requirement:'G1 import'}]}]}]}),
    row('E','POST','/evaluations',{itemId:s.items[5],score:50}),
    row('E','POST',`/evaluations/${s.pairs.submit}/submit`,{version:1}),
    row('E','POST',`/evaluations/${s.pairs.approve}/approve`,{version:1}),
    row('E','POST',`/evaluations/${s.pairs.return}/return`,{version:1,comment:'G1 positive return'}),
    row('W','PUT',`/evaluations/${s.pairs.correct}/correct`,{version:1,newScore:100,reason:'G1 positive correction'}),
    row('C','POST',`/evaluations/${s.pairs.clientApprove}/client-approve`,{version:1}),
    row('C','POST',`/evaluations/${s.pairs.clientReturn}/client-return`,{version:1,comment:'G1 positive return'}),
    {...row('W','POST','/reviews/ge-final',{scope:'tenant',confirm:true}),tenant:s.freezeTenant},
    row('W','POST',`/reviews/snapshots/${s.snapshot}/notes`,{note:'G1 positive note'}),
    row('W','POST','/actions',{title:'G1 positive action',departmentId:d,serviceId:service}),
    row('C','PATCH',`/actions/${s.action}`,{evidenceNote:'G1 positive evidence'}),
    {...row('E','POST',`/answers/${s.answer}/attachments`),multipart:true},
    row('E','DELETE',`/answers/${s.answer}/attachments/${s.attachment}`),
    row('C','POST',`/notifications/${s.notification}/read`,{}),row('C','POST','/notifications/read-all',{}),
    row('P','POST','/clients',{code:'G1-POS-NEW',name:'G1 positive new'}),
    row('P','PATCH',`/clients/${s.configTenant}`,{name:'G1 positive edit'}),
    row('P','POST',`/clients/${s.configTenant}/services`,{serviceId:s.services.UNLINKED}),
    row('P','PATCH',`/clients/${s.configTenant}/services/${s.services.UNLINKED}`,{showGap:false}),
    row('P','DELETE',`/clients/${s.configTenant}/services/${s.services.UNLINKED}`),
    row('P','PATCH',`/departments/${s.configDept}/head`,{clientId:s.configTenant,headUserId:s.configUser}),
    row('P','POST','/assignments',{...config,itemId:s.assignable,departmentId:d}),
    row('P','DELETE','/assignments',{...config,itemId:s.assignable,departmentId:d}),
    row('W','POST','/assignments/na',{itemId:s.naItem,departmentId:d,naReason:'not-applicable'}),
    row('C','POST','/staff-lists',{rows:[{email:'g1-positive-create@g1.invalid',name:'G1',departmentId:d,role:'employee'}]}),
    row('C','POST',`/staff-lists/${s.lists.submit}/submit`,{}),
    row('P','POST',`/staff-lists/${s.lists.reject}/reject`,{...config,reason:'G1 positive rejection'}),
    row('P','POST','/services/link-all',{serviceId:s.services.EMPTY,confirm:true}),
    row('P','POST','/initiatives',{title:'G1 positive new',sector:'G1',serviceIds:[service]}),
    row('P','PATCH',`/initiatives/${s.library}`,{title:'G1 positive edit'}),
    row('W','POST','/initiatives/select',{initiativeId:s.library}),row('W','DELETE',`/initiatives/select/${s.library}`),
    row('P','POST','/esg-profile/import',{...config,serviceId:service,rows:[{pillar:'E',department:'G1',topic:'G1-positive',parameter:'G1'}]}),
    row('P','PUT','/report-settings',{...config,serviceId:service,disclosureLevel:'in-accordance',reportLevel:'L3',statementName:'G1 positive edit',statementPeriod:'2026'}),
    row('P','POST','/users',{...config,email:'g1-positive-user@g1.invalid',name:'G1',role:'employee',departmentId:d,password:s.password}),
    row('P','PATCH',`/users/${s.configUser}`,{clientId:s.configTenant,isActive:false}),
    row('P','POST',`/staff-lists/${s.lists.approve}/approve`,config),
  ];
}
