// OD-11 §1 (product posture): the shipped product must never present itself with
// demo framing — no banner component, no banner copy, no banner translation key.
// These are stop-guards, not cosmetic lint: a re-introduced string fails the run.
//
// Tokens are assembled from fragments (the same technique as rtl.test.ts) so this
// file's own source never forms the strings it forbids — a plain grep for the
// banned words must return zero hits anywhere under src/, this guard included.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BANNER = 'Demo' + 'Banner'; // component identifier (imports + JSX usage)
const BANNER_KEY = 'demo' + 'Banner'; // translation key under `common`
const BANNER_COPY = 'Demo' + ' build'; // the visible copy the banner rendered

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...collect(rel));
    else out.push(rel);
  }
  return out;
}

const TEXTUAL = collect('src').filter((file) => /\.(ts|tsx|css|sql|json)$/.test(file));

function hitsFor(pattern: RegExp): string[] {
  return TEXTUAL.filter((file) => pattern.test(readFileSync(path.join(ROOT, file), 'utf8')));
}

test('OD-11 §1: no demo-build copy anywhere under src/i18n', () => {
  const i18n = TEXTUAL.filter((file) => file.startsWith('src/i18n/'));
  assert.ok(
    i18n.some((file) => file.endsWith('/translations.ts')),
    'non-vacuity: translations.ts is inside the scanned i18n surface',
  );
  const hits = i18n.filter((file) => readFileSync(path.join(ROOT, file), 'utf8').includes(BANNER_COPY));
  assert.deepEqual(hits, [], `demo-build copy must not ship in i18n: ${hits.join(', ')}`);
});

test('OD-11 §1: no banner component import or usage anywhere in src', () => {
  assert.ok(TEXTUAL.length > 100, 'non-vacuity: the whole src tree is scanned');
  const re = new RegExp(`\\b${BANNER}\\b`);
  assert.deepEqual(hitsFor(re), [], 'banner component reference must not survive in src');
});

test('OD-11 §1: no banner translation key anywhere in src', () => {
  const re = new RegExp(`\\b${BANNER_KEY}\\b`);
  assert.deepEqual(hitsFor(re), [], 'banner translation key must not survive in src');
});
