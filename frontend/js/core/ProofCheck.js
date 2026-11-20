/**
 * ProofCheck — Check one step of a diagrammatic proof: is diagram A equal
 * to diagram B (relation '='), or equal up to a nonzero scalar ('≈')?
 *
 * Concrete diagrams are compared exactly (numerically, tolerance 1e-9).
 *
 * Diagrams with symbolic generators — boxes f, states ψ, effects φ,
 * scalars s, spider phases α — are checked by random substitution: every
 * symbol gets a random value, the same on both sides, and the comparison is
 * repeated with fresh values. Two different diagrams agree on random values
 * only with negligible probability, so a pass is strong evidence of an
 * identity in the symbols; a fail is a definite counterexample.
 *
 *   - Boxes / states / effects / scalars: keyed by label and shape (a box
 *     "f" with 1 input and 1 output is one symbol on both sides).
 *   - Spider phases: a label is a linear expression such as "α+β",
 *     "2α-π/2" or "-θ/2"; symbols get random multiples of π/1009, so the
 *     arithmetic is exact. A label that is not such an expression is one
 *     opaque symbol.
 */
import C from './Complex.js';
import Tensor from './Tensor.js';
import Phase from './Phase.js';
import contractIR from './ContractIR.js';
import { generatorTensor } from './Interpret.js';
import Config from './Config.js';

/**
 * @param {import('./IR.js').IRGraph} irA — left-hand diagram
 * @param {import('./IR.js').IRGraph} irB — right-hand diagram
 * @param {'='|'≈'} relation
 * @returns {{ status: 'ok'|'fail'|'unavailable', scalar?: [number,number],
 *             symbols: string[], hint: string }}
 */
export function checkStep(irA, irB, relation, { trials = 3, seed = 12345, assumptions = {} } = {}) {
  for (const [ir, side] of [[irA, 'left'], [irB, 'right']]) {
    if (!ir.isValid) return { status: 'unavailable', symbols: [],
      hint: `The ${side} diagram has errors: ` + ir.diagnostics.filter(d => d.severity === 'error').map(d => d.message).join('; ') };
  }
  const shape = ir => `${ir.inputBoundary.length} input${ir.inputBoundary.length === 1 ? '' : 's'} and ${ir.outputBoundary.length} output${ir.outputBoundary.length === 1 ? '' : 's'}`;
  if (irA.inputBoundary.length !== irB.inputBoundary.length || irA.outputBoundary.length !== irB.outputBoundary.length) {
    return { status: 'fail', symbols: [],
      hint: `Different shapes: the left diagram has ${shape(irA)}, the right has ${shape(irB)}` };
  }

  const symbols = [...new Set([..._symbolsOf(irA), ..._symbolsOf(irB)])].sort();
  const assumed = symbols.filter(x => assumptions[x]).map(x => `${x} ${assumptions[x]}`);
  const nTrials = symbols.length ? trials : 1;
  const rand = _rng(seed);
  let firstScalar = null, scalarVaries = false;

  for (let k = 0; k < nTrials; k++) {
    const values = new Map();   // symbol key → value, shared by both sides
    let ta, tb;
    try { ta = _evaluate(irA, values, rand, assumptions); tb = _evaluate(irB, values, rand, assumptions); }
    catch (e) { if (e instanceof AssumptionError) return { status: 'unavailable', symbols, hint: e.message }; throw e; }
    if (ta.tooLarge || tb.tooLarge) return { status: 'unavailable', symbols, hint: ta.reason || tb.reason };
    if (!ta.tensor || !tb.tensor) return { status: 'unavailable', symbols, hint: 'Could not evaluate a diagram' };
    const A = ta.tensor, B = tb.tensor;
    const tol = Config.numericTolerance;
    const exact = Tensor.equal(A, B, tol);
    const upTo = exact ? { equal: true, phase: C.ONE } : Tensor.equalUpToPhase(A, B, tol);
    if (!upTo.equal) {
      // ≈ asks for nonzero numbers λ, μ with λ f = μ g (PQP Def. 3.39), so zero is ≈ only to zero
      const zA = A.d.every(z => C.isZero(z, tol));
      const zB = B.d.every(z => C.isZero(z, tol));
      if (zA !== zB) return { status: 'fail', symbols,
        hint: `The ${zA ? 'left' : 'right'} diagram is zero and the other is not — zero is equal (even up to a number) only to zero` };
      return { status: 'fail', symbols,
        hint: symbols.length ? `Not equal (a random choice of ${symbols.join(', ')} tells them apart)` : 'Not equal' };
    }
    const s = upTo.phase;
    if (relation === '=' && !exact) {
      return { status: 'fail', symbols, scalar: s,
        hint: `Equal only up to a scalar (${_scalarText(s)}) — use ≈, or add the scalar` };
    }
    if (relation === '≈' && C.isZero(s)) return { status: 'fail', symbols, hint: 'Differ by a zero scalar' };
    if (!firstScalar) firstScalar = s;
    else if (!C.eq(firstScalar, s, 1e-7)) scalarVaries = true;
  }

  const how = (symbols.length ? ` for random values of ${symbols.join(', ')} (${nTrials} checks)` : '')
    + (assumed.length ? `, assuming ${assumed.join(', ')}` : '');
  if (relation === '=') return { status: 'ok', symbols, scalar: C.ONE, hint: `Equal${how}` };
  const sc = C.eq(firstScalar, C.ONE) ? 'exactly equal' : `equal up to ${scalarVaries ? 'a scalar that depends on the symbols' : _scalarText(firstScalar)}`;
  return { status: 'ok', symbols, scalar: firstScalar, hint: `${sc[0].toUpperCase() + sc.slice(1)}${how}` };
}

/* ---- Symbols ---- */

const _isSpider = n => n.kind === 'z-spider' || n.kind === 'x-spider';
// A symbol is its label plus its canonical shape: fᵀ and f† swap inputs and
// outputs, so they share f's key (and its random matrix, transformed).
const _boxKey = n => {
  const swap = n.flip && n.flip.v;
  const i = swap ? n.totalOut : n.totalIn, o = swap ? n.totalIn : n.totalOut;
  return `${n.label || n.kind}:${i}→${o}`;
};

/** Names of the symbols a graph uses (for messages). */
function _symbolsOf(ir) {
  const out = [];
  const summed = new Set(ir.sumIndices || []);
  for (const n of ir.nodes.values()) {
    if (summed.has(n.label) && (n.kind === 'state' || n.kind === 'effect')) continue;   // a summed basis index
    if (_isSpider(n) && n.phaseSymbolic) {
      const expr = parsePhaseExpr(n.label);
      if (expr) out.push(...Object.keys(expr.symbols)); else out.push(n.label);
    } else if (!_isSpider(n) && !generatorTensor(n)) {
      out.push(n.label || n.kind);
    }
  }
  return out;
}

/** Contract a graph with symbols replaced by values from `values` (filled on demand). */
/** Thrown when an assumption cannot apply (e.g. "unitary" on a box that is not square). */
class AssumptionError extends Error {}

/**
 * Contract a graph; if it is a sum (Σ over indices), sum the contractions over
 * every assignment of the indices to the basis {0, 1}.
 */
function _evaluate(ir, values, rand, assumptions) {
  const idx = ir.sumIndices || [];
  if (!idx.length) return _contract(ir, values, rand, assumptions, null);
  let total = null;
  for (let a = 0; a < (1 << idx.length); a++) {
    const subst = Object.fromEntries(idx.map((x, k) => [x, String((a >> (idx.length - 1 - k)) & 1)]));
    const r = _contract(ir, values, rand, assumptions, subst);
    if (!r.tensor) return r;
    total = total ? Tensor.add(total, r.tensor) : r.tensor;
  }
  return { tensor: total };
}

function _contract(ir, values, rand, assumptions = {}, subst = null) {
  const saved = [];
  for (const n of ir.nodes.values()) {
    // A summed index on a state/effect: this term's basis vector
    if (subst && (n.kind === 'state' || n.kind === 'effect') && subst[n.label] !== undefined) {
      saved.push([n, { label: n.label }]);
      n.label = subst[n.label];
      continue;
    }
    if (_isSpider(n) && n.phaseSymbolic) {
      saved.push([n, { phase: n.phase, phaseSymbolic: true, tensor: n.tensor }]);
      n.phase = _phaseValue(n.label, values, rand);
      n.phaseSymbolic = false;
    } else if (!_isSpider(n) && !generatorTensor(n)) {
      saved.push([n, { phase: n.phase, phaseSymbolic: n.phaseSymbolic, tensor: n.tensor }]);
      const key = 'box:' + _boxKey(n);
      const swap = n.flip && n.flip.v;
      const [rows, cols] = swap ? [1 << n.totalIn, 1 << n.totalOut] : [1 << n.totalOut, 1 << n.totalIn];
      if (!values.has(key)) values.set(key, _sample(n, rows, cols, rand, assumptions[n.label]));
      n.tensor = values.get(key);      // canonical matrix; generatorTensor applies the orientation
    }
  }
  try { return contractIR(ir); }
  finally { for (const [n, s] of saved) Object.assign(n, s); }
}

/** Random phase for a (possibly compound) phase label. */
function _phaseValue(label, values, rand) {
  const sym = name => {
    const key = 'phase:' + name;
    if (!values.has(key)) values.set(key, new Phase(1 + Math.floor(rand() * 2016), 1009));
    return values.get(key);
  };
  const expr = parsePhaseExpr(label);
  if (!expr) return sym(label);
  let total = expr.constant;
  for (const [name, coef] of Object.entries(expr.symbols)) {
    const v = sym(name);
    total = total.add(new Phase(v.num * coef.num, v.den * coef.den));
  }
  return total;
}

/**
 * Parse a linear phase expression: terms like α, -β, 2α, α/2, 3θ/4, π/2, -π,
 * \\alpha, joined by + and −. Returns { constant: Phase (multiple of π),
 * symbols: { name: {num, den} } } or null if the label is not of this form.
 */
export function parsePhaseExpr(label) {
  if (label == null) return null;
  const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', phi: 'φ', psi: 'ψ', lambda: 'λ', mu: 'μ', omega: 'ω' };
  let s = String(label).replace(/\s+/g, '').replace(/\\([a-z]+)/g, (m, w) => (w === 'pi' ? 'π' : GREEK[w] || m))
    .replace(/pi/g, 'π').replace(/−/g, '-');
  if (!s) return null;
  if (!/^[+-]/.test(s)) s = '+' + s;
  const termRe = /([+-])(\d*)\*?(π|[A-Za-zα-ωΑ-Ω][A-Za-z0-9_α-ωΑ-Ω']*)?(?:\/(\d+))?/y;
  let constant = new Phase(0), symbols = {}, pos = 0;
  while (pos < s.length) {
    termRe.lastIndex = pos;
    const m = termRe.exec(s);
    if (!m || m[0].length <= 1) return null;
    const sign = m[1] === '-' ? -1 : 1;
    const num = sign * (m[2] ? parseInt(m[2], 10) : 1);
    const den = m[4] ? parseInt(m[4], 10) : 1;
    if (den === 0) return null;
    if (m[3] === 'π') constant = constant.add(new Phase(num, den));
    else if (m[3]) {
      const prev = symbols[m[3]];
      const add = { num, den };
      symbols[m[3]] = prev ? _addRat(prev, add) : add;
    } else {
      // bare fraction: "1/2" means π/2, as in Phase.parse (a bare integer is not a phase)
      if (!m[2] || !m[4]) return null;
      constant = constant.add(new Phase(num, den));
    }
    pos = termRe.lastIndex;
  }
  for (const k of Object.keys(symbols)) if (symbols[k].num === 0) delete symbols[k];
  return { constant, symbols };
}

function _addRat(a, b) {
  const num = a.num * b.den + b.num * a.den, den = a.den * b.den;
  const g = (x, y) => (y ? g(y, x % y) : Math.abs(x));
  const d = g(num, den) || 1;
  return { num: num / d, den: den / d };
}

/* ---- Random values ---- */

/** Small seeded PRNG (mulberry32), so checks are reproducible. */
function _rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random value for a symbol, satisfying its assumption:
 *   unitary   — a random unitary (square only)
 *   isometry  — random orthonormal columns (normalised, for a state)
 *   causal    — discarding the outputs = discarding the inputs (⏚ on thick legs,
 *               delete on thin ones); for one half of a doubled f̂ this means f
 *               is an isometry (PQP: a pure process is causal iff it is an isometry)
 */
function _sample(n, rows, cols, rand, prop) {
  const name = n.label || n.kind;
  if (!prop) return _randomTensor(rows, cols, rand);
  if (prop === 'unitary') {
    if (rows !== cols) throw new AssumptionError(`${name} is assumed unitary, but it has ${Math.log2(cols)} input(s) and ${Math.log2(rows)} output(s)`);
    return _orthonormalColumns(rows, cols, rand);
  }
  if (prop === 'isometry' || (prop === 'causal' && n.doubledHalf)) {
    if (rows < cols) throw new AssumptionError(`${name} is assumed ${prop === 'causal' ? 'causal (an isometry)' : 'an isometry'}, but it has more inputs than outputs`);
    return _orthonormalColumns(rows, cols, rand);
  }
  if (prop === 'causal') return _causal(n, rows, cols, rand);
  return _randomTensor(rows, cols, rand);
}

/** Random rows×cols matrix with orthonormal columns (Gram–Schmidt). */
function _orthonormalColumns(rows, cols, rand) {
  const colsV = [];
  while (colsV.length < cols) {
    let v = Array.from({ length: rows }, () => [rand() * 2 - 1, rand() * 2 - 1]);
    for (const u of colsV) {
      let ip = C.ZERO;                      // ⟨u|v⟩
      for (let r = 0; r < rows; r++) ip = C.add(ip, C.mul(C.conj(u[r]), v[r]));
      v = v.map((x, r) => C.sub(x, C.mul(ip, u[r])));
    }
    const norm = Math.sqrt(v.reduce((a, x) => a + C.abs2(x), 0));
    if (norm < 1e-6) continue;
    colsV.push(v.map(x => C.scale(1 / norm, x)));
  }
  const d = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) d.push(colsV[c][r]);
  return new Tensor(rows, cols, d);
}

/**
 * A random causal map: a random M, corrected so that D_out·M = D_in, where
 * D is the discard (⏚ = Σ⟨ii| on a thick leg's pair) or delete (Σ⟨i| on a
 * thin leg), on the symbol's canonical legs. Causality is linear, so this is a
 * random point of exactly the causal maps.
 */
function _causal(n, rows, cols, rand) {
  const g = n.legGroups || { in: Array(Math.log2(cols)).fill(1), out: Array(Math.log2(rows)).fill(1) };
  const groups = n.flip && n.flip.v ? { in: g.out, out: g.in } : g;      // canonical legs
  const disc = list => list.reduce((acc, k) => {
    const piece = k === 2 ? [1, 0, 0, 1] : [1, 1];
    const out = [];
    for (const a of acc) for (const b of piece) out.push(a * b);
    return out;
  }, [1]);
  const Dout = disc(groups.out), Din = disc(groups.in);
  if (Dout.length !== rows || Din.length !== cols) return _randomTensor(rows, cols, rand);
  const M = _randomTensor(rows, cols, rand);
  const nn = Dout.reduce((a, x) => a + x * x, 0);
  for (let i = 0; i < cols; i++) {
    let sum = C.ZERO;
    for (let o = 0; o < rows; o++) sum = C.add(sum, C.scale(Dout[o], M.get(o, i)));
    const c = C.sub([Din[i], 0], sum);
    for (let o = 0; o < rows; o++) M.set(o, i, C.add(M.get(o, i), C.scale(Dout[o] / nn, c)));
  }
  return M;
}

function _randomTensor(rows, cols, rand) {
  const d = [];
  for (let i = 0; i < rows * cols; i++) d.push([rand() * 2 - 1, rand() * 2 - 1]);
  return new Tensor(rows, cols, d);
}

function _scalarText(s) {
  const tol = 1e-9, mag = C.abs(s);
  const named = [[Math.SQRT2, '√2'], [1 / Math.SQRT2, '1/√2'], [2, '2'], [0.5, '1/2']];
  if (Math.abs(C.arg(s)) < tol) for (const [v, t] of named) if (Math.abs(mag - v) < tol) return t;
  if (Math.abs(mag - 1) < tol) return `a phase e^{i·${(C.arg(s) / Math.PI).toFixed(3)}π}`;
  return C.str(s, 4);
}
