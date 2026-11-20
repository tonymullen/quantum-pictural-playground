/**
 * Verify — Compare two tensors and report equivalence status.
 * This is the numerical backbone of verify-mode:
 *   ✓ Equivalent (with any scalar/phase difference reported)
 *   ✗ Not equivalent (with a hint about the disagreement)
 *   ? One or both sides are symbolic / unavailable
 */
import C from './Complex.js';
import Tensor from './Tensor.js';
import Config from './Config.js';

/** @typedef {'equivalent'|'not-equivalent'|'unavailable'} VerifyStatus */

/**
 * Compare two tensors, allowing for a global scalar/phase difference.
 *
 * @param {Tensor|null} a — tensor from side A (e.g. diagram)
 * @param {Tensor|null} b — tensor from side B (e.g. Dirac expression)
 * @returns {{ status: VerifyStatus, phase?: C, scalar?: C, hint?: string }}
 */
export function verify(a, b) {
  if (!a || !b) {
    return {
      status: 'unavailable',
      hint: !a && !b ? 'Both sides are symbolic — no numeric check possible'
          : !a ? 'Diagram side has symbolic (unlabelled) generators'
          :       'Dirac side could not be evaluated numerically'
    };
  }

  // Shape check FIRST — never compare tensors with different shapes
  if (a.rows !== b.rows || a.cols !== b.cols) {
    const aIn = Math.round(Math.log2(a.cols)), aOut = Math.round(Math.log2(a.rows));
    const bIn = Math.round(Math.log2(b.cols)), bOut = Math.round(Math.log2(b.rows));
    return {
      status: 'not-equivalent',
      hint: `Shape mismatch: diagram maps ${aIn} → ${aOut} qubits, `
          + `expression maps ${bIn} → ${bOut} qubits`
    };
  }

  const tol = Config.numericTolerance;

  // Exact equality
  if (Tensor.equal(a, b, tol)) {
    return { status: 'equivalent', scalar: C.ONE };
  }

  // Equality up to global scalar
  const result = Tensor.equalUpToPhase(a, b, tol);
  if (result.equal) {
    const s = result.phase; // the scalar c such that b = c·a
    const mag = C.abs(s);
    const isUnitMag = Math.abs(mag - 1) < tol;
    if (isUnitMag) {
      // True phase (|c|=1)
      return { status: 'equivalent', scalar: s,
        hint: `Equal up to global phase e^{i${C.arg(s).toFixed(3)}}` };
    } else {
      // General scalar (|c|≠1)
      return { status: 'equivalent', scalar: s,
        hint: `Equal up to scalar ${_scalarStr(s)}` };
    }
  }

  // Not equivalent
  const hint = _buildHint(a, b, tol);
  return { status: 'not-equivalent', hint };
}

function _scalarStr(s) {
  const tol = 1e-10;
  const mag = C.abs(s);
  const s2 = 1 / Math.sqrt(2);
  if (Math.abs(mag - Math.sqrt(2)) < tol && Math.abs(C.arg(s)) < tol) return '√2';
  if (Math.abs(mag - s2) < tol && Math.abs(C.arg(s)) < tol) return '1/√2';
  if (Math.abs(mag - 2) < tol && Math.abs(C.arg(s)) < tol) return '2';
  return C.str(s, 4);
}

/**
 * Build a pedagogical hint about why two tensors differ.
 */
function _buildHint(a, b, tol) {
  // Size mismatch
  if (a.rows !== b.rows || a.cols !== b.cols) {
    return `Dimension mismatch: ${a.rows}×${a.cols} vs ${b.rows}×${b.cols}. `
         + `Check that both sides have the same number of open wires.`;
  }

  // Find first disagreeing entry
  for (let i = 0; i < a.rows; i++) {
    for (let j = 0; j < a.cols; j++) {
      const va = a.get(i, j), vb = b.get(i, j);
      if (!C.eq(va, vb, tol)) {
        // Express in computational basis
        const bra = a.cols > 1 ? _basisLabel(j, Math.log2(a.cols)) : '';
        const ket = _basisLabel(i, Math.log2(a.rows));
        const braket = a.cols > 1 ? `⟨${bra}|M|${ket}⟩` : `⟨${ket}|ψ⟩`;
        return `Disagreement at ${braket}: `
             + `diagram gives ${C.str(va)}, expression gives ${C.str(vb)}.`;
      }
    }
  }
  return 'Tensors differ but no specific entry found (numerical edge case).';
}

/** Convert an integer to a binary basis label, e.g. 5 with 3 qubits → "101". */
function _basisLabel(index, nQubits) {
  const n = Math.round(nQubits);
  if (n <= 0) return String(index);
  return index.toString(2).padStart(n, '0');
}

/**
 * Convenience: verify mode status as a user-facing string + icon.
 */
export function verifyStatusDisplay(result) {
  switch (result.status) {
    case 'equivalent':
      if (result.scalar && C.eq(result.scalar, C.ONE)) {
        return { icon: '✓', cls: 'verify-ok', text: 'Equivalent' };
      }
      return { icon: '✓', cls: 'verify-ok', text: result.hint || 'Equivalent (up to scalar)' };
    case 'not-equivalent':
      return { icon: '✗', cls: 'verify-fail', text: result.hint };
    case 'unavailable':
      return { icon: '?', cls: 'verify-unknown', text: result.hint };
    default:
      return { icon: '—', cls: '', text: '' };
  }
}

export default { verify, verifyStatusDisplay };
