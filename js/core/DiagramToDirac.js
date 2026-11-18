/**
 * DiagramToDirac — Generate Dirac-notation LaTeX from an IR graph.
 *
 * Pipeline: IR → decompose into connected components → per-component:
 *   contract → classify → recognise → format.
 * Scalar components become prefactors. Non-scalar components combine with ⊗,
 * in the same left-to-right order as the IR boundary, so the generated
 * expression evaluates to exactly the whole-diagram tensor.
 * Returns { latex (parseable), info (display-only), category, reason, tensor, ir }.
 */
import C from './Complex.js';
import Config from './Config.js';
import diagramToIR from './DiagramToIR.js';
import contractIR from './ContractIR.js';
import classify from './Classify.js';
import symbolicPrint from './SymbolicPrint.js';

/**
 * @param {import('../editors/DiagramEditor/DiagramDocument.js').default} doc
 * @returns {{ latex: string, info: string, category: string, reason: string,
 *             tensor: null, ir: import('./IR.js').IRGraph }}
 */
export default function diagramToDirac(doc) {
  const ir = diagramToIR(doc);
  if (!ir.isValid) {
    return { latex: '', info: ir.diagnostics.map(d => d.message).join('; '),
      category: 'error', reason: 'Diagram has errors', tensor: null, ir };
  }

  const components = ir.connectedComponents();
  if (components.length === 0) {
    return { latex: '', info: 'Empty diagram', category: 'C', reason: 'Empty', tensor: null, ir };
  }

  let scalarPrefactor = C.ONE;
  const parts = [];
  const infoParts = [];

  for (const comp of components) {
    const { tensor, symbolic, reason } = contractIR(comp);
    const cl = classify(tensor, symbolic, comp, reason);
    const isScalar = tensor && tensor.rows === 1 && tensor.cols === 1;

    if (isScalar) {
      scalarPrefactor = C.mul(scalarPrefactor, tensor.get(0, 0));
      infoParts.push('Scalar: ' + C.str(tensor.get(0, 0)));
      continue;
    }

    const compResult = _translateComponent(tensor, cl, comp);
    // Fold recognition scalar into the global prefactor
    if (compResult.scalar && !C.eq(compResult.scalar, C.ONE)) {
      scalarPrefactor = C.mul(scalarPrefactor, compResult.scalar);
    }
    parts.push(compResult);
    if (compResult.info) infoParts.push(compResult.info);
  }

  const prefactorIsOne = C.eq(scalarPrefactor, C.ONE);
  const wrap = p => (p.isSum && (parts.length > 1 || !prefactorIsOne)) ? `(${p.latex})` : p.latex;
  const combined = parts.map(wrap).join(' \\otimes ');

  let latex;
  if (parts.length === 0) {
    latex = _complexToLatex(scalarPrefactor);
  } else if (prefactorIsOne) {
    latex = combined;
  } else {
    const pre = C.isZero(scalarPrefactor) ? '0' : _complexToLatex(scalarPrefactor);
    latex = pre + ' \\cdot ' + (parts.length > 1 ? '(' + combined + ')' : combined);
  }
  // A component that could not be printed would silently change the shape of
  // the ⊗ product, so emit nothing parseable rather than a wrong expression.
  if (parts.some(p => !p.latex)) latex = '';

  const cats = parts.map(p => p.category);
  const overallCat = parts.length === 0 ? 'C'
    : cats.includes('D') ? 'D' : cats.includes('F') ? 'F'
    : cats.includes('A') ? 'A' : cats.includes('B') ? 'B' : 'C';
  const reasons = parts.map(p => p.reason).filter(Boolean);
  const overallReason = parts.length === 0
    ? (C.isZero(scalarPrefactor) ? 'Evaluates to zero' : 'Scalar')
    : reasons.length <= 1 ? (reasons[0] || '') : parts.length + ' components';

  const info = infoParts.join(' | ');
  return { latex, info, category: overallCat, reason: overallReason, tensor: null, ir };
}

function _translateComponent(tensor, cl, comp) {
  if (cl.category === 'D') {
    const s = cl.structural || {};
    const nIn = comp.inputBoundary.length, nOut = comp.outputBoundary.length;
    const info = s.tooLarge ? cl.reason
      : `Map from ${nIn} to ${nOut} qubits, ${s.nonzero || '?'} non-zero entries`;
    return { latex: '', info, category: 'D', reason: info };
  }
  if (!tensor) {
    // Symbolic: generate latex from node labels + structure
    const sp = symbolicPrint(comp);
    const info = sp.assumptions.length ? sp.assumptions.join('; ') : '';
    return { latex: sp.latex, isSum: !!sp.isSum, info, category: 'F',
      reason: info || 'Symbolic expression' };
  }
  switch (cl.category) {
    case 'B': {
      const scalar = cl.phase || C.ONE; // tensor = scalar · named form
      let info = 'This is ' + cl.name;
      if (!C.eq(scalar, C.ONE)) {
        const isPhase = Math.abs(C.abs(scalar) - 1) < 1e-10;
        info += isPhase ? ` (up to phase ${C.str(scalar)})` : ` (scalar ${C.str(scalar)})`;
      }
      return { latex: cl.latex, isSum: false, info, category: 'B', reason: info, scalar };
    }
    case 'C': {
      const { latex, nTerms } = _tensorToLatex(tensor);
      return { latex, isSum: nTerms > 1, info: cl.reason, category: 'C', reason: cl.reason };
    }
    case 'A':
    default: {
      const { latex, nTerms } = _tensorToLatex(tensor);
      return { latex, isSum: nTerms > 1, info: '', category: 'A', reason: cl.reason };
    }
  }
}

/**
 * Convert a tensor to Dirac LaTeX as a sum of basis terms.
 * A zero tensor prints as 0 times a basis element so its shape is preserved.
 * @returns {{ latex: string, nTerms: number }}
 */
function _tensorToLatex(tensor) {
  const { rows, cols } = tensor;
  if (rows === 1 && cols === 1) return { latex: _complexToLatex(tensor.get(0, 0)), nTerms: 1 };

  const nQOut = Math.round(Math.log2(rows));
  const nQIn = Math.round(Math.log2(cols));
  const basis = (i, j) => {
    const ket = nQOut ? `|${i.toString(2).padStart(nQOut, '0')}\\rangle` : '';
    const bra = nQIn ? `\\langle ${j.toString(2).padStart(nQIn, '0')}|` : '';
    return ket + bra;
  };

  const terms = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const v = tensor.get(i, j);
      if (C.isZero(v)) continue;
      terms.push(_coeffToLatex(v, terms.length === 0) + basis(i, j));
    }
  }
  if (terms.length === 0) return { latex: '0 ' + basis(0, 0), nTerms: 1 };
  return { latex: terms.join(' '), nTerms: terms.length };
}

/** Format a complex coefficient for a sum. */
function _coeffToLatex(z, isFirst) {
  const [re, im] = z;
  const tol = 1e-10;
  const isOne = Math.abs(re - 1) < tol && Math.abs(im) < tol;
  const isNegOne = Math.abs(re + 1) < tol && Math.abs(im) < tol;
  const isReal = Math.abs(im) < tol;
  const isImag = Math.abs(re) < tol;

  if (isOne) return isFirst ? '' : '+ ';
  if (isNegOne) return '- ';
  if (isReal) {
    const sign = re > 0 ? (isFirst ? '' : '+ ') : '- ';
    return `${sign}${_niceReal(Math.abs(re))}`;
  }
  if (isImag) {
    const sign = im > 0 ? (isFirst ? '' : '+ ') : '- ';
    const mag = Math.abs(im);
    return `${sign}${Math.abs(mag - 1) < tol ? '' : _niceReal(mag)}i`;
  }
  const prefix = isFirst ? '' : '+ ';
  return `${prefix}(${_complexToLatex(z)})`;
}

function _complexToLatex(z) {
  const [re, im] = z;
  if (Math.abs(im) < 1e-14) return _niceReal(re);
  if (Math.abs(re) < 1e-14) return `${_niceReal(im)}i`;
  const sign = im >= 0 ? '+' : '';
  return `${_niceReal(re)}${sign}${_niceReal(im)}i`;
}

/** Format a real number, recognising √2, 1/√2, integers, etc. */
function _niceReal(x) {
  const tol = 1e-10;
  if (Math.abs(x) < tol) return '0';
  const sign = x < 0 ? '-' : '';
  const a = Math.abs(x);
  if (Math.abs(a - Math.round(a)) < tol) return sign + Math.round(a);
  if (Math.abs(a - 1 / Math.sqrt(2)) < tol) return sign + '\\frac{1}{\\sqrt{2}}';
  if (Math.abs(a - Math.sqrt(2)) < tol) return sign + '\\sqrt{2}';
  for (const d of [2, 3, 4, 8]) {           // simple fractions: 1/2, 3/4, …
    const n = a * d;
    if (Math.abs(n - Math.round(n)) < tol) return `${sign}\\frac{${Math.round(n)}}{${d}}`;
  }
  return x.toFixed(Config.complexPrecision);
}
