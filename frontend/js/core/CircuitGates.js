/**
 * CircuitGates — Gate library and reference semantics for quantum circuits.
 *
 * A circuit (see CircuitDocument) is
 *   { nQubits, inputs: string[], outputs: string[], columns: (Cell|null)[][] }
 * where columns[t][q] is the cell on qubit q at time step t and
 *   Cell = { gate: <gate id>, param?: string }.
 * Qubit 0 is the leftmost tensor factor (most significant bit) — the
 * leftmost wire in the PQP diagram.
 *
 * Column semantics follow Quirk: every control (•) or anti-control (∘) in a
 * column conditions every gate in that column; a column with exactly two ×
 * cells swaps those qubits.
 *
 * Inputs: 'open' | '0' | '1' | '+' | '-'.  Outputs: 'open' | '0' | '1' | '+' | '-' | 'discard'
 * (a fixed output is a post-selected effect ⟨0|, ⟨1|, ⟨+|, ⟨−|; 'discard' is ⏚).
 *
 * Measurement (PQP ch. 8, strictly): a 'measure' cell measures its qubit in the
 * computational basis, and from then on the wire is classical. Only controls
 * may sit on a classical wire — they make the column's gates classically
 * controlled. A circuit with a measurement (or a discarded output) is a
 * quantum process, not a linear map: it is drawn in the doubled picture.
 */
import C from './Complex.js';
import Tensor from './Tensor.js';
import Phase from './Phase.js';
import * as K from './KnownGates.js';

const diag = z => Tensor.fromRows([[C.ONE, C.ZERO], [C.ZERO, z]]);

/**
 * Gate descriptors.
 *   label  — short text drawn on the circuit
 *   latex  — Dirac form (a function of the phase LaTeX for parametrised gates)
 *   zx     — ZX translation: { spider: 'z'|'x', phase } | { h: true } | { y: true }
 *   param  — true if the gate takes a phase parameter (a Phase.parse string)
 */
export const GATES = {
  H:   { id: 'H',   label: 'H',  latex: () => 'H',              zx: { h: true },                     matrix: () => K.H },
  X:   { id: 'X',   label: 'X',  latex: () => 'X',              zx: { spider: 'x', phase: Phase.PI }, matrix: () => K.X },
  Y:   { id: 'Y',   label: 'Y',  latex: () => 'Y',              zx: { y: true },                     matrix: () => K.Y },
  Z:   { id: 'Z',   label: 'Z',  latex: () => 'Z',              zx: { spider: 'z', phase: Phase.PI }, matrix: () => K.Z },
  S:   { id: 'S',   label: 'S',  latex: () => 'S',              zx: { spider: 'z', phase: new Phase(1, 2) },  matrix: () => K.S },
  Sdg: { id: 'Sdg', label: 'S†', latex: () => 'S^\\dagger',     zx: { spider: 'z', phase: new Phase(-1, 2) }, matrix: () => Tensor.dagger(K.S) },
  T:   { id: 'T',   label: 'T',  latex: () => 'T',              zx: { spider: 'z', phase: new Phase(1, 4) },  matrix: () => K.T },
  Tdg: { id: 'Tdg', label: 'T†', latex: () => 'T^\\dagger',     zx: { spider: 'z', phase: new Phase(-1, 4) }, matrix: () => Tensor.dagger(K.T) },
  // Z-phase gate diag(1, e^{iθ}) = Z spider with phase θ
  P:   { id: 'P',   label: 'Z(θ)', param: true,
         latex: t => `(|0\\rangle\\langle 0| + e^{i ${t}}|1\\rangle\\langle 1|)`,
         zx: { spider: 'z', phase: 'param' },
         matrix: ph => ph ? diag(ph.toComplex()) : null },
  // X-phase gate H·diag(1, e^{iθ})·H = X spider with phase θ
  XP:  { id: 'XP',  label: 'X(θ)', param: true,
         latex: t => `(|+\\rangle\\langle +| + e^{i ${t}}|-\\rangle\\langle -|)`,
         zx: { spider: 'x', phase: 'param' },
         matrix: ph => ph ? Tensor.mul(K.H, Tensor.mul(diag(ph.toComplex()), K.H)) : null },
};

/** Non-gate cells. */
export const CONTROL = 'ctrl', ANTI_CONTROL = 'actrl', SWAP = 'swap', MEASURE = 'measure';

/** Does the circuit measure or discard anything (so it is a quantum process, drawn doubled)? */
export function isMixedCircuit(circ) {
  return (circ.outputs || []).includes('discard')
    || (circ.columns || []).some(col => (col || []).some(c => c && c.gate === MEASURE));
}

/**
 * Which wires are classical before each step: classicalBefore(circ)[t] is the
 * set of qubits measured in a step before t (t = columns.length: at the outputs).
 * Also returns measuredAt[q] = the step that measures q (or -1).
 */
export function wireKinds(circ) {
  const n = circ.nQubits, measuredAt = Array(n).fill(-1), before = [];
  let cur = new Set();
  (circ.columns || []).forEach((col, t) => {
    before.push(new Set(cur));
    (col || []).forEach((c, q) => { if (c && c.gate === MEASURE && measuredAt[q] < 0) { measuredAt[q] = t; cur.add(q); } });
  });
  before.push(new Set(cur));
  return { classicalBefore: before, measuredAt };
}

/** Phase of a parametrised cell (null if symbolic, e.g. "α"). */
export function cellPhase(cell) {
  return Phase.parse(cell.param ?? '');
}

/** 2×2 matrix of a gate cell, or null if symbolic. */
export function cellMatrix(cell) {
  const g = GATES[cell.gate];
  if (!g) return null;
  return g.param ? g.matrix(cellPhase(cell)) : g.matrix();
}

/** Single-qubit kets for inputs/outputs. */
export const BASIS_KET = { '0': K.KET0, '1': K.KET1, '+': K.KET_PLUS, '-': K.KET_MINUS };

/**
 * Classify the cells of one column.
 * @returns {{ controls: {q:number, anti:boolean}[], targets: {q:number, cell:object}[],
 *             swaps: number[], diagnostics: string[] }}
 */
export function analyzeColumn(col) {
  const controls = [], targets = [], swapQs = [], measures = [], diagnostics = [];
  (col || []).forEach((cell, q) => {
    if (!cell) return;
    if (cell.gate === CONTROL) controls.push({ q, anti: false });
    else if (cell.gate === ANTI_CONTROL) controls.push({ q, anti: true });
    else if (cell.gate === SWAP) swapQs.push(q);
    else if (cell.gate === MEASURE) measures.push(q);
    else if (GATES[cell.gate]) targets.push({ q, cell });
    else diagnostics.push(`Unknown gate "${cell.gate}" on qubit ${q}`);
  });
  let swaps = swapQs;
  if (swapQs.length !== 0 && swapQs.length !== 2) {
    diagnostics.push(`A swap needs exactly two × in a column (found ${swapQs.length}); ignored`);
    swaps = [];
  }
  return { controls, targets, swaps, measures, diagnostics };
}

/** Is a column empty or a no-op (controls with nothing to control)? */
export function isIdleColumn(col) {
  const a = analyzeColumn(col);
  return a.targets.length === 0 && a.swaps.length === 0 && a.measures.length === 0;
}

/**
 * The exact operator of one column, restricted to `qubits` (ascending; the
 * first is the most significant bit). Every cell of the column must lie on
 * one of `qubits`. Returns null if a gate is symbolic.
 */
export function columnOperator(col, qubits) {
  const { controls, targets, swaps } = analyzeColumn(col);
  const k = qubits.length, dim = 1 << k;
  const pos = new Map(qubits.map((q, i) => [q, k - 1 - i])); // qubit → bit position
  const bit = (x, q) => (x >> pos.get(q)) & 1;

  const ops = new Map();
  for (const { q, cell } of targets) {
    const m = cellMatrix(cell);
    if (!m) return null;
    ops.set(q, m);
  }
  const satisfied = j => controls.every(({ q, anti }) => bit(j, q) === (anti ? 0 : 1));
  const swapBits = x => {
    if (swaps.length !== 2) return x;
    const [a, b] = swaps, ba = bit(x, a), bb = bit(x, b);
    if (ba === bb) return x;
    return x ^ (1 << pos.get(a)) ^ (1 << pos.get(b));
  };

  const M = Tensor.zeros(dim, dim);
  for (let j = 0; j < dim; j++) {
    if (!satisfied(j)) { M.set(j, j, C.ONE); continue; }
    for (let i = 0; i < dim; i++) {
      let amp = C.ONE;
      for (const q of qubits) {
        const op = ops.get(q);
        if (op) amp = C.mul(amp, op.get(bit(i, q), bit(j, q)));
        else if (bit(i, q) !== bit(j, q)) { amp = C.ZERO; break; }
      }
      if (!C.isZero(amp)) M.set(swapBits(i), j, amp);
    }
  }
  return M;
}

/**
 * Reference semantics: the circuit's tensor, computed directly by
 * multiplying column operators (independent of the ZX translation).
 * Shape (2^#open outputs) × (2^#open inputs), qubit 0 most significant.
 * Returns null if any gate is symbolic.
 */
export function circuitTensor(circ) {
  const n = circ.nQubits;
  const all = Array.from({ length: n }, (_, q) => q);
  let U = Tensor.identity(1 << n);
  for (const col of circ.columns) {
    const op = columnOperator(col, all);
    if (!op) return null;
    U = Tensor.mul(op, U);
  }
  let S = null, E = null;
  for (let q = 0; q < n; q++) {
    const inp = circ.inputs[q] || 'open', out = circ.outputs[q] || 'open';
    const s = inp === 'open' ? K.I2 : BASIS_KET[inp];
    const e = out === 'open' ? K.I2 : Tensor.dagger(BASIS_KET[out]);
    S = S ? Tensor.kron(S, s) : s;
    E = E ? Tensor.kron(E, e) : e;
  }
  if (n === 0) return Tensor.identity(1);
  return Tensor.mul(E, Tensor.mul(U, S));
}

/**
 * Reference semantics of a circuit with measurements: its channel, in the
 * index convention of the doubled picture (see DiagramToIR), computed
 * directly with density operators — independent of the diagram.
 *
 * Measuring dephases the qubit; a classically controlled gate is then just
 * the controlled gate (its control is diagonal). Each open quantum wire is a
 * pair (conjugate index a, index b), standing for the operator |b⟩⟨a|; each
 * open classical wire is one index c (the diagonal entry). Wires are in qubit
 * order, qubit 0 most significant (big-endian). Returns null if symbolic.
 * @returns {Tensor|null} (out dim) × (in dim)
 */
export function circuitChannel(circ) {
  const n = circ.nQubits, N = 1 << n;
  const all = Array.from({ length: n }, (_, q) => q);
  const bitOf = (x, q) => (x >> (n - 1 - q)) & 1;
  const steps = [];
  for (const col of circ.columns) {
    const a = analyzeColumn(col);
    if (a.targets.length || a.swaps.length) {
      const U = columnOperator(col.map(c => (c && c.gate === MEASURE ? null : c)), all);
      if (!U) return null;
      steps.push({ U, Ud: Tensor.dagger(U) });
    }
    for (const q of a.measures) steps.push({ measure: q });
  }
  const { classicalBefore } = wireKinds(circ);
  const classicalOut = classicalBefore[circ.columns.length];
  const openIn = all.filter(q => (circ.inputs[q] || 'open') === 'open');
  const outKind = q => {
    const o = circ.outputs[q] || 'open';
    if (o !== 'open') return o;
    return classicalOut.has(q) ? 'c' : 'q';
  };
  const inDim = 4 ** openIn.length;
  const outQ = all.filter(q => ['q', 'c'].includes(outKind(q)));
  const outDim = outQ.reduce((d, q) => d * (outKind(q) === 'q' ? 4 : 2), 1);
  const M = Tensor.zeros(outDim, inDim);
  const ket = s => BASIS_KET[s];
  for (let j = 0; j < inDim; j++) {
    // |b⟩⟨a| on the open inputs (pairs (a, b), qubit order), |s⟩⟨s| on fixed ones
    let X = Tensor.fromRows([[C.ONE]]);
    let k = openIn.length;
    for (const q of all) {
      const inp = circ.inputs[q] || 'open';
      let f;
      if (inp === 'open') {
        k--; const pair = (j >> (2 * k)) & 3, a = pair >> 1, b = pair & 1;
        f = Tensor.zeros(2, 2); f.set(b, a, C.ONE);
      } else f = Tensor.mul(ket(inp), Tensor.dagger(ket(inp)));
      X = q === 0 ? f : Tensor.kron(X, f);
    }
    for (const st of steps) {
      if (st.U) X = Tensor.mul(st.U, Tensor.mul(X, st.Ud));
      else {
        const Y = Tensor.zeros(N, N);
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
          if (bitOf(r, st.measure) === bitOf(c, st.measure)) Y.set(r, c, X.get(r, c));
        X = Y;
      }
    }
    // Read off the outputs: sum over discarded / post-selected wires
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const v = X.get(r, c);
      if (C.isZero(v)) continue;
      let w = C.ONE, idx = 0, ok = true;
      for (const q of all) {
        const o = outKind(q), br = bitOf(r, q), bc = bitOf(c, q);
        if (o === 'q') idx = idx * 4 + bc * 2 + br;          // pair (conj a = column, b = row)
        else if (o === 'c') { if (br !== bc) { ok = false; break; } idx = idx * 2 + br; }
        else if (o === 'discard') { if (br !== bc) { ok = false; break; } }
        else {                                                // post-select ⟨s|·|s⟩
          const e = ket(o);
          w = C.mul(w, C.mul(C.conj(e.get(br, 0)), e.get(bc, 0)));
        }
      }
      if (!ok || C.isZero(w)) continue;
      M.set(idx, j, C.add(M.get(idx, j), C.mul(w, v)));
    }
  }
  return M;
}
