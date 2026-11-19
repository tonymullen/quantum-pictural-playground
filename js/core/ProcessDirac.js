/**
 * ProcessDirac — Dirac notation for diagrams that are not just linear maps:
 * the doubled picture (quantum processes) and sums over a basis (Σᵢ).
 *
 * Every doubled diagram built from doubled pure maps, white dots and discards
 * reads as a sum of Kraus operators (PQP ch. 6–8):
 *   a white dot   = Σᵢ of the basis vector i on each of its legs (dots joined
 *                   by wires fuse: one index for the whole cluster)
 *   a discard ⏚   = Σⱼ ⟨j| on the pair (the trace)
 * Removing them leaves a pure (thin) diagram K with basis states/effects
 * labelled i, j, …, and the process is
 *   familiar:  ρ ↦ Σᵢⱼ K ρ K†        (classical wires: the diagonal |i⟩⟨i|)
 *   PQP:       Σᵢⱼ K̂                 (K̂ = K̄ ⊗ K, wire by wire; classical legs single)
 *
 *   processToDirac(doc) → { familiar, pqp, latex, info, category, reason }
 *   evaluateDiagram(ir) → { tensor, symbolic?, reason? }   (contraction, summing Σ indices)
 */
import DiagramDocument from '../editors/DiagramEditor/DiagramDocument.js';
import diagramToIR from './DiagramToIR.js';
import contractIR from './ContractIR.js';
import { irToDirac, tensorToLatex } from './DiagramToDirac.js';
import parseDirac from './DiracParser.js';
import evalDirac, { evalProcess } from './DiracEval.js';
import Tensor from './Tensor.js';

const INDEX_NAMES = ['i', 'j', 'k', 'l', 'm', 'n', 'p', 'q', 'r', 's', 'u', 'v', 'w'];

/** Contract a graph, summing over its Σ indices (states/effects so labelled take 0 and 1). */
export function evaluateDiagram(ir) {
  const idx = ir.sumIndices || [];
  if (!idx.length) return contractIR(ir);
  let total = null;
  for (let a = 0; a < (1 << idx.length); a++) {
    const saved = [];
    idx.forEach((x, k) => {
      for (const n of ir.nodes.values())
        if ((n.kind === 'state' || n.kind === 'effect') && n.label === x) { saved.push([n, n.label]); n.label = String((a >> (idx.length - 1 - k)) & 1); }
    });
    let r;
    try { r = contractIR(ir); } finally { for (const [n, l] of saved) n.label = l; }
    if (!r.tensor) return r;
    total = total ? Tensor.add(total, r.tensor) : r.tensor;
  }
  return { tensor: total };
}

/**
 * The Kraus diagram of a doubled diagram: dots and discards replaced by
 * basis states/effects labelled with sum indices, everything else made thin.
 * @returns {{ ok: true, kraus: DiagramDocument, indices: string[], classical: Set<string> }
 *          | { ok: false, why: string }}
 *   classical: ids (in kraus) of the basis nodes standing on classical boundary legs
 */
export function krausDiagram(doc) {
  const nodes = [...doc.nodes.values()];
  const general = nodes.find(n => n.isMixed && n.isMixed());
  if (general) return { ok: false, why: `"${general.label || 'Φ'}" is a general process — it has no Kraus form drawn in the diagram` };

  // Clusters of white dots joined by wires (dots fuse), one index each; one per discard
  const parent = new Map();
  const find = x => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  for (const n of nodes) if (n.type.key === 'dot') parent.set(n.id, n.id);
  for (const w of doc.wires)
    if (parent.has(w.fromNodeId) && parent.has(w.toNodeId)) parent.set(find(w.fromNodeId), find(w.toNodeId));
  const used = new Set([...(doc.sumIndices || []), ...nodes.map(n => n.label)]);
  const names = INDEX_NAMES.filter(x => !used.has(x));
  const indexOf = new Map(), indices = [...(doc.sumIndices || [])];
  const fresh = () => {
    const x = names.shift();
    if (!x) throw new Error('Too many sums');
    indices.push(x); return x;
  };
  for (const n of nodes) {
    if (n.type.key === 'dot') { const root = find(n.id); if (!indexOf.has(root)) indexOf.set(root, fresh()); indexOf.set(n.id, indexOf.get(root)); }
    else if (n.type.key === 'discard') indexOf.set(n.id, fresh());
  }
  const isSum = n => n.type.key === 'dot' || n.type.key === 'discard';

  // Build the thin diagram as JSON
  const data = doc.toJSON();
  const out = { name: `${doc.name} · Kraus`, tensorOrder: doc.tensorOrder, nodes: [], wires: [] };
  for (const nd of data.nodes) {
    const n = doc.nodes.get(nd.id);
    if (isSum(n)) continue;
    out.nodes.push({ ...nd, thick: false, process: false, legThick: undefined });
  }
  const classical = new Set();
  let extra = 0;
  const basis = (kind, label, x, y, onClassicalBoundary) => {
    const id = `kraus-${extra++}`;
    out.nodes.push({ id, typeKey: kind, x, y, label, inputs: kind === 'effect' ? 1 : 0, outputs: kind === 'state' ? 1 : 0 });
    if (onClassicalBoundary) classical.add(id);
    return id;
  };
  const portPos = (n, dir, i) => (dir === 'in' ? n.getInputPort(i) : n.getOutputPort(i));
  if (typeof doc.refreshLegs === 'function') doc.refreshLegs();
  for (const w of data.wires) {
    const a = doc.nodes.get(w.fromNodeId), b = doc.nodes.get(w.toNodeId);
    if (isSum(a) && isSum(b)) continue;                      // inside a cluster of fused dots
    let from = w.fromNodeId, fp = w.fromPort, to = w.toNodeId, tp = w.toPort;
    if (isSum(a)) { const p = portPos(a, 'out', w.fromPort); from = basis('state', indexOf.get(a.id), p.x, p.y + 14); fp = 0; }
    if (isSum(b)) { const p = portPos(b, 'in', w.toPort); to = basis('effect', indexOf.get(b.id), p.x, p.y - 14); tp = 0; }
    out.wires.push({ fromNodeId: from, fromPort: fp, toNodeId: to, toPort: tp });
  }
  // Open legs of dots and discards: a basis vector with its leg left open
  for (const n of nodes) {
    if (!isSum(n)) continue;
    for (const dir of ['in', 'out'])
      for (let i = 0; i < (dir === 'in' ? n.inputs : n.outputs); i++) {
        if (doc.wireOnPort(n.id, dir, i)) continue;
        const p = portPos(n, dir, i), thin = !n.portIsThick(dir, i);
        if (dir === 'out') basis('state', indexOf.get(n.id), p.x, p.y + 14, thin);
        else basis('effect', indexOf.get(n.id), p.x, p.y - 14, thin);
      }
  }
  // fromJSON needs ids it knows: keep a map for the classical marks
  const order = out.nodes.map(n => n.id);
  const kraus = DiagramDocument.fromJSON(out);
  const ids = [...kraus.nodes.keys()];
  const classicalIds = new Set(order.map((id, k) => (classical.has(id) ? ids[k] : null)).filter(Boolean));
  return { ok: true, kraus, indices, classical: classicalIds };
}

/** Latex of a pure diagram (or null). */
function pureLatex(doc) {
  const r = irToDirac(diagramToIR(doc));
  return r.latex ? r.latex : null;
}

/** Is x one atom (a ket, a bra, \widehat{…}, a single symbol)? — then it needs no parentheses. */
function atomic(x) {
  if (/^(\\langle [^|]*\||\|[^\\|]*\\rangle)$/.test(x)) return true;
  if (x.startsWith('\\widehat{') && x.endsWith('}')) {
    let d = 0;
    for (let k = '\\widehat'.length; k < x.length; k++) { if (x[k] === '{') d++; else if (x[k] === '}') { d--; if (d === 0) return k === x.length - 1; } }
  }
  return /^[|\\]?[^\s+\-⊗]*$/.test(x) && !/\\otimes|\+|-|\s/.test(x);
}
const paren = x => (atomic(x) ? x : `(${x})`);
const sumOf = idx => (idx.length ? `\\sum_{${idx.join(',')}} ` : '');

/** Contract a thin diagram with its index labels set by `assign` ({ i: '0', … }). */
function tensorAt(ir, assign) {
  const saved = [];
  for (const n of ir.nodes.values())
    if ((n.kind === 'state' || n.kind === 'effect') && assign[n.label] !== undefined) { saved.push([n, n.label]); n.label = assign[n.label]; }
  try { return contractIR(ir).tensor; } finally { for (const [n, l] of saved) n.label = l; }
}

const assignments = idx => Array.from({ length: 1 << idx.length }, (_, a) =>
  Object.fromEntries(idx.map((x, k) => [x, String((a >> (idx.length - 1 - k)) & 1)])));

/** An operator as LaTeX: I, I^{⊗n}, a scalar, or a sum of basis terms. */
function opLatex(M) {
  if (M.rows === M.cols && M.rows > 1 && Tensor.equal(M, Tensor.identity(M.rows), 1e-9)) {
    const n = Math.round(Math.log2(M.rows));
    return n === 1 ? 'I' : `I^{\\otimes ${n}}`;
  }
  return tensorToLatex(M).latex;
}

/**
 * Group Kraus terms that are multiples of one another (Σ c K ρ K† with
 * the same K up to phase): returns [{ M, keyExtra }] with Σ M ρ M† equal to the sum.
 */
function groupTerms(terms) {
  const groups = [];
  for (const { K, extra } of terms) {
    const norm = Math.sqrt(K.d.reduce((s, z) => s + z[0] * z[0] + z[1] * z[1], 0));
    if (norm < 1e-12) continue;
    const first = K.d.find(z => Math.hypot(z[0], z[1]) > 1e-9);
    const ph = Math.atan2(first[1], first[0]);
    const N = Tensor.scale([Math.cos(-ph) / norm, Math.sin(-ph) / norm], K);
    const g = groups.find(x => x.extra === extra && Tensor.equal(x.N, N, 1e-9));
    if (g) g.w += norm * norm; else groups.push({ N, w: norm * norm, extra });
  }
  return groups.map(g => ({ M: Tensor.scale([Math.sqrt(g.w), 0], g.N), extra: g.extra }));
}

/** Does `latex` evaluate (as a process on these wires) to T? */
function verifies(latex, kinds, T) {
  try {
    const r = evalProcess(parseDirac(latex), kinds);
    return !!(r.tensor && !r.leak && Tensor.equal(r.tensor, T, 1e-9));
  } catch { return false; }
}

/**
 * Dirac notation for a doubled diagram, both ways (each checked against the
 * diagram before it is offered).
 * @returns {{ latex: string, familiar: {latex, info}, pqp: {latex, info}, info: string, category: string, reason: string }}
 */
export function processToDirac(doc) {
  const none = why => ({ latex: '', familiar: { latex: '', info: why }, pqp: { latex: '', info: why },
    info: why, category: 'D', reason: 'No Dirac form', tensor: null, ir: null });
  const ir = diagramToIR(doc);
  if (!ir.isValid) return none('The diagram has errors: ' + ir.diagnostics.filter(d => d.severity === 'error').map(d => d.message).join('; '));
  let k;
  try { k = krausDiagram(doc); } catch (e) { return none(e.message); }
  if (!k.ok) return none(k.why);
  const kinds = ir.boundaryKinds || { in: ir.inputBoundary.map(() => 'q'), out: ir.outputBoundary.map(() => 'q') };
  const hasIn = kinds.in.length > 0;
  const T = evaluateDiagram(ir).tensor;          // null if symbolic
  const S = sumOf(k.indices);
  const kIR = diagramToIR(k.kraus);
  const anyC = [...kinds.in, ...kinds.out].includes('c');

  // ---- familiar: ρ ↦ Σ K ρ K† ----
  let familiar = '', famInfo = (hasIn ? 'Familiar form: a sum of Kraus operators, ρ ↦ Σ K ρ K†' : 'Familiar form: the density operator')
    + (anyC ? '; a classical wire carries the diagonal |i⟩⟨i|' : '');
  const shortest = list => list.filter(Boolean).sort((a, b) => a.length - b.length)[0] || '';
  const famCands = [];
  const Ks = T ? assignments(k.indices).map(a => tensorAt(kIR, a)) : null;
  if (Ks && Ks.every(Boolean)) {
    if (!hasIn) {
      // A state: its density operator Σ K K†
      const rho = Ks.reduce((acc, K) => { const t = Tensor.mul(K, Tensor.dagger(K)); return acc ? Tensor.add(acc, t) : t; }, null);
      famCands.push(opLatex(rho));
    } else {
      const groups = groupTerms(Ks.map(K => ({ K, extra: '' })));
      const wrap = x => (/\s[+-]\s/.test(x) ? `(${x})` : x);
      const term = ({ M }) => (M.rows === M.cols && Tensor.equal(M, Tensor.identity(M.rows), 1e-9)) ? '\\rho'
        : `${wrap(opLatex(M))} \\rho ${wrap(opLatex(Tensor.dagger(M)))}`;
      famCands.push(`\\rho \\mapsto ${groups.length ? groups.map(term).join(' + ') : '0'}`);
    }
  }
  const Ksym = pureLatex(k.kraus);
  if (Ksym && hasIn) famCands.push(`\\rho \\mapsto ${S}${paren(Ksym)} \\rho ${paren(Ksym)}^\\dagger`);
  // The explicit sum is the familiar one: keep it unless it is much longer than the Σ form
  const ok = famCands.map(c => (c && (T ? verifies(c, kinds, T) : true) ? c : ''));
  familiar = ok[0] && (!ok[1] || ok[0].length <= 1.6 * ok[1].length) ? ok[0] : shortest(ok);
  if (!familiar) famInfo = 'Familiar form: could not be written';

  // ---- PQP: Σ K̂ (classical legs single) ----
  let pqp = '', pqpInfo = 'PQP form: the doubled map, K̂ = K̄ ⊗ K wire by wire; classical (thin) legs single';
  const side = list => {
    if (!list.includes('q') || !list.includes('c')) return 'any';
    if (list.lastIndexOf('c') < list.indexOf('q')) return 'left';
    if (list.indexOf('c') > list.lastIndexOf('q')) return 'right';
    return 'mixed';
  };
  const where = [side(kinds.in), side(kinds.out)].filter(x => x !== 'any');
  const at = !anyC || where.length === 0 ? 'left' : (where.every(x => x === where[0]) && where[0] !== 'mixed' ? where[0] : null);
  if (!at) pqpInfo = 'PQP form: not written — the classical and quantum wires are interleaved (the familiar form covers it)';
  else {
    const kd = k.kraus.toJSON();
    const qDoc = DiagramDocument.fromJSON({ ...kd, nodes: kd.nodes.filter(n => !k.classical.has(n.id)),
      wires: kd.wires.filter(w => !k.classical.has(w.fromNodeId) && !k.classical.has(w.toNodeId)) });
    const cDoc = DiagramDocument.fromJSON({ ...kd, nodes: kd.nodes.filter(n => k.classical.has(n.id)), wires: [] });
    const join = (C, Q) => { const f = at === 'left' ? [C, Q] : [Q, C]; const fs = f.filter(Boolean); return fs.map(x => (fs.length > 1 ? paren(x) : x)).join(' \\otimes '); };
    // 1. compact: Σ C ⊗ \widehat{Q} with the indices as labels
    const Ql = qDoc.nodes.size ? pureLatex(qDoc) : '', Cl = cDoc.nodes.size ? pureLatex(cDoc) : '';
    if (Ql !== null && Cl !== null) {
      const cand = S + join(Cl, Ql ? `\\widehat{${Ql}}` : '');
      if (!T || verifies(cand, kinds, T)) pqp = cand;
    }
    // 2. explicit: Σ over groups of C ⊗ \widehat{M} (kept if shorter)
    if (T) {
      const qIR = diagramToIR(qDoc), cIR = cDoc.nodes.size ? diagramToIR(cDoc) : null;
      const terms = assignments(k.indices).map(a => ({ K: qDoc.nodes.size ? tensorAt(qIR, a) : Tensor.identity(1),
        extra: cIR ? opLatex(tensorAt(cIR, a)) : '' }));
      if (terms.every(t => t.K)) {
        const groups = groupTerms(terms);
        const piece = ({ M, extra }) => {
          if (M.rows === 1 && M.cols === 1) {                        // only a weight: a probability
            const w = M.get(0, 0)[0] ** 2;
            const coef = Math.abs(w - 1) < 1e-9 ? '' : tensorToLatex(new Tensor(1, 1, [[w, 0]])).latex + ' ';
            return extra ? coef + extra : (coef.trim() || '1');
          }
          return join(extra, `\\widehat{${opLatex(M)}}`);
        };
        const cand = groups.length ? groups.map(piece).join(' + ') : '0';
        if (verifies(cand, kinds, T) && (!pqp || cand.length < pqp.length)) pqp = cand;
      }
    }
    if (!pqp) pqpInfo = 'PQP form: could not be written';
  }
  return { latex: familiar || pqp, familiar: { latex: familiar, info: famInfo }, pqp: { latex: pqp, info: pqpInfo },
    info: famInfo, category: familiar || pqp ? 'A' : 'D',
    reason: `${k.indices.length ? `Σ over ${k.indices.join(', ')}: ` : ''}a quantum process`, tensor: null, ir: null };
}

/** Dirac for a (thin) diagram with a Σ: Σᵢ of its pure diagram, the indices left as labels (checked). */
export function sumToDirac(doc) {
  const data = doc.toJSON();
  const pure = DiagramDocument.fromJSON({ ...data, sumIndices: [] });
  const T = evaluateDiagram(diagramToIR(doc)).tensor;
  const info = `A sum over the basis: ${doc.sumIndices.join(', ')} takes the values 0 and 1`;
  const K = pureLatex(pure);
  const cand = K ? `${sumOf(doc.sumIndices)}${paren(K)}` : '';
  const ok = c => { try { const t = evalDirac(parseDirac(c)); return !T || (t && t.rows === T.rows && t.cols === T.cols && Tensor.equal(t, T, 1e-9)); } catch { return false; } };
  if (cand && ok(cand)) return { latex: cand, info, category: 'A', reason: 'Σ over a basis', tensor: null, ir: null };
  if (T) return { latex: opLatex(T), info: info + ' (written out: the sum, evaluated)', category: 'A', reason: 'Σ over a basis', tensor: T, ir: null };
  return { latex: '', info: 'Could not write the sum', category: 'D', reason: 'No Dirac form', tensor: null, ir: null };
}
