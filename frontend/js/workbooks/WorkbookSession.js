/**
 * WorkbookSession — the workbook that is open right now.
 *
 *   current = { name, description, origin: 'demo'|'mine'|'new', storeId, exercise }
 *             (exercise: the textbook exercise this workbook is a starter for, or null)
 *   dirty   — true once anything changes after opening or saving
 *
 * Opening a workbook replaces every document and every panel. Demos are
 * read-only: changes to an opened demo are kept only by "Save a copy to My
 * Workbooks". A workbook from My Workbooks can be saved in place.
 */
import DocumentStore from '../editors/DocumentStore.js';
import { captureWorkbook, openWorkbookDocuments } from './Workbook.js';
import { DemoStore, LocalWorkbookStore, RemoteWorkbookStore } from './WorkbookStores.js';

const Session = {
  /** Where workbooks come from: Demos (read-only) and My Workbooks. */
  stores: { demo: new DemoStore(), mine: new LocalWorkbookStore() },
  /** The signed-in user (from the server), or null when there is no server. */
  user: null,
  current: { name: 'Untitled workbook', description: '', origin: 'new', storeId: null, exercise: null },
  dirty: false,
  _layout: null,
  _loading: false,
  _listeners: new Set(),

  /** Connect to the app's layout manager (call once at startup). */
  attach(layout) {
    this._layout = layout;
    layout.onChange = () => this.markDirty();
    DocumentStore.onAnyChange(() => this.markDirty());
    DocumentStore.onListChange(() => this.markDirty());
  },

  /**
   * Use the server for My Workbooks if there is one (call once at startup).
   * Without a server, My Workbooks stays in this browser.
   * @returns {Promise<boolean>} whether the server is in use
   */
  async connectServer(opts = {}) {
    if (!opts.baseUrl) return false;
    const user = await RemoteWorkbookStore.probe(opts);
    if (!user) return false;
    this.user = user;
    this.stores.mine = new RemoteWorkbookStore({ ...opts, user });
    this._notify();
    return true;
  },

  onChange(fn) { this._listeners.add(fn); },
  offChange(fn) { this._listeners.delete(fn); },
  _notify() { for (const fn of this._listeners) fn(this); },

  markDirty() {
    if (this._loading || this.dirty) return;
    this.dirty = true;
    this._notify();
  },

  /** The open workbook as JSON (documents + layout). */
  capture(name = this.current.name) {
    return captureWorkbook({ name, description: this.current.description, exercise: this.current.exercise }, this._layout.serialize());
  },

  /** Open a workbook from a store ('demo' or 'mine'). */
  async open(origin, id) {
    const wb = await this.stores[origin].load(id);
    this.openJSON(wb, { origin, storeId: id });
  },

  /** Open workbook JSON: replaces all documents and panels. */
  openJSON(wb, { origin, storeId = null }) {
    this._loading = true;
    try {
      const { layout } = openWorkbookDocuments(wb);
      this._layout.loadLayout(layout || this._layout.constructor.defaultSpec());
      this.current = { name: wb.name, description: wb.description || '', origin, storeId, exercise: wb.exercise || null };
    } finally {
      this._loading = false;
      this.dirty = false;
      this._notify();
    }
  },

  /** Start an empty workbook with the default panels (each creates an empty document). */
  newWorkbook(name = 'Untitled workbook') {
    this._loading = true;
    try {
      DocumentStore.clear();
      this._layout.loadLayout(this._layout.constructor.defaultSpec());
      this.current = { name, description: '', origin: 'new', storeId: null, exercise: null };
    } finally {
      this._loading = false;
      this.dirty = false;
      this._notify();
    }
  },

  /** Can "Save" overwrite the open workbook? (Only one from My Workbooks.) */
  get canSave() { return this.current.origin === 'mine'; },

  async save() {
    if (!this.canSave) throw new Error('Use “Save a copy to My Workbooks”');
    await this.stores.mine.save(this.capture(), this.current.storeId);
    this.dirty = false;
    this._notify();
  },

  /** Save the open workbook as a new entry in My Workbooks, and continue in it. */
  async saveCopy(name) {
    const id = await this.stores.mine.save(this.capture(name));
    this.current = { ...this.current, name, origin: 'mine', storeId: id };
    this.dirty = false;
    this._notify();
    return id;
  },

  rename(name) {
    if (!name || name === this.current.name) return;
    this.current = { ...this.current, name };
    this.dirty = true;
    this._notify();
  },
};

export default Session;
