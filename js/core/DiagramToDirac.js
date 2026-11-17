/**
 * DiagramToDirac — Generate Dirac-notation LaTeX from an IR graph.
 *
 * Pipeline: IR → decompose into connected components → per-component:
 *   contract → classify → recognise → format.
 * Scalar components become prefactors. Non-scalar components combine with ⊗.
 * Returns { latex (parseable), info (display-only), category, reason, tensor, ir }.
 */
import C from './Complex.js';
import Tensor from './Tensor.js';
import Config from './Config.js';
import diagramToIR from './DiagramToIR.js';
import contractIR from './ContractIR.js';
import classify from './Classify.js';
import { recognise } from './KnownGates.js';

/**
 * @param {import('../editors/DiagramEditor/DiagramDocument.js').default} doc
 * @returns {{ latex: string, category: string, reason: string,
 *             tensor: Tensor|null, ir: import('./IR.js').IRGraph,
 *             display: string }}
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
    const { tensor, symbolic } = contractIR(comp);
    const cl = classify(tensor, symbolic, comp);
    const isScalar = tensor && tensor.rows === 1 && tensor.cols === 1;

    if (isScalar && tensor) {
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

  if (C.isZero(scalarPrefactor)) {
    return { latex: '0', info: 'Evaluates to zero', category: 'C',
      reason: 'All components contract to zero', tensor: null, ir };
  }

  let latex = '';
  const prefactorIsOne = C.eq(scalarPrefactor, C.ONE);
  if (parts.length === 0) {
    latex = _complexToLatex(scalarPrefactor);
  } else {
    const partLatexes = parts.map(p => p.latex).filter(Boolean);
    const combined = partLatexes.join(' \\otimes ');
    if (!prefactorIsOne) {
      latex = _complexToLatex(scalarPrefactor) + ' \\cdot ' + (parts.length > 1 ? '(' + combined + ')' : combined);
    } else {
      latex = combined;
    }
  }

  const cats = parts.map(p => p.category);
  const overallCat = cats.includes('D') ? 'D' : cats.includes('F') ? 'F'
    : cats.includes('A') ? 'A' : cats.includes('B') ? 'B' : cats.includes('C') ? 'C' : 'A';
  const reasons = parts.map(p => p.reason).filter(Boolean);
  const overallReason = reasons.length <= 1 ? (reasons[0] || '') : parts.length + ' components';

  const info = infoParts.length ? infoParts.join(' | ') : '';
  const allParseable = parts.every(p => p.latex);
  if (!allParseable) latex = '';

  return { latex, info, category: overallCat, reason: overallReason, tensor: null, ir };
}

function _translateComponent(tensor, cl, comp) {
  if (!tensor) {
    return { latex: '', info: 'Symbolic: ' + cl.reason, category: cl.category, reason: cl.reason };
  }
  switch (cl.category) {
    case 'B': {
      const latex = cl.latex || _tensorToLatex(tensor, comp);
      const scalar = cl.phase || C.ONE; // scalar between actual tensor and named form
      let info = 'This is ' + cl.name;
      if (!C.eq(scalar, C.ONE)) {
        const mag = C.abs(scalar);
        const isPhase = Math.abs(mag - 1) < 1e-10;
        info += isPhase ? ` (up to phase ${C.str(scalar)})` : ` (scalar ${C.str(scalar)})`;
      }
      return { latex, info, category: 'B', reason: info, scalar };
    }
    case 'C': {
      const latex = _tensorToLatex(tensor, comp);
      return { latex, info: cl.reason, category: 'C', reason: cl.reason };
    }
    case 'D': {
      const s = cl.structural || {};
      const nIn = comp.inputBoundary.length;
      const nOut = comp.outputBoundary.length;
      const info = 'Map from ' + nIn + ' to ' + nOut + ' qubits, ' + (s.nonzero||'?') + ' non-zero entries';
      return { latex: '', info, category: 'D', reason: info };
    }
    case 'A':
    default: {
      const latex = _tensorToLatex(tensor, comp);
      return { latex, info: '', category: 'A', reason: cl.reason };
    }
  }
}

/** Convert a tensor to Dirac LaTeX notation. */
function _tensorToLatex(tensor, ir) {
  if (!tensor) return '\\text{(symbolic)}';
  const { rows, cols } = tensor;
  const isState = cols === 1 && rows > 1;
  const isEffect = rows === 1 && cols > 1;
  const isScalar = rows === 1 && cols === 1;

  if (isScalar) return _complexToLatex(tensor.get(0, 0));

  const nQOut = Math.round(Math.log2(rows));
  const nQIn = Math.round(Math.log2(cols));

  if (isState) return _stateToLatex(tensor, nQOut);
  if (isEffect) return _effectToLatex(tensor, nQIn);
  return _operatorToLatex(tensor, nQOut, nQIn);
}

/** State vector → ket sum. */
function _stateToLatex(t, nQ) {
  const terms = [];
  for (let i = 0; i < t.rows; i++) {
    const v = t.get(i, 0);
    if (C.isZero(v)) continue;
    const label = i.toString(2).padStart(nQ, '0');
    const coeff = _coeffToLatex(v, terms.length === 0);
    terms.push(`${coeff}|${label}\\rangle`);
  }
  return terms.length ? terms.join(' ') : '0';
}

/** Effect (bra) → bra sum. */
function _effectToLatex(t, nQ) {
  const terms = [];
  for (let j = 0; j < t.cols; j++) {
    const v = t.get(0, j);
    if (C.isZero(v)) continue;
    const label = j.toString(2).padStart(nQ, '0');
    const coeff = _coeffToLatex(v, terms.length === 0);
    terms.push(`${coeff}\\langle ${label}|`);
  }
  return terms.length ? terms.join(' ') : '0';
}

/** Operator → outer product sum. */
function _operatorToLatex(t, nQOut, nQIn) {
  const terms = [];
  for (let i = 0; i < t.rows; i++) {
    for (let j = 0; j < t.cols; j++) {
      const v = t.get(i, j);
      if (C.isZero(v)) continue;
      const ket = i.toString(2).padStart(nQOut, '0');
      const bra = j.toString(2).padStart(nQIn, '0');
      const coeff = _coeffToLatex(v, terms.length === 0);
      terms.push(`${coeff}|${ket}\\rangle\\langle ${bra}|`);
    }
  }
  if (terms.length > Config.maxAdditiveTerms) {
    return `\\text{(${terms.length}-term operator, ${t.rows}\\times${t.cols})}`;
  }
  return terms.length ? terms.join(' ') : '0';
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
    return `${sign}${mag === 1 ? '' : _niceReal(mag)}i`;
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

/** Format a real number, recognising √2, 1/√2, etc. */
function _niceReal(x) {
  const tol = 1e-10;
  if (Math.abs(x) < tol) return '0';
  if (Math.abs(x - 1) < tol) return '1';
  if (Math.abs(x + 1) < tol) return '-1';
  const s2 = 1 / Math.sqrt(2);
  if (Math.abs(x - s2) < tol) return '\\frac{1}{\\sqrt{2}}';
  if (Math.abs(x + s2) < tol) return '-\\frac{1}{\\sqrt{2}}';
  if (Math.abs(x - Math.sqrt(2)) < tol) return '\\sqrt{2}';
  return x.toFixed(Config.complexPrecision);
}

function _structuralSummary(cl, tensor) {
  const s = cl.structural || {};
  return `\\text{${s.nQubits || '?'}-qubit, ${s.nonzero || '?'} non-zero entries, } ${s.rows} \\times ${s.cols}`;
}

function _symbolicForm(ir) {
  // Show only symbolic (non-evaluable) generators
  const symbolic = [];
  const concrete = [];
  for (const n of ir.nodes.values()) {
    const name = n.label || n.kind;
    if (n.kind === 'morphism' || n.kind === 'state' || n.kind === 'effect' || n.kind === 'scalar') {
      symbolic.push(`\\text{${name}}`);
    } else {
      concrete.push(name);
    }
  }
  if (symbolic.length === 0) {
    return concrete.map(c => `\\text{${c}}`).join(' \\cdot ');
  }
  let result = symbolic.join(' \\cdot ');
  if (concrete.length > 0) {
    result += ` \\quad \\text{(with ${concrete.length} concrete generator${concrete.length > 1 ? 's' : ''})}`;
  }
  return result;
}
