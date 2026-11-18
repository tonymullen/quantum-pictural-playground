/**
 * CircuitDocument — Data model for a quantum circuit (Quirk-style).
 *
 *   nQubits   number of wires; qubit 0 is the leftmost tensor factor
 *   inputs[q]  'open' | '0' | '1' | '+' | '-'
 *   outputs[q] 'open' | '0' | '1' | '+' | '-'   (fixed = post-selected effect)
 *   columns[t][q]  Cell | null,  Cell = { gate, param? }
 *       gate ∈ CircuitGates.GATES ids ('H','X','Y','Z','S','Sdg','T','Tdg','P','XP')
 *              or 'ctrl' (•), 'actrl' (∘), 'swap' (×)
 *       param: phase string for 'P' / 'XP', e.g. "π/8" or a symbol "α"
 *
 * Same document interface as DiagramDocument: onChange/offChange, undo/redo,
 * toIR(), generateDirac(). All edits go through methods that record an undo
 * step and notify listeners. Empty columns are removed automatically.
 */
import circuitToIR from '../../core/CircuitToIR.js';
import circuitToDirac from '../../core/CircuitToDirac.js';
import { GATES, CONTROL, ANTI_CONTROL, SWAP } from '../../core/CircuitGates.js';

let _circId = 0;
const STATES = ['open', '0', '1', '+', '-'];
const CELL_IDS = new Set([...Object.keys(GATES), CONTROL, ANTI_CONTROL, SWAP]);
export const MAX_QUBITS = 8;

export default class CircuitDocument {
  constructor(name, nQubits = 2) {
    this.id = `circ-${_circId++}`;
    this.kind = 'circuit';
    this.name = name || `Circuit ${_circId}`;
    this.nQubits = nQubits;
    this.inputs = Array(nQubits).fill('open');
    this.outputs = Array(nQubits).fill('open');
    this.columns = [];
    this.tensorOrder = 'big-endian';   // see IR.TENSOR_ORDERS
    this._undoStack = [];
    this._redoStack = [];
    this._maxUndo = 100;
    this._listeners = new Set();
  }

  /* ---- Observer ---- */
  onChange(fn) { this._listeners.add(fn); }
  offChange(fn) { this._listeners.delete(fn); }
  _notify() { for (const fn of this._listeners) fn(this); }

  /* ---- Common document interface ---- */
  toIR() { return circuitToIR(this); }
  generateDirac() { return { ...circuitToDirac(this), ir: null, tensor: null }; }

  /* ---- Reading ---- */
  cell(t, q) { return (this.columns[t] && this.columns[t][q]) || null; }

  /* ---- Editing (each call is one undo step) ---- */

  /** Put a cell at (step t, qubit q); null clears it. t may be columns.length (a new last step). */
  setCell(t, q, cell) {
    this._checkQubit(q);
    if (cell && !CELL_IDS.has(cell.gate)) throw new Error(`Unknown gate "${cell.gate}"`);
    const placed = cell ? { ...cell } : null;
    this._edit(() => {
      while (this.columns.length <= t) this.columns.push(Array(this.nQubits).fill(null));
      this.columns[t][q] = placed;
    });
    return placed ? this._find(placed) : null;
  }

  /**
   * Insert a new step before t holding one cell (one undo step).
   * @returns {{t:number, q:number}} where the cell ended up
   */
  insertCell(t, q, cell) {
    this._checkQubit(q);
    if (!CELL_IDS.has(cell.gate)) throw new Error(`Unknown gate "${cell.gate}"`);
    const placed = { ...cell };
    this._edit(() => {
      t = Math.max(0, Math.min(t, this.columns.length));
      const col = Array(this.nQubits).fill(null);
      col[q] = placed;
      this.columns.splice(t, 0, col);
    });
    return this._find(placed);
  }

  /**
   * Move a cell (one undo step). `to.insert` puts it in a new step before
   * to.t; otherwise it replaces whatever is at (to.t, to.q).
   * @returns {{t:number, q:number}|null} where the cell ended up
   */
  moveCell(from, to) {
    const cell = this.cell(from.t, from.q);
    if (!cell) return null;
    this._checkQubit(to.q);
    const placed = { ...cell };
    this._edit(() => {
      this.columns[from.t][from.q] = null;
      if (to.insert) {
        const col = Array(this.nQubits).fill(null);
        col[to.q] = placed;
        this.columns.splice(Math.max(0, Math.min(to.t, this.columns.length)), 0, col);
      } else {
        while (this.columns.length <= to.t) this.columns.push(Array(this.nQubits).fill(null));
        this.columns[to.t][to.q] = placed;
      }
    });
    return this._find(placed);
  }

  /** Position of a cell object (by identity), after empty steps were removed. */
  _find(cell) {
    for (let t = 0; t < this.columns.length; t++) {
      const q = this.columns[t].indexOf(cell);
      if (q >= 0) return { t, q };
    }
    return null;
  }

  /** Insert an empty step before t (useful before setCell to place a gate between steps). */
  insertColumn(t) {
    this._edit(() => {
      this.columns.splice(t, 0, Array(this.nQubits).fill(null));
    }, { keepEmpty: t });
  }

  removeColumn(t) { this._edit(() => { this.columns.splice(t, 1); }); }

  /** Add a qubit (wire) at position q (default: last). */
  addQubit(q = this.nQubits) {
    if (this.nQubits >= MAX_QUBITS) throw new Error(`At most ${MAX_QUBITS} qubits`);
    this._edit(() => {
      this.nQubits++;
      this.inputs.splice(q, 0, 'open');
      this.outputs.splice(q, 0, 'open');
      for (const col of this.columns) col.splice(q, 0, null);
    });
  }

  removeQubit(q) {
    this._checkQubit(q);
    this._edit(() => {
      this.nQubits--;
      this.inputs.splice(q, 1);
      this.outputs.splice(q, 1);
      for (const col of this.columns) col.splice(q, 1);
    });
  }

  setInput(q, state) { this._checkState(state); this._checkQubit(q); this._edit(() => { this.inputs[q] = state; }); }
  setOutput(q, state) { this._checkState(state); this._checkQubit(q); this._edit(() => { this.outputs[q] = state; }); }

  rename(name) { this._edit(() => { this.name = name; }); }

  /** 'big-endian' (N&C: qubit 0 first factor) or 'little-endian' (Qiskit/Quirk). */
  setTensorOrder(order) {
    if (order !== 'big-endian' && order !== 'little-endian') throw new Error(`Unknown tensor order ${order}`);
    this._edit(() => { this.tensorOrder = order; });
  }

  /* ---- Undo / Redo ---- */
  toJSON() {
    return { name: this.name, nQubits: this.nQubits, tensorOrder: this.tensorOrder, inputs: [...this.inputs],
      outputs: [...this.outputs], columns: this.columns.map(c => c.map(x => (x ? { ...x } : null))) };
  }
  _restore(data) {
    this.name = data.name; this.nQubits = data.nQubits;
    this.tensorOrder = data.tensorOrder || 'big-endian';
    this.inputs = [...data.inputs]; this.outputs = [...data.outputs];
    this.columns = data.columns.map(c => c.map(x => (x ? { ...x } : null)));
  }
  pushUndo() {
    this._undoStack.push(JSON.stringify(this.toJSON()));
    if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
    this._redoStack = [];
  }
  undo() {
    if (!this._undoStack.length) return false;
    this._redoStack.push(JSON.stringify(this.toJSON()));
    this._restore(JSON.parse(this._undoStack.pop()));
    this._notify();
    return true;
  }
  redo() {
    if (!this._redoStack.length) return false;
    this._undoStack.push(JSON.stringify(this.toJSON()));
    this._restore(JSON.parse(this._redoStack.pop()));
    this._notify();
    return true;
  }

  /* ---- Internals ---- */
  _edit(fn, { keepEmpty = -1 } = {}) {
    this.pushUndo();
    fn();
    // Drop empty steps (except one just inserted on purpose)
    this.columns = this.columns.filter((c, t) => t === keepEmpty || c.some(Boolean));
    this._notify();
  }
  _checkQubit(q) {
    if (!Number.isInteger(q) || q < 0 || q >= this.nQubits) throw new Error(`No qubit ${q}`);
  }
  _checkState(s) {
    if (!STATES.includes(s)) throw new Error(`State must be one of ${STATES.join(', ')}`);
  }
}
