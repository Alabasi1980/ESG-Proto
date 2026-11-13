import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { assertB17ContentAuthority, CONTENT_AUTHORITY_SQL, STRUCTURE_SQL,
  SANCTIONED_DEFINER_FUNCTIONS } from '../db/b17Readiness.ts';

// U2-C1 (task §23 goal 6): the authority view is now per-sanctioned-definer
// plus the complete live b17_% definer list.
const sanctionedAuthority = (name: string) => ({ name, definer: true, explicit_acl: true,
  owner_is_app: true, owner_is_current: true, owner_is_session: true,
  owner_super: false, owner_bypass: false,
  execute: [{ grantee_is_owner: true, grantor_is_owner: true, privilege: 'EXECUTE', grantable: false }] });
const authority = () => ({ definer_functions: [...SANCTIONED_DEFINER_FUNCTIONS].sort(),
  authority: [...SANCTIONED_DEFINER_FUNCTIONS].sort().map(sanctionedAuthority) });
const db = (value: unknown) => ({ query: async () => ({ rows: value === null ? [] : [{ authority: value }] }) }) as unknown as pg.PoolClient;
test('SHIELD-U2D-01: owner/ACL guard admits only the sanctioned nonbypass app/session/table principals', async () => {
  assert.deepEqual([...SANCTIONED_DEFINER_FUNCTIONS].sort(), ['b17_catalog_child_count', 'b17_content_fact']);
  await assertB17ContentAuthority(db(authority()));
  // Every per-function owner/ACL property of EVERY sanctioned definer refuses drift.
  for (const name of SANCTIONED_DEFINER_FUNCTIONS) {
    for (const field of ['definer', 'explicit_acl', 'owner_is_app', 'owner_is_current', 'owner_is_session'] as const)
      await assert.rejects(() => assertB17ContentAuthority(db(
        { ...authority(), authority: authority().authority.map(f => f.name === name ? { ...f, [field]: false } : f) })), /authority_drift/);
    for (const field of ['owner_super', 'owner_bypass'] as const)
      await assert.rejects(() => assertB17ContentAuthority(db(
        { ...authority(), authority: authority().authority.map(f => f.name === name ? { ...f, [field]: true } : f) })), /authority_drift/);
    for (const execute of [[], null, [{ ...sanctionedAuthority(name).execute[0], grantee_is_owner: false }],
      [{ ...sanctionedAuthority(name).execute[0], grantor_is_owner: false }],
      [{ ...sanctionedAuthority(name).execute[0], grantable: true }],
      [sanctionedAuthority(name).execute[0], sanctionedAuthority(name).execute[0]]])
      await assert.rejects(() => assertB17ContentAuthority(db(
        { ...authority(), authority: authority().authority.map(f => f.name === name ? { ...f, execute } : f) })), /authority_drift/);
  }
  // The live b17_% definer list must equal the sanctioned set exactly:
  // extra, renamed, missing or superseded privileged helpers all refuse.
  for (const definer_functions of [[], null, ['b17_setting'], ['b17_content_fact'],
    ['b17_content_fact', 'b17_platform_scope'], ['b17_catalog_child_count', 'b17_evil'],
    ['b17_catalog_child_count', 'b17_content_fact', 'b17_extra']])
    await assert.rejects(() => assertB17ContentAuthority(db({ ...authority(), definer_functions })), /authority_drift/);
  for (const auth of [[], null, [sanctionedAuthority('b17_content_fact')],
    [sanctionedAuthority('b17_catalog_child_count'), sanctionedAuthority('b17_content_fact'), sanctionedAuthority('b17_evil')],
    [{ ...sanctionedAuthority('b17_content_fact'), name: 'b17_unknown' }]])
    await assert.rejects(() => assertB17ContentAuthority(db({ ...authority(), authority: auth })), /authority_drift/);
  // A missing/extra authority list entry never slips through length checks alone.
  await assert.rejects(() => assertB17ContentAuthority(db({ definer_functions: authority().definer_functions })), /authority_drift/);
  await assert.rejects(() => assertB17ContentAuthority(db(null)), /authority_drift/);
  assert.ok(STRUCTURE_SQL.includes(CONTENT_AUTHORITY_SQL));
  assert.ok(CONTENT_AUTHORITY_SQL.includes("q.prosecdef AND left(q.proname,4)='b17_'"));
  assert.ok(CONTENT_AUTHORITY_SQL.includes("p.proname = ANY(ARRAY['b17_catalog_child_count','b17_content_fact'])"));
});
test('SHIELD-U2D-02 round-4: ownership is exactly-one own-department answer + signature + retained assignment; edits/placement are not ownership', () => {
  const sql = readFileSync(new URL('../db/b17-content.sql', import.meta.url), 'utf8');
  const ownership = sql.slice(sql.indexOf("WHEN 'evaluation'"), sql.indexOf("WHEN 'writable'"));
  const writable = sql.slice(sql.indexOf("WHEN 'writable'"), sql.indexOf("WHEN 'initiative'"));
  // Proven ONLY from the retained pair: own-department answer, author signature, retained assignment.
  for (const evidence of ['JOIN answers', 'a.submitted_by=e.evaluator_id', 'FROM assignments', 'FROM answers other',
    "b17_setting('current_user_department_id')", 'count(*)'])
    assert.ok(ownership.includes(evidence), evidence);
  // Ordinary edits, assignment count and the evaluator's CURRENT department are deleted from both facts.
  for (const removed of ['e.version=1', 'a.version=1', 'e.created_at=a.created_at', 'e.updated_at=a.updated_at',
    'e.previous_score IS NULL', "a.correction_history='[]'::jsonb", 'JOIN users', 'u.department_id',
    'count(*) FROM assignments'])
    assert.ok(!ownership.includes(removed), removed);
  for (const evidence of ["b17_content_fact('linked',t,r)", "b17_content_fact('assigned',t,r)",
    'NOT EXISTS(SELECT 1 FROM answers a', "b17_content_fact('evaluation',t,e.id)"])
    assert.ok(writable.includes(evidence), evidence);
  assert.ok(!writable.includes('NOT EXISTS(SELECT 1 FROM assignments a'), 'assignment-count mirror deleted from writable');
  assert.ok(!writable.includes('e.version=1') && !writable.includes('previous_score IS NULL'), 'no edit-state gates in writable');
  assert.match(sql, /REVOKE ALL ON FUNCTION b17_content_fact\(text,uuid,uuid,uuid\) FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION b17_content_fact\(text,uuid,uuid,uuid\) TO CURRENT_USER/);
  assert.match(sql, /b17_evaluations ON evaluations FOR SELECT USING\(CASE WHEN b17_work_tenant/);
  // U2-C1 D1 count definer: same REVOKE-PUBLIC / owner-GRANT / fixed-search_path
  // discipline as b17_content_fact, count-only return type, fail-closed guard.
  assert.match(sql, /REVOKE ALL ON FUNCTION b17_catalog_child_count\(text,uuid\) FROM PUBLIC/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION b17_catalog_child_count\(text,uuid\) TO CURRENT_USER/);
  assert.match(sql, /CREATE FUNCTION b17_catalog_child_count\(kind text, ref uuid\) RETURNS integer/);
  assert.match(sql, /SECURITY DEFINER\nSET search_path=pg_catalog,public,pg_temp/);
  assert.ok(sql.includes("RAISE EXCEPTION 'b17.count_context'"), 'count guard denies (never 0) outside platform.config');
  assert.ok(sql.includes("RAISE EXCEPTION 'b17.count_args'"), 'count args validated (closed kind list, non-null ref)');
});
