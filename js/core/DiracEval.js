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
  return _eval(ast);
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
    case 'operator': return _evalOperator(node.name);
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

/** Map a ket label to a column vector, or null if symbolic. */
function _evalKet(label) {
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
  let result = null;
  for (const f of factors) {
    const t = _eval(f);
    if (!t) return null;
    result = result ? _mul(result, t) : t;
  }
  return result;
}

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
