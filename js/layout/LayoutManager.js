/**
 * LayoutManager — Binary tree of splits and editor areas.
 * LeafNode: { type:'leaf', areaId, area }
 * SplitNode: { type:'split', direction, ratio, children:[node,node], handle }
 */
import EditorArea from './EditorArea.js';
import SplitHandle from './SplitHandle.js';
import EditorRegistry from '../editors/EditorRegistry.js';

export default class LayoutManager {
  constructor(rootEl) {
    this.rootEl = rootEl;
    this.rootEl.classList.add('layout-container');
    this.areas = new Map();
    this.focusedId = null;
    this.tree = null;
    this._createDefaultLayout();
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
  }

  setFocus(areaId) {
    if (this.focusedId === areaId) return;
    if (this.focusedId) { const p = this.areas.get(this.focusedId); if (p) p.setFocused(false); }
    this.focusedId = areaId;
    const a = this.areas.get(areaId); if (a) a.setFocused(true);
  }

  render() {
    this.rootEl.innerHTML = '';
    const r = this.rootEl.getBoundingClientRect();
    this.rootEl.appendChild(this._buildDOM(this.tree, r.width, r.height));
    for (const a of this.areas.values()) a.onResize();
  }

  /**
   * Create the default layout:
   *   ┌──────────────┬──────────────┐
   *   │ Circuit      │ Diagram      │
   *   ├──────────────┴──────────────┤
   *   │ Dirac                       │
   *   └─────────────────────────────┘
   * Panels are created diagram → Dirac → circuit, so the Dirac editor first
   * links to the example diagram (the circuit and its diagram come after).
   */
  _createDefaultLayout() {
    const types = EditorRegistry.list();
    const pick = (word, fallback) => types.find(t => t.includes(word)) || fallback || types[0];
    const leaf = type => {
      const area = new EditorArea(type, this);
      this.areas.set(area.id, area);
      return { type: 'leaf', areaId: area.id, area };
    };
    const split = (direction, ratio, a, b) => {
      const handle = new SplitHandle(direction, () => {});
      const node = { type: 'split', direction, ratio, children: [a, b], handle };
      handle.onDragCallback = (delta, ev) => this._handleDrag(node, ev);
      return node;
    };
    const diagram = leaf(pick('Diagram'));
    const dirac = leaf(pick('Dirac'));
    const circuitType = types.find(t => t.includes('Circuit'));
    const top = circuitType ? split('horizontal', 0.45, leaf(circuitType), diagram) : diagram;
    this.tree = split('vertical', 0.6, top, dirac);
    this.render();
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
