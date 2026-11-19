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
 * LocalWorkbookStore   — My Workbooks, kept in this browser (until the server exists)
 * RemoteWorkbookStore  — My Workbooks on the remote database (not implemented yet)
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
    this.note = 'Saved in this browser for now · server storage is coming';
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

/** My Workbooks on the remote database — the interface the server will implement. */
export class RemoteWorkbookStore {
  constructor({ baseUrl } = {}) {
    this.readOnly = false;
    this.label = 'My Workbooks';
    this.note = 'Stored on the server';
    this.baseUrl = baseUrl;
  }
  async list() { throw new Error('Server storage is not available yet'); }
  async load() { throw new Error('Server storage is not available yet'); }
  async save() { throw new Error('Server storage is not available yet'); }
  async remove() { throw new Error('Server storage is not available yet'); }
}
