/**
 * Classify — Pedagogical-usefulness assessment (Categories A–G).
 * Classifies a translation result and provides a one-sentence reason.
 */
import C from './Complex.js';
import Tensor from './Tensor.js';
import Config from './Config.js';
import { recognise } from './KnownGates.js';

/**
 * @typedef {'A'|'B'|'C'|'D'|'E'|'F'|'G'} Category
 * @typedef {{ category: Category, reason: string, name?: string,
 *             latex?: string, phase?: C, structural?: object }} ClassifyResult
 */

/**
 * Classify a tensor result for pedagogical display.
 * @param {Tensor|null} tensor — contracted tensor
 * @param {boolean} symbolic — true if some generators were symbolic
 * @param {import('./IR.js').IRGraph} ir — the source IR
 * @returns {ClassifyResult}
 */
export default function classify(tensor, symbolic, ir) {
  // Category F: symbolic / interpretation-dependent
  if (symbolic || !tensor) {
    return {
      category: 'F', reason: 'Contains generic boxes without matrices — result is symbolic'
    };
  }

  const rows = tensor.rows, cols = tensor.cols;
  const isScalar = rows === 1 && cols === 1;
  const isState = cols === 1 && rows > 1;
  const isEffect = rows === 1 && cols > 1;

  // Category C: trivial or degenerate

  // Zero tensor
  if (tensor.normSq() < Config.numericTolerance) {
    return { category: 'C', reason: 'This evaluates to zero — look for orthogonal state-effect pairs' };
  }

  // Scalar
  if (isScalar) {
    const val = tensor.get(0, 0);
    if (C.eq(val, C.ONE)) return { category: 'C', reason: 'Evaluates to 1 (scalar)' };
    if (C.eq(val, [2, 0])) return { category: 'C', reason: 'Evaluates to 2 — a loop (trace of identity) gives dimension' };
    return { category: 'C', reason: `Evaluates to scalar ${C.str(val)}` };
  }

  // Identity (square matrix)
  if (rows === cols) {
    const id = Tensor.identity(rows);
    const idCheck = Tensor.equalUpToPhase(tensor, id);
    if (idCheck.equal) {
      if (C.eq(idCheck.phase, C.ONE))
        return { category: 'C', reason: 'This is the identity — the snake equation straightens this wire', name: 'Identity' };
      return { category: 'C', reason: `Identity up to phase ${C.str(idCheck.phase)}`, name: 'Identity', phase: idCheck.phase };
    }
  }

  // Category B: recognised standard object
  const match = recognise(tensor);
  if (match) {
    return {
      category: 'B',
      reason: `This is ${match.name}`,
      name: match.name,
      latex: match.latex,
      phase: match.phase
    };
  }

  // Category D: too large
  const nTerms = _countNonzero(tensor);
  if (nTerms > Config.maxAdditiveTerms) {
    const nQ = Math.log2(Math.max(rows, cols));
    return {
      category: 'D',
      reason: `${Math.round(nQ)}-qubit result with ${nTerms} non-zero terms — too large for a readable expression`,
      structural: { rows, cols, nonzero: nTerms, nQubits: Math.round(nQ) }
    };
  }

  // Category A: clean result (within readability budget)
  return {
    category: 'A',
    reason: `Clean result: ${rows}×${cols} with ${nTerms} terms`
  };
}

function _countNonzero(t) {
  let count = 0;
  for (const v of t.d) if (!C.isZero(v)) count++;
  return count;
}
