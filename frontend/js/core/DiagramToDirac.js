/**
 * DiagramToDirac — Generate Dirac-notation LaTeX from an IR graph.
 *
 * Pipeline: IR → split into tensor factors (connected components, merged
 *   where their wires interleave) → per factor: contract → classify →
 *   recognise → format.
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
import Tensor from './Tensor.js';
import { scalarLabel } from './CircuitToIR.js';

/**
 * @param {import('../editors/DiagramEditor/DiagramDocument.js').default} doc
 * @returns {{ latex: string, info: string, category: string, reason: string,
 *             tensor: null, ir: import('./IR.js').IRGraph }}
 */
export default function diagramToDirac(doc) {
  return irToDirac(diagramToIR(doc));
}

/**
 * Generate Dirac LaTeX for any IR graph (from a diagram, a circuit, …).
 * @param {import('./IR.js').IRGraph} ir
 */
export function irToDirac(ir) {
  if (!ir.isValid) {
    return { latex: '', info: ir.diagnostics.filter(d => d.severity === 'error').map(d => d.message).join('; '),
      category: 'error', reason: 'Diagram has errors', tensor: null, ir };
  }

  const components = tensorFactors(ir);
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
      continue;
    }

    const compResult = _translateComponent(tensor, cl, comp);
    // the diagram nodes this factor comes from (for hover-highlighting)
    compResult.nodeIds = [...comp.nodes.values()].map(n => n.provenance && n.provenance.elementId).filter(Boolean);
    // Fold recognition scalar into the global prefactor
    if (compResult.scalar && !C.eq(compResult.scalar, C.ONE)) {
      scalarPrefactor = C.mul(scalarPrefactor, compResult.scalar);
    }
    parts.push(compResult);
    if (compResult.info) infoParts.push(compResult.info);
  }

  // Fold a leftover scalar into a factor that is printed as a sum of basis
  // terms, so √2·(½|00⟩⟨00| + …) becomes (1/√2)|00⟩⟨00| + …
  const numeric = parts.find(p => p.tensor);
  if (numeric && !C.eq(scalarPrefactor, C.ONE) && !C.isZero(scalarPrefactor)) {
    const { latex, nTerms } = _tensorToLatex(Tensor.scale(scalarPrefactor, numeric.tensor));
    numeric.latex = latex;
    numeric.isSum = nTerms > 1;
    scalarPrefactor = C.ONE;
  }
  if (!C.eq(scalarPrefactor, C.ONE) && parts.length > 0)
    infoParts.push(`Overall scalar ${scalarLabel(scalarPrefactor)}`);

  const prefactorIsOne = C.eq(scalarPrefactor, C.ONE);
  const wrap = p => (p.isSum && (parts.length > 1 || !prefactorIsOne)) ? `(${p.latex})` : p.latex;
  const combined = parts.map(wrap).join(' \\otimes ');
  // The same expression with each ⊗ factor tagged (KaTeX \htmlData), and what each tag points at
  const links = parts.map(p => ({ nodeIds: p.nodeIds || [] }));
  const annotatedParts = parts.map((p, k) => `\\htmlData{qpp=${k}}{${wrap(p)}}`).join(' \\otimes ');

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
  let annotated = '';
  if (latex && parts.length) {
    annotated = prefactorIsOne ? annotatedParts
      : (C.isZero(scalarPrefactor) ? '0' : _complexToLatex(scalarPrefactor)) + ' \\cdot ' + (parts.length > 1 ? '(' + annotatedParts + ')' : annotatedParts);
  }

  const cats = parts.map(p => p.category);
  const overallCat = parts.length === 0 ? 'C'
    : cats.includes('D') ? 'D' : cats.includes('F') ? 'F'
    : cats.includes('A') ? 'A' : cats.includes('B') ? 'B' : 'C';
  const reasons = parts.map(p => p.reason).filter(Boolean);
  const overallReason = parts.length === 0
    ? (C.isZero(scalarPrefactor) ? 'Evaluates to zero' : 'Scalar')
    : reasons.length <= 1 ? (reasons[0] || '') : parts.length + ' components';

  const info = infoParts.join(' | ');
  return { latex, info, category: overallCat, reason: overallReason, tensor: null, ir, annotated, links };
}

/**
 * Split an IR into tensor factors whose ⊗ (in the returned order) equals the
 * whole graph's tensor in its boundary order.
 *
 * Starts from connected components. Components whose wires interleave on the
 * boundary (e.g. a CNOT on wires 0 and 2 beside an H on wire 1) cannot be
 * written as A ⊗ B, so they are merged into one factor. Factors are ordered
 * consistently with both the input and the output boundary; if no such
 * order exists, everything becomes a single factor.
 * @param {import('./IR.js').IRGraph} ir
 * @returns {import('./IR.js').IRGraph[]}
 */
export function tensorFactors(ir) {
  const comps = ir.connectedComponents();
  if (comps.length <= 1) return comps;

  const compOf = new Map();
  comps.forEach((c, i) => { for (const id of c.nodes.keys()) compOf.set(id, i); });
  const seqIn = ir.inputBoundary.map(b => compOf.get(b.nodeId));
  const seqOut = ir.outputBoundary.map(b => compOf.get(b.nodeId));

  // Union-find over component indices; merge anything inside another's span
  const parent = comps.map((_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) { parent[a] = b; return true; } return false; };
  for (let changed = true; changed;) {
    changed = false;
    for (const seq of [seqIn, seqOut]) {
      const first = new Map(), last = new Map();
      seq.forEach((c, k) => { const r = find(c); if (!first.has(r)) first.set(r, k); last.set(r, k); });
      for (const [r, f] of first)
        for (let k = f; k <= last.get(r); k++) if (union(r, seq[k])) changed = true;
    }
  }

  // Order groups so both boundary sequences are respected (topological sort)
  const roots = [...new Set(comps.map((_, i) => find(i)))];
  const after = new Map(roots.map(r => [r, new Set()]));
  const indeg = new Map(roots.map(r => [r, 0]));
  for (const seq of [seqIn, seqOut]) {
    const order = [];
    for (const c of seq) { const r = find(c); if (order[order.length - 1] !== r) order.push(r); }
    for (let k = 1; k < order.length; k++) {
      if (!after.get(order[k - 1]).has(order[k])) {
        after.get(order[k - 1]).add(order[k]);
        indeg.set(order[k], indeg.get(order[k]) + 1);
      }
    }
  }
  const firstPos = r => {
    const i = seqOut.findIndex(c => find(c) === r), j = seqIn.findIndex(c => find(c) === r);
    return Math.min(i < 0 ? Infinity : i, j < 0 ? Infinity : j);
  };
  const ready = roots.filter(r => indeg.get(r) === 0);
  const sorted = [];
  while (ready.length) {
    ready.sort((a, b) => firstPos(a) - firstPos(b));
    const r = ready.shift();
    sorted.push(r);
    for (const nx of after.get(r)) { indeg.set(nx, indeg.get(nx) - 1); if (indeg.get(nx) === 0) ready.push(nx); }
  }
  if (sorted.length !== roots.length) return [ir.subgraph(ir.nodes.keys())]; // no consistent order

  return sorted.map(r => {
    const ids = [];
    comps.forEach((c, i) => { if (find(i) === r) ids.push(...c.nodes.keys()); });
    return ir.subgraph(ids);
  });
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
      // tensor = scalar · named form; the scalar joins the overall prefactor
      const info = 'This is ' + cl.name;
      return { latex: cl.latex, isSum: false, info, category: 'B', reason: info, scalar: cl.phase || C.ONE };
    }
    case 'C': {
      const { latex, nTerms } = _tensorToLatex(tensor);
      return { latex, isSum: nTerms > 1, info: cl.reason, category: 'C', reason: cl.reason, tensor };
    }
    case 'A':
    default: {
      const { latex, nTerms } = _tensorToLatex(tensor);
      return { latex, isSum: nTerms > 1, info: '', category: 'A', reason: cl.reason, tensor };
    }
  }
}

/**
 * Convert a tensor to Dirac LaTeX as a sum of basis terms.
 * A zero tensor prints as 0 times a basis element so its shape is preserved.
 * @returns {{ latex: string, nTerms: number }}
 */
export function tensorToLatex(tensor) { return _tensorToLatex(tensor); }
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
