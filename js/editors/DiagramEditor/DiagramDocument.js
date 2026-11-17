/**
 * DiagramDocument — Shared data model for a single diagram.
 * Holds nodes, wires, undo/redo stacks, and fires change events
 * so multiple editor views can stay synchronised.
 */
import DiagramNode, { NODE_TYPES } from './DiagramNode.js';
import DiagramWire from './DiagramWire.js';

let _docId = 0;

export default class DiagramDocument {
  constructor(name) {
    this.id = `doc-${_docId++}`;
    this.name = name || `Diagram ${_docId}`;
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
        provenance: n.provenance
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
      this.nodes.set(node.id, node);
    }
    this.wires = data.wires.map(wd => {
      const w = new DiagramWire(wd.fromNodeId, wd.fromPort, wd.toNodeId, wd.toPort);
      w.id = wd.id; w.selected = wd.selected;
      w.wireType = wd.wireType || 'qubit';
      return w;
    });
  }

  pushUndo() {
    this._undoStack.push(this._snapshot());
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
}
