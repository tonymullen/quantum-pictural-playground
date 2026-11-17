/**
 * Interpret — Evaluate an IRGraph as a tensor network.
 *
 * Strategy: for each generator, produce its tensor (matrix), then
 * compose them according to the graph's wiring. This is the semantic
 * ground truth for both directions and for verification.
 *
 * Scope: target sizes ≤6 open wires, ≤30 generators. At these sizes
 * full contraction is sub-millisecond.
 */
import C from './Complex.js';
import Tensor from './Tensor.js';
import Phase from './Phase.js';
import { GenKind, WireType } from './IR.js';
import Config from './Config.js';

/**
 * Get the tensor for a single IR generator node.
 * @param {import('./IR.js').IRNode} node
 * @returns {Tensor|null} — null if symbolic (no concrete matrix)
 */
export function generatorTensor(node) {
  // If the node carries an explicit tensor, use it
  if (node.tensor) return node.tensor;

  const nIn = node.totalIn, nOut = node.totalOut;
  const dim = 2; // qubit dimension

  switch (node.kind) {
    case GenKind.Z_SPIDER:
      return zSpiderTensor(nIn, nOut, node.phase || Phase.ZERO);
    case GenKind.X_SPIDER:
      return xSpiderTensor(nIn, nOut, node.phase || Phase.ZERO);
    case GenKind.HADAMARD:
      return hadamardTensor();
    case GenKind.CUP:
      return cupTensor();
    case GenKind.CAP:
      return capTensor();
    case GenKind.SWAP:
      return swapTensor();
    case GenKind.STATE:
    case GenKind.EFFECT:
    case GenKind.MORPHISM:
    case GenKind.SCALAR:
      // These are symbolic unless a tensor is attached
      return null;
    default:
      return null;
  }
}

/**
 * Z-spider: |0...0⟩⟨0...0| + e^{iα}|1...1⟩⟨1...1|
 * As a tensor of shape (2^nOut) × (2^nIn).
 */
function zSpiderTensor(nIn, nOut, phase) {
  const dIn = 1 << nIn, dOut = 1 << nOut;
  const t = Tensor.zeros(dOut, dIn);
  // |0...0⟩⟨0...0| entry: row 0, col 0
  t.set(0, 0, C.ONE);
  // e^{iα}|1...1⟩⟨1...1| entry: row (dOut-1), col (dIn-1)
  t.set(dOut - 1, dIn - 1, phase.toComplex());
  return t;
}

/**
 * X-spider: H⊗n · Z-spider · H⊗m (Hadamard-conjugated Z-spider).
 */
function xSpiderTensor(nIn, nOut, phase) {
  const z = zSpiderTensor(nIn, nOut, phase);
  // Build H⊗nIn and H⊗nOut
  const s2 = 1 / Math.sqrt(2);
  const H = Tensor.fromRows([[C.real(s2), C.real(s2)],
                              [C.real(s2), C.real(-s2)]]);
  let hIn = Tensor.identity(1);
  for (let i = 0; i < nIn; i++) hIn = Tensor.kron(hIn, H);
  let hOut = Tensor.identity(1);
  for (let i = 0; i < nOut; i++) hOut = Tensor.kron(hOut, H);
  return Tensor.mul(hOut, Tensor.mul(z, hIn));
}

function hadamardTensor() {
  const s2 = 1 / Math.sqrt(2);
  return Tensor.fromRows([[C.real(s2), C.real(s2)],
                           [C.real(s2), C.real(-s2)]]);
}

/** Cup: |00⟩ + |11⟩ as a 4×1 column vector (0 inputs, 2 outputs). */
function cupTensor() {
  return Tensor.fromRows([[C.ONE], [C.ZERO], [C.ZERO], [C.ONE]]);
}

/** Cap: ⟨00| + ⟨11| as a 1×4 row vector (2 inputs, 0 outputs). */
function capTensor() {
  return Tensor.fromRows([[C.ONE, C.ZERO, C.ZERO, C.ONE]]);
}

/** SWAP: 4×4 permutation matrix. */
function swapTensor() {
  return Tensor.fromRows([
    [1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]
  ]);
}

export default { generatorTensor };
