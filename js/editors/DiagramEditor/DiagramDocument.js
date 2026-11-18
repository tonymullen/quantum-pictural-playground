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
  _notify() { for (const fn of this._listeners) fn(this); }

  /* ---- Common document interface (shared with CircuitDocument) ---- */
  toIR() { return diagramToIR(this); }
  generateDirac() { return irToDirac(this.toIR()); }

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
        portXOffsets: n.portXOffsets
      });
    }
    const wires = this.wires.map(w => ({
      id: w.id, fromNodeId: w.fromNodeId, fromPort: w.fromPort,
      toNodeId: w.toNodeId, toPort: w.toPort, selected: w.selected,
      wireType: w.wireType
    }));
    return JSON.stringify({ nodes, wires });
  }

  _restore(json) {
    const data = JSON.parse(json);
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
    if (dir === 'out') {
      node.outputs = Math.max(0, node.outputs - 1);
      for (const w of this.wires) if (w.fromNodeId === node.id && w.fromPort > index) w.fromPort--;
    } else {
      node.inputs = Math.max(0, node.inputs - 1);
      for (const w of this.wires) if (w.toNodeId === node.id && w.toPort > index) w.toPort--;
    }
  }
}
