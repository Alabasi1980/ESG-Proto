// TASK-PROTO-U4-1c (OD-12 §7) — general bucket: collision-proof codes + real
// idempotence, with a tiny in-memory stand-in for the three catalog tables.
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
  serviceBucketSuffix,
  type BucketDb,
} from './generalBucket.ts';

interface FakeState {
  services: { id: string; code: string }[];
  standards: { id: string; code: string; category: string }[];
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
        return { rows: [...state.services].sort((a, b) => a.code.localeCompare(b.code)).map((s) => ({ id: s.id })),
          rowCount: state.services.length };
      }
      if (/INSERT INTO standards/.test(text)) {
        if (state.standards.some((s) => s.code === params[0])) return { rows: [], rowCount: 0 };
        const row = { id: id(), code: String(params[0]), category: String(params[2]) };
        state.standards.push(row);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      if (/SELECT id FROM standards WHERE code/.test(text)) {
        const row = state.standards.find((s) => s.code === params[0]);
        return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
      }
      if (/SELECT code FROM standards WHERE id/.test(text)) {
        const row = state.standards.find((s) => s.id === params[0]);
        return { rows: row ? [{ code: row.code }] : [], rowCount: row ? 1 : 0 };
      }
      if (/SELECT st.id FROM service_standards ss JOIN standards st/.test(text)) {
        const mapped = state.mappings.filter((m) => m.service_id === params[0])
          .map((m) => state.standards.find((s) => s.id === m.standard_id)!).filter((s) => s && s.category === params[1])
          .sort((a, b) => a.code.localeCompare(b.code));
        return { rows: mapped.length ? [{ id: mapped[0].id }] : [], rowCount: mapped.length ? 1 : 0 };
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
const S1 = '31111111-1111-4111-8111-111111111111';
const S2 = '39999999-9999-4999-8999-999999999999';

test('U4-1c general bucket code: slug + service-id suffix, deterministic and unique per service', () => {
  assert.equal(generalStandardCode('GRI', S1), 'GENERAL-GRI-31111111');
  assert.equal(generalStandardCode('cbb/msx 2025', S1), 'GENERAL-CBB-MSX-2025-31111111');
  // R2 collision proof: two services whose codes slug to the SAME text still get
  // distinct bucket codes because the service id is part of the key.
  assert.equal(sanitizeServiceCode('CBB/MSX'), sanitizeServiceCode('cbb msx'));
  const a = generalStandardCode('CBB/MSX', S1), b = generalStandardCode('cbb msx', S2);
  assert.notEqual(a, b);
  assert.equal(a.split('-').at(-1), '31111111');
  assert.equal(serviceBucketSuffix('not-a-uuid'), serviceBucketSuffix('not-a-uuid'));
  assert.notEqual(serviceBucketSuffix('not-a-uuid'), serviceBucketSuffix('also-not-a-uuid'));
  assert.match(serviceBucketSuffix('not-a-uuid'), /^[0-9A-F]{8}$/);
  // Round 2 (F-10): a REAL invalid/empty code case, not a tautology.
  assert.match(sanitizeServiceCode(''), /^SERVICE-[0-9A-F]{8}$/);
  assert.notEqual(generalStandardCode('', S1), generalStandardCode('', S2));
  assert.notEqual(sanitizeServiceCode(''), sanitizeServiceCode('   '));
  assert.ok(generalStandardCode('x'.repeat(80), S1).length <= 60);
});

test('U4-1c general bucket: create once, then converge (idempotent, ON CONFLICT only)', async () => {
  const state = fresh();
  state.services.push({ id: S1, code: 'GRI' });
  const db = fakeDb(state);
  const first = await ensureGeneralBucket(db, S1);
  assert.deepEqual(first.created, { standard: true, disclosure: true, mapping: true });
  assert.equal(first.standardCode, 'GENERAL-GRI-31111111');
  assert.equal(first.adopted, false);
  state.standards[0].code = 'GENERAL-GRI-MOVED'; // simulate a renamed row
  const second = await ensureGeneralBucket(db, S1);
  assert.deepEqual(second.created, { standard: false, disclosure: false, mapping: false });
  assert.equal(second.standardId, first.standardId);
  assert.equal(second.disclosureId, first.disclosureId);
  assert.equal(second.adopted, true);
  assert.equal(state.standards.length, 1);
  assert.equal(state.disclosures.length, 1);
  assert.equal(state.mappings.length, 1);
  for (const sql of state.calls) {
    if (!/INSERT/.test(sql)) continue;
    assert.match(sql, /ON CONFLICT(?: \([^)]*\))? DO NOTHING/);
  }
});

test('U4-1c general bucket: a pre-suffix legacy bucket is adopted, never duplicated', async () => {
  const state = fresh();
  state.services.push({ id: S1, code: 'GRI' });
  state.standards.push({ id: 'legacy-std', code: 'GENERAL-GRI', category: 'general' });
  state.mappings.push({ service_id: S1, standard_id: 'legacy-std' });
  const result = await ensureGeneralBucket(fakeDb(state), S1);
  assert.equal(result.standardId, 'legacy-std');
  assert.equal(result.standardCode, 'GENERAL-GRI');
  assert.equal(result.adopted, true);
  assert.equal(state.standards.length, 1, 'no suffixed duplicate is minted before the rename');
});

test('U4-1c general bucket: backfill covers every service once and is repeatable', async () => {
  const state = fresh();
  state.services.push({ id: S1, code: 'CBB/MSX' }, { id: S2, code: 'cbb msx' });
  const db = fakeDb(state);
  const run = await backfillGeneralBuckets(db);
  assert.deepEqual(run.map((r) => r.serviceCode).sort(), ['CBB/MSX', 'cbb msx'].sort());
  assert.equal(new Set(run.map((r) => r.standardId)).size, 2, 'collision-prone codes get distinct buckets');
  assert.equal(state.mappings.length, 2);
  const again = await backfillGeneralBuckets(db);
  assert.deepEqual(again.map((r) => r.created),
    [{ standard: false, disclosure: false, mapping: false }, { standard: false, disclosure: false, mapping: false }]);
  assert.equal(state.standards.length, 2);
});

test('U4-1c general bucket: titles are the owner-decided bilingual strings', () => {
  assert.equal(GENERAL_STANDARD_TITLE, 'عام / General');
  assert.equal(GENERAL_DISCLOSURE_TITLE, 'أسئلة عامة / General questions');
  assert.equal(GENERAL_DISCLOSURE_CODE, 'GENERAL');
});
