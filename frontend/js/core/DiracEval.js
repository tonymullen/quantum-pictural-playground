/**
 * DiracEval — Evaluate a Dirac AST (from DiracParser) into a Tensor.
 *
 * Maps kets to column vectors, bras to row vectors, operators to matrices
 * from KnownGates, tensor products to Kronecker products, products to
 * matrix multiplication, sums to addition, daggers to conjugate transpose.
 *
 * Returns null when the expression is symbolic (e.g. |ψ⟩, α, \frac{1}{\sqrt{n}}).
 * Throws DiracEvalError when the expression is concrete but ill-typed
 * (e.g. a dimension mismatch).
 */
import C from './Complex.js';
import Tensor from './Tensor.js';
import * as Gates from './KnownGates.js';

export class DiracEvalError extends Error {}

/** @param {object} ast — from parseDirac()
 *  @returns {Tensor|null} */
export default function evalDirac(ast) {
  if (ast && ast.type === 'map') return null;    // a process ρ ↦ … needs its wire types: evalProcess
  return _eval(ast);
}

/** Values of summed indices and of ρ while evaluating (see indexsum, evalProcess). */
let ENV = { idx: {}, rho: null };
function _withEnv(env, fn) {
  const saved = ENV; ENV = env;
  try { return fn(); } finally { ENV = saved; }
}

/**
 * Evaluate an expression for a quantum process into the doubled picture's
 * matrix (the same index convention as the diagram: each quantum wire a pair
 * (conjugate index, index), each classical wire one index — DiagramToIR).
 * Accepts either notation:
 *   PQP (doubled):   Σᵢ \hat{…} — evaluated as it stands
 *   familiar:        ρ ↦ …  (or, for a state, just a density operator) — run
 *                    on each |b⟩⟨a| and read off; classical wires are the
 *                    diagonal (a bit c is the operator |c⟩⟨c|)
 * @param {object} ast
 * @param {{ in: ('q'|'c')[], out: ('q'|'c')[] }} kinds — the diagram's wires, in ⊗ order
 * @returns {{ tensor: Tensor|null, notation: 'pqp'|'familiar', hint?: string }}
 */
export function evalProcess(ast, kinds) {
  const dimOf = list => list.reduce((d, k) => d * (k === 'q' ? 4 : 2), 1);
  const inDim = dimOf(kinds.in), outDim = dimOf(kinds.out);
  const opIn = 1 << kinds.in.length, opOut = 1 << kinds.out.length;
  if (ast.type !== 'map') {
    const t = _eval(ast);
    if (!t) return { tensor: null, notation: 'pqp' };
    if (t.rows === outDim && t.cols === inDim) return { tensor: t, notation: 'pqp' };
    if (kinds.in.length === 0 && t.rows === opOut && t.cols === opOut)
      return _readOff(() => t, kinds, inDim, outDim, opIn);         // a density operator
    if (kinds.in.length && t.rows === opOut && t.cols === opOut)
      throw new DiracEvalError(`This is an operator, not a process: write ρ ↦ … for a map on states, or use the doubled (PQP) form`);
    throw new DiracEvalError(`A ${_shape(t)} matrix can't be this process: in the doubled (PQP) form it is ${outDim}×${inDim}`
      + (kinds.in.length ? '; in familiar form write ρ ↦ …' : `; as a density operator it is ${opOut}×${opOut}`));
  }
  return _readOff(rho => _withEnv({ ...ENV, rho }, () => _eval(ast.body)), kinds, inDim, outDim, opIn);
}

/** Run a map on each |b⟩⟨a| (|c⟩⟨c| for classical inputs) and read off the doubled matrix. */
function _readOff(apply, kinds, inDim, outDim, opIn) {
  const nIn = kinds.in.length, nOut = kinds.out.length;
  const M = Tensor.zeros(outDim, inDim);
  let leak = false;
  for (let j = 0; j < inDim; j++) {
    // decode input index j → row/column bit strings of ρ
    let rest = j, r = 0, c = 0;
    const digits = [];
    for (let w = nIn - 1; w >= 0; w--) {
      const base = kinds.in[w] === 'q' ? 4 : 2;
      digits[w] = rest % base; rest = Math.floor(rest / base);
    }
    for (let w = 0; w < nIn; w++) {
      const d = digits[w];
      const [ca, cb] = kinds.in[w] === 'q' ? [d >> 1, d & 1] : [d, d];   // pair (conj a, b) ↔ |b⟩⟨a|
      r = (r << 1) | cb; c = (c << 1) | ca;
    }
    const rho = Tensor.zeros(opIn, opIn); rho.set(r, c, C.ONE);
    const Y = apply(rho);
    if (!Y) return { tensor: null, notation: 'familiar' };
    if (Y.rows !== (1 << nOut) || Y.cols !== (1 << nOut))
      throw new DiracEvalError(`The process must give a ${1 << nOut}×${1 << nOut} operator (its output), not ${_shape(Y)}`);
    for (let rr = 0; rr < Y.rows; rr++) for (let cc = 0; cc < Y.cols; cc++) {
      const v = Y.get(rr, cc);
      if (C.isZero(v)) continue;
      let idx = 0, ok = true;
      for (let w = 0; w < nOut; w++) {
        const br = (rr >> (nOut - 1 - w)) & 1, bc = (cc >> (nOut - 1 - w)) & 1;
        if (kinds.out[w] === 'q') idx = idx * 4 + bc * 2 + br;
        else if (br !== bc) { ok = false; break; } else idx = idx * 2 + br;
      }
      if (!ok) { leak = true; continue; }
      M.set(idx, j, C.add(M.get(idx, j), v));
    }
  }
  return leak
    ? { tensor: M, notation: 'familiar', hint: 'Its output has off-diagonal terms on a classical wire, so it is not this process' , leak: true }
    : { tensor: M, notation: 'familiar' };
}

/** PQP's doubling of a matrix, wire by wire: (f̄ ⊗ f) with each wire's pair (conj, normal) together. */
function _double(T) {
  const m = Math.round(Math.log2(T.rows)), n = Math.round(Math.log2(T.cols));
  if ((1 << m) !== T.rows || (1 << n) !== T.cols) throw new DiracEvalError(`Can't double a ${_shape(T)} matrix (not qubits)`);
  const R = Tensor.zeros(T.rows * T.rows, T.cols * T.cols);
  const pairIdx = (a, b, k) => { let x = 0; for (let w = k - 1; w >= 0; w--) x = x * 4 + ((a >> w) & 1) * 2 + ((b >> w) & 1); return x; };
  for (let a = 0; a < T.rows; a++) for (let c = 0; c < T.cols; c++) {
    const u = C.conj(T.get(a, c));
    if (C.isZero(u)) continue;
    for (let b = 0; b < T.rows; b++) for (let d = 0; d < T.cols; d++) {
      const v = T.get(b, d);
      if (C.isZero(v)) continue;
      R.set(pairIdx(a, b, m), pairIdx(c, d, n), C.mul(u, v));
    }
  }
  return R;
}

const _shape = t => `${t.rows}×${t.cols}`;
const _isScalar = t => t.rows === 1 && t.cols === 1;

function _eval(node) {
  switch (node.type) {
    case 'ket': return _evalKet(node.label);
    case 'bra': { const k = _evalKet(node.label); return k ? Tensor.dagger(k) : null; }
    case 'braket': return _evalBraket(node.braLabel, node.ketLabel);
    case 'scalar': return _scalarToTensor(node.value);
    case 'sum': return _evalSum(node.terms);
    case 'product': return _evalProduct(node.factors);
    case 'tensor': return _evalTensor(node.factors);
    case 'dagger': { const t = _eval(node.operand); return t ? Tensor.dagger(t) : null; }
    case 'tensorpow': return _evalTensorPow(node.operand, node.n);
    case 'conjugate': { const t = _eval(node.operand); return t ? new Tensor(t.rows, t.cols, t.d.map(C.conj)) : null; }
    case 'transpose': { const t = _eval(node.operand); return t ? Tensor.dagger(new Tensor(t.rows, t.cols, t.d.map(C.conj))) : null; }
    case 'operator': return node.name === 'ρ' ? ENV.rho : _evalOperator(node.name);
    case 'double': { const t = _eval(node.operand); return t ? _double(t) : null; }
    case 'trace': {
      const t = _eval(node.operand);
      if (!t) return null;
      if (t.rows !== t.cols) throw new DiracEvalError(`The trace needs a square matrix, not ${_shape(t)}`);
      return _scalarToTensor(Tensor.trace(t));
    }
    case 'indexsum': {
      const k = node.indices.length;
      let total = null;
      for (let a = 0; a < (1 << k); a++) {
        const idx = { ...ENV.idx };
        node.indices.forEach((x, w) => { idx[x] = String((a >> (k - 1 - w)) & 1); });
        const t = _withEnv({ ...ENV, idx }, () => _eval(node.body));
        if (!t) return null;
        if (total && (total.rows !== t.rows || total.cols !== t.cols))
          throw new DiracEvalError(`The terms of a sum must have one shape (${_shape(total)} and ${_shape(t)})`);
        total = total ? Tensor.add(total, t) : t;
      }
      return total;
    }
    case 'frac': return _evalFrac(node.num, node.den);
    case 'recip': {
      const d = _evalScalar(node.operand, 'divisor');
      return d && _scalarToTensor(_inv(d));
    }
    case 'sqrt': {
      const v = _evalScalar(node.operand, '\\sqrt argument');
      return v && _scalarToTensor(_csqrt(v));
    }
    case 'exp': {
      const v = _evalScalar(node.operand, 'exponent');
      return v && _scalarToTensor(C.scale(Math.exp(v[0]), C.phase(v[1])));
    }
    default: return null;
  }
}

/** Single-qubit ket labels; multi-character labels over these are tensor products. */
const SINGLE_KETS = {
  '0': () => Gates.KET0, '1': () => Gates.KET1,
  '+': () => Gates.KET_PLUS, '-': () => Gates.KET_MINUS,
};
const s2 = 1 / Math.sqrt(2);
const BELL = {
  'Phi^+': [1, 0, 0, 1], 'Phi^-': [1, 0, 0, -1],
  'Psi^+': [0, 1, 1, 0], 'Psi^-': [0, 1, -1, 0],
};

/** Replace summed index letters (i, j, …) in a label by their current basis value. */
function _subst(label) {
  const idx = ENV.idx;
  if (!idx || !Object.keys(idx).length) return label;
  const compact = label.replace(/\s+/g, '');
  if (![...compact].every(ch => idx[ch] !== undefined || '01+-'.includes(ch))) return label;
  return [...compact].map(ch => idx[ch] ?? ch).join('');
}

/** Map a ket label to a column vector, or null if symbolic. */
function _evalKet(label) {
  label = _subst(label);
  const bell = label.replace(/^\\/, '').replace(/[{}]/g, '');
  if (BELL[bell]) return Tensor.fromRows(BELL[bell].map(v => [v * s2]));
  if (/^[01+-]+$/.test(label)) {
    let t = null;
    for (const ch of label) t = t ? Tensor.kron(t, SINGLE_KETS[ch]()) : SINGLE_KETS[ch]();
    return t;
  }
  const compact = label.replace(/\s+/g, '');
  if (compact !== label && /^[01+-]+$/.test(compact)) return _evalKet(compact);
  return null; // symbolic ket — can't evaluate
}

function _evalBraket(braLabel, ketLabel) {
  const bra = _evalKet(braLabel), ket = _evalKet(ketLabel);
  if (!bra || !ket) return null;
  return _mul(Tensor.dagger(bra), ket);
}

function _scalarToTensor(value) {
  return new Tensor(1, 1, [value]);
}

/** Evaluate to a 1×1 tensor's value; null if symbolic; throws if not a scalar. */
function _evalScalar(node, what) {
  const t = _eval(node);
  if (!t) return null;
  if (!_isScalar(t)) throw new DiracEvalError(`The ${what} must be a number, but it is a ${_shape(t)} matrix`);
  return t.get(0, 0);
}

function _inv(z) {
  if (C.isZero(z)) throw new DiracEvalError('Division by zero');
  return C.div(C.ONE, z);
}

/** Principal complex square root. */
function _csqrt([a, b]) {
  const r = Math.hypot(a, b);
  return [Math.sqrt((r + a) / 2), (b < 0 ? -1 : 1) * Math.sqrt(Math.max(0, (r - a) / 2))];
}

function _evalFrac(numNode, denNode) {
  const num = _eval(numNode);
  const den = _evalScalar(denNode, 'denominator of \\frac');
  if (!num || !den) return null;
  return Tensor.scale(_inv(den), num);
}

function _evalSum(terms) {
  let result = null;
  for (const { sign, node } of terms) {
    let t = _eval(node);
    if (!t) return null;
    if (sign === -1) t = Tensor.scale(C.NEG1, t);
    if (!result) { result = t; continue; }
    if (result.rows !== t.rows || result.cols !== t.cols)
      throw new DiracEvalError(`Cannot add terms of different shapes (${_shape(result)} and ${_shape(t)})`);
    result = Tensor.add(result, t);
  }
  return result;
}

function _mul(A, B) {
  if (_isScalar(A)) return Tensor.scale(A.get(0, 0), B);
  if (_isScalar(B)) return Tensor.scale(B.get(0, 0), A);
  if (A.cols !== B.rows)
    throw new DiracEvalError(`Cannot compose a ${_shape(A)} with a ${_shape(B)} — dimensions don't match`
      + ' (for a tensor of operators applied to a state, write (A \\otimes B)|ψ⟩)');
  return Tensor.mul(A, B);
}

function _evalProduct(factors) {
  const ts = [];
  for (const f of factors) {
    const t = _eval(f);
    if (!t) return null;
    // Kets side by side are their tensor product, |v⟩|w⟩ = |v⟩ ⊗ |w⟩ (Nielsen & Chuang §2.1.7;
    // PQP §3.4.4 D8), and so are bras side by side, ⟨v|⟨w| = ⟨v| ⊗ ⟨w|
    const prev = ts[ts.length - 1];
    if (prev && ((_isKet(prev) && _isKet(t)) || (_isBra(prev) && _isBra(t)))) ts[ts.length - 1] = Tensor.kron(prev, t);
    else ts.push(t);
  }
  let result = null;
  for (const t of ts) result = result ? _mul(result, t) : t;
  return result;
}
const _isKet = t => t.cols === 1 && t.rows > 1;
const _isBra = t => t.rows === 1 && t.cols > 1;

function _evalTensor(factors) {
  let result = null;
  for (const f of factors) {
    const t = _eval(f);
    if (!t) return null;
    result = result ? Tensor.kron(result, t) : t;
  }
  return result;
}

function _evalTensorPow(operand, n) {
  if (n < 1) throw new DiracEvalError('Tensor power must be at least 1');
  const t = _eval(operand);
  if (!t) return null;
  let r = t;
  for (let k = 1; k < n; k++) r = Tensor.kron(r, t);
  return r;
}

/** Map an operator name to a known gate matrix. */
function _evalOperator(name) {
  const map = {
    'H': Gates.H, 'X': Gates.X, 'Y': Gates.Y, 'Z': Gates.Z,
    'S': Gates.S, 'T': Gates.T,
    'I': Gates.I2, '1': Gates.I2, 'Id': Gates.I2,
    'CNOT': Gates.CNOT, 'CX': Gates.CNOT, 'CZ': Gates.CZ, 'SWAP': Gates.SWAP,
  };
  return map[name] || null; // null = symbolic operator
}
