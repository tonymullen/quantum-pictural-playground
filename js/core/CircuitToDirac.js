/**
 * CircuitToDirac — Write a circuit in Dirac notation, column by column.
 *
 *   (outputs) · C_k ⋯ C_2 · C_1 · (inputs)      — later steps on the left
 *
 * Each column C_t is a ⊗ of single-qubit gates and I on idle wires, e.g.
 * (H \otimes I). Adjacent CNOT / CZ / SWAP use their names; other controlled
 * columns use the projector form
 *   |0⟩⟨0| ⊗ I + |1⟩⟨1| ⊗ X
 * Inputs become a ket (|00⟩, or (I ⊗ |0⟩) when some wires are open), outputs
 * a bra likewise. Every expression parses with DiracParser and evaluates to
 * exactly the circuit's tensor (CircuitGates.circuitTensor).
 */
import { GATES, analyzeColumn, cellPhase, isIdleColumn, isMixedCircuit } from './CircuitGates.js';

/**
 * @param {{ nQubits:number, inputs:string[], outputs:string[], columns:any[][] }} circ
 * @returns {{ latex: string, info: string, category: string, reason: string }}
 */
export default function circuitToDirac(circ) {
  if (isMixedCircuit(circ)) {
    return { latex: '', category: 'D', reason: 'Measurement: no Dirac form yet',
      info: 'This circuit measures or discards, so it is a quantum process (drawn doubled) — Dirac notation for it is not available yet; the proof checker handles it' };
  }
  // Little-endian: the last qubit is the first factor — print the mirrored circuit
  if (circ.tensorOrder === 'little-endian') circ = mirrorQubits(circ);
  const n = circ.nQubits;
  if (n === 0) return { latex: '1', info: '', category: 'C', reason: 'Empty circuit' };

  const factors = [];
  const inputs = Array.from({ length: n }, (_, q) => circ.inputs[q] || 'open');
  const outputs = Array.from({ length: n }, (_, q) => circ.outputs[q] || 'open');

  const out = _boundary(outputs, 'bra');
  if (out) factors.push(out);
  const cols = circ.columns.filter(c => !isIdleColumn(c));
  for (let k = cols.length - 1; k >= 0; k--) factors.push(_column(cols[k], n));
  const inp = _boundary(inputs, 'ket');
  if (inp) factors.push(inp);

  let latex;
  if (factors.length === 0) latex = n === 1 ? 'I' : `I^{\\otimes ${n}}`;
  else latex = factors.map(f => (factors.length > 1 && f.compound ? `(${f.latex})` : f.latex)).join(' ');

  const nSteps = cols.length;
  const reason = nSteps === 0 ? 'Identity circuit'
    : `${nSteps} step${nSteps > 1 ? 's' : ''}, written column by column (latest on the left)`;
  const info = factors.some(f => f.fallback)
    ? 'A controlled swap of non-adjacent qubits is shown as U (not evaluated)' : '';
  return { latex, info, category: 'A', reason };
}

/** The same circuit with qubit order reversed (qubit q ↦ n−1−q). */
export function mirrorQubits(circ) {
  const rev = a => [...a].reverse();
  return { ...circ, tensorOrder: 'big-endian', inputs: rev(circ.inputs), outputs: rev(circ.outputs),
    columns: circ.columns.map(rev) };
}

/** Input ket / output bra: |01⟩, or a ⊗ with I on open wires; null if all open. */
function _boundary(labels, kind) {
  if (labels.every(l => l === 'open')) return null;
  const one = l => kind === 'ket' ? `|${l}\\rangle` : `\\langle ${l}|`;
  if (labels.every(l => l !== 'open')) return { latex: one(labels.join('')), compound: false };
  return { latex: labels.map(l => (l === 'open' ? 'I' : one(l))).join(' \\otimes '), compound: true };
}

const _gateLatex = cell => {
  const g = GATES[cell.gate];
  if (!g.param) return g.latex();
  const ph = cellPhase(cell);
  return g.latex(ph ? ph.toLatex() : _symbolicPhase(cell.param));
};
const _symbolicPhase = s => s.replace(/α/g, '\\alpha ').replace(/β/g, '\\beta ').replace(/γ/g, '\\gamma ')
  .replace(/θ/g, '\\theta ').replace(/φ/g, '\\phi ').trim();

/** One column as an operator on all n qubits. */
function _column(col, n) {
  const { controls, targets, swaps } = analyzeColumn(col);
  const tensor = slots => ({ latex: slots.join(' \\otimes '), compound: slots.length > 1 });

  if (controls.length === 0) {
    const slots = [];
    for (let q = 0; q < n; q++) {
      const t = targets.find(x => x.q === q);
      if (swaps.length === 2 && q === swaps[0] && swaps[1] === q + 1) { slots.push('\\operatorname{SWAP}'); q++; continue; }
      slots.push(t ? _gateLatex(t.cell) : 'I');
    }
    if (swaps.length === 2 && swaps[1] !== swaps[0] + 1) return _swapChain(swaps, n, slots);
    return tensor(slots);
  }

  // Named adjacent two-qubit gates
  if (controls.length === 1 && !controls[0].anti && targets.length === 1 && swaps.length === 0) {
    const c = controls[0].q, t = targets[0].q, gate = targets[0].cell.gate;
    const name = gate === 'X' && t === c + 1 ? 'CNOT' : gate === 'Z' && Math.abs(t - c) === 1 ? 'CZ' : null;
    if (name) {
      const lo = Math.min(c, t), slots = [];
      for (let q = 0; q < n; q++) {
        if (q === lo) { slots.push(`\\operatorname{${name}}`); q++; } else slots.push('I');
      }
      return tensor(slots);
    }
  }

  // Projector form: sum over control values
  const terms = [];
  const nc = controls.length;
  for (let v = 0; v < (1 << nc); v++) {
    const values = new Map(controls.map((c, i) => [c.q, (v >> (nc - 1 - i)) & 1]));
    const active = controls.every(c => values.get(c.q) === (c.anti ? 0 : 1));
    const slots = [];
    for (let q = 0; q < n; q++) {
      if (values.has(q)) { const b = values.get(q); slots.push(`|${b}\\rangle\\langle ${b}|`); continue; }
      const t = targets.find(x => x.q === q);
      if (active && swaps.length === 2 && q === swaps[0]) {
        // swap inside a controlled term: only adjacent swaps can be named here
        if (swaps[1] !== q + 1) return _fallback();
        slots.push('\\operatorname{SWAP}'); q++; continue;
      }
      slots.push(active && t ? _gateLatex(t.cell) : 'I');
    }
    terms.push(slots.join(' \\otimes '));
  }
  return { latex: terms.join(' + '), compound: true };
}

/** A non-adjacent swap (a,b) as a product of adjacent swaps, plus the column's other gates. */
function _swapChain([a, b], n, slots) {
  const adjacentSwap = k => {
    const s = [];
    for (let q = 0; q < n; q++) {
      if (q === k) { s.push('\\operatorname{SWAP}'); q++; } else s.push('I');
    }
    return `(${s.join(' \\otimes ')})`;
  };
  // SWAP(a,b) = S(a) S(a+1) … S(b-1) … S(a+1) S(a), with S(k) swapping k and k+1.
  // It acts only on a and b, so it commutes with the column's other gates.
  const seq = [];
  for (let k = a; k < b; k++) seq.push(k);
  for (let k = b - 2; k >= a; k--) seq.push(k);
  const others = slots.some((x, q) => q !== a && q !== b && x !== 'I')
    ? `(${slots.map((x, q) => (q === a || q === b ? 'I' : x)).join(' \\otimes ')})` : '';
  return { latex: [others, ...seq.map(adjacentSwap)].filter(Boolean).join(' '), compound: true };
}

/** Last resort (a controlled swap of non-adjacent qubits): named, not evaluable. */
function _fallback() {
  return { latex: '\\operatorname{U}', compound: false, fallback: true };
}
