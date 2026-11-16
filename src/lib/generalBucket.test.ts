// TASK-PROTO-U4-1c (OD-12 §7) — general bucket: slug rules + idempotence, with a
// tiny in-memory stand-in for the three catalog tables (no DB needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERAL_DISCLOSURE_CODE,
  GENERAL_DISCLOSURE_TITLE,
  GENERAL_STANDARD_TITLE,
  backfillGeneralBuckets,
  ensureGeneralBucket,
  generalStandardCode,
  sanitizeServiceCode,
  type BucketDb,
} from './generalBucket.ts';

interface FakeState {
  services: { id: string; code: string }[];
  standards: { id: string; code: string }[];
  disclosures: { id: string; standard_id: string; code: string }[];
  mappings: { service_id: string; standard_id: string }[];
  calls: string[];
}

function fakeDb(state: FakeState): BucketDb {
  let seq = 0;
  const id = () => `id-${++seq}`;
  return {
    async query(text: string, params: any[] = []) {
      state.calls.push(text.replace(/\s+/g, ' ').trim());
      if (/SELECT id, code FROM services WHERE id/.test(text)) {
        const row = state.services.find((s) => s.id === params[0]);
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      if (/SELECT id FROM services ORDER BY code/.test(text)) {
        return { rows: [...state.services].sort((a, b) => a.code.localeCompare(b.code)).map((s) => ({ id: s.id })), rowCount: state.services.length };
      }
      if (/INSERT INTO standards/.test(text)) {
        if (state.standards.some((s) => s.code === params[0])) return { rows: [], rowCount: 0 };
        const row = { id: id(), code: String(params[0]) };
        state.standards.push(row);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      if (/SELECT id FROM standards WHERE code/.test(text)) {
        const row = state.standards.find((s) => s.code === params[0]);
        return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
      }
      if (/INSERT INTO disclosures/.test(text)) {
        if (state.disclosures.some((d) => d.standard_id === params[0] && d.code === params[1])) return { rows: [], rowCount: 0 };
        const row = { id: id(), standard_id: String(params[0]), code: String(params[1]) };
        state.disclosures.push(row);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      if (/SELECT id FROM disclosures WHERE standard_id/.test(text)) {
        const row = state.disclosures.find((d) => d.standard_id === params[0] && d.code === params[1]);
        return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
      }
      if (/INSERT INTO service_standards/.test(text)) {
        if (state.mappings.some((m) => m.service_id === params[0] && m.standard_id === params[1])) return { rows: [], rowCount: 0 };
        state.mappings.push({ service_id: String(params[0]), standard_id: String(params[1]) });
        return { rows: [{ id: id() }], rowCount: 1 };
      }
      throw new Error(`unexpected SQL in fake: ${text}`);
    },
  };
}

const fresh = (): FakeState => ({ services: [], standards: [], disclosures: [], mappings: [], calls: [] });

test('U4-1c general bucket: SANITIZED code is deterministic, uppercase and collision-safe', () => {
  assert.equal(sanitizeServiceCode('GRI'), 'GRI');
  assert.equal(generalStandardCode('GRI'), 'GENERAL-GRI');
  assert.equal(generalStandardCode('cbb/msx 2025'), 'GENERAL-CBB-MSX-2025');
  assert.equal(generalStandardCode('  msx--sa  '), 'GENERAL-MSX-SA');
  const arabic = sanitizeServiceCode('خدمة');
  assert.match(arabic, /^SERVICE-[0-9A-F]{8}$/);
  assert.notEqual(arabic, sanitizeServiceCode('خدمات'));
  assert.equal(sanitizeServiceCode(''), 'SERVICE-' + sanitizeServiceCode('').slice(8));
  assert.ok(generalStandardCode('x'.repeat(80)).length <= 56);
});

test('U4-1c general bucket: first call creates the three objects, a repeat is a no-op', async () => {
  const state = fresh();
  state.services.push({ id: 'svc-1', code: 'GRI' });
  const db = fakeDb(state);
  const first = await ensureGeneralBucket(db, 'svc-1');
  assert.deepEqual(first.created, { standard: true, disclosure: true, mapping: true });
  assert.equal(state.standards.length, 1);
  assert.equal(state.standards[0].code, 'GENERAL-GRI');
  assert.equal(state.disclosures.length, 1);
  assert.equal(state.disclosures[0].code, GENERAL_DISCLOSURE_CODE);
  assert.equal(state.mappings.length, 1);
  const second = await ensureGeneralBucket(db, 'svc-1');
  assert.deepEqual(second.created, { standard: false, disclosure: false, mapping: false });
  assert.equal(second.standardId, first.standardId);
  assert.equal(second.disclosureId, first.disclosureId);
  assert.equal(state.standards.length, 1);
  assert.equal(state.disclosures.length, 1);
  assert.equal(state.mappings.length, 1);
  // Idempotence is structural: every insert carries ON CONFLICT DO NOTHING, so a
  // concurrent pair of callers cannot mint a duplicate row.
  for (const sql of state.calls) {
    if (!/INSERT/.test(sql)) continue;
    assert.match(sql, /ON CONFLICT(?: \([^)]*\))? DO NOTHING/);
  }
});

test('U4-1c general bucket: backfill covers every service exactly once and is repeatable', async () => {
  const state = fresh();
  state.services.push({ id: 'svc-1', code: 'GRI' }, { id: 'svc-2', code: 'MSX' });
  const db = fakeDb(state);
  const run = await backfillGeneralBuckets(db);
  assert.deepEqual(run.map((r) => r.serviceCode).sort(), ['GRI', 'MSX']);
  assert.deepEqual(run.map((r) => r.created.mapping), [true, true]);
  assert.equal(state.mappings.length, 2);
  const again = await backfillGeneralBuckets(db);
  assert.deepEqual(again.map((r) => r.created), [
    { standard: false, disclosure: false, mapping: false },
    { standard: false, disclosure: false, mapping: false },
  ]);
  assert.equal(state.standards.length, 2);
});

test('U4-1c general bucket: titles are the owner-decided bilingual strings', () => {
  assert.equal(GENERAL_STANDARD_TITLE, 'عام / General');
  assert.equal(GENERAL_DISCLOSURE_TITLE, 'أسئلة عامة / General questions');
});
