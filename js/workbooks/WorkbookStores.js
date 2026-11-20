/**
 * WorkbookStores — where workbooks live. Every store has the same interface,
 * so the Workbook Browser treats them alike:
 *
 *   list()          → Promise<{ id, name, description, summary, savedAt }[]>
 *   load(id)        → Promise<workbook JSON>
 *   save(wb, id?)   → Promise<id>      (writable stores only; id = overwrite)
 *   remove(id)      → Promise<void>    (writable stores only)
 *   readOnly        boolean
 *   label, note     shown in the browser
 *
 * DemoStore            — read-only; the demos shipped with the app (demos/*.json)
 * LocalWorkbookStore   — My Workbooks kept in this browser (when there is no server)
 * RemoteWorkbookStore  — My Workbooks on the server (server/, MongoDB)
 */

/** Demos: read-only JSON files shipped with the app. */
export class DemoStore {
  /** @param {{ fetchJSON?: (path: string) => Promise<any>, base?: string }} [opts] */
  constructor({ fetchJSON, base = 'demos/' } = {}) {
    this.readOnly = true;
    this.label = 'Demos';
    this.note = 'Included with the app · open one and “Save a copy” to keep your changes';
    this.base = base;
    this.fetchJSON = fetchJSON || (async path => {
      const r = await fetch(path, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
      return r.json();
    });
  }
  async list() { return (await this.fetchJSON(this.base + 'index.json')).demos; }
  async load(id) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Bad demo id "${id}"`);
    return this.fetchJSON(`${this.base}${id}.json`);
  }
  async save() { throw new Error('Demos are read-only — save a copy to My Workbooks'); }
  async remove() { throw new Error('Demos are read-only'); }
}

/** My Workbooks, stored in this browser's localStorage. */
export class LocalWorkbookStore {
  /** @param {{ storage?: Storage, key?: string }} [opts] */
  constructor({ storage = globalThis.localStorage, key = 'qpp.myWorkbooks.v1' } = {}) {
    this.readOnly = false;
    this.label = 'My Workbooks';
    this.note = 'Saved in this browser — no server is running (start it with: cd server && npm start)';
    this.storage = storage;
    this.key = key;
  }
  _all() {
    try { return JSON.parse(this.storage.getItem(this.key) || '{}'); }
    catch { return {}; }
  }
  _write(all) {
    try { this.storage.setItem(this.key, JSON.stringify(all)); }
    catch (e) { throw new Error('Could not save — browser storage is full or unavailable'); }
  }
  async list() {
    return Object.entries(this._all())
      .map(([id, wb]) => ({ id, name: wb.name, description: wb.description, summary: wb.summary, savedAt: wb.savedAt }))
      .sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  }
  async load(id) {
    const wb = this._all()[id];
    if (!wb) throw new Error('That workbook no longer exists');
    return wb;
  }
  async save(wb, id = null) {
    const all = this._all();
    const key = id || `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    all[key] = wb;
    this._write(all);
    return key;
  }
  async remove(id) {
    const all = this._all();
    delete all[id];
    this._write(all);
  }
}

/**
 * My Workbooks on the server (server/, MongoDB). Keeps the revision of each
 * workbook it has listed or loaded, so a save from a stale tab is refused
 * (the server answers 409) instead of overwriting newer work.
 */
export class RemoteWorkbookStore {
  /** @param {{ baseUrl?: string, fetch?: typeof fetch, user?: object }} [opts] */
  constructor({ baseUrl = 'api', fetch: fetchImpl, user = null } = {}) {
    this.readOnly = false;
    this.label = 'My Workbooks';
    this.user = user;
    this.note = user ? `Saved on the server · ${user.displayName}` : 'Saved on the server';
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this._fetch = fetchImpl || ((...a) => fetch(...a));
    this._revisions = new Map();
  }

  /** Is there a server? Resolves to the current user, or null (no server / not reachable). */
  static async probe({ baseUrl = 'api', fetch: fetchImpl, timeoutMs = 2000 } = {}) {
    const f = fetchImpl || ((...a) => fetch(...a));
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await f(`${baseUrl.replace(/\/$/, '')}/me`, { cache: 'no-store', signal: ctl && ctl.signal });
      if (!r.ok) return null;
      const body = await r.json();
      return body && body.user ? body.user : null;
    } catch { return null; } finally { if (timer) clearTimeout(timer); }
  }

  async _call(method, path, body) {
    let r;
    try {
      r = await this._fetch(`${this.baseUrl}/workbooks${path}`, {
        method, cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new Error('Could not reach the server — check that it is running'); }
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) {
      const err = new Error((data && data.error) || `Server error (${r.status})`);
      err.status = r.status;
      if (r.status === 409) { err.conflict = true; err.message = 'This workbook was saved somewhere else (another tab?) since you opened it — use “Save a copy” to keep your version'; }
      throw err;
    }
    return data;
  }

  async list() {
    const rows = await this._call('GET', '');
    for (const w of rows) this._revisions.set(w.id, w.revision);
    return rows;
  }
  async load(id) {
    const { workbook, revision } = await this._call('GET', `/${encodeURIComponent(id)}`);
    this._revisions.set(id, revision);
    return workbook;
  }
  async save(wb, id = null) {
    if (id) {
      if (!this._revisions.has(id)) await this.load(id);      // learn the revision we are replacing
      const { revision } = await this._call('PUT', `/${encodeURIComponent(id)}`, { workbook: wb, revision: this._revisions.get(id) });
      this._revisions.set(id, revision);
      return id;
    }
    const { id: newId, revision } = await this._call('POST', '', { workbook: wb });
    this._revisions.set(newId, revision);
    return newId;
  }
  async remove(id) {
    await this._call('DELETE', `/${encodeURIComponent(id)}`);
    this._revisions.delete(id);
  }
}
