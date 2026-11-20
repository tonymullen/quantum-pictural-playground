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

const config = loadConfig({ ...process.env, DB_NAME: `qpp_test_${Date.now().toString(36)}`, PORT: '0' });
let client, db, server, base;
const demo = JSON.parse(readFileSync(new URL('../../demos/teleportation.json', import.meta.url)));

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

test('the app is served, but not the server’s own files', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<html|<!doctype/i);
  assert.equal((await fetch(base + '/js/app.js')).status, 200);
  assert.equal((await fetch(base + '/demos/index.json')).status, 200);
  assert.equal((await fetch(base + '/server/src/config.js')).status, 404);
  assert.equal((await fetch(base + '/server/package.json')).status, 404);
});

test('the app’s RemoteWorkbookStore works against the server', async () => {
  const { RemoteWorkbookStore } = await import('../../js/workbooks/WorkbookStores.js');
  const asCarol = (url, opts = {}) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), 'X-QPP-Dev-User': 'carol' } });
  const opts = { baseUrl: `${base}/api`, fetch: asCarol };
  const user = await RemoteWorkbookStore.probe(opts);
  assert.equal(user.displayName, 'carol');
  assert.equal(await RemoteWorkbookStore.probe({ baseUrl: 'http://127.0.0.1:9/api', timeoutMs: 500 }), null, 'no server → null');

  const tab1 = new RemoteWorkbookStore({ ...opts, user });
  const id = await tab1.save(demo);
  assert.deepEqual((await tab1.list()).map(w => w.id), [id]);
  assert.deepEqual(await tab1.load(id), demo);
  await tab1.save({ ...demo, name: 'Saved in place' }, id);
  assert.equal((await tab1.list())[0].name, 'Saved in place');

  // A second tab loads it, saves; the first tab's next save is refused, not lost
  const tab2 = new RemoteWorkbookStore({ ...opts, user });
  await tab2.load(id);
  await tab2.save({ ...demo, name: 'From tab 2' }, id);
  await assert.rejects(tab1.save({ ...demo, name: 'From tab 1' }, id), e => e.conflict === true && /another tab/.test(e.message));
  assert.equal((await tab2.list())[0].name, 'From tab 2');

  await tab2.remove(id);
  assert.equal((await tab1.list()).length, 0);
  await assert.rejects(tab1.load(id), e => e.status === 404);
});
