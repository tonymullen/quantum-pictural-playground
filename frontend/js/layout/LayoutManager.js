/**
 * LayoutManager — Binary tree of splits and editor areas.
 * LeafNode: { type:'leaf', areaId, area }
 * SplitNode: { type:'split', direction, ratio, children:[node,node], handle }
 */
import EditorArea from './EditorArea.js';
import SplitHandle from './SplitHandle.js';
import EditorRegistry from '../editors/EditorRegistry.js';

export default class LayoutManager {
  /**
   * @param {HTMLElement} rootEl
   * @param {{ spec?: object|false, onChange?: Function }} [options] — spec:
   *   a saved layout, the default if omitted, or false to start empty (a
   *   workbook will load one). onChange: called when panels are split,
   *   closed, resized or change editor type.
   */
  constructor(rootEl, { spec, onChange = null } = {}) {
    this.rootEl = rootEl;
    this.rootEl.classList.add('layout-container');
    this.areas = new Map();
    this.focusedId = null;
    this.tree = null;
    this.onChange = onChange;
    if (spec !== false) this.loadLayout(spec || LayoutManager.defaultSpec());
    this._resizeObserver = new ResizeObserver(() => this.render());
    this._resizeObserver.observe(this.rootEl);
  }

  /**
   * Split a panel in two; the new half shows the same editor type.
   * @param {number} [ratio] — where the divider goes (0–1 along the split)
   */
  splitArea(areaId, direction, ratio = 0.5) {
    const node = this._findNode(this.tree, areaId);
    if (!node) return;
    const newArea = new EditorArea(node.area.editorType, this);
    this.areas.set(newArea.id, newArea);
    const newLeaf = { type: 'leaf', areaId: newArea.id, area: newArea };
    const handle = new SplitHandle(direction, () => {});
    const splitNode = {
      type: 'split', direction, ratio: Math.max(0.1, Math.min(0.9, ratio)),
      children: [{ type: 'leaf', areaId: node.areaId, area: node.area }, newLeaf],
      handle
    };
    this._replaceNode(areaId, splitNode);
    handle.onDragCallback = (delta, ev) => this._handleDrag(splitNode, ev);
    this.render();
    this._changed();
  }

  closeArea(areaId) {
    if (this.tree.type === 'leaf') return;
    const pi = this._findParent(this.tree, null, areaId);
    if (!pi) return;
    const { parent, childIndex } = pi;
    const sibling = parent.children[childIndex === 0 ? 1 : 0];
    const area = this.areas.get(areaId);
    if (area) { area.destroy(); this.areas.delete(areaId); }
    if (parent.handle) parent.handle.destroy();
    this._replaceInTree(this.tree, parent, sibling);
    this.render();
    this._changed();
  }

  /* ---- Merging (Blender's "join areas") ---- */

  /** Each panel's rectangle as fractions of the whole layout: Map areaId → {x0, y0, x1, y1}. */
  leafRects() {
    const out = new Map();
    const walk = (n, r) => {
      if (n.type === 'leaf') { out.set(n.areaId, r); return; }
      if (n.direction === 'horizontal') {       // side by side
        const xm = r.x0 + (r.x1 - r.x0) * n.ratio;
        walk(n.children[0], { ...r, x1: xm }); walk(n.children[1], { ...r, x0: xm });
      } else {                                  // one above the other
        const ym = r.y0 + (r.y1 - r.y0) * n.ratio;
        walk(n.children[0], { ...r, y1: ym }); walk(n.children[1], { ...r, y0: ym });
      }
    };
    if (this.tree) walk(this.tree, { x0: 0, y0: 0, x1: 1, y1: 1 });
    return out;
  }

  /**
   * Can panel `srcId` take over panel `dstId`? Only if they share a whole edge
   * (same width and stacked, or same height and side by side), so the merged
   * panel is still a rectangle.
   * @returns {null | 'left'|'right'|'up'|'down'} the side of src that dst is on
   */
  mergeDirection(srcId, dstId) {
    if (srcId === dstId) return null;
    const R = this.leafRects(), a = R.get(srcId), b = R.get(dstId);
    if (!a || !b) return null;
    const eq = (u, v) => Math.abs(u - v) < 1e-6;
    if (eq(a.x0, b.x0) && eq(a.x1, b.x1)) {
      if (eq(a.y1, b.y0)) return 'down';
      if (eq(a.y0, b.y1)) return 'up';
    }
    if (eq(a.y0, b.y0) && eq(a.y1, b.y1)) {
      if (eq(a.x1, b.x0)) return 'right';
      if (eq(a.x0, b.x1)) return 'left';
    }
    return null;
  }

  /**
   * Merge: panel `srcId` grows over its neighbour `dstId`, whose editor is
   * closed. The split tree is rebuilt from the panels' rectangles.
   * @returns {boolean} whether the panels were merged
   */
  mergeAreas(srcId, dstId) {
    if (!this.mergeDirection(srcId, dstId)) return false;
    const R = this.leafRects(), a = R.get(srcId), b = R.get(dstId);
    R.set(srcId, { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
    R.delete(dstId);
    const prefer = this.tree.type === 'split' ? this.tree.direction : 'vertical';
    const tree = this._treeFromRects([...R].map(([id, r]) => ({ id, r })), { x0: 0, y0: 0, x1: 1, y1: 1 }, prefer);
    if (!tree) return false;                     // not a clean set of splits (cannot happen for a shared edge)
    const destroyHandles = n => { if (n.type === 'split') { if (n.handle) n.handle.destroy(); n.children.forEach(destroyHandles); } };
    destroyHandles(this.tree);
    const dst = this.areas.get(dstId);
    if (dst) { dst.destroy(); this.areas.delete(dstId); }
    if (this.focusedId === dstId) this.focusedId = null;
    this.tree = tree;
    this.setFocus(srcId);
    this.render();
    this._changed();
    return true;
  }

  /** Rebuild a split tree that cuts `box` into the rectangles `items` (straight cuts all the way across). */
  _treeFromRects(items, box, prefer) {
    const eps = 1e-6;
    if (items.length === 1) {
      const area = this.areas.get(items[0].id);
      return { type: 'leaf', areaId: items[0].id, area };
    }
    const dirs = prefer === 'horizontal' ? ['horizontal', 'vertical'] : ['vertical', 'horizontal'];
    for (const dir of dirs) {
      const [lo, hi] = dir === 'horizontal' ? ['x0', 'x1'] : ['y0', 'y1'];
      const cuts = [...new Set(items.map(it => it.r[hi]))].filter(c => c < box[hi] - eps).sort((u, v) => u - v);
      for (const c of cuts) {
        if (!items.every(it => it.r[hi] <= c + eps || it.r[lo] >= c - eps)) continue;
        const A = items.filter(it => it.r[hi] <= c + eps), B = items.filter(it => it.r[lo] >= c - eps);
        const ta = this._treeFromRects(A, { ...box, [hi]: c }, dir === 'horizontal' ? 'vertical' : 'horizontal');
        const tb = this._treeFromRects(B, { ...box, [lo]: c }, dir === 'horizontal' ? 'vertical' : 'horizontal');
        if (!ta || !tb) return null;
        const handle = new SplitHandle(dir, () => {});
        const node = { type: 'split', direction: dir, ratio: (c - box[lo]) / (box[hi] - box[lo]), children: [ta, tb], handle };
        handle.onDragCallback = (delta, ev) => this._handleDrag(node, ev);
        return node;
      }
    }
    return null;
  }

  setFocus(areaId) {
    if (this.focusedId === areaId) return;
    if (this.focusedId) { const p = this.areas.get(this.focusedId); if (p) p.setFocused(false); }
    this.focusedId = areaId;
    const a = this.areas.get(areaId); if (a) a.setFocused(true);
  }

  render() {
    if (!this.tree) return;
    this.rootEl.innerHTML = '';
    const r = this.rootEl.getBoundingClientRect();
    this.rootEl.appendChild(this._buildDOM(this.tree, r.width, r.height));
    for (const a of this.areas.values()) a.onResize();
  }

  /**
   * The default layout:
   *   ┌──────────────┬──────────────┐
   *   │ Circuit      │ Diagram      │
   *   ├──────────────┴──────────────┤
   *   │ Dirac                       │
   *   └─────────────────────────────┘
   */
  static defaultSpec() {
    return { type: 'split', direction: 'vertical', ratio: 0.6, children: [
      { type: 'split', direction: 'horizontal', ratio: 0.45, children: [
        { type: 'leaf', editorType: 'Circuit Editor' },
        { type: 'leaf', editorType: 'Diagram Editor' } ] },
      { type: 'leaf', editorType: 'Dirac Formula Editor' } ] };
  }

  /** The layout as plain data: splits, plus each panel's editor type and state. */
  serialize() {
    const ser = n => n.type === 'leaf'
      ? { type: 'leaf', ...n.area.specForSave() }
      : { type: 'split', direction: n.direction, ratio: n.ratio, children: n.children.map(ser) };
    return this.tree ? ser(this.tree) : null;
  }

  /** Replace every panel with the layout `spec` (editor types it does not know show an error). */
  loadLayout(spec) {
    const destroy = n => {
      if (!n) return;
      if (n.type === 'leaf') n.area.destroy();
      else { if (n.handle) n.handle.destroy(); n.children.forEach(destroy); }
    };
    destroy(this.tree);
    this.areas.clear();
    this.focusedId = null;
    const types = EditorRegistry.list();
    const build = s => {
      if (s.type === 'split') {
        const handle = new SplitHandle(s.direction, () => {});
        const node = { type: 'split', direction: s.direction, ratio: s.ratio ?? 0.5,
          children: s.children.map(build), handle };
        handle.onDragCallback = (delta, ev) => this._handleDrag(node, ev);
        return node;
      }
      const type = types.includes(s.editorType) ? s.editorType : (types[0] || s.editorType);
      const area = new EditorArea(type, this, s.state || null);
      this.areas.set(area.id, area);
      return { type: 'leaf', areaId: area.id, area };
    };
    this.tree = build(spec || LayoutManager.defaultSpec());
    this.render();
  }

  /** The focused panel, or the first one. */
  focusedArea() {
    return this.areas.get(this.focusedId) || this.areas.values().next().value || null;
  }

  _changed() { if (this.onChange) this.onChange(); }

  /** Close every visiting editor (e.g. the Workbook Browser), restoring what it covered. */
  closeTransients() {
    for (const a of this.areas.values()) a.closeTransient();
  }

  _createLeaf(editorType) {
    const a = new EditorArea(editorType, this);
    this.areas.set(a.id, a);
    this.tree = { type: 'leaf', areaId: a.id, area: a };
    this.render();
  }

  _findNode(n, id) {
    if (!n) return null;
    if (n.type === 'leaf') return n.areaId === id ? n : null;
    return this._findNode(n.children[0], id) || this._findNode(n.children[1], id);
  }

  _findParent(n, parent, id) {
    if (!n) return null;
    if (n.type === 'leaf') {
      if (n.areaId === id && parent) return { parent, childIndex: parent.children[0] === n ? 0 : 1 };
      return null;
    }
    return this._findParent(n.children[0], n, id) || this._findParent(n.children[1], n, id);
  }

  _replaceNode(areaId, replacement) {
    if (this.tree.type === 'leaf' && this.tree.areaId === areaId) { this.tree = replacement; return; }
    this._doReplace(this.tree, areaId, replacement);
  }
  _doReplace(n, areaId, rep) {
    if (n.type === 'leaf') return false;
    for (let i = 0; i < 2; i++) {
      const c = n.children[i];
      if (c.type === 'leaf' && c.areaId === areaId) { n.children[i] = rep; return true; }
      if (this._doReplace(c, areaId, rep)) return true;
    }
    return false;
  }

  _replaceInTree(root, target, rep) {
    if (root === target) { this.tree = rep; return; }
    this._doReplaceObj(this.tree, target, rep);
  }
  _doReplaceObj(n, target, rep) {
    if (n.type === 'leaf') return false;
    for (let i = 0; i < 2; i++) {
      if (n.children[i] === target) { n.children[i] = rep; return true; }
      if (this._doReplaceObj(n.children[i], target, rep)) return true;
    }
    return false;
  }

  _handleDrag(splitNode, ev) {
    const pe = splitNode.handle.el.parentElement;
    if (!pe) return;
    const r = pe.getBoundingClientRect();
    const isH = splitNode.direction === 'horizontal';
    const pos = isH ? (ev.clientX - r.left) : (ev.clientY - r.top);
    let ratio = Math.max(0.1, Math.min(0.9, pos / (isH ? r.width : r.height)));
    // Snap to a nearby panel edge elsewhere in the layout, so edges can be
    // lined up exactly (which merging needs)
    const snap = this._snapRatio(splitNode, ratio);
    splitNode.handle.el.classList.toggle('snapped', snap !== null);
    if (snap !== null) ratio = snap;
    splitNode.ratio = ratio;
    this.render();
    this._changed();
  }

  /** A ratio for `splitNode` that puts its divider exactly on another panel's edge within SNAP_PX, or null. */
  _snapRatio(splitNode, ratio) {
    const SNAP_PX = 10;
    const isH = splitNode.direction === 'horizontal';
    const [lo, hi] = isH ? ['x0', 'x1'] : ['y0', 'y1'];
    // this split's box and its subtree, in layout fractions
    let box = null; const inside = new Set();
    const walk = (n, rc, mine) => {
      if (n === splitNode) { box = rc; mine = true; }
      if (n.type === 'leaf') { if (mine) inside.add(n.areaId); return; }
      const h = n.direction === 'horizontal', k = h ? 'x' : 'y';
      const m = rc[k + '0'] + (rc[k + '1'] - rc[k + '0']) * n.ratio;
      walk(n.children[0], { ...rc, [k + '1']: m }, mine);
      walk(n.children[1], { ...rc, [k + '0']: m }, mine);
    };
    walk(this.tree, { x0: 0, y0: 0, x1: 1, y1: 1 }, false);
    if (!box) return null;
    const total = isH ? this.rootEl.getBoundingClientRect().width : this.rootEl.getBoundingClientRect().height;
    if (!total) return null;
    const c = box[lo] + (box[hi] - box[lo]) * ratio, tol = SNAP_PX / total;
    let best = null, bestD = tol;
    for (const [id, rc] of this.leafRects()) {
      if (inside.has(id)) continue;
      for (const e of [rc[lo], rc[hi]]) {
        if (e <= box[lo] + 1e-9 || e >= box[hi] - 1e-9) continue;
        const d = Math.abs(e - c);
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    return best === null ? null : (best - box[lo]) / (box[hi] - box[lo]);
  }

  _buildDOM(node, w, h) {
    if (node.type === 'leaf') {
      node.area.el.style.width = w + 'px';
      node.area.el.style.height = h + 'px';
      node.area.el.style.flex = 'none';
      return node.area.el;
    }
    const isH = node.direction === 'horizontal';
    const hs = 4, total = isH ? w : h, usable = total - hs;
    const f = usable * node.ratio, s = usable - f;
    const c = document.createElement('div');
    c.className = `split-container ${node.direction}`;
    c.style.width = w + 'px'; c.style.height = h + 'px';
    c.appendChild(this._buildDOM(node.children[0], isH ? f : w, isH ? h : f));
    c.appendChild(node.handle.el);
    c.appendChild(this._buildDOM(node.children[1], isH ? s : w, isH ? h : s));
    return c;
  }
}
