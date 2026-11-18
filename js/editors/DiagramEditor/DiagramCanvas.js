/**
 * DiagramCanvas — Interactive HTML5 Canvas for quantum diagrams.
 *
 * One interaction mode, no tools:
 *   - Drag a port handle      → draw a wire (snaps to a compatible port)
 *   - Drag a spider's + handle → new leg; drop on another spider to join them
 *   - Drag a connected port   → pick up that wire end; drop on empty space to remove it
 *   Wires between two spiders are legs: drawn straight, and removing the wire
 *   removes the legs.
 *   - Drag a node             → move it (moves all selected nodes)
 *   - Click a node / wire     → select (Shift adds); drag on empty space → box select
 *   - Click a spider/box port → select that leg (🗑 removes it)
 *   - Delete / Backspace      → delete selection (same as the 🗑 button)
 *   - Alt+drag / middle-drag  → pan; wheel → zoom
 */
import DiagramNode, { uprightText } from './DiagramNode.js';
import { ORIENTATIONS, orient, unorient } from '../../core/FlowDirection.js';
import DiagramWire, { wireCurve, straightCurve, strokeCurve } from './DiagramWire.js';
import diagramToIR from '../../core/DiagramToIR.js';

const PORT_HIT_R = 8;     // world-space radius for grabbing a port handle
const DRAG_THRESHOLD = 3; // screen px before a press becomes a drag
const LEG_HANDLE_R = 6;   // radius of a spider's "+ new leg" handle

export default class DiagramCanvas {
  /**
   * @param {HTMLElement} containerEl
   * @param {import('./DiagramDocument.js').default} doc — shared document
   * @param {{ onSelectionChange?: Function, onEditLabel?: Function }} [hooks]
   */
  constructor(containerEl, doc, hooks = {}) {
    this.container = containerEl;
    this.doc = doc;
    this.hooks = hooks;
    this.panX = 0; this.panY = 0; this.zoom = 1;
    this.orientation = ORIENTATIONS.pqp;   // view only (see FlowDirection.js)
    this.gesture = null;   // active mouse gesture (move | wire | rect | press)
    this.hover = null;     // { kind:'port', nodeId, dir, port } | { kind:'node'|'wire', ... }
    this.selectedPort = null; // { nodeId, dir, port } — a selected leg (view state)
    // Port indices can shift on any edit, so a selected leg does not survive one
    this._onDocChange = () => { this.selectedPort = null; this.draw(); this._selectionChanged(); };
    this.doc.onChange(this._onDocChange);
    this.wrapEl = document.createElement('div');
    this.wrapEl.className = 'diagram-canvas-wrap';
    this.canvas = document.createElement('canvas');
    this.wrapEl.appendChild(this.canvas);
    this.container.appendChild(this.wrapEl);
    this.ctx = this.canvas.getContext('2d');
    this._bindEvents();
    // Robust deferred resize: retry until the container has real dimensions
    this._retryResize(0);
  }

  _retryResize(attempt) {
    requestAnimationFrame(() => {
      const r = this.wrapEl.getBoundingClientRect();
      if ((r.width === 0 || r.height === 0) && attempt < 10) {
        this._retryResize(attempt + 1);
        return;
      }
      this.resize();
    });
  }

  /** Proxy getters — all data lives on the shared document. */
  get nodes() { return this.doc.nodes; }
  get wires() { return this.doc.wires; }
  set wires(v) { this.doc.wires = v; }

  /** Switch to a different document (called by the editor selector). */
  setDocument(doc) {
    this.doc.offChange(this._onDocChange);
    this.doc = doc;
    this.doc.onChange(this._onDocChange);
    this.gesture = null; this.hover = null; this.selectedPort = null;
    if (doc.derivedFrom) this.fitToContent();  // generated layouts can be anywhere
    this.draw();
    this._selectionChanged();
  }

  /* ---- Editing operations ---- */

  addNode(type, x, y) {
    if (x === undefined) {
      const r = this.canvas.getBoundingClientRect();
      ({ x, y } = this._screenToWorld(r.width / 2, r.height / 2));
    }
    this.doc.pushUndo();
    const node = new DiagramNode(type, x, y);
    this.nodes.set(node.id, node);
    this._commit();
    return node;
  }

  clearAll() { this.doc.pushUndo(); this.nodes.clear(); this.wires = []; this._commit(); }

  deleteSelected() {
    if (this.selectedPort) {
      const { nodeId, dir, port } = this.selectedPort;
      const node = this.nodes.get(nodeId);
      if (node) {
        this.doc.pushUndo();
        this.doc.removeLeg(node, dir, port);
        this._commit();
      }
      return;
    }
    const ids = new Set();
    for (const [id, n] of this.nodes) { if (n.selected) ids.add(id); }
    const hasSelectedWires = this.wires.some(w => w.selected);
    if (ids.size === 0 && !hasSelectedWires) {
      this._showToast('Select nodes, wires or a leg to delete', 'warn');
      return;
    }
    this.doc.pushUndo();
    // Remove wires first, while both ends exist, so spider legs are pruned
    this.doc.removeWires(this.wires.filter(w =>
      w.selected || ids.has(w.fromNodeId) || ids.has(w.toNodeId)));
    for (const id of ids) this.nodes.delete(id);
    this._commit();
  }

  /**
   * Change a node's leg counts. Removing a leg takes an unconnected one when
   * possible; if a connected spider–spider leg must go, the partner's leg
   * goes with it (DiagramDocument.dropLeg).
   */
  setArity(node, inputs, outputs) {
    inputs = Math.max(0, inputs); outputs = Math.max(0, outputs);
    if (inputs === node.inputs && outputs === node.outputs) return;
    this.doc.pushUndo();
    while (node.inputs > inputs) this.doc.dropLeg(node, 'in');
    while (node.outputs > outputs) this.doc.dropLeg(node, 'out');
    node.inputs = Math.max(node.inputs, inputs);
    node.outputs = Math.max(node.outputs, outputs);
    this._commit();
  }

  setLabel(node, label) {
    if (label === node.label) return;
    this.doc.pushUndo();
    node.label = label;
    this._commit();
  }

  /** Selected nodes (array). */
  selectedNodes() { return Array.from(this.nodes.values()).filter(n => n.selected); }

  undo() { if (!this.doc.undo()) this._showToast('Nothing to undo', 'warn'); }
  redo() { if (!this.doc.redo()) this._showToast('Nothing to redo', 'warn'); }

  /** Notify other viewers that data changed. */
  _commit() { this.doc.commit(); }

  _selectionChanged() { if (this.hooks.onSelectionChange) this.hooks.onSelectionChange(); }

  /** Change the view orientation (drawing only) and refit the view. */
  setOrientation(id) {
    this.orientation = ORIENTATIONS[id] || ORIENTATIONS.pqp;
    if (this.nodes.size) this.fitToContent(); else this.draw();
  }

  /** Pan/zoom so every node is visible (zoom capped at 1). */
  fitToContent(margin = 50) {
    const r = this.canvas.getBoundingClientRect();
    if (!this.nodes.size || !r.width || !r.height) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.nodes.values()) {
      const p = orient(this.orientation, n.x, n.y), pad = n.radius + 20;
      x0 = Math.min(x0, p.x - pad); x1 = Math.max(x1, p.x + pad);
      y0 = Math.min(y0, p.y - pad); y1 = Math.max(y1, p.y + pad);
    }
    this.zoom = Math.min(1, (r.width - 2 * margin) / (x1 - x0), (r.height - 2 * margin) / (y1 - y0));
    this.panX = r.width / 2 - ((x0 + x1) / 2) * this.zoom;
    this.panY = r.height / 2 - ((y0 + y1) / 2) * this.zoom;
    this.draw();
  }

  /* ---- Rendering ---- */

  resize() {
    const r = this.wrapEl.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    if (w === 0 || h === 0) return;
    // Boundary order depends on positions, so recompute on every frame
    try { diagramToIR(this.doc); } catch { /* markers are best-effort */ }
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);
    const o = this.orientation;
    ctx.transform(o.a, o.b, o.c, o.d, 0, 0);
    ctx.__orient = o;
    this._drawGrid(ctx, w, h);
    const g = this.gesture;
    for (const wire of this.wires) {
      if (g && g.kind === 'wire' && g.detached === wire) continue;
      wire.draw(ctx, this.nodes);
    }
    for (const node of this.nodes.values()) node.draw(ctx);
    this._drawBoundaryMarkers(ctx);
    this._drawHandles(ctx);
    if (g && g.kind === 'wire') this._drawWiringPreview(ctx);
    ctx.restore();
    this._drawFlowArrow();
    if (g && g.kind === 'rect') this._drawSelRect();
  }

  /** Port-handle highlights: hovered port, and valid targets while wiring. */
  _drawHandles(ctx) {
    const ring = (p, color, r) => {
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    };
    ctx.save();
    const g = this.gesture;
    if (g && g.kind === 'wire') {
      const isLeg = g.anchor.dir === 'leg';
      const wants = isLeg ? ['in', 'out'] : [g.anchor.dir === 'out' ? 'in' : 'out'];
      for (const node of this.nodes.values()) {
        if (node.id === g.anchor.nodeId) continue;
        for (const want of wants) {
          const n = want === 'in' ? node.inputs : node.outputs;
          for (let i = 0; i < n; i++) {
            const p = this._portPos(node, want, i);
            const t = g.target;
            const isTarget = t && !t.isNew && t.nodeId === node.id && t.dir === want && t.port === i;
            ring(p, isTarget ? '#4fc1ff' : 'rgba(79,193,255,0.35)', isTarget ? 7 : 5);
          }
        }
      }
      if (g.target && g.target.isNew) {
        const n = this.nodes.get(g.target.nodeId);
        if (n) ring({ x: n.x, y: n.y }, '#4fc1ff', n.radius + 6);
      }
    } else {
      // "+ new leg" handle on the hovered / selected spiders
      for (const node of this._legHandleNodes()) {
        const p = this._legHandlePos(node);
        const hot = this.hover && this.hover.kind === 'leg' && this.hover.nodeId === node.id;
        ctx.beginPath(); ctx.arc(p.x, p.y, LEG_HANDLE_R, 0, Math.PI * 2);
        ctx.fillStyle = hot ? '#4fc1ff' : 'rgba(30,30,30,0.9)'; ctx.fill();
        ctx.strokeStyle = '#4fc1ff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.strokeStyle = hot ? '#1e1e1e' : '#4fc1ff';
        ctx.beginPath();
        ctx.moveTo(p.x - 3, p.y); ctx.lineTo(p.x + 3, p.y);
        ctx.moveTo(p.x, p.y - 3); ctx.lineTo(p.x, p.y + 3);
        ctx.stroke();
      }
    }
    if (this.selectedPort) {
      const node = this.nodes.get(this.selectedPort.nodeId);
      if (node) {
        const p = this._portPos(node, this.selectedPort.dir, this.selectedPort.port);
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#4fc1ff'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
    if (!g && this.hover && this.hover.kind === 'port') {
      const node = this.nodes.get(this.hover.nodeId);
      if (node) {
        const p = this._portPos(node, this.hover.dir, this.hover.port);
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#4fc1ff'; ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Draw numbered markers on open (boundary) ports. */
  _drawBoundaryMarkers(ctx) {
    if (!this.doc.inputBoundary.length && !this.doc.outputBoundary.length) return;
    ctx.save();
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const mark = (list, dir, color, dy) => {
      list.forEach((b, i) => {
        const node = this.nodes.get(b.nodeId);
        if (!node) return;
        const p = this._portPos(node, dir, b.portIndex);
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(p.x, p.y + dy, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        uprightText(ctx, `${dir}${i}`, p.x, p.y + dy);
      });
    };
    mark(this.doc.inputBoundary, 'in', '#2a7ab5', 14);
    mark(this.doc.outputBoundary, 'out', '#6a9955', -14);
    ctx.restore();
  }

  _drawFlowArrow() {
    const ctx = this.ctx;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(this.orientation.arrow, w - 8, 8);
    ctx.restore();
  }

  _drawWiringPreview(ctx) {
    const g = this.gesture;
    const node = this.nodes.get(g.anchor.nodeId);
    if (!node) return;
    const isLeg = g.anchor.dir === 'leg';
    const a = isLeg ? this._legHandlePos(node) : this._portPos(node, g.anchor.dir, g.anchor.port);
    let m = { x: g.mx, y: g.my }, tn = null;
    if (g.target) {
      tn = this.nodes.get(g.target.nodeId);
      if (tn) m = g.target.isNew ? { x: tn.x, y: tn.y } : this._portPos(tn, g.target.dir, g.target.port);
    }
    const straight = isLeg || (node.isSpider() && (!tn || tn.isSpider()));
    const pts = straight ? straightCurve(a, m)
      : g.anchor.dir === 'out' ? wireCurve(a, m) : wireCurve(m, a);
    ctx.save();
    ctx.strokeStyle = '#4fc1ff'; ctx.lineWidth = 2;
    if (!g.target) ctx.setLineDash([5, 4]);
    strokeCurve(ctx, pts);
    ctx.restore();
  }

  _drawSelRect() {
    const g = this.gesture, ctx = this.ctx;
    ctx.save(); ctx.strokeStyle = '#4fc1ff'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.fillStyle = 'rgba(79,193,255,0.08)';
    const rx = Math.min(g.x1, g.x2), ry = Math.min(g.y1, g.y2);
    const rw = Math.abs(g.x2 - g.x1), rh = Math.abs(g.y2 - g.y1);
    ctx.fillRect(rx, ry, rw, rh); ctx.strokeRect(rx, ry, rw, rh); ctx.restore();
  }

  _drawGrid(ctx, sw, sh) {
    const step = 30; ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1 / this.zoom;
    // Visible world rectangle (the view may be rotated)
    const cs = [[0, 0], [sw, 0], [0, sh], [sw, sh]].map(([x, y]) => this._screenToWorld(x, y));
    const l = Math.min(...cs.map(c => c.x)), r = Math.max(...cs.map(c => c.x));
    const t = Math.min(...cs.map(c => c.y)), b = Math.max(...cs.map(c => c.y));
    const sx = Math.floor(l / step) * step, sy = Math.floor(t / step) * step;
    for (let x = sx; x < r; x += step) { ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, b); ctx.stroke(); }
    for (let y = sy; y < b; y += step) { ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(r, y); ctx.stroke(); }
    ctx.restore();
  }

  /* ---- Hit testing (world coordinates) ---- */

  _screenToWorld(sx, sy) {
    return unorient(this.orientation, (sx - this.panX) / this.zoom, (sy - this.panY) / this.zoom);
  }

  worldToScreen(x, y) {
    const p = orient(this.orientation, x, y);
    return { x: this.panX + p.x * this.zoom, y: this.panY + p.y * this.zoom };
  }

  _portPos(node, dir, i) { return dir === 'in' ? node.getInputPort(i) : node.getOutputPort(i); }

  _nodeAt(wx, wy) {
    const arr = Array.from(this.nodes.values()).reverse();
    for (const n of arr) if (n.containsPoint(wx, wy)) return n;
    return null;
  }

  /** Nearest port handle within PORT_HIT_R (optionally only one direction). */
  _portAt(wx, wy, dirOnly = null) {
    let best = null, bestD = PORT_HIT_R * PORT_HIT_R;
    for (const node of this.nodes.values()) {
      for (const dir of ['in', 'out']) {
        if (dirOnly && dir !== dirOnly) continue;
        const n = dir === 'in' ? node.inputs : node.outputs;
        for (let i = 0; i < n; i++) {
          const p = this._portPos(node, dir, i);
          const d = (wx - p.x) ** 2 + (wy - p.y) ** 2;
          if (d <= bestD) { bestD = d; best = { nodeId: node.id, dir, port: i }; }
        }
      }
    }
    return best;
  }

  /** Spiders that currently show a "+ new leg" handle: hovered or selected. */
  _legHandleNodes() {
    const out = [];
    for (const n of this.nodes.values()) {
      if (!n.isSpider()) continue;
      if (n.selected || (this.hover && this.hover.nodeId === n.id)) out.push(n);
    }
    return out;
  }

  /** The + handle sits to the node's right on screen, whatever the orientation. */
  _legHandlePos(node) {
    const off = unorient(this.orientation, node.radius + 11, 0);
    return { x: node.x + off.x, y: node.y + off.y };
  }

  _legHandleAt(wx, wy) {
    for (const n of this._legHandleNodes()) {
      const p = this._legHandlePos(n);
      if ((wx - p.x) ** 2 + (wy - p.y) ** 2 <= (LEG_HANDLE_R + 2) ** 2) return n;
    }
    return null;
  }

  _count(node, dir) { return dir === 'in' ? node.inputs : node.outputs; }

  _wireAt(wx, wy) {
    for (let i = this.wires.length - 1; i >= 0; i--)
      if (this.wires[i].hitTest(wx, wy, this.nodes)) return this.wires[i];
    return null;
  }

  /** The wire attached to a port, if any. */
  _wireOnPort({ nodeId, dir, port }) {
    return this.wires.find(w => dir === 'out'
      ? (w.fromNodeId === nodeId && w.fromPort === port)
      : (w.toNodeId === nodeId && w.toPort === port)) || null;
  }

  /**
   * Where a wire being dragged from `anchor` would land at (wx, wy).
   * Returns a port { nodeId, dir, port }, possibly with isNew:true meaning
   * "add a new leg of this direction to that spider".
   * anchor.dir is 'out' | 'in', or 'leg' for a spider's + handle.
   */
  _findTarget(anchor, wx, wy, exclude) {
    const src = this.nodes.get(anchor.nodeId);
    const isLeg = anchor.dir === 'leg';
    const want = isLeg ? null : (anchor.dir === 'out' ? 'in' : 'out');
    const exact = this._portAt(wx, wy, want);
    if (exact && exact.nodeId !== anchor.nodeId) return exact;

    const node = this._nodeAt(wx, wy);
    if (!node || node.id === anchor.nodeId) return null;
    const dirs = want ? [want] : ['in', 'out'];
    const free = [];
    for (const dir of dirs)
      for (let i = 0; i < this._count(node, dir); i++) {
        const cand = { nodeId: node.id, dir, port: i };
        const occ = this._wireOnPort(cand);
        if (!occ || occ === exclude) free.push(cand);
      }
    // Spider ↔ spider: always a fresh leg, so the spider's open wires are kept
    if (node.isSpider() && (src.isSpider() || free.length === 0)) {
      const dir = want || 'in';
      return { nodeId: node.id, dir, port: this._count(node, dir), isNew: true };
    }
    // Otherwise the nearest port, preferring free ones
    let best = null, bestScore = Infinity;
    for (const dir of dirs)
      for (let i = 0; i < this._count(node, dir); i++) {
        const p = this._portPos(node, dir, i);
        const cand = { nodeId: node.id, dir, port: i };
        const isFree = free.some(f => f.dir === dir && f.port === i);
        const score = (wx - p.x) ** 2 + (wy - p.y) ** 2 + (isFree ? 0 : 1e6);
        if (score < bestScore) { bestScore = score; best = cand; }
      }
    return best;
  }

  _deselectAll() {
    this.selectedPort = null;
    for (const n of this.nodes.values()) n.selected = false;
    for (const w of this.wires) w.selected = false;
  }

  /* ---- Events ---- */

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('mousedown', e => this._onMouseDown(e));
    window.addEventListener('mousemove', this._mm = e => this._onMouseMove(e));
    window.addEventListener('mouseup', this._mu = e => this._onMouseUp(e));
    c.addEventListener('mouseleave', () => { if (!this.gesture) { this.hover = null; this.draw(); } });
    c.addEventListener('wheel', e => this._onWheel(e), { passive: false });
    c.addEventListener('dblclick', e => this._onDblClick(e));
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.tabIndex = 0;
    c.addEventListener('keydown', e => this._onKeyDown(e));
  }

  _eventPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    return { sx, sy, ...this._screenToWorld(sx, sy) };
  }

  _onMouseDown(e) {
    this.canvas.focus();
    const { sx, sy, x, y } = this._eventPos(e);
    if (e.button === 1 || (e.button === 0 && e.altKey)) { this._startPan(e); return; }
    if (e.button !== 0) return;

    // 1. Port handle → start (or pick up) a wire
    const port = this._portAt(x, y);
    if (port) {
      const existing = this._wireOnPort(port);
      let anchor = port;
      if (existing) {
        // Pick up this end: the anchor becomes the wire's other end
        anchor = port.dir === 'out'
          ? { nodeId: existing.toNodeId, dir: 'in', port: existing.toPort }
          : { nodeId: existing.fromNodeId, dir: 'out', port: existing.fromPort };
      }
      this.gesture = { kind: 'wire', anchor, detached: existing, picked: existing ? port : null,
        pressed: port, sx, sy, moved: false,
        mx: x, my: y, target: null, snapshot: this.doc._snapshot() };
      this.draw();
      return;
    }

    // 1b. Spider "+" handle → new leg
    const legNode = this._legHandleAt(x, y);
    if (legNode) {
      this.gesture = { kind: 'wire', anchor: { nodeId: legNode.id, dir: 'leg' }, detached: null,
        picked: null, pressed: null, sx, sy, moved: false,
        mx: x, my: y, target: null, snapshot: this.doc._snapshot() };
      this.draw();
      return;
    }

    // A leg selection never combines with node/wire selection
    this.selectedPort = null;

    // 2. Node → select, and get ready to move the selection
    const node = this._nodeAt(x, y);
    if (node) {
      if (e.shiftKey) node.selected = !node.selected;
      else if (!node.selected) { this._deselectAll(); node.selected = true; }
      const origins = new Map();
      for (const n of this.nodes.values()) if (n.selected) origins.set(n, { x: n.x, y: n.y });
      this.gesture = { kind: 'move', sx, sy, wx: x, wy: y, origins, moved: false,
        snapshot: this.doc._snapshot() };
      this.draw(); this._selectionChanged();
      return;
    }

    // 3. Wire → select
    const wire = this._wireAt(x, y);
    if (wire) {
      if (e.shiftKey) wire.selected = !wire.selected;
      else { this._deselectAll(); wire.selected = true; }
      this.draw(); this._selectionChanged();
      return;
    }

    // 4. Empty space → box select
    if (!e.shiftKey) this._deselectAll();
    this.gesture = { kind: 'rect', x1: sx, y1: sy, x2: sx, y2: sy };
    this.draw(); this._selectionChanged();
  }

  _onMouseMove(e) {
    const { sx, sy, x, y } = this._eventPos(e);
    const g = this.gesture;
    if (!g) {
      // Hover feedback only when the pointer is over this canvas
      if (e.target !== this.canvas) return;
      const port = this._portAt(x, y);
      const legNode = port ? null : this._legHandleAt(x, y);
      const node = port || legNode ? null : this._nodeAt(x, y);
      const hover = port ? { kind: 'port', ...port }
        : legNode ? { kind: 'leg', nodeId: legNode.id }
        : node ? { kind: 'node', nodeId: node.id }
        : this._wireAt(x, y) ? { kind: 'wire' } : null;
      this.canvas.style.cursor = !hover ? 'default'
        : hover.kind === 'port' || hover.kind === 'leg' ? 'crosshair'
        : hover.kind === 'node' ? 'move' : 'pointer';
      const key = h => h ? `${h.kind}:${h.nodeId}:${h.dir}:${h.port}` : '';
      if (key(hover) !== key(this.hover)) { this.hover = hover; this.draw(); }
      return;
    }
    if (g.kind === 'move') {
      if (!g.moved && Math.hypot(sx - g.sx, sy - g.sy) < DRAG_THRESHOLD) return;
      g.moved = true;
      for (const [n, o] of g.origins) { n.x = o.x + (x - g.wx); n.y = o.y + (y - g.wy); }
      this.draw();
    } else if (g.kind === 'wire') {
      if (!g.moved && Math.hypot(sx - g.sx, sy - g.sy) < DRAG_THRESHOLD) return;
      g.moved = true;
      g.mx = x; g.my = y;
      g.target = this._findTarget(g.anchor, x, y, g.detached);
      this.draw();
    } else if (g.kind === 'rect') {
      g.x2 = sx; g.y2 = sy; this.draw();
    }
  }

  _onMouseUp(e) {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (g.kind === 'move') {
      if (g.moved) { this.doc.pushUndo(g.snapshot); this._commit(); }
    } else if (g.kind === 'wire') {
      if (g.pressed && !g.moved) this._clickPort(g.pressed, e.shiftKey);
      else this._finishWire(g);
    } else if (g.kind === 'rect') {
      const x1 = Math.min(g.x1, g.x2), y1 = Math.min(g.y1, g.y2);
      const x2 = Math.max(g.x1, g.x2), y2 = Math.max(g.y1, g.y2);
      for (const n of this.nodes.values()) {
        const { x: px, y: py } = this.worldToScreen(n.x, n.y);
        if (px >= x1 && px <= x2 && py >= y1 && py <= y2) n.selected = true;
      }
      this._selectionChanged();
    }
    this.draw();
  }

  /** A click (no drag) on a port: select that leg, or the node if its legs are fixed. */
  _clickPort(port, additive) {
    const node = this.nodes.get(port.nodeId);
    if (!node) return;
    if (!additive) this._deselectAll();
    if (node.type.variableArity) this.selectedPort = { ...port };
    else node.selected = true;
    this._selectionChanged();
  }

  _finishWire(g) {
    const t = g.target;
    const old = g.detached;
    if (!t) {
      if (old) {  // dropped a picked-up wire end on empty space → remove the wire
        this.doc.pushUndo(g.snapshot);
        this.doc.removeWires([old]);
        this._commit();
      }
      return;
    }
    let anchor = g.anchor;
    if (old && !t.isNew) {
      const [f, to] = anchor.dir === 'out' ? [anchor, t] : [t, anchor];
      if (old.fromNodeId === f.nodeId && old.fromPort === f.port
          && old.toNodeId === to.nodeId && old.toPort === to.port) return; // unchanged
    }
    this.doc.pushUndo(g.snapshot);

    // Materialise new legs
    if (anchor.dir === 'leg') {
      const src = this.nodes.get(anchor.nodeId);
      const dir = t.dir === 'in' ? 'out' : 'in';
      anchor = { nodeId: src.id, dir, port: this._count(src, dir) };
      if (dir === 'out') src.outputs++; else src.inputs++;
    }
    if (t.isNew) {
      const tn = this.nodes.get(t.nodeId);
      if (t.dir === 'out') tn.outputs++; else tn.inputs++;
    }

    // A port takes one wire: replace whatever was on the target port
    const displaced = t.isNew ? null : this._wireOnPort(t);
    const [from, to] = anchor.dir === 'out' ? [anchor, t] : [t, anchor];
    this.wires = this.wires.filter(w => w !== old && w !== displaced);
    this.wires.push(new DiagramWire(from.nodeId, from.port, to.nodeId, to.port));

    // A re-routed spider–spider wire leaves its old leg behind: remove it
    if (old && g.picked) {
      const a = this.nodes.get(old.fromNodeId), b = this.nodes.get(old.toNodeId);
      const pickedNode = this.nodes.get(g.picked.nodeId);
      const reused = g.picked.nodeId === t.nodeId && g.picked.dir === t.dir && g.picked.port === t.port;
      if (a && b && a.isSpider() && b.isSpider() && pickedNode && !reused)
        this.doc.removePort(pickedNode, g.picked.dir, g.picked.port);
    }
    this._commit();
  }

  _onWheel(e) {
    e.preventDefault();
    const { sx, sy } = this._eventPos(e);
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const nz = Math.max(0.1, Math.min(5, this.zoom * factor));
    this.panX = sx - (sx - this.panX) * (nz / this.zoom);
    this.panY = sy - (sy - this.panY) * (nz / this.zoom);
    this.zoom = nz;
    this.draw();
  }

  _startPan(e) {
    const sx = e.clientX, sy = e.clientY;
    const opx = this.panX, opy = this.panY;
    const mv = ev => { this.panX = opx + (ev.clientX - sx); this.panY = opy + (ev.clientY - sy); this.draw(); };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }

  _onDblClick(e) {
    const { x, y } = this._eventPos(e);
    const node = this._nodeAt(x, y);
    if (!node) return;
    this._deselectAll(); node.selected = true;
    this.draw(); this._selectionChanged();
    if (this.hooks.onEditLabel) this.hooks.onEditLabel(node);
  }

  _onKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelected(); }
    else if (e.key === 'Escape') {
      if (this.gesture && this.gesture.kind === 'move')
        for (const [n, o] of this.gesture.origins) { n.x = o.x; n.y = o.y; }
      this.gesture = null; this.draw();
    }
    else if (e.key === 'a' && mod) {
      e.preventDefault();
      for (const n of this.nodes.values()) n.selected = true;
      this.draw(); this._selectionChanged();
    }
    else if (e.key === 'z' && mod && !e.shiftKey) { e.preventDefault(); this.undo(); }
    else if ((e.key === 'z' && mod && e.shiftKey) || (e.key === 'y' && mod)) { e.preventDefault(); this.redo(); }
  }

  /** Show a brief toast message overlaid on the canvas */
  _showToast(msg, type = 'error') {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `
      position:absolute; bottom:12px; left:50%; transform:translateX(-50%);
      padding:6px 14px; border-radius:4px; font-size:12px; z-index:100;
      pointer-events:none; opacity:0; transition:opacity 0.2s;
      color:#fff; font-family:var(--font-sans);
      background:${type === 'error' ? '#c33' : type === 'warn' ? '#886600' : '#2a7ab5'};
    `;
    this.wrapEl.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 1800);
  }

  destroy() {
    this.doc.offChange(this._onDocChange);
    window.removeEventListener('mousemove', this._mm);
    window.removeEventListener('mouseup', this._mu);
    this.wrapEl.remove();
  }
}
