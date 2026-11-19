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

  splitArea(areaId, direction) {
    const node = this._findNode(this.tree, areaId);
    if (!node) return;
    const newArea = new EditorArea(node.area.editorType, this);
    this.areas.set(newArea.id, newArea);
    const newLeaf = { type: 'leaf', areaId: newArea.id, area: newArea };
    const handle = new SplitHandle(direction, () => {});
    const splitNode = {
      type: 'split', direction, ratio: 0.5,
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
    splitNode.ratio = Math.max(0.1, Math.min(0.9, pos / (isH ? r.width : r.height)));
    this.render();
    this._changed();
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
