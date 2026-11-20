/**
 * DiagramDocument — Shared data model for a single diagram.
 * Holds nodes, wires, undo/redo stacks, and fires change events
 * so multiple editor views can stay synchronised.
 */
import DiagramNode, { NODE_TYPES } from './DiagramNode.js';
import DiagramWire from './DiagramWire.js';
import Tensor from '../../core/Tensor.js';
import diagramToIR from '../../core/DiagramToIR.js';
import { irToDirac } from '../../core/DiagramToDirac.js';
import { processToDirac, sumToDirac } from '../../core/ProcessDirac.js';

let _docId = 0;

export default class DiagramDocument {
  constructor(name) {
    this.id = `doc-${_docId++}`;
    this.kind = 'diagram';
    this.name = name || `Diagram ${_docId}`;
    /** Id of the circuit this diagram is generated from (its contents get replaced), or null. */
    this.derivedFrom = null;
    /** Which wire is the first ⊗ factor — see IR.TENSOR_ORDERS. */
    this.tensorOrder = 'big-endian';
    /** Σ over these labels (PQP's sums over a basis), e.g. ['i']: states/effects labelled i range over the basis. */
    this.sumIndices = [];
    this.nodes = new Map();
    this.wires = [];
    this._undoStack = [];
    this._redoStack = [];
    this._maxUndo = 50;
    /** @type {Set<Function>} */
    this._listeners = new Set();
    // Boundary ordering (populated by DiagramToIR adapter)
    this.inputBoundary = [];   // { nodeId, portIndex }[]
    this.outputBoundary = [];  // { nodeId, portIndex }[]
  }

  /* ---- Observer pattern ---- */
  /** Register a callback that is invoked on any data change. */
  onChange(fn) { this._listeners.add(fn); }
  offChange(fn) { this._listeners.delete(fn); }
  _notify() { this.fitBends(); for (const fn of this._listeners) fn(this); }

  /**
   * Cups and caps follow what they are wired to: with both legs wired, each
   * port sits straight under (over) the end it connects to, so the bend is
   * as wide as its legs are apart. (Legs to another cup/cap don't count —
   * the two would chase each other.)
   */
  fitBends() {
    for (const n of this.nodes.values()) {
      if (!n.isBend()) continue;
      const dir = n.type.shape === 'cup' ? 'out' : 'in';
      const xs = [0, 1].map(i => {
        const w = this.wireOnPort(n.id, dir, i);
        if (!w) return null;
        const m = this.nodes.get(dir === 'out' ? w.toNodeId : w.fromNodeId);
        if (!m || m === n || m.isBend()) return null;
        return (dir === 'out' ? m.getInputPort(w.toPort) : m.getOutputPort(w.fromPort)).x;
      });
      if (xs[0] === null || xs[1] === null) continue;
      let [a, b] = xs;
      const MIN = 12;                              // never pinch to nothing
      if (Math.abs(b - a) < MIN) { const mid = (a + b) / 2, s = b >= a ? 1 : -1; a = mid - s * MIN / 2; b = mid + s * MIN / 2; }
      n.x = (a + b) / 2;
      n.portXOffsets = [a - n.x, b - n.x];
    }
  }

  /* ---- Serialization (workbooks) ---- */

  /** Plain data for this diagram (no selection state). */
  toJSON() {
    const data = JSON.parse(this._snapshot());
    for (const n of data.nodes) delete n.selected;
    for (const w of data.wires) delete w.selected;
    return { name: this.name, tensorOrder: this.tensorOrder, sumIndices: [...this.sumIndices], derivedFrom: this.derivedFrom,
      ownerProof: this.ownerProof || null, nodes: data.nodes, wires: data.wires };
  }

  /** A new diagram from toJSON() data; nodes and wires get fresh ids. */
  static fromJSON(data, name) {
    const doc = new DiagramDocument(name || data.name);
    doc.tensorOrder = data.tensorOrder || 'big-endian';
    doc.sumIndices = Array.isArray(data.sumIndices) ? [...data.sumIndices] : [];
    doc.derivedFrom = data.derivedFrom || null;
    if (data.ownerProof) doc.ownerProof = data.ownerProof;
    const typeMap = {};
    for (const t of Object.values(NODE_TYPES)) typeMap[t.key] = t;
    const ids = new Map();
    for (const nd of data.nodes) {
      const type = typeMap[nd.typeKey];
      if (!type) throw new Error(`Unknown node type "${nd.typeKey}"`);
      const n = new DiagramNode(type, nd.x, nd.y);
      n.label = nd.label || ''; n.inputs = nd.inputs; n.outputs = nd.outputs;
      n.tensor = nd.tensor ? new Tensor(nd.tensor.rows, nd.tensor.cols, nd.tensor.d) : null;
      n.portXOffsets = nd.portXOffsets || null;
      n.flip = nd.flip ? { v: !!nd.flip.v, h: !!nd.flip.h } : { v: false, h: false };
      n.thick = !!nd.thick; n.process = !!nd.process;
      n.legThick = nd.legThick ? { in: [...nd.legThick.in], out: [...nd.legThick.out] } : { in: [], out: [] };
      ids.set(nd.id, n.id);
      doc.nodes.set(n.id, n);
    }
    for (const wd of data.wires) {
      const w = new DiagramWire(ids.get(wd.fromNodeId), wd.fromPort, ids.get(wd.toNodeId), wd.toPort);
      w.wireType = wd.wireType || 'qubit';
      doc.wires.push(w);
    }
    doc.fitBends();
    return doc;
  }

  /**
   * An independent copy of `src` (nodes and wires get fresh ids; selection
   * cleared; tensor order kept; not linked to any circuit or proof).
   */
  static copyOf(src, name) {
    return DiagramDocument.fromJSON({ ...src.toJSON(), derivedFrom: null, ownerProof: null }, name || src.name);
  }

  /**
   * Replace this diagram's contents with a fresh copy of `src`'s, as one
   * undoable edit of this diagram (used for deliberate transfers between a
   * proof step and the diagram it came from).
   */
  replaceWithCopyOf(src) {
    const fresh = DiagramDocument.copyOf(src);
    this.pushUndo();
    this.tensorOrder = src.tensorOrder;
    this.nodes = fresh.nodes;
    this.wires = fresh.wires;
    this.commit();
  }

  /* ---- Common document interface (shared with CircuitDocument) ---- */
  toIR() { return diagramToIR(this); }

  /** Does the diagram use the doubled picture (any thick wire)? */
  hasThickWires() { return [...this.nodes.values()].some(n => n.hasThick()); }

  /** Set the summed indices (Σ_i …) — a diagram setting, undoable. */
  setSumIndices(list) {
    const clean = [...new Set(list.map(x => x.trim()).filter(x => /^[A-Za-zα-ω][A-Za-z0-9α-ω']*$/.test(x)))];
    if (clean.join() === this.sumIndices.join()) return;
    this.pushUndo();
    this.sumIndices = clean;
    this.commit();
  }

  generateDirac() {
    // A quantum process (doubled picture): both the familiar and PQP's notation
    if (this.hasThickWires()) return processToDirac(this);
    if (this.sumIndices.length) return sumToDirac(this);
    return irToDirac(this.toIR());
  }

  /** Replace all nodes and wires (used for diagrams generated from a circuit). */
  replaceContents(nodes, wires) {
    this.nodes.clear();
    for (const n of nodes) this.nodes.set(n.id, n);
    this.wires = wires;
    this._undoStack = []; this._redoStack = [];
    this._notify();
  }

  /** Change the tensor order (a document setting; notifies so sync re-checks). */
  setTensorOrder(order) {
    if (order === this.tensorOrder) return;
    this.tensorOrder = order;
    this._notify();
  }

  /* ---- Undo / Redo ---- */
  _snapshot() {
    const nodes = [];
    for (const n of this.nodes.values()) {
      nodes.push({
        id: n.id, typeKey: n.type.key,
        x: n.x, y: n.y, label: n.label,
        inputs: n.inputs, outputs: n.outputs,
        selected: n.selected,
        phase: n.phase, symbolicForm: n.symbolicForm,
        provenance: n.provenance,
        tensor: n.tensor ? { rows: n.tensor.rows, cols: n.tensor.cols, d: n.tensor.d } : null,
        portXOffsets: n.portXOffsets,
        flip: n.flip && (n.flip.v || n.flip.h) ? { v: !!n.flip.v, h: !!n.flip.h } : undefined,
        thick: n.thick || undefined, process: n.process || undefined,
        legThick: (n.legThick && (n.legThick.in.length || n.legThick.out.length)) ? n.legThick : undefined
      });
    }
    const wires = this.wires.map(w => ({
      id: w.id, fromNodeId: w.fromNodeId, fromPort: w.fromPort,
      toNodeId: w.toNodeId, toPort: w.toPort, selected: w.selected,
      wireType: w.wireType
    }));
    return JSON.stringify({ nodes, wires, sumIndices: this.sumIndices });
  }

  _restore(json) {
    const data = JSON.parse(json);
    if (Array.isArray(data.sumIndices)) this.sumIndices = [...data.sumIndices];
    const typeMap = {};
    for (const t of Object.values(NODE_TYPES)) typeMap[t.key] = t;
    this.nodes.clear();
    for (const nd of data.nodes) {
      const node = new DiagramNode(typeMap[nd.typeKey], nd.x, nd.y);
      node.id = nd.id; node.label = nd.label;
      node.inputs = nd.inputs; node.outputs = nd.outputs;
      node.selected = nd.selected;
      node.phase = nd.phase || null;
      node.symbolicForm = nd.symbolicForm || null;
      node.provenance = nd.provenance || null;
      node.tensor = nd.tensor ? new Tensor(nd.tensor.rows, nd.tensor.cols, nd.tensor.d) : null;
      node.portXOffsets = nd.portXOffsets || null;
      node.flip = nd.flip ? { v: !!nd.flip.v, h: !!nd.flip.h } : { v: false, h: false };
      node.thick = !!nd.thick; node.process = !!nd.process;
      node.legThick = nd.legThick ? { in: [...nd.legThick.in], out: [...nd.legThick.out] } : { in: [], out: [] };
      this.nodes.set(node.id, node);
    }
    this.wires = data.wires.map(wd => {
      const w = new DiagramWire(wd.fromNodeId, wd.fromPort, wd.toNodeId, wd.toPort);
      w.id = wd.id; w.selected = wd.selected;
      w.wireType = wd.wireType || 'qubit';
      return w;
    });
  }

  /** Record an undo step. Pass a snapshot taken earlier (e.g. at the start
   *  of a drag) to record the state from before a gesture. */
  pushUndo(snapshot = this._snapshot()) {
    this._undoStack.push(snapshot);
    if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
    this._redoStack = [];
  }

  undo() {
    if (this._undoStack.length === 0) return false;
    this._redoStack.push(this._snapshot());
    this._restore(this._undoStack.pop());
    this._notify();
    return true;
  }

  redo() {
    if (this._redoStack.length === 0) return false;
    this._undoStack.push(this._snapshot());
    this._restore(this._redoStack.pop());
    this._notify();
    return true;
  }

  /** Call after any mutation to notify viewers. */
  commit() { this._notify(); }

  /* ---- Spider legs ---- */

  /**
   * Recompute which ports are side legs. A wire joining two spiders (or a
   * spider and a Hadamard box) is drawn
   * as a straight leg out of each spider's edge, facing the other one (PQP
   * draws e.g. the CNOT's control–target wire horizontally). Several legs
   * between the same pair fan out slightly. This is derived layout only.
   */
  refreshLegs() {
    for (const n of this.nodes.values()) n._side = { in: new Map(), out: new Map() };
    const pairs = new Map();
    for (const w of this.wires) {
      const a = this.nodes.get(w.fromNodeId), b = this.nodes.get(w.toNodeId);
      if (!a || !b || !a.isFlexible() || !b.isFlexible()) continue;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (!pairs.has(key)) pairs.set(key, []);
      pairs.get(key).push(w);
    }
    for (const list of pairs.values()) {
      list.forEach((w, j) => {
        const a = this.nodes.get(w.fromNodeId), b = this.nodes.get(w.toNodeId);
        const theta = Math.atan2(b.y - a.y, b.x - a.x);
        const off = (j - (list.length - 1) / 2) * 0.45;
        a._side.out.set(w.fromPort, theta + off);
        b._side.in.set(w.toPort, theta + Math.PI - off);
      });
    }
  }

  /**
   * Remove wires. A wire between two spiders *is* a leg of each, so those
   * legs are removed too (on whichever of the two nodes remain).
   */
  removeWires(list) {
    for (const w of list) {
      const i = this.wires.indexOf(w);
      if (i < 0) continue;
      this.wires.splice(i, 1);
      const a = this.nodes.get(w.fromNodeId), b = this.nodes.get(w.toNodeId);
      if (a && b && a.isSpider() && b.isSpider()) {
        this.removePort(a, 'out', w.fromPort);
        this.removePort(b, 'in', w.toPort);
      }
    }
  }

  /* ---- Orientation and sliding (PQP §4.3) ---- */

  /**
   * Flip a box, state or effect: 'T' (transpose: rotate 180°), 'adj' (adjoint
   * †: reflect top↔bottom) or 'conj' (conjugate: reflect left↔right). The
   * adjoint and transpose swap inputs and outputs; for a state or effect that
   * turns it into the other kind, and its wires (now pointing the wrong way)
   * are removed. Returns false if the node has no orientation.
   */
  flipNode(node, which) {
    if (!node.isOrientable()) return false;
    const dv = which !== 'conj', dh = which !== 'adj';
    node.flip = { v: !!node.flip.v !== dv, h: !!node.flip.h !== dh };
    if (dv && node.inputs !== node.outputs) {
      this.wires = this.wires.filter(w => w.fromNodeId !== node.id && w.toNodeId !== node.id);
      [node.inputs, node.outputs] = [node.outputs, node.inputs];
      if (node.type === NODE_TYPES.STATE) node.type = NODE_TYPES.EFFECT;
      else if (node.type === NODE_TYPES.EFFECT) node.type = NODE_TYPES.STATE;
    }
    return true;
  }

  /**
   * Ways a one-wire box can slide round an adjacent bend (Proposition 4.30):
   * its input comes from a cup, or its output goes into a cap.
   * @returns {{ via: DiagramNode, side: 'in'|'out', leg: number }[]}
   */
  slideOptions(node) {
    if (!node || node.type.key !== 'morphism' || node.inputs !== 1 || node.outputs !== 1) return [];
    const opts = [];
    const win = this.wireOnPort(node.id, 'in', 0);
    const cup = win && this.nodes.get(win.fromNodeId);
    if (cup && cup.type.key === 'cup') opts.push({ via: cup, side: 'in', leg: win.fromPort });
    const wout = this.wireOnPort(node.id, 'out', 0);
    const cap = wout && this.nodes.get(wout.toNodeId);
    if (cap && cap.type.key === 'cap') opts.push({ via: cap, side: 'out', leg: wout.toPort });
    return opts;
  }

  /**
   * Slide a box round a cup or cap: it leaves its leg and appears on the
   * other leg as its transpose (rotated 180°). The map is unchanged —
   * (f ⊗ 1)∘cup = (1 ⊗ fᵀ)∘cup, and likewise for caps. Returns the new box.
   */
  slide(node, opt) {
    const other = 1 - opt.leg, via = opt.via;
    const drop = ws => { this.wires = this.wires.filter(w => !ws.includes(w)); };
    const moved = new DiagramNode(node.type, 0, node.y);
    moved.label = node.label;
    moved.tensor = node.tensor;
    moved.thick = node.thick; moved.process = node.process;
    moved.legThick = { in: [...node.legThick.in], out: [...node.legThick.out] };
    moved.flip = { v: !node.flip.v, h: !node.flip.h };   // transpose = both reflections
    if (opt.side === 'in') {
      // cup.leg → f → Q   and   cup.other → P    becomes    cup.leg → Q   and   cup.other → fᵀ → P
      const wIn = this.wireOnPort(node.id, 'in', 0), up = this.wireOnPort(node.id, 'out', 0);
      const otherW = this.wireOnPort(via.id, 'out', other);
      drop([wIn, up, otherW].filter(Boolean));
      if (up) this.wires.push(new DiagramWire(via.id, opt.leg, up.toNodeId, up.toPort));
      moved.x = via.getOutputPort(other).x;
      // Land halfway up the other leg (between the cup and whatever comes next on it)
      const next = otherW && this.nodes.get(otherW.toNodeId);
      const legY = via.getOutputPort(other).y;
      moved.y = next ? (legY + next.getInputPort(otherW.toPort).y) / 2 : legY - 60;
      this.wires.push(new DiagramWire(via.id, other, moved.id, 0));
      if (otherW) this.wires.push(new DiagramWire(moved.id, 0, otherW.toNodeId, otherW.toPort));
    } else {
      // R → f → cap.leg   and   S → cap.other    becomes    R → cap.leg   and   S → fᵀ → cap.other
      const wOut = this.wireOnPort(node.id, 'out', 0), down = this.wireOnPort(node.id, 'in', 0);
      const otherW = this.wireOnPort(via.id, 'in', other);
      drop([wOut, down, otherW].filter(Boolean));
      if (down) this.wires.push(new DiagramWire(down.fromNodeId, down.fromPort, via.id, opt.leg));
      moved.x = via.getInputPort(other).x;
      // Land halfway down the other leg (between the cap and whatever feeds it)
      const prev = otherW && this.nodes.get(otherW.fromNodeId);
      const legY = via.getInputPort(other).y;
      moved.y = prev ? (legY + prev.getOutputPort(otherW.fromPort).y) / 2 : legY + 60;
      this.wires.push(new DiagramWire(moved.id, 0, via.id, other));
      if (otherW) this.wires.push(new DiagramWire(otherW.fromNodeId, otherW.fromPort, moved.id, 0));
    }
    this.nodes.delete(node.id);
    this.nodes.set(moved.id, moved);
    return moved;
  }

  /** The wire on a given port, if any. */
  wireOnPort(nodeId, dir, index) {
    return this.wires.find(w => dir === 'out'
      ? (w.fromNodeId === nodeId && w.fromPort === index)
      : (w.toNodeId === nodeId && w.toPort === index)) || null;
  }

  /**
   * Remove one specific leg (port) of a node, with its wire. If the wire
   * joins two spiders, the partner spider's leg goes too.
   */
  removeLeg(node, dir, index) {
    const w = this.wireOnPort(node.id, dir, index);
    if (w) {
      const a = this.nodes.get(w.fromNodeId), b = this.nodes.get(w.toNodeId);
      if (a && b && a.isSpider() && b.isSpider()) { this.removeWires([w]); return; }
      this.wires.splice(this.wires.indexOf(w), 1);
    }
    this.removePort(node, dir, index);
  }

  /**
   * Remove one leg of a direction, choosing the least disruptive: the
   * highest-numbered unconnected port, else the highest-numbered one.
   */
  dropLeg(node, dir) {
    const count = dir === 'in' ? node.inputs : node.outputs;
    if (count === 0) return;
    let index = count - 1;
    for (let i = count - 1; i >= 0; i--) {
      if (!this.wireOnPort(node.id, dir, i)) { index = i; break; }
    }
    this.removeLeg(node, dir, index);
  }

  /** Remove one port from a node, renumbering the wires on its later ports. */
  removePort(node, dir, index) {
    if (node.legThick && node.legThick[dir]) node.legThick[dir].splice(index, 1);   // keep leg types in step
    if (dir === 'out') {
      node.outputs = Math.max(0, node.outputs - 1);
      for (const w of this.wires) if (w.fromNodeId === node.id && w.fromPort > index) w.fromPort--;
    } else {
      node.inputs = Math.max(0, node.inputs - 1);
      for (const w of this.wires) if (w.toNodeId === node.id && w.toPort > index) w.toPort--;
    }
  }
}
