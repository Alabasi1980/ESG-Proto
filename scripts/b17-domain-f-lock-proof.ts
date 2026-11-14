// U2-F scratch-only scheduling/fault-injection support. Used by f3 only;
// no production hooks, no source/schema alteration. API callbacks drive the
// actual dispatcher/wrapper/handler; oracle is exact-scratch/guarded by f3.
import assert from 'node:assert/strict';
import pg from 'pg';
import { hashTab } from '../src/server/access.ts';

type Reply = { status: number; text: string; data: any };
const pause = () => new Promise(r => setTimeout(r, 20));
async function waitForLock(c: pg.Client, fragment: string) {
  for (let i = 0; i < 300; i++) {
    // The scheduling gate is an open transaction: refresh PostgreSQL's stats
    // snapshot or repeated polls would keep seeing the first activity sample.
    await c.query('SELECT pg_stat_clear_snapshot()');
    const rows = (await c.query(`SELECT pid,pg_blocking_pids(pid) blockers FROM pg_stat_activity
      WHERE datname=current_database() AND usename='b17domainowner' AND state='active'
      AND wait_event_type='Lock' AND position($1 in query)>0`, [fragment])).rows;
    if (rows.some(r => r.blockers.length > 0)) return;
    await pause();
  }
  const active = (await c.query(`SELECT usename,state,wait_event_type,query FROM pg_stat_activity
    WHERE datname=current_database() AND pid<>pg_backend_pid()`)).rows;
  assert.fail(`No actual blocked SQL observed for ${fragment}: ${JSON.stringify(active)}`);
}

export async function concurrentRequestAndDeactivation(url: string, userId: string,
  read: () => Promise<Reply>, deactivate: () => Promise<Reply>) {
  const gate = new pg.Client({ connectionString: url }); await gate.connect();
  let reading: Promise<Reply> | undefined, writing: Promise<Reply> | undefined;
  try {
    await gate.query('BEGIN');
    await gate.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    // The actual request takes auth_sessions FOR SHARE, then queues at the
    // held user row. Deactivation must queue at the SESSION row, NOT users.
    reading = read();
    await waitForLock(gate, 'FROM users WHERE id=$1 FOR SHARE');
    writing = deactivate();
    await waitForLock(gate, 'SELECT sid FROM auth_sessions WHERE user_id = $1 ORDER BY sid FOR UPDATE');
    await gate.query('ROLLBACK'); // release the user gate; reader200, then writer200
    const [reader, writer] = await Promise.all([reading, writing]);
    assert.equal(reader.status, 200, reader.text);
    assert.equal(writer.status, 200, writer.text);
    return { reader, writer };
  } finally {
    await gate.query('ROLLBACK').catch(() => {});
    await Promise.allSettled([reading, writing].filter(Boolean));
    await gate.end();
  }
}

// Interceptors are scoped to one local operation and restored in finally.
// Nonmatching queries retain node-pg's callback/promise overload behaviour.
async function intercept<T>(hook: (sql: string, values: any[]) => Promise<void> | undefined,
  operation: () => Promise<T>) {
  const prototype = pg.Client.prototype as any;
  const original = prototype.query;
  prototype.query = function (...args: any[]) {
    const work = typeof args[0] === 'string' && Array.isArray(args[1]) ? hook(args[0], args[1]) : undefined;
    if (work) return work.then(() => original.apply(this, args));
    return original.apply(this, args);
  };
  try { return await operation(); } finally { prototype.query = original; }
}

export async function assertAuthorityHeldAtInsert(url: string, sid: string, tabId: string,
  email: string, operation: () => Promise<Reply>) {
  let inspected = 0;
  const result = await intercept((sql, values) => {
    if (!sql.includes('INSERT INTO users') || values[0] !== email) return;
    return (async () => {
      const observer = new pg.Client({ connectionString: url }); await observer.connect();
      try {
        for (const [text, id] of [
          ['SELECT sid FROM auth_sessions WHERE sid=$1 FOR UPDATE NOWAIT', sid],
          ['SELECT id FROM workspace_tabs WHERE id=$1 FOR UPDATE NOWAIT', tabId],
        ]) {
          await observer.query('BEGIN');
          await assert.rejects(() => observer.query(text, [id]), (e: any) => e.code === '55P03',
            'the actor session/tab lock must still be held at the business INSERT');
          await observer.query('ROLLBACK');
        }
        inspected++;
      } finally { await observer.end(); }
    })();
  }, operation);
  assert.equal(inspected, 1, 'non-vacuous inspection inside the real INSERT');
  return result;
}

export async function changeTabBetweenWrapperAndTransaction(handle: string,
  transition: () => Promise<void>, operation: () => Promise<Reply>) {
  let reads = 0;
  const result = await intercept((sql, values) => {
    if (!sql.includes('FROM workspace_tabs') || !sql.includes('FOR UPDATE') || values[0] !== hashTab(handle)) return;
    if (++reads === 2) return transition(); // wrapper committed; inner txn not yet locked tab
  }, operation);
  assert.ok(reads >= 2, 'the handler really re-read the tab after the wrapper');
  return result;
}

export async function failDeactivationAudit(userId: string, operation: () => Promise<Reply>) {
  let injected = 0;
  const result = await intercept((sql, values) => {
    if (sql.includes('INSERT INTO audit_log') && values[2] === 'USER_DEACTIVATED' && values[4] === userId) {
      injected++;
      // AFTER the actual users UPDATE + revocation trigger, BEFORE audit.
      return Promise.reject(Object.assign(new Error('INJECTED audit diagnostic: never expose'), { code: 'P0001' }));
    }
  }, operation);
  assert.equal(injected, 1, 'the fault reached the post-UPDATE audit write');
  return result;
}
