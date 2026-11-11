// Micro-fix proof: no Express-default HTML error page may escape the API.
//
// Spins a minimal Express app wired EXACTLY like src/server/routes.ts
// (routes → apiNotFoundHandler → globalJsonErrorHandler, mounted LAST) and
// proves over real HTTP that:
//  1. a synchronously-thrown error inside a route yields JSON (not HTML)
//     with the thrown status and code, and no stack trace;
//  2. a next(err)-forwarded error yields the same JSON shape;
//  3. a plain Error with no status defaults to 500 JSON;
//  4. an unknown route yields 404 JSON (not the default HTML page).
//
// Existing refusal bodies are NOT changed by this fix — they keep their own
// try/catch in-route; this suite only covers errors that would otherwise
// reach Express's default HTML finalhandler.

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  apiNotFoundHandler,
  errorStatus,
  globalJsonErrorHandler,
} from '../server/errorHandler.ts';

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  // Sync throw inside a route (Express forwards sync throws to error middleware).
  app.get('/boom-sync', () => {
    throw Object.assign(new Error('sync boom'), { statusCode: 418, code: 'test.boom' });
  });
  // Explicit next(err) forwarding (the reliable async path on Express 4).
  app.get('/boom-next', (_req, _res, next) => {
    next(Object.assign(new Error('next boom'), { status: 403, code: 'test.next' }));
  });
  // Plain error: no status, no code → 500 JSON.
  app.get('/boom-plain', () => {
    throw new Error('plain boom');
  });
  // Malformed JSON body also lands here (body-parser SyntaxError, status 400).
  app.post('/echo', (req, res) => {
    res.json({ seen: req.body });
  });
  // SAME terminal order as src/server/routes.ts.
  app.use(apiNotFoundHandler);
  app.use(globalJsonErrorHandler);
  return app;
}

async function listen(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function getRaw(base: string, path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', text, json };
}

test('thrown error inside a route yields JSON (not HTML) with the thrown status + code', async () => {
  const { base, close } = await listen(buildApp());
  try {
    const r = await getRaw(base, '/boom-sync');
    assert.equal(r.status, 418);
    assert.match(r.contentType, /application\/json/);
    assert.ok(!r.text.includes('<html'), 'must not be the Express HTML error page');
    assert.equal(r.json?.error, 'sync boom');
    assert.equal(r.json?.code, 'test.boom');
    assert.ok(!('stack' in (r.json ?? {})), 'stack trace must never be sent');
  } finally {
    await close();
  }
});

test('next(err)-forwarded 403 yields JSON with status + code, no stack', async () => {
  const { base, close } = await listen(buildApp());
  try {
    const r = await getRaw(base, '/boom-next');
    assert.equal(r.status, 403);
    assert.match(r.contentType, /application\/json/);
    assert.ok(!r.text.toLowerCase().includes('<html'), 'must not be an HTML page');
    assert.equal(r.json?.error, 'next boom');
    assert.equal(r.json?.code, 'test.next');
    assert.ok(!('stack' in (r.json ?? {})));
  } finally {
    await close();
  }
});

test('plain Error without status defaults to 500 JSON', async () => {
  const { base, close } = await listen(buildApp());
  try {
    const r = await getRaw(base, '/boom-plain');
    assert.equal(r.status, 500);
    assert.match(r.contentType, /application\/json/);
    assert.equal(r.json?.error, 'plain boom');
    assert.equal(r.json?.code, undefined);
  } finally {
    await close();
  }
});

test('unknown route yields 404 JSON (never the default HTML page)', async () => {
  const { base, close } = await listen(buildApp());
  try {
    const r = await getRaw(base, '/no-such-route');
    assert.equal(r.status, 404);
    assert.match(r.contentType, /application\/json/);
    assert.equal(r.json?.error, 'Not found');
    assert.ok(!r.text.toLowerCase().includes('<html'));
  } finally {
    await close();
  }
});

test('malformed JSON body yields 400 JSON (never an HTML page)', async () => {
  const { base, close } = await listen(buildApp());
  try {
    const r = await getRaw(base, '/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{oops',
    });
    assert.equal(r.status, 400);
    assert.match(r.contentType, /application\/json/);
    assert.ok(typeof r.json?.error === 'string' && r.json.error.length > 0);
    assert.ok(!r.text.toLowerCase().includes('<html'));
  } finally {
    await close();
  }
});

test('errorStatus: preserves statusCode/status in range, defaults 500 otherwise', () => {
  assert.equal(errorStatus(Object.assign(new Error('x'), { statusCode: 403 })), 403);
  assert.equal(errorStatus(Object.assign(new Error('x'), { status: 404 })), 404);
  assert.equal(errorStatus(new Error('plain')), 500);
  assert.equal(errorStatus(Object.assign(new Error('x'), { statusCode: 200 })), 500);
  assert.equal(errorStatus(Object.assign(new Error('x'), { statusCode: '403' })), 500);
  assert.equal(errorStatus(null), 500);
});
