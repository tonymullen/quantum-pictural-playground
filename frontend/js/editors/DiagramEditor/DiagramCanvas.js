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
 *   - Cmd+C / Cmd+X           → copy / cut the selected nodes as a fragment (one clipboard, all panels)
 *   - Cmd+V                   → paste; with a selection whose legs match, replace it (a rewrite)
 *   - Shift+Cmd+V / Cmd+D     → paste beside / duplicate, never replacing
 *   - Drop a node near a free port it fits → plugged in (wired)
 *   - T / the taut button       → pull the wires taut: an animated preview, then Apply (↵) or Cancel (Esc)
 *   - Alt+drag / middle-drag  → pan; wheel → zoom
 */
import DiagramNode, { uprightText } from './DiagramNode.js';
import { ORIENTATIONS, orient, unorient } from '../../core/FlowDirection.js';
import DiagramWire, { wireCurve, straightCurve, strokeCurve } from './DiagramWire.js';
import diagramToIR from '../../core/DiagramToIR.js';
import { Clipboard, copyFragment, pasteFragment, fits, replaceRegion, regionBoundary, plugCandidates, describeLegs } from './Fragment.js';
import DiagramDocument from './DiagramDocument.js';
import { pullTautChecked, stringPaths, resample } from './PullTaut.js';
import { rulesFor, applyRewrite } from './Rewrites.js';
import Highlight from '../../core/Highlight.js';

// Handle sizes are in SCREEN pixels (converted with px()), so ports, wires and
// the + handle stay grabbable however far the view is zoomed out.
const PORT_HIT_R = 9;     // screen-px radius for grabbing a port handle
const DRAG_THRESHOLD = 3; // screen px before a press becomes a drag
const LEG_HANDLE_R = 7;   // screen-px radius of a spider's "+ new leg" handle
const NODE_CORE = 0.55;   // the inner part of a node always grabs the node, not a port
const PLUG_R = 18;        // screen-px: a dropped node's free port this close to a fitting one is wired to it

/** Draw "Σ" with its indices as a subscript, right-aligned at (x, y) in screen space. */
export function drawSigma(ctx, x, y, indices, size = 30) {
  ctx.save();
  ctx.fillStyle = '#e0e0e0'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  ctx.font = `${Math.round(size * 0.42)}px serif`;
  const sub = indices.join(',');
  const subW = ctx.measureText(sub).width;
  ctx.fillText(sub, x, y + size * 0.42);
  ctx.font = `${Math.round(size)}px serif`;
  ctx.fillText('Σ', x - subW * 0.35, y);
  ctx.restore();
}

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
    this._onDocChange = () => { this.selectedPort = null; if (this._taut) this._endTaut(); this._emitHover(null); this.draw(); this._selectionChanged(); };
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
    // Follow our own box too (e.g. a toolbar above wraps onto another line)
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.wrapEl);
    // Hover-linking (Highlight.js): glow the nodes another view points at
    this._source = 'canvas-' + Math.random().toString(36).slice(2, 8);
    this._offHighlight = Highlight.on(h => this._onHighlight(h));
  }

  _onHighlight(h) {
    if (h.source === this._source) return;
    let ids = null;
    if (!h.clear) {
      if (h.docId === this.doc.id && h.nodeIds && h.nodeIds.length) ids = new Set(h.nodeIds);
      else if (h.circuitId && h.circuitId === this.doc.derivedFrom && h.columns)
        ids = new Set([...this.nodes.values()].filter(n => h.columns.includes(n.circuitT)).map(n => n.id));
    }
    const key = ids ? [...ids].sort().join() : '';
    if (key === (this._hlKey || '')) return;
    this._hl = ids && ids.size ? ids : null; this._hlKey = key;
    this.draw();
  }

  /** Tell the other views which node is under the pointer. */
  _emitHover(node) {
    const id = node ? node.id : null;
    if (id === this._emittedHover) return;
    this._emittedHover = id;
    if (!node) { Highlight.clear(this._source); return; }
    Highlight.emit({ docId: this.doc.id, nodeIds: [node.id], circuitId: this.doc.derivedFrom || null,
      columns: node.circuitT !== undefined ? [node.circuitT] : null }, this._source);
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
    if (this._taut) this._endTaut();
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
      if (node && !node.type.variableArity) {
        this._showToast('This leg cannot be removed — you can choose it Thin or Thick', 'warn');
        return;
      }
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

  /** Remove wires whose two ends no longer have the same thickness. */
  _dropMismatchedWires() {
    this.wires = this.wires.filter(w => {
      const a = this.nodes.get(w.fromNodeId), b = this.nodes.get(w.toNodeId);
      return a && b && a.portIsThick('out', w.fromPort) === b.portIsThick('in', w.toPort);
    });
  }

  /** Double a generator (thick: f̂ = f̄ ⊗ f) or undo that (one undo step). */
  setThick(node, on) {
    if (!node.isDoubleable() || !!node.thick === on) return;
    this.doc.pushUndo();
    node.thick = on;
    if (!on) node.process = false;
    this._dropMismatchedWires();
    this._commit();
  }

  /** A thick box/state/effect: pure (the double of a symbol) or a general process. */
  setProcess(node, on) {
    if (!node.thick || !node.isOrientable() || !!node.process === on) return;
    this.doc.pushUndo();
    node.process = on;
    this._dropMismatchedWires();
    this._commit();
  }

  /** Choose one leg's thickness on a white dot or a general process. */
  setLegThick(node, dir, i, on) {
    if (!node.hasLegTypes() || node.portIsThick(dir, i) === on) return;
    this.doc.pushUndo();
    node.legThick[dir][i] = on;
    this._dropMismatchedWires();
    this._commit();
  }

  /** Flip a box/state/effect: 'T' (transpose), 'adj' (†) or 'conj' (one undo step). */
  flip(node, which) {
    if (!node || !node.isOrientable()) return;
    this.doc.pushUndo();
    this.doc.flipNode(node, which);
    this._commit();
  }

  /** Slide a box round the cup or cap it touches (PQP Prop. 4.30); it becomes its transpose. */
  slide(node, opt) {
    this.doc.pushUndo();
    const moved = this.doc.slide(node, opt);
    this._deselectAll(); moved.selected = true;
    this._commit();
    return moved;
  }

  /** Slide handles for the selected box: one per cup/cap it touches. */
  _slideHandles() {
    const sel = this.selectedNodes();
    if (sel.length !== 1) return [];
    const node = sel[0];
    return this.doc.slideOptions(node).map(opt => {
      // Just off the wire, on the side of the bend it slides into (screen-relative)
      const p = opt.side === 'in' ? node.getInputPort(0) : node.getOutputPort(0);
      const toward = opt.side === 'in' ? 1 : -1;                   // the cup is below, the cap above (PQP frame)
      const off = unorient(this.orientation, this.px(15), 0);
      const along = { x: 0, y: toward * this.px(14) };
      return { node, opt, x: p.x + off.x + along.x, y: p.y + off.y + along.y };
    });
  }

  _slideHandleAt(wx, wy) {
    const r = this.px(LEG_HANDLE_R + 2);
    return this._slideHandles().find(h => (wx - h.x) ** 2 + (wy - h.y) ** 2 <= r * r) || null;
  }

  setLabel(node, label) {
    if (label === node.label) return;
    this.doc.pushUndo();
    node.label = label;
    this._commit();
  }

  /** Selected nodes (array). */
  selectedNodes() { return Array.from(this.nodes.values()).filter(n => n.selected); }

  /* ---- Fragments: copy, paste, replace (see Fragment.js) ---- */

  /** Copy the selected nodes (and the wires between them) to the app clipboard. */
  copySelection({ quiet = false } = {}) {
    const ids = this.selectedNodes().map(n => n.id);
    if (!ids.length) { this._showToast('Select nodes to copy', 'warn'); return null; }
    const frag = copyFragment(this.doc, ids);
    Clipboard.set(frag);
    this._pasted = new Set(ids);   // pasting over what was just copied would change nothing: paste beside it
    if (!quiet) this._showToast(`Copied: ${frag.nodes.length} node${frag.nodes.length === 1 ? '' : 's'}, ${describeLegs(frag.inputs.length, frag.outputs.length)}`, 'info');
    return frag;
  }

  cutSelection() {
    if (!this.copySelection({ quiet: true })) return;
    this.deleteSelected();
  }

  /**
   * Paste the clipboard. With a selection whose legs match the clipboard's,
   * replace it (the rewrite gesture for proofs); otherwise — or with
   * alongside — add it beside, selected and ready to drag (and plug in).
   */
  paste({ alongside = false } = {}) {
    const frag = Clipboard.get();
    if (!frag) { this._showToast('Nothing to paste — copy some nodes first (Cmd+C)', 'warn'); return null; }
    const sel = this.selectedNodes().map(n => n.id);
    // Selection = what was just copied or pasted → paste (another) beside it, never over it
    const justPasted = this._pasted && sel.length === this._pasted.size && sel.every(id => this._pasted.has(id));
    if (sel.length && !alongside && !justPasted) {
      const f = fits(this.doc, sel, frag);
      if (f.ok) {
        this.doc.pushUndo();
        const added = replaceRegion(this.doc, sel, frag);
        this._deselectAll(); for (const n of added) n.selected = true;
        this._pasted = null;
        this._commit(); this._selectionChanged();
        this._showToast('Replaced the selection (Cmd+Z undoes; Shift+Cmd+V pastes beside instead)', 'info');
        return added;
      }
      this._showToast(`Pasted beside — can’t replace: ${f.why}`, 'warn');
    }
    // Beside: at the pointer (if it moved since the last paste), else a step on from the last paste
    const same = (a, b) => a && b && Math.hypot(a.x - b.x, a.y - b.y) < 1;
    const selNodes = this.selectedNodes();
    const overSel = p => p && selNodes.some(n => Math.hypot(p.x - n.x, p.y - n.y) <= n.radius * 1.5);
    let at;
    if (this._pointer && !same(this._pointer, this._pasteFrom) && !(justPasted && overSel(this._pointer))) at = { ...this._pointer };
    else if (justPasted && selNodes.length) {
      const c = selNodes.reduce((a, n) => ({ x: a.x + n.x / selNodes.length, y: a.y + n.y / selNodes.length }), { x: 0, y: 0 });
      at = { x: c.x + 40, y: c.y + 40 };
    } else if (this._lastPasteAt) at = { x: this._lastPasteAt.x + 40, y: this._lastPasteAt.y + 40 };
    else { const r = this.canvas.getBoundingClientRect(); at = this._screenToWorld(r.width / 2, r.height / 2); }
    this._pasteFrom = this._pointer;
    this.doc.pushUndo();
    const added = pasteFragment(this.doc, frag, at.x, at.y);
    this._deselectAll(); for (const n of added) n.selected = true;
    this._pasted = new Set(added.map(n => n.id));
    this._lastPasteAt = at;
    this._commit(); this._selectionChanged();
    return added;
  }

  /** Copy and paste beside in one go (leaves the clipboard as it was). */
  duplicateSelection() {
    const ids = this.selectedNodes().map(n => n.id);
    if (!ids.length) { this._showToast('Select nodes to duplicate', 'warn'); return null; }
    const saved = Clipboard.get();
    Clipboard.set(copyFragment(this.doc, ids));
    this._pasted = new Set(ids);       // → beside the selection
    this._pasteFrom = this._pointer;   // (ignore the pointer)
    const added = this.paste({ alongside: true });
    Clipboard.set(saved);
    return added;
  }

  /** The selection's legs, for the inspector: "2 inputs, 1 output". */
  selectionLegs() {
    const ids = this.selectedNodes().map(n => n.id);
    if (!ids.length) return null;
    const b = regionBoundary(this.doc, ids);
    return { inputs: b.in.length, outputs: b.out.length };
  }

  undo() { if (!this.doc.undo()) this._showToast('Nothing to undo', 'warn'); }
  redo() { if (!this.doc.redo()) this._showToast('Nothing to redo', 'warn'); }

  /** Notify other viewers that data changed. */
  _commit() { this.doc.commit(); }

  _selectionChanged() {
    if (this.hooks.onSelectionChange) this.hooks.onSelectionChange();
    // e.g. the Numbers panel shows the matrix of the selection
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('qpp:selection',
      { detail: { docId: this.doc.id, nodeIds: this.selectedNodes().map(n => n.id) } }));
  }

  /** Change the view orientation (drawing only) and refit the view. */
  setOrientation(id) {
    this.orientation = ORIENTATIONS[id] || ORIENTATIONS.pqp;
    if (this.nodes.size) this.fitToContent(); else this.draw();
  }

  /** Pan/zoom so every node is visible (zoom capped at 1). */
  fitToContent(margin = 50) {
    const r = this.canvas.getBoundingClientRect();
    if (!this.nodes.size || !r.width || !r.height) return;
    margin = Math.min(margin, r.width * 0.12, r.height * 0.12);   // small canvases: small margins
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.nodes.values()) {
      const p = orient(this.orientation, n.x, n.y), pad = n.radius + 20;
      x0 = Math.min(x0, p.x - pad); x1 = Math.max(x1, p.x + pad);
      y0 = Math.min(y0, p.y - pad); y1 = Math.max(y1, p.y + pad);
    }
    // Floor at 0.45 so a fitted view stays workable in a small panel (it may then need panning)
    this.zoom = Math.max(0.45, Math.min(1, (r.width - 2 * margin) / (x1 - x0), (r.height - 2 * margin) / (y1 - y0)));
    this._fitted = true;
    this.panX = r.width / 2 - ((x0 + x1) / 2) * this.zoom;
    this.panY = r.height / 2 - ((y0 + y1) / 2) * this.zoom;
    this.draw();
  }

  /* ---- Rendering ---- */

  resize() {
    const r = this.wrapEl.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (this._fitted) {                     // stay fitted until the user pans or zooms
      this._sizeCanvas(r);
      this.fitToContent();
      return;
    }
    this._sizeCanvas(r);
    this.draw();
  }

  _sizeCanvas(r) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    if (w === 0 || h === 0) return;
    // Boundary order depends on positions, so recompute on every frame; the same
    // pass gives the well-formedness errors (e.g. PQP typing), shown on the canvas
    let errors = [];
    try {
      const ir = diagramToIR(this.doc);
      errors = ir.diagnostics.filter(d => d.severity === 'error');
      const byIR = new Map();
      for (const n of ir.nodes.values()) if (n.provenance) byIR.set(n.id, n.provenance.elementId);
      this._errorNodes = new Set(errors.map(d => byIR.get(d.nodeId)).filter(Boolean));
    } catch { this._errorNodes = new Set(); }
    this._showDiagnostics(errors);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);
    const o = this.orientation;
    ctx.transform(o.a, o.b, o.c, o.d, 0, 0);
    ctx.__orient = o;
    this._drawGrid(ctx, w, h);
    if (this._taut) {                          // the pull-taut preview draws the frame itself
      this._drawTaut(ctx);
      ctx.restore();
      this._drawFlowArrow();
      return;
    }
    const g = this.gesture;
    for (const wire of this.wires) {
      if (g && g.kind === 'wire' && g.detached === wire) continue;
      wire.draw(ctx, this.nodes);
    }
    if (this.showStructure) this._drawStructure(ctx);
    for (const id of this._hl || []) {                   // what another view points at (hover-linking)
      const n = this.nodes.get(id);
      if (!n) continue;
      // a glow along the node's own outline (under it, so only the outside shows)
      ctx.save(); ctx.strokeStyle = 'rgba(255, 196, 0, 0.7)'; ctx.lineWidth = (n.thick ? 4 : 2) + this.px(16);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      n._outlinePath(ctx); ctx.stroke(); ctx.restore();
    }
    for (const id of this._errorNodes || []) {           // nodes with errors: a dashed red outline
      const n = this.nodes.get(id);
      if (!n) continue;
      ctx.save(); ctx.strokeStyle = '#f44747'; ctx.lineWidth = (n.thick ? 4 : 2) + this.px(12); ctx.setLineDash([this.px(5), this.px(4)]);
      ctx.lineJoin = 'round'; n._outlinePath(ctx); ctx.stroke(); ctx.restore();
    }
    for (const node of this.nodes.values()) node.draw(ctx);
    this._drawBoundaryMarkers(ctx);
    this._drawHandles(ctx);
    if (g && g.kind === 'wire') this._drawWiringPreview(ctx);
    if (g && g.kind === 'move' && g.moved && g.plugs) this._drawPlugPreview(ctx, g.plugs);
    ctx.restore();
    this._drawFlowArrow();
    this._drawSum();
    if (g && g.kind === 'rect') this._drawSelRect();
  }

  /**
   * The ∘/⊗ structure (a view option): layers by how far each process is
   * from the inputs — composed in sequence, bottom to top — and within a
   * layer, the pieces side by side. Spiders joined by a leg (a CNOT's two
   * halves) are one piece of one layer. Scalars stand apart.
   */
  _drawStructure(ctx) {
    const nodes = [...this.nodes.values()].filter(n => n.type.key !== 'scalar');
    if (!nodes.length) return;
    // pieces: nodes joined by spider–spider legs
    const parent = new Map(nodes.map(n => [n.id, n.id]));
    const find = x => { while (parent.get(x) !== x) x = parent.get(x); return x; };
    // a leg joining spiders side by side (a CNOT's two halves): it runs across, not up
    const legPair = w => {
      const a = this.nodes.get(w.fromNodeId), b = this.nodes.get(w.toNodeId);
      return a && b && a.isFlexible() && b.isFlexible() && Math.abs(b.y - a.y) < 0.5 * Math.abs(b.x - a.x);
    };
    for (const w of this.wires) if (legPair(w) && parent.has(w.fromNodeId) && parent.has(w.toNodeId)) parent.set(find(w.fromNodeId), find(w.toNodeId));
    // depth of a piece: one more than the deepest piece feeding it
    const pieceOf = id => find(id), depth = new Map();
    const feeds = new Map();
    for (const w of this.wires) {
      if (legPair(w) || !parent.has(w.fromNodeId) || !parent.has(w.toNodeId)) continue;
      const a = pieceOf(w.fromNodeId), b = pieceOf(w.toNodeId);
      if (a === b) continue;
      if (!feeds.has(b)) feeds.set(b, new Set());
      feeds.get(b).add(a);
    }
    const visiting = new Set();
    const dOf = p => {
      if (depth.has(p)) return depth.get(p);
      if (visiting.has(p)) return 0;                     // a loop (a trace): stop
      visiting.add(p);
      let d = 0;
      for (const q of feeds.get(p) || []) d = Math.max(d, dOf(q) + 1);
      visiting.delete(p); depth.set(p, d); return d;
    };
    const layers = new Map();
    for (const n of nodes) {
      const d = dOf(pieceOf(n.id));
      if (!layers.has(d)) layers.set(d, new Map());
      const pieces = layers.get(d), p = pieceOf(n.id);
      if (!pieces.has(p)) pieces.set(p, []);
      pieces.get(p).push(n);
    }
    const box = ns => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of ns) { x0 = Math.min(x0, n.x - n.radius); x1 = Math.max(x1, n.x + n.radius); y0 = Math.min(y0, n.y - n.radius); y1 = Math.max(y1, n.y + n.radius); }
      return { x0, y0, x1, y1 };
    };
    ctx.save();
    const pad = this.px(10);
    const order = [...layers.keys()].sort((a, b) => a - b);
    let prev = null;
    order.forEach((d, k) => {
      const pieces = [...layers.get(d).values()];
      const b = box(pieces.flat());
      // the layer
      ctx.strokeStyle = 'rgba(197, 134, 192, 0.85)'; ctx.lineWidth = this.px(1.5); ctx.setLineDash([this.px(6), this.px(4)]);
      ctx.strokeRect(b.x0 - pad * 1.6, b.y0 - pad, (b.x1 - b.x0) + pad * 3.2, (b.y1 - b.y0) + pad * 2);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(197, 134, 192, 0.95)'; ctx.font = `${this.px(11)}px sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      uprightText(ctx, `${k + 1}`, b.x0 - pad * 1.6 + this.px(6), b.y1 + pad - this.px(7));
      // ⊗ between the pieces side by side
      const sorted = pieces.map(ns => ({ ns, b: box(ns) })).sort((p, q) => p.b.x0 - q.b.x0);
      ctx.font = `bold ${this.px(15)}px serif`; ctx.textAlign = 'center';
      for (let i = 1; i < sorted.length; i++) {
        const l = sorted[i - 1].b, r = sorted[i].b;
        uprightText(ctx, '⊗', (l.x1 + r.x0) / 2, (b.y0 + b.y1) / 2);
      }
      // ∘ between this layer and the one before (below it)
      if (prev) {
        ctx.font = `${this.px(26)}px serif`; ctx.textAlign = 'center';
        const y = (prev.y0 + b.y1) / 2, x = Math.min(prev.x0, b.x0) - pad * 3.4;
        uprightText(ctx, '∘', x, y);
      }
      prev = b;
    });
    ctx.restore();
  }

  /** Port-handle highlights: hovered port, and valid targets while wiring. */
  _drawHandles(ctx) {
    const px = n => this.px(n);
    const ring = (p, color, r) => {
      ctx.beginPath(); ctx.arc(p.x, p.y, px(r), 0, Math.PI * 2);
      ctx.strokeStyle = color; ctx.lineWidth = px(2); ctx.stroke();
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
        if (n) { n._outlinePath(ctx); ctx.lineJoin = 'round';
          ctx.strokeStyle = '#4fc1ff'; ctx.lineWidth = (n.thick ? 4 : 2) + px(2); ctx.stroke(); }
      }
    } else {
      // "+ new leg" handle on the hovered / selected spiders
      for (const node of this._legHandleNodes()) {
        const p = this._legHandlePos(node);
        const hot = this.hover && this.hover.kind === 'leg' && this.hover.nodeId === node.id;
        ctx.beginPath(); ctx.arc(p.x, p.y, px(LEG_HANDLE_R), 0, Math.PI * 2);
        ctx.fillStyle = hot ? '#4fc1ff' : 'rgba(30,30,30,0.9)'; ctx.fill();
        ctx.strokeStyle = '#4fc1ff'; ctx.lineWidth = px(1.5); ctx.stroke();
        ctx.strokeStyle = hot ? '#1e1e1e' : '#4fc1ff';
        ctx.beginPath();
        ctx.moveTo(p.x - px(3.5), p.y); ctx.lineTo(p.x + px(3.5), p.y);
        ctx.moveTo(p.x, p.y - px(3.5)); ctx.lineTo(p.x, p.y + px(3.5));
        ctx.stroke();
      }
      // Hovering a node shows all its port handles, so it is clear where a wire can start
      const hn = this.hover && this.hover.nodeId && this.hover.kind !== 'leg' ? this.nodes.get(this.hover.nodeId) : null;
      if (hn) {
        ctx.fillStyle = 'rgba(79,193,255,0.55)';
        for (const dir of ['in', 'out']) {
          for (let i = 0; i < (dir === 'in' ? hn.inputs : hn.outputs); i++) {
            const p = this._portPos(hn, dir, i);
            ctx.beginPath(); ctx.arc(p.x, p.y, px(4), 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }
    if (this.selectedPort) {
      const node = this.nodes.get(this.selectedPort.nodeId);
      if (node) {
        const p = this._portPos(node, this.selectedPort.dir, this.selectedPort.port);
        ctx.beginPath(); ctx.arc(p.x, p.y, px(6), 0, Math.PI * 2);
        ctx.fillStyle = '#4fc1ff'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = px(1.5); ctx.stroke();
      }
    }
    if (!g) {
      for (const h of this._slideHandles()) {
        const hot = this.hover && this.hover.kind === 'slide' && this.hover.nodeId === h.node.id && this.hover.side === h.opt.side;
        ctx.beginPath(); ctx.arc(h.x, h.y, px(LEG_HANDLE_R + 1), 0, Math.PI * 2);
        ctx.fillStyle = hot ? '#cca700' : 'rgba(30,30,30,0.92)'; ctx.fill();
        ctx.strokeStyle = '#cca700'; ctx.lineWidth = px(1.5); ctx.stroke();
        ctx.fillStyle = hot ? '#1e1e1e' : '#cca700';
        ctx.font = `bold ${px(11)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        uprightText(ctx, '↷', h.x, h.y + px(0.5));
      }
    }
    if (!g && this.hover && this.hover.kind === 'port') {
      const node = this.nodes.get(this.hover.nodeId);
      if (node) {
        const p = this._portPos(node, this.hover.dir, this.hover.port);
        ctx.beginPath(); ctx.arc(p.x, p.y, px(5.5), 0, Math.PI * 2);
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

  /** PQP writes a sum over a basis in front of the diagram: Σᵢ */
  _drawSum() {
    const idx = this.doc.sumIndices || [];
    if (!idx.length || !this.nodes.size) return;
    let x0 = Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of this.nodes.values()) {
      const p = this.worldToScreen(n.x, n.y), r = n.radius * this.zoom;
      x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r); y1 = Math.max(y1, p.y + r);
    }
    drawSigma(this.ctx, x0 - 14, (y0 + y1) / 2, idx, Math.max(22, Math.min(40, 30 * this.zoom)));
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

  /** While dragging: which free ports will be wired together on drop. */
  _drawPlugPreview(ctx, plugs) {
    ctx.save();
    ctx.strokeStyle = '#4fc1ff'; ctx.fillStyle = '#4fc1ff'; ctx.lineWidth = this.px(2);
    for (const p of plugs) {
      ctx.beginPath(); ctx.moveTo(p.ax, p.ay); ctx.lineTo(p.bx, p.by); ctx.stroke();
      for (const [x, y] of [[p.ax, p.ay], [p.bx, p.by]]) {
        ctx.beginPath(); ctx.arc(x, y, this.px(6), 0, Math.PI * 2); ctx.stroke();
      }
    }
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

  /** World length of n screen pixels at the current zoom. */
  px(n) { return n / this.zoom; }

  _screenToWorld(sx, sy) {
    return unorient(this.orientation, (sx - this.panX) / this.zoom, (sy - this.panY) / this.zoom);
  }

  worldToScreen(x, y) {
    const p = orient(this.orientation, x, y);
    return { x: this.panX + p.x * this.zoom, y: this.panY + p.y * this.zoom };
  }

  _portPos(node, dir, i) { return dir === 'in' ? node.getInputPort(i) : node.getOutputPort(i); }

  /** A node whose inner core contains the point (that press means "the node"). */
  _nodeCoreAt(wx, wy) {
    for (const n of Array.from(this.nodes.values()).reverse()) {
      if (n.type.shape === 'wire') continue;
      const r = n.radius * NODE_CORE;
      if ((wx - n.x) ** 2 + (wy - n.y) ** 2 <= r * r) return n;
    }
    return null;
  }

  _nodeAt(wx, wy) {
    const arr = Array.from(this.nodes.values()).reverse();
    for (const n of arr) if (n.containsPoint(wx, wy)) return n;
    return null;
  }

  /** Nearest port handle within PORT_HIT_R (optionally only one direction). */
  _portAt(wx, wy, dirOnly = null) {
    if (this._nodeCoreAt(wx, wy)) return null;   // the middle of a node grabs the node
    let best = null, bestD = this.px(PORT_HIT_R) ** 2;
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
    const off = unorient(this.orientation, node.radius + this.px(12), 0);
    return { x: node.x + off.x, y: node.y + off.y };
  }

  _legHandleAt(wx, wy) {
    for (const n of this._legHandleNodes()) {
      const p = this._legHandlePos(n);
      if ((wx - p.x) ** 2 + (wy - p.y) ** 2 <= this.px(LEG_HANDLE_R + 2) ** 2) return n;
    }
    return null;
  }

  _count(node, dir) { return dir === 'in' ? node.inputs : node.outputs; }

  _wireAt(wx, wy) {
    for (let i = this.wires.length - 1; i >= 0; i--)
      if (this.wires[i].hitTest(wx, wy, this.nodes, this.px(6))) return this.wires[i];
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
  /** Thickness of the wire being drawn: true/false, or null if a new white-dot leg (either). */
  _anchorThick(anchor) {
    const src = this.nodes.get(anchor.nodeId);
    if (anchor.dir === 'leg') return src.type.key === 'dot' ? null : !!src.thick;
    return src.portIsThick(anchor.dir, anchor.port);
  }

  _findTarget(anchor, wx, wy, exclude) {
    const src = this.nodes.get(anchor.nodeId);
    const isLeg = anchor.dir === 'leg';
    const want = isLeg ? null : (anchor.dir === 'out' ? 'in' : 'out');
    // Thick (quantum) and thin (classical) only join their own kind
    const at = this._anchorThick(anchor);
    const fits = (node, dir, i) => at === null || node.portIsThick(dir, i) === at;
    const exact = this._portAt(wx, wy, want);
    if (exact && exact.nodeId !== anchor.nodeId && fits(this.nodes.get(exact.nodeId), exact.dir, exact.port)) return exact;

    const node = this._nodeAt(wx, wy);
    if (!node || node.id === anchor.nodeId) return null;
    const dirs = want ? [want] : ['in', 'out'];
    const free = [];
    for (const dir of dirs)
      for (let i = 0; i < this._count(node, dir); i++) {
        const cand = { nodeId: node.id, dir, port: i };
        const occ = this._wireOnPort(cand);
        if ((!occ || occ === exclude) && fits(node, dir, i)) free.push(cand);
      }
    // Spider ↔ spider: always a fresh leg, so the spider's open wires are kept
    // (a white dot's new leg takes whatever thickness the wire has)
    const newLegFits = node.type.key === 'dot' || at === null || !!node.thick === at;
    if (node.isSpider() && newLegFits && (src.isSpider() || free.length === 0)) {
      const dir = want || 'in';
      return { nodeId: node.id, dir, port: this._count(node, dir), isNew: true };
    }
    // Otherwise the nearest fitting port, preferring free ones
    let best = null, bestScore = Infinity;
    for (const dir of dirs)
      for (let i = 0; i < this._count(node, dir); i++) {
        if (!fits(node, dir, i)) continue;
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
    c.addEventListener('mouseleave', () => { this._emitHover(null); if (!this.gesture) { this.hover = null; this.draw(); } });
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

  /* ---- Rewrites (Rewrites.js) ---- */

  /**
   * Apply a rewrite rule to the selection, as one undoable edit. A proof's
   * step editor may take the request instead (hooks.onRewriteRequest), to
   * make the result the next step.
   */
  rewrite(ruleId) {
    const ids = this.selectedNodes().map(n => n.id);
    if (this.hooks.onRewriteRequest && this.hooks.onRewriteRequest(ruleId, ids)) return null;
    const rule = rulesFor(this.doc, ids).find(r => r.id === ruleId);
    if (!rule) { this._showToast('That rewrite does not apply to the selection', 'warn'); return null; }
    const snapshot = this.doc._snapshot();
    const res = applyRewrite(this.doc, rule);
    if (!res.ok) { this._showToast(res.why, 'warn'); return res; }
    this.doc.pushUndo(snapshot);
    this._deselectAll();
    for (const n of res.nodes) if (this.nodes.has(n.id)) n.selected = true;
    this._commit(); this._selectionChanged();
    this._showToast(`${rule.name}: ${res.relation === '=' ? 'equal' : 'equal up to a scalar'}${res.scalar ? ` (scalar ${res.scalar} added)` : ''}`, 'info');
    return res;
  }

  /* ---- Pull taut: an animated, non-destructive preview, then Apply or Cancel ---- */

  /**
   * Show the wires being pulled taut (PullTaut.js). Nothing changes until
   * Apply; the scrubber runs the motion back and forth.
   */
  previewPullTaut() {
    if (this._taut) return;
    const after = new DiagramDocument('taut');
    after._restore(this.doc._snapshot());
    after.tensorOrder = this.doc.tensorOrder; after.sumIndices = [...(this.doc.sumIndices || [])];
    const report = pullTautChecked(after);
    if (!report.ok) { this._showToast(report.why, 'warn'); return; }
    const N = 120;
    // Pair each string before with the same string after: by its ends and beads; strings
    // with only open ends look alike, so those are paired left to right
    const beforePaths = stringPaths(this.doc), afterAll = stringPaths(after);
    const group = list => { const g = new Map(); for (const p of list) { if (!g.has(p.key)) g.set(p.key, []); g.get(p.key).push(p); } for (const v of g.values()) v.sort((a, b) => a.points[0].x - b.points[0].x); return g; };
    const bG = group(beforePaths), aG = group(afterAll);
    const match = new Map();
    for (const [k, bs] of bG) bs.forEach((bp, i) => match.set(bp, (aG.get(k) || [])[i]));
    const pairs = [], morphWires = new Set(), morphNodes = new Set();
    for (const bp of beforePaths) {
      const ap = match.get(bp);
      if (!ap || bp.points.length < 2 || ap.points.length < 2) continue;
      const unchanged = bp.wires.every(w => after.wires.some(x => x.id === w.id)) && bp.wiring.every(id => after.nodes.has(id))
        && bp.beads.every(b => { const n = after.nodes.get(b.id), o = this.doc.nodes.get(b.id); return n && Math.hypot(n.x - o.x, n.y - o.y) < 1; });
      if (unchanged) continue;
      const A = resample(bp.points, N), B = resample(ap.points, N);
      const beads = bp.beads.map(b => {
        const ab = ap.beads.find(x => x.id === b.id);
        return { id: b.id, fb: A.frac(b.at), fa: ab ? B.frac(ab.at) : A.frac(b.at), rot: 0 };
      });
      pairs.push(this._prepareMorph({ A: A.points, B: B.points, beads, thick: bp.thick }));
      for (const w of bp.wires) morphWires.add(w.id);
      for (const w of ap.wires) morphWires.add(w.id);
      for (const id of bp.wiring) morphNodes.add(id);
      for (const id of ap.wiring) morphNodes.add(id);
      for (const b of bp.beads) morphNodes.add(b.id);
    }
    this._taut = { after, report, pairs, morphWires, morphNodes, t: 0, playing: true };
    this._fitBoth(this.doc, after);
    // Each bead's whole turn: the turn its end state needs (0, or a half turn for
    // one that comes out transposed), taken the way the string itself turns as it
    // is pulled — follow the string's direction at the bead through the motion.
    const K = 240, wrap = x => { while (x > Math.PI) x -= 2 * Math.PI; while (x <= -Math.PI) x += 2 * Math.PI; return x; };
    for (const pr of pairs) {
      const frames = [];
      for (let k = 0; k <= K; k++) frames.push(this._morph(pr, k / K));
      for (const b of pr.beads) {
        const need = wrap(this._tangent(pr.B, b.fa) - this._tangent(pr.A, b.fb));
        let total = 0, prev = this._tangent(frames[0], b.fb);
        for (let k = 1; k <= K; k++) {
          const a = this._tangent(frames[k], b.fb + (b.fa - b.fb) * (k / K));
          total += wrap(a - prev); prev = a;
        }
        // the end state fixes the turn up to whole turns: take the one nearest what the string did
        b.turn = need + 2 * Math.PI * Math.round((total - need) / (2 * Math.PI));
        b.stringTurn = total;
      }
    }
    this._showTautBar();
    this._playTaut(1);
  }

  /** Fit the view to two diagrams at once (the preview's start and end). */
  _fitBoth(a, b) {
    const r = this.canvas.getBoundingClientRect();
    const nodes = [...a.nodes.values(), ...b.nodes.values()];
    if (!nodes.length || !r.width || !r.height) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      const p = orient(this.orientation, n.x, n.y), pad = n.radius + 24;
      x0 = Math.min(x0, p.x - pad); x1 = Math.max(x1, p.x + pad); y0 = Math.min(y0, p.y - pad); y1 = Math.max(y1, p.y + pad);
    }
    const margin = Math.min(40, r.width * 0.1, r.height * 0.1), barRoom = 56;   // keep clear of the controls
    this.zoom = Math.max(0.35, Math.min(1.6, (r.width - 2 * margin) / (x1 - x0), (r.height - 2 * margin - barRoom) / (y1 - y0)));
    this.panX = r.width / 2 - ((x0 + x1) / 2) * this.zoom;
    this.panY = (r.height - barRoom) / 2 - ((y0 + y1) / 2) * this.zoom;
    this._fitted = false;
  }

  /**
   * How a string moves while it is pulled taut: its ends travel to their new
   * places, and the string keeps its shape *relative to the line between its
   * ends* while that shape's bulges shrink away (and any bend it must keep
   * grows in). So a snake straightens and swings upright, rather than each
   * point sliding straight across to its new place.
   */
  _prepareMorph(pr) {
    const N = pr.A.length;
    const frame = (P, Q) => {
      const dx = Q.x - P.x, dy = Q.y - P.y, L = Math.hypot(dx, dy);
      return L < 1e-6 ? null : { L, c: { x: dx / L, y: dy / L }, n: { x: -dy / L, y: dx / L } };
    };
    // each point's offset from the straight line between the ends, in that line's frame
    const offsets = (pts, f) => pts.map((p, i) => {
      const s = i / (N - 1), bx = pts[0].x + s * (pts[N - 1].x - pts[0].x), by = pts[0].y + s * (pts[N - 1].y - pts[0].y);
      const dx = p.x - bx, dy = p.y - by;
      return { u: dx * f.c.x + dy * f.c.y, v: dx * f.n.x + dy * f.n.y };
    });
    const fA = frame(pr.A[0], pr.A[N - 1]), fB = frame(pr.B[0], pr.B[N - 1]);
    if (fA && fB) { pr.dA = offsets(pr.A, fA); pr.dB = offsets(pr.B, fB); }
    return pr;
  }

  /** The string's points at (eased) time t. */
  _morph(pr, t) {
    const N = pr.A.length;
    const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const E0 = lerp(pr.A[0], pr.B[0]), E1 = lerp(pr.A[N - 1], pr.B[N - 1]);
    const dx = E1.x - E0.x, dy = E1.y - E0.y, L = Math.hypot(dx, dy);
    if (!pr.dA || L < 1e-6) return pr.A.map((p, i) => lerp(p, pr.B[i]));
    const c = { x: dx / L, y: dy / L }, n = { x: -dy / L, y: dx / L };
    // the old shape's slack fades a little ahead of the new shape's bend growing in
    const wA = 1 - Math.min(1, t * 1.15), wB = Math.max(0, (t - 0.15) / 0.85);
    return pr.A.map((_, i) => {
      const s = i / (N - 1);
      const u = pr.dA[i].u * wA + pr.dB[i].u * wB, v = pr.dA[i].v * wA + pr.dB[i].v * wB;
      return { x: E0.x + s * dx + c.x * u + n.x * v, y: E0.y + s * dy + c.y * u + n.y * v };
    });
  }

  _tangent(pts, f) {
    const i = Math.max(0, Math.min(pts.length - 2, Math.round(f * (pts.length - 1))));
    const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  /** Animate the preview to t = target (0 or 1). */
  _playTaut(target) {
    const T = this._taut;
    if (!T) return;
    cancelAnimationFrame(this._tautRaf);
    const t0 = T.t, start = performance.now(), dur = 1500 * Math.abs(target - t0) || 1;
    const step = now => {
      if (!this._taut) return;
      const k = Math.min(1, (now - start) / dur);
      T.t = t0 + (target - t0) * k;
      this._syncTautBar();
      this.draw();
      if (k < 1) this._tautRaf = requestAnimationFrame(step);
    };
    this._tautRaf = requestAnimationFrame(step);
  }

  /** One frame: nodes at their in-between places, changed strings morphing, beads riding them. */
  _drawTaut(ctx) {
    const T = this._taut, before = this.doc, after = T.after;
    const ease = x => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
    const t = ease(T.t);
    const saved = new Map();
    const place = (n, x, y) => { if (!saved.has(n)) saved.set(n, { x: n.x, y: n.y }); n.x = x; n.y = y; };
    // Nodes in both: slide between their places (anchors nudged, ends aligned)
    for (const [id, n] of before.nodes) {
      const m = after.nodes.get(id);
      if (m && !T.morphNodes.has(id)) place(n, n.x + (m.x - n.x) * t, n.y + (m.y - n.y) * t);
    }
    for (const [id, m] of after.nodes) {
      const n = before.nodes.get(id);
      if (n) place(m, saved.has(n) ? n.x : m.x, saved.has(n) ? n.y : m.y);
    }
    // Unchanged wires (and wires that only exist on one side, cross-fading)
    const alpha = (a, fn) => { ctx.save(); ctx.globalAlpha = a; fn(); ctx.restore(); };
    const afterIds = new Set(after.wires.map(w => w.id)), beforeIds = new Set(before.wires.map(w => w.id));
    for (const w of before.wires) {
      if (T.morphWires.has(w.id)) continue;
      alpha(afterIds.has(w.id) ? 1 : 1 - t, () => w.draw(ctx, before.nodes));
    }
    for (const w of after.wires) if (!beforeIds.has(w.id) && !T.morphWires.has(w.id)) alpha(t, () => w.draw(ctx, after.nodes));
    // The strings being pulled taut
    const beadAt = new Map();
    for (const pr of T.pairs) {
      const pts = this._morph(pr, t);
      ctx.save();
      ctx.strokeStyle = '#b0b0b0'; ctx.lineWidth = pr.thick ? 5 : 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke(); ctx.restore();
      for (const b of pr.beads) {
        const f = b.fb + (b.fa - b.fb) * t;
        const i = f * (pts.length - 1), i0 = Math.floor(i), i1 = Math.min(pts.length - 1, i0 + 1);
        const p = { x: pts[i0].x + (pts[i1].x - pts[i0].x) * (i - i0), y: pts[i0].y + (pts[i1].y - pts[i0].y) * (i - i0) };
        // turn smoothly through the middle of the motion
        const s = Math.max(0, Math.min(1, (t - 0.15) / 0.7));
        const rot = b.turn * (s * s * (3 - 2 * s));
        b.rot = rot;
        beadAt.set(b.id, { p, rot });
      }
    }
    // Nodes: unchanged and sliding ones; beads on their string, turning with it
    for (const [id, n] of before.nodes) {
      if (T.morphNodes.has(id) && !beadAt.has(id)) continue;         // wiring now drawn as the string
      if (beadAt.has(id)) {
        const { p, rot } = beadAt.get(id);
        place(n, p.x, p.y);
        // the shape turns; its label stays upright (the shape shows the transpose, as in a still diagram)
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(rot); ctx.translate(-p.x, -p.y);
        n.draw(ctx, { label: false }); ctx.restore();
        n.drawLabel(ctx);
        continue;
      }
      alpha(after.nodes.has(id) ? 1 : 1 - t, () => n.draw(ctx));
    }
    // New nodes (a kept bend, a plain wire at a diagram input/output) appear at the end
    for (const [id, m] of after.nodes) {
      if (before.nodes.has(id)) continue;
      if (m.type.key === 'cup' || m.type.key === 'cap' || m.type.key === 'identity') {
        if (t > 0.98) m.draw(ctx);              // until then the moving string draws its shape
      } else alpha(t, () => m.draw(ctx));
    }
    for (const [n, p] of saved) { n.x = p.x; n.y = p.y; }
  }

  _showTautBar() {
    const T = this._taut, r = T.report;
    const bar = this._tautBar = document.createElement('div');
    bar.className = 'taut-bar';
    const parts = [];
    if (r.removed) parts.push(`${r.removed} pulled out`);
    if (r.beadsTransposed) parts.push(`${r.beadsTransposed} transposed`);
    const label = document.createElement('span');
    label.className = 'taut-label';
    label.textContent = `Taut: ${parts.join(' · ') || 'straightened'} · = ✓`;
    label.title = `${r.removed} bend(s), crossing(s) or plain wire(s) pulled out; ${r.beadsTransposed} box(es) slid round a bend and came out transposed. Checked equal to the original.`;
    const play = document.createElement('button'); play.className = 'taut-btn'; play.title = 'Play again';
    play.addEventListener('click', () => { T.t = T.t > 0.5 ? 0 : T.t; this._playTaut(1); });
    play.textContent = '▶';
    const range = this._tautRange = document.createElement('input');
    range.type = 'range'; range.min = 0; range.max = 1000; range.value = 0; range.className = 'taut-range';
    range.title = 'Scrub: drag back and forth';
    range.addEventListener('input', () => { cancelAnimationFrame(this._tautRaf); T.t = range.value / 1000; this.draw(); });
    const apply = document.createElement('button'); apply.className = 'taut-btn primary'; apply.textContent = 'Apply';
    apply.title = 'Keep the taut diagram (Enter) — one undoable edit';
    apply.addEventListener('click', () => this.applyPullTaut());
    const cancel = document.createElement('button'); cancel.className = 'taut-btn'; cancel.textContent = 'Cancel';
    cancel.title = 'Leave the diagram as it was (Esc)';
    cancel.addEventListener('click', () => this.cancelPullTaut());
    bar.append(label, play, range, apply, cancel);
    bar.addEventListener('mousedown', e => e.stopPropagation());
    this.wrapEl.appendChild(bar);
  }

  _syncTautBar() { if (this._tautRange) this._tautRange.value = Math.round(this._taut.t * 1000); }

  applyPullTaut() {
    const T = this._taut;
    if (!T) return;
    this._endTaut();
    this.doc.pushUndo();
    const keep = { order: this.doc.tensorOrder, sums: this.doc.sumIndices };
    this.doc._restore(T.after._snapshot());
    this.doc.tensorOrder = keep.order; this.doc.sumIndices = keep.sums;
    this._commit();
    this._selectionChanged();
    if (this.hooks.onPullTaut) this.hooks.onPullTaut(T.report);
  }

  cancelPullTaut() {
    if (!this._taut) return;
    this._endTaut(); this.draw();
    if (this.hooks.onPullTautCancel) this.hooks.onPullTautCancel();
  }

  _endTaut() {
    cancelAnimationFrame(this._tautRaf);
    this._taut = null;
    if (this._tautBar) { this._tautBar.remove(); this._tautBar = null; this._tautRange = null; }
  }

  _onMouseDown(e) {
    if (this._taut) return;                    // the preview is not editable
    // preventScroll: focusing must not scroll an ancestor (that would move the
    // content under the pointer between the press and a double-click)
    this.canvas.focus({ preventScroll: true });
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

    // 1a. Slide handle → slide the box round the bend
    const sh = this._slideHandleAt(x, y);
    if (sh) { this.slide(sh.node, sh.opt); this._selectionChanged(); return; }

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
    if (e.target === this.canvas) this._pointer = { x, y };
    if (!g) {
      // Hover feedback only when the pointer is over this canvas
      if (e.target !== this.canvas) return;
      const port = this._portAt(x, y);
      const slideH = this._slideHandleAt(x, y);
      if (slideH) {
        const hv = { kind: 'slide', nodeId: slideH.node.id, side: slideH.opt.side };
        this.canvas.style.cursor = 'pointer';
        this.canvas.title = `Slide ${slideH.node.label || 'the box'} round the ${slideH.opt.via.type.key} (it becomes its transpose) — S`;
        if (!this.hover || this.hover.kind !== 'slide' || this.hover.side !== hv.side) { this.hover = hv; this.draw(); }
        return;
      }
      this.canvas.title = '';
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
      this._emitHover(hover && hover.nodeId ? this.nodes.get(hover.nodeId) : null);
      return;
    }
    if (g.kind === 'move') {
      if (!g.moved && Math.hypot(sx - g.sx, sy - g.sy) < DRAG_THRESHOLD) return;
      g.moved = true;
      for (const [n, o] of g.origins) { n.x = o.x + (x - g.wx); n.y = o.y + (y - g.wy); }
      this.doc.fitBends();
      g.plugs = plugCandidates(this.doc, new Set([...g.origins.keys()].map(n => n.id)), this.px(PLUG_R));
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
      if (g.moved) {
        this.doc.pushUndo(g.snapshot);
        const plugs = plugCandidates(this.doc, new Set([...g.origins.keys()].map(n => n.id)), this.px(PLUG_R));
        for (const p of plugs) this.wires.push(new DiagramWire(p.from.nodeId, p.from.port, p.to.nodeId, p.to.port));
        if (plugs.length) this._showToast(`Plugged in ${plugs.length} leg${plugs.length === 1 ? '' : 's'}`, 'info');
        this._commit();
      }
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
    // Select the leg where legs can be removed or have a type (white dots, processes)
    if (node.type.variableArity || node.hasLegTypes()) this.selectedPort = { ...port };
    else node.selected = true;
    this._selectionChanged();
  }

  _finishWire(g) {
    const t = g.target;
    const old = g.detached;
    if (!t) {
      const over = g.moved !== false && this._portAt(g.mx, g.my);
      if (over && over.nodeId !== g.anchor.nodeId && this._anchorThick(g.anchor) !== null
          && this.nodes.get(over.nodeId).portIsThick(over.dir, over.port) !== this._anchorThick(g.anchor)) {
        this._showToast('Thick (quantum) and thin (classical) wires cannot be joined', 'warn');
      }
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

    // Materialise new legs; a white dot's new leg takes the wire's thickness
    const tn = this.nodes.get(t.nodeId);
    const wireThick = this._anchorThick(anchor) ?? (t.isNew ? (tn.type.key === 'dot' ? false : !!tn.thick)
      : tn.portIsThick(t.dir, t.port));
    const setLeg = (node, dir, i) => { if (node.type.key === 'dot') node.legThick[dir][i] = wireThick; };
    if (anchor.dir === 'leg') {
      const src = this.nodes.get(anchor.nodeId);
      const dir = t.dir === 'in' ? 'out' : 'in';
      anchor = { nodeId: src.id, dir, port: this._count(src, dir) };
      if (dir === 'out') src.outputs++; else src.inputs++;
      setLeg(src, dir, anchor.port);
    }
    if (t.isNew) {
      if (t.dir === 'out') tn.outputs++; else tn.inputs++;
      setLeg(tn, t.dir, t.port);
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
    this._fitted = false;
    const { sx, sy } = this._eventPos(e);
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const nz = Math.max(0.1, Math.min(5, this.zoom * factor));
    this.panX = sx - (sx - this.panX) * (nz / this.zoom);
    this.panY = sy - (sy - this.panY) * (nz / this.zoom);
    this.zoom = nz;
    this.draw();
  }

  _startPan(e) {
    this._fitted = false;
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
    if (this._taut) {
      if (e.key === 'Enter') { e.preventDefault(); this.applyPullTaut(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.cancelPullTaut(); }
      return;
    }
    if ((e.key === 't' || e.key === 'T') && !mod && !e.altKey) { e.preventDefault(); this.previewPullTaut(); return; }
    if ((e.key === 's' || e.key === 'S') && !mod && !e.altKey) {
      const hs = this._slideHandles();
      if (hs.length) { e.preventDefault(); this.slide(hs[0].node, hs[0].opt); this._selectionChanged(); }
      else if (this.selectedNodes().length === 1) this._showToast('Slide: select a box that sits on a cup or cap leg', 'warn');
      return;
    }
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
    else if (mod && !e.altKey && (e.key === 'c' || e.key === 'C') && !e.shiftKey) { e.preventDefault(); this.copySelection(); }
    else if (mod && !e.altKey && (e.key === 'x' || e.key === 'X') && !e.shiftKey) { e.preventDefault(); this.cutSelection(); }
    else if (mod && !e.altKey && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); this.paste({ alongside: e.shiftKey }); }
    else if (mod && !e.altKey && (e.key === 'd' || e.key === 'D') && !e.shiftKey) { e.preventDefault(); this.duplicateSelection(); }
    else if (e.key === 'z' && mod && !e.shiftKey) { e.preventDefault(); this.undo(); }
    else if ((e.key === 'z' && mod && e.shiftKey) || (e.key === 'y' && mod)) { e.preventDefault(); this.redo(); }
  }

  /** A small banner with the diagram's first error (and how many more). */
  _showDiagnostics(errors) {
    if (!this._diagEl) {
      this._diagEl = document.createElement('div');
      this._diagEl.className = 'diagram-diagnostics';
      this.wrapEl.appendChild(this._diagEl);
    }
    const text = errors.length ? '⚠ ' + errors[0].message + (errors.length > 1 ? `  (+${errors.length - 1} more)` : '') : '';
    if (this._diagEl.textContent !== text) this._diagEl.textContent = text;
    this._diagEl.hidden = !text;
  }

  /** Show a brief toast message overlaid on the canvas */
  _showToast(msg, type = 'error') {
    if (this._toastEl) this._toastEl.remove();      // one at a time: the newest replaces the last
    const el = this._toastEl = document.createElement('div');
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
    if (this._offHighlight) this._offHighlight();
    if (this._ro) this._ro.disconnect();
    this.doc.offChange(this._onDocChange);
    window.removeEventListener('mousemove', this._mm);
    window.removeEventListener('mouseup', this._mu);
    this.wrapEl.remove();
  }
}
