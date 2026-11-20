/**
 * WorkbookBrowser — where workbooks are opened and saved.
 *
 *   ┌ open workbook: name · Demo / My Workbooks · unsaved changes
 *   │   [Save] [Save a copy…] [＋ New] [Rename…]                         ┐
 *   ├ tree ────────────────────────┬ details ───────────────────────────┤
 *   │ ▾ Demos                      │ Bell state is a cup                │
 *   │     Getting started          │ 1 circuit · 1 proof                │
 *   │     Bell state is a cup      │ description …                      │
 *   │ ▾ My Workbooks               │ [Open]  [🗑 Delete]                │
 *   │     My proof                 │                                    │
 *   └──────────────────────────────┴────────────────────────────────────┘
 *
 * Demos and My Workbooks look and behave alike; only their stores differ
 * (WorkbookStores). Demos are read-only. Confirmations appear inline.
 */
import Session from '../../workbooks/WorkbookSession.js';
import { summaryText } from '../../workbooks/Workbook.js';

const ORIGIN_LABEL = { demo: 'Demo', mine: 'My Workbooks', new: 'Not saved yet' };

export default class WorkbookBrowser {
  static get typeName() { return 'Workbook Browser'; }
  /** Only visits a panel: it is not saved in workbooks, and showing it is not an edit. */
  static get transient() { return true; }

  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.lists = { demo: [], mine: [] };
    this.errors = { demo: '', mine: '' };
    this.collapsed = {};      // folder key → true (closed) / false (open), once the user toggles it
    this.selected = (options.state && options.state.selected) || null;   // { origin, id }
    this.pending = null;     // inline form/confirmation: { kind, ... }

    this.el = document.createElement('div');
    this.el.className = 'workbook-browser';
    this.container.appendChild(this.el);

    this.currentEl = document.createElement('div');
    this.currentEl.className = 'wb-current';
    this.mainEl = document.createElement('div');
    this.mainEl.className = 'wb-main';
    this.treeEl = document.createElement('div');
    this.treeEl.className = 'wb-tree';
    this.treeEl.tabIndex = 0;
    this.treeEl.addEventListener('keydown', e => this._onKey(e));
    this.detailsEl = document.createElement('div');
    this.detailsEl.className = 'wb-details';
    this.mainEl.append(this.treeEl, this.detailsEl);
    this.el.append(this.currentEl, this.mainEl);

    this._onSession = () => this.renderCurrent();
    Session.onChange(this._onSession);
    this._onSaveCopyRequest = () => this._startSaveCopy();
    window.addEventListener('qpp:save-copy', this._onSaveCopyRequest);

    this.renderCurrent();
    this.refresh();
  }

  getState() { return { selected: this.selected }; }

  /** Reload both lists. */
  async refresh() {
    await Promise.all(['demo', 'mine'].map(async origin => {
      try { this.lists[origin] = await Session.stores[origin].list(); this.errors[origin] = ''; }
      catch (e) { this.lists[origin] = []; this.errors[origin] = e.message; }
    }));
    if (this._destroyed) return;
    this.renderTree();
    this.renderDetails();
  }

  /* ---------------- The open workbook ---------------- */

  renderCurrent() {
    const c = Session.current, el = this.currentEl;
    el.innerHTML = '';
    const info = document.createElement('div');
    info.className = 'wb-current-info';
    info.append(this._span('Open:', 'wb-dim'), this._span(c.name, 'wb-current-name'),
      this._span(ORIGIN_LABEL[c.origin], `wb-origin wb-origin-${c.origin}`));
    if (Session.dirty) info.append(this._span('● unsaved changes', 'wb-dirty'));
    el.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'wb-actions';
    const p = this.pending;
    if (p && (p.kind === 'save-copy' || p.kind === 'rename')) {
      actions.appendChild(this._nameForm(p));
    } else {
      if (Session.canSave) actions.appendChild(this._button('Save', 'Save changes to this workbook (Cmd+S)',
        () => this._run(() => Session.save()), !Session.dirty));
      actions.append(
        this._button('Save a copy…', 'Save the open workbook as a new entry in My Workbooks', () => this._startSaveCopy()),
        this._button('＋ New', 'Start an empty workbook', () => this._confirmReplace({ kind: 'new' })),
        this._button('Rename…', 'Rename the open workbook', () => { this.pending = { kind: 'rename', value: c.name }; this.renderCurrent(); }),
        this._button('✕ Close', 'Close the browser and bring back the panel it covered', () => window.dispatchEvent(new Event('qpp:close-browser'))));
    }
    el.appendChild(actions);
    if (p && p.kind === 'error') el.appendChild(this._span(p.message, 'wb-error'));
    if (p && p.kind === 'note') el.appendChild(this._span(p.message, 'wb-note'));
  }

  _startSaveCopy() {
    const c = Session.current;
    this.pending = { kind: 'save-copy', value: c.origin === 'mine' ? `${c.name} (copy)` : c.name };
    this.renderCurrent();
    const input = this.currentEl.querySelector('input');
    if (input) { input.focus(); input.select(); }
  }

  _nameForm(p) {
    const form = document.createElement('form');
    form.className = 'wb-name-form';
    const input = document.createElement('input');
    input.type = 'text'; input.value = p.value; input.spellcheck = false;
    input.placeholder = 'Workbook name';
    const ok = this._button(p.kind === 'rename' ? 'Rename' : 'Save to My Workbooks', '', null);
    ok.type = 'submit';
    const cancel = this._button('Cancel', '', () => { this.pending = null; this.renderCurrent(); });
    form.append(this._span(p.kind === 'rename' ? 'Rename to' : 'Save a copy as', 'wb-dim'), input, ok, cancel);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      this.pending = null;
      if (p.kind === 'rename') { Session.rename(name); this.renderCurrent(); }
      else this._run(async () => {
        await Session.saveCopy(name);
        this.pending = { kind: 'note', message: `Saved “${name}” to My Workbooks` };
        await this.refresh();
        this.selected = { origin: 'mine', id: Session.current.storeId };
        this.renderTree(); this.renderDetails(); this.renderCurrent();
      });
    });
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }
      if (e.key === 'Escape') { this.pending = null; this.renderCurrent(); }
    });
    setTimeout(() => input.focus(), 0);
    return form;
  }

  /* ---------------- Tree ---------------- */

  renderTree() {
    const t = this.treeEl;
    t.innerHTML = '';
    this._visible = [];
    for (const origin of ['demo', 'mine']) {
      const store = Session.stores[origin];
      const folder = document.createElement('div');
      folder.className = 'wb-folder';
      const open = !this._isCollapsed(origin, [], []);
      folder.appendChild(this._folderHead(origin, [], store.label, store.note, open, 0));
      if (open) {
        folder.appendChild(this._span(store.note, 'wb-folder-note'));
        if (this.errors[origin]) folder.appendChild(this._span(this.errors[origin], 'wb-error'));
        else if (!this.lists[origin].length) folder.appendChild(this._span(
          origin === 'mine' ? 'Nothing saved yet — use “Save a copy…”' : 'No demos found', 'wb-empty'));
        this._renderLevel(folder, origin, [], this.lists[origin], 1);
      }
      t.appendChild(folder);
    }
  }

  /**
   * One level of the tree: items with no further folder, and a sub-folder per
   * next folder name, in the order they first appear in the list.
   */
  _renderLevel(parentEl, origin, path, items, depth) {
    const groups = [];        // { name, items } | { item }
    const byName = new Map();
    for (const item of items) {
      const f = item.folder || [];
      const name = f[path.length];
      if (name === undefined) { groups.push({ item }); continue; }
      if (!byName.has(name)) { const g = { name, items: [] }; byName.set(name, g); groups.push(g); }
      byName.get(name).items.push(item);
    }
    for (const g of groups) {
      if (g.item) { parentEl.appendChild(this._treeItem(origin, g.item, depth)); continue; }
      const sub = [...path, g.name];
      const open = !this._isCollapsed(origin, sub, g.items);
      const el = document.createElement('div');
      el.className = 'wb-subfolder';
      el.appendChild(this._folderHead(origin, sub, g.name, '', open, depth));
      if (open) this._renderLevel(el, origin, sub, g.items, depth + 1);
      parentEl.appendChild(el);
    }
  }

  _folderKey(origin, path) { return [origin, ...path].join('\u0000'); }

  /** A folder is open if the user opened it, or (by default) if it is a top level or holds the open or selected workbook. */
  _isCollapsed(origin, path, items) {
    const k = this._folderKey(origin, path);
    if (k in this.collapsed) return this.collapsed[k];
    if (path.length <= 1 && !(path.length === 1 && origin === 'demo' && path[0] === 'Software tour')) return false;
    const holds = it => (Session.current.origin === origin && Session.current.storeId === it.id)
      || (this.selected && this.selected.origin === origin && this.selected.id === it.id);
    return !items.some(holds);
  }

  _folderHead(origin, path, label, title, open, depth) {
    const head = document.createElement('div');
    head.className = depth ? 'wb-folder-head wb-subfolder-head' : 'wb-folder-head';
    head.style.paddingLeft = `${10 + depth * 14}px`;
    head.textContent = `${open ? '▾' : '▸'} ${label}`;
    if (title) head.title = title;
    head.addEventListener('click', () => { this.collapsed[this._folderKey(origin, path)] = open; this.renderTree(); });
    return head;
  }

  _treeItem(origin, item, depth = 1) {
    const row = document.createElement('div');
    const sel = this.selected && this.selected.origin === origin && this.selected.id === item.id;
    const isOpen = Session.current.origin === origin && Session.current.storeId === item.id;
    row.className = 'wb-item' + (sel ? ' selected' : '') + (isOpen ? ' is-open' : '');
    row.style.paddingLeft = `${10 + depth * 14}px`;
    row.dataset.origin = origin; row.dataset.id = item.id;
    row.append(this._span(item.exercise ? '✎' : '▤', 'wb-icon'), this._span(item.name, 'wb-item-name'),
      this._span(item.exercise ? `Exercise · ${'★'.repeat(item.exercise.level || 1)}` : summaryText(item.summary), 'wb-item-summary'));
    row.title = 'Double-click to open';
    row.addEventListener('mousedown', () => { this._select({ origin, id: item.id }); this.treeEl.focus({ preventScroll: true }); });
    row.addEventListener('dblclick', () => this._confirmReplace({ kind: 'open', origin, id: item.id, name: item.name }));
    this._visible.push({ origin, id: item.id, item });
    return row;
  }

  _select(sel) {
    this.selected = sel;
    if (this.pending && this.pending.kind !== 'save-copy' && this.pending.kind !== 'rename') this.pending = null;
    this.renderTree();
    this.renderDetails();
  }

  /** The workbooks visible in the tree, top to bottom (for the arrow keys). */
  _flat() { return this._visible || []; }

  _onKey(e) {
    const flat = this._flat();
    const i = this.selected ? flat.findIndex(f => f.origin === this.selected.origin && f.id === this.selected.id) : -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const j = Math.max(0, Math.min(flat.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (flat[j]) this._select({ origin: flat[j].origin, id: flat[j].id });
    } else if (e.key === 'Enter' && i >= 0) {
      this._confirmReplace({ kind: 'open', origin: flat[i].origin, id: flat[i].id, name: flat[i].item.name });
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && i >= 0 && flat[i].origin === 'mine') {
      e.preventDefault();
      this.pending = { kind: 'delete', id: flat[i].id, name: flat[i].item.name };
      this.renderDetails();
    }
  }

  /* ---------------- Details ---------------- */

  renderDetails() {
    const d = this.detailsEl;
    d.innerHTML = '';
    const p = this.pending;
    const sel = this.selected;
    const item = sel && this.lists[sel.origin].find(x => x.id === sel.id);

    if (p && (p.kind === 'open' || p.kind === 'new')) {
      d.appendChild(this._confirmBox(
        `“${Session.current.name}” has unsaved changes. ${p.kind === 'open' ? `Opening “${p.name}”` : 'Starting a new workbook'} replaces it.`,
        Session.canSave ? 'Save it first, or discard the changes.' : 'Use “Save a copy…” first to keep them, or discard them.',
        p.kind === 'open' ? 'Discard changes and open' : 'Discard changes', () => this._doReplace(p)));
      return;
    }
    if (!item) {
      d.appendChild(this._span('Select a workbook to see what it contains. Double-click (or Enter) opens it.', 'wb-hint'));
      return;
    }
    const h = document.createElement('h3'); h.textContent = item.name; d.appendChild(h);
    d.appendChild(this._span(`${Session.stores[sel.origin].label}${item.savedAt && sel.origin === 'mine' ? ' · saved ' + new Date(item.savedAt).toLocaleString() : ''}`, 'wb-dim'));
    d.appendChild(this._span(summaryText(item.summary), 'wb-summary'));
    if (item.description) { const para = document.createElement('p'); para.textContent = item.description; d.appendChild(para); }
    if (item.book && /^textbook\/[\w./#-]+$/.test(item.book)) {
      const a = document.createElement('a');
      a.className = 'wb-book-link'; a.href = item.book; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = item.exercise ? '📖 This exercise in the textbook' : '📖 Read this in the textbook';
      d.appendChild(a);
    }

    if (p && p.kind === 'delete' && p.id === item.id) {
      d.appendChild(this._confirmBox(`Delete “${item.name}” from My Workbooks?`, 'This cannot be undone.', 'Delete',
        () => this._run(async () => {
          await Session.stores.mine.remove(item.id);
          if (Session.current.origin === 'mine' && Session.current.storeId === item.id)
            Session.current = { ...Session.current, origin: 'new', storeId: null };
          this.pending = null; this.selected = null;
          await this.refresh(); this.renderCurrent();
        }), true));
      return;
    }
    const row = document.createElement('div');
    row.className = 'wb-actions';
    row.appendChild(this._button('Open', 'Open this workbook (replaces the open one)',
      () => this._confirmReplace({ kind: 'open', origin: sel.origin, id: item.id, name: item.name })));
    if (sel.origin === 'mine') row.appendChild(this._button('🗑 Delete', 'Delete from My Workbooks (Del)', () => {
      this.pending = { kind: 'delete', id: item.id, name: item.name }; this.renderDetails();
    }));
    if (sel.origin === 'demo') row.appendChild(this._span('Read-only — your changes are kept with “Save a copy…”', 'wb-dim'));
    d.appendChild(row);
  }

  _confirmBox(text, sub, okLabel, onOk, danger = false) {
    const box = document.createElement('div');
    box.className = 'wb-confirm';
    box.append(this._span(text, 'wb-confirm-text'), this._span(sub, 'wb-dim'));
    const row = document.createElement('div');
    row.className = 'wb-actions';
    const ok = this._button(okLabel, '', onOk);
    if (danger) ok.classList.add('danger');
    row.append(ok, this._button('Cancel', '', () => { this.pending = null; this.renderDetails(); }));
    box.appendChild(row);
    return box;
  }

  /* ---------------- Opening / new ---------------- */

  _confirmReplace(p) {
    if (Session.dirty) { this.pending = p; this.renderDetails(); return; }
    this._doReplace(p);
  }

  _doReplace(p) {
    this.pending = null;
    // Opening replaces every panel, this browser included — nothing may touch `this` afterwards
    if (p.kind === 'new') { Session.newWorkbook(); return; }
    this._run(() => Session.open(p.origin, p.id));
  }

  async _run(fn) {
    try { await fn(); }
    catch (e) {
      if (this._destroyed) return;
      this.pending = { kind: 'error', message: e.message };
      this.renderCurrent();
    }
  }

  /* ---------------- Helpers ---------------- */

  _span(text, cls) { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; }
  _button(text, title, fn, disabled = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wb-btn'; b.textContent = text; if (title) b.title = title;
    b.disabled = disabled;
    if (fn) b.addEventListener('click', fn);
    return b;
  }

  onResize() {}

  destroy() {
    this._destroyed = true;
    Session.offChange(this._onSession);
    window.removeEventListener('qpp:save-copy', this._onSaveCopyRequest);
    this.el.remove();
  }
}
