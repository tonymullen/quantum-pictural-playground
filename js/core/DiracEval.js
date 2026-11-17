/**
 * DiracEval — Evaluate a Dirac AST (from DiracParser) into a Tensor.
 *
 * Maps kets to column vectors, bras to row vectors, operators to matrices
 * from KnownGates, tensor products to Kronecker products, products to
 * matrix multiplication, sums to addition, daggers to conjugate transpose.
 */
import C from './Complex.js';
import Tensor from './Tensor.js';
import * as Gates from './KnownGates.js';

/** @param {object} ast — from parseDirac()
 *  @returns {Tensor|null} */
export default function evalDirac(ast) {
  return _eval(ast);
}

function _eval(node) {
  switch (node.type) {
    case 'ket': return _evalKet(node.label);
    case 'bra': return _evalBra(node.label);
    case 'braket': return _evalBraket(node.braLabel, node.ketLabel);
    case 'scalar': return _scalarToTensor(node.value);
    case 'sum': return _evalSum(node.terms);
    case 'product': return _evalProduct(node.factors);
    case 'tensor': return _evalTensor(node.factors);
    case 'dagger': { const t = _eval(node.operand); return t ? Tensor.dagger(t) : null; }
    case 'operator': return _evalOperator(node.name);
    default: return null;
  }
}

/** Map a ket label to a column vector. */
function _evalKet(label) {
  // Named kets
  if (label === '+') return Gates.KET_PLUS;
  if (label === '-') return Gates.KET_MINUS;
  // Bell states
  if (label === '\\Phi^+' || label === '\\Phi^{+}') return Gates.BELL_PHI_PLUS_NORM;
  // Computational basis: label is a binary string like "0", "1", "00", "01", "101"
  if (/^[01]+$/.test(label)) {
    const nQ = label.length;
    const index = parseInt(label, 2);
    return Tensor.ket(index, nQ);
  }
  // Single-character named kets
  if (label === '0') return Gates.KET0;
  if (label === '1') return Gates.KET1;
  return null; // symbolic ket — can't evaluate
}

function _evalBra(label) {
  const ket = _evalKet(label);
  return ket ? Tensor.dagger(ket) : null;
}

function _evalBraket(braLabel, ketLabel) {
  const bra = _evalBra(braLabel);
  const ket = _evalKet(ketLabel);
  if (!bra || !ket) return null;
  return Tensor.mul(bra, ket);
}

function _scalarToTensor(value) {
  return new Tensor(1, 1, [value]);
}

function _evalSum(terms) {
  let result = null;
  for (const { sign, node } of terms) {
    let t = _eval(node);
    if (!t) return null;
    if (sign === -1) t = Tensor.scale(C.NEG1, t);
    result = result ? Tensor.add(result, t) : t;
  }
  return result;
}

function _evalProduct(factors) {
  let result = null;
  for (const f of factors) {
    const t = _eval(f);
    if (!t) return null;
    if (!result) { result = t; continue; }
    // Scalar × anything or anything × scalar
    if (result.rows === 1 && result.cols === 1) {
      result = Tensor.scale(result.get(0, 0), t);
    } else if (t.rows === 1 && t.cols === 1) {
      result = Tensor.scale(t.get(0, 0), result);
    } else {
      result = Tensor.mul(result, t);
    }
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

/** Map an operator name to a known gate matrix. */
function _evalOperator(name) {
  const map = {
    'H': Gates.H, 'X': Gates.X, 'Y': Gates.Y, 'Z': Gates.Z,
    'S': Gates.S, 'T': Gates.T,
    'I': Gates.I2, 'CNOT': Gates.CNOT, 'CZ': Gates.CZ, 'SWAP': Gates.SWAP,
  };
  return map[name] || null; // null = symbolic operator
}
