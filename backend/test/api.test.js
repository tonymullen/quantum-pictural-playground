/**
 * API tests against a real MongoDB (MONGODB_URI, default local), in a
 * throwaway database that is dropped afterwards.  Run: npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { connect } from '../src/db.js';
import { createApp } from '../src/app.js';

const FRONTEND = 'https://frontend.example';
const config = loadConfig({ ...process.env, DB_NAME: `qpp_test_${Date.now().toString(36)}`, PORT: '0', ALLOWED_ORIGINS: FRONTEND });
let client, db, server, base;
const demo = JSON.parse(readFileSync(new URL('./fixtures/workbook.json', import.meta.url)));   // a sample workbook

before(async () => {
  ({ client, db } = await connect(config));
  server = createApp({ db, config }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await db.dropDatabase();
  await client.close();
});

/** Call the API as a given (development) user. */
const as = user => async (method, path, body) => {
  const r = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(user ? { 'X-QPP-Dev-User': user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};
const alice = as('alice'), bob = as('bob'), local = as(null);

test('who am I: a development user, created on first use', async () => {
  const a = await alice('GET', '/api/me');
  assert.equal(a.status, 200);
  assert.equal(a.body.user.displayName, 'alice');
  assert.deepEqual(a.body.user.providers, ['dev']);
  const again = await alice('GET', '/api/me');
  assert.equal(again.body.user.id, a.body.user.id, 'the same user each time');
  const l = await local('GET', '/api/me');
  assert.match(l.body.user.displayName, /no login/);
  assert.equal(await db.collection('users').countDocuments(), 2);
});

test('save, list, load, overwrite, delete', async () => {
  const created = await alice('POST', '/api/workbooks', { workbook: demo });
  assert.equal(created.status, 201);
  const { id } = created.body;
  assert.equal(created.body.revision, 1);

  const list = await alice('GET', '/api/workbooks');
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].name, demo.name);
  assert.deepEqual(list.body[0].summary, { circuits: 1, diagrams: 0, proofs: 1 }, 'summary recomputed by the server');
  assert.equal(list.body[0].content, undefined, 'listings carry no content');

  const loaded = await alice('GET', `/api/workbooks/${id}`);
  assert.deepEqual(loaded.body.workbook, demo, 'the workbook comes back exactly as saved');

  const renamed = { ...demo, name: 'My teleportation' };
  const put = await alice('PUT', `/api/workbooks/${id}`, { workbook: renamed, revision: 1 });
  assert.equal(put.status, 200);
  assert.equal(put.body.revision, 2);
  assert.equal((await alice('GET', '/api/workbooks')).body[0].name, 'My teleportation');

  const del = await alice('DELETE', `/api/workbooks/${id}`);
  assert.equal(del.status, 204);
  assert.equal((await alice('GET', '/api/workbooks')).body.length, 0);
  assert.equal((await alice('GET', `/api/workbooks/${id}`)).status, 404);
  assert.ok(await db.collection('workbooks').findOne({ deletedAt: { $ne: null } }), 'deleting keeps the data (soft delete)');
});

test('a stale save is refused (409), not silently overwritten', async () => {
  const { body: { id } } = await alice('POST', '/api/workbooks', { workbook: demo });
  assert.equal((await alice('PUT', `/api/workbooks/${id}`, { workbook: demo, revision: 1 })).status, 200);
  const stale = await alice('PUT', `/api/workbooks/${id}`, { workbook: { ...demo, name: 'Other tab' }, revision: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, 2, 'and says which revision is current');
  assert.equal((await alice('PUT', `/api/workbooks/${id}`, { workbook: demo })).status, 400, 'revision is required');
});

test('users only ever see their own workbooks', async () => {
  const { body: { id } } = await alice('POST', '/api/workbooks', { workbook: { ...demo, name: 'Alice only' } });
  assert.ok(!(await bob('GET', '/api/workbooks')).body.some(w => w.id === id), 'not in Bob’s list');
  assert.equal((await bob('GET', `/api/workbooks/${id}`)).status, 404, 'Bob can’t load it (404, not 403)');
  assert.equal((await bob('PUT', `/api/workbooks/${id}`, { workbook: demo, revision: 1 })).status, 404, 'or overwrite it');
  assert.equal((await bob('DELETE', `/api/workbooks/${id}`)).status, 404, 'or delete it');
  assert.equal((await alice('GET', `/api/workbooks/${id}`)).status, 200, 'Alice still can');
});

test('bad input is refused with a reason', async () => {
  const r = await alice('POST', '/api/workbooks', { workbook: { ...demo, format: 'other' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /format/);
  assert.equal((await alice('POST', '/api/workbooks', { workbook: { ...demo, name: '  ' } })).status, 400);
  assert.equal((await alice('POST', '/api/workbooks', { workbook: { ...demo, documents: [{ kind: 'spaceship' }] } })).status, 400);
  assert.equal((await alice('GET', '/api/workbooks/not-an-id')).status, 404);
  assert.equal((await as('bad user!')('GET', '/api/me')).status, 400);
  const huge = { ...demo, description: 'x'.repeat(config.maxWorkbookBytes + 10) };
  assert.equal((await alice('POST', '/api/workbooks', { workbook: huge })).status, 413);
});

test('workbook keys MongoDB could not store as field names survive', async () => {
  const odd = { ...demo, documents: [...demo.documents, { kind: 'proof', id: 'p-odd', data: { name: 'odd', assumptions: { '$x.y': 'causal' }, steps: [] } }] };
  const { body: { id } } = await alice('POST', '/api/workbooks', { workbook: odd });
  const back = await alice('GET', `/api/workbooks/${id}`);
  assert.equal(back.body.workbook.documents.at(-1).data.assumptions['$x.y'], 'causal');
});

test('only the API is served: no files', async () => {
  for (const p of ['/', '/index.html', '/js/app.js', '/src/config.js', '/package.json']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 404, p);
    assert.match((await r.json()).error, /api/);
  }
});

test('CORS: the frontend’s origin may call the API, others may not', async () => {
  const pre = await fetch(base + '/api/workbooks', { method: 'OPTIONS', headers: {
    Origin: FRONTEND, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), FRONTEND);
  assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');
  assert.match(pre.headers.get('access-control-allow-methods'), /PUT/);
  const get = await fetch(base + '/api/me', { headers: { Origin: FRONTEND } });
  assert.equal(get.headers.get('access-control-allow-origin'), FRONTEND);
  const other = await fetch(base + '/api/me', { headers: { Origin: 'https://elsewhere.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null, 'no CORS grant for other origins');
  const otherPre = await fetch(base + '/api/workbooks', { method: 'OPTIONS', headers: { Origin: 'https://elsewhere.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(otherPre.status, 403);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'oauth' }), /ALLOWED_ORIGINS/);
});
