/**
 * SymbolicPrint — Generate symbolic Dirac LaTeX from an IR component
 * that contains generators without concrete matrices.
 *
 * Rules:
 *   state (0 in, 1 out)  → |label⟩
 *   effect (1 in, 0 out) → ⟨label|
 *   box (n in, m out)    → label (as operator)
 *   scalar (0 in, 0 out) → label
 *   Z spider, phase α    → |0…0⟩⟨0…0| + e^{iα}|1…1⟩⟨1…1|   (X: |+…+⟩, |−…−⟩)
 *   Composition via wires → product (later applied first in PQP)
 *   Closed loop of boxes/cups/caps → Tr(…)
 *
 * Limitation: composition is printed by juxtaposition in topological order,
 * which is exact for chains but not for components with parallel branches.
 */
import { GenKind } from './IR.js';
import { generatorTensor } from './Interpret.js';

const GREEK = { 'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
  'θ': '\\theta', 'φ': '\\phi', 'ϕ': '\\phi', 'ψ': '\\psi', 'λ': '\\lambda',
  'μ': '\\mu', 'ω': '\\omega', 'π': '\\pi' };
const toTex = s => s.replace(/[αβγδθφϕψλμωπ]/g, ch => GREEK[ch] + ' ').trim();

/**
 * @param {import('./IR.js').IRGraph} comp — a connected component
 * @returns {{ latex: string, assumptions: string[], isSum: boolean }}
 */
export default function symbolicPrint(comp) {
  const nodes = Array.from(comp.nodes.values());
  const assumptions = [];
  for (const n of nodes) assumptions.push(..._nodeAssumptions(n));

  // Single-node case (most common for lone symbolic generators)
  if (nodes.length === 1) {
    const { latex, isSum } = _nodeToLatex(nodes[0]);
    return { latex, assumptions, isSum };
  }

  // Closed loop with no states/effects → Tr(...)
  const open = comp.openPorts();
  const closed = open.inputs.length === 0 && open.outputs.length === 0;
  const hasStateOrEffect = nodes.some(n =>
    n.kind === GenKind.STATE || n.kind === GenKind.EFFECT);
  if (closed && !hasStateOrEffect) {
    const labels = nodes.filter(n => !generatorTensor(n)).map(n => _opName(n));
    if (labels.length > 0)
      return { latex: `\\operatorname{Tr}(${labels.join(' ')})`, assumptions, isSum: false };
  }

  // Topological-order composition (later = higher = leftmost)
  const sorted = _topoSort(comp) || nodes;
  const factors = sorted
    .filter(n => !(generatorTensor(n) && (n.kind === GenKind.CUP || n.kind === GenKind.CAP)))
    .map(n => { const r = _nodeToLatex(n); return r.isSum ? `(${r.latex})` : r.latex; });
  // Merge adjacent ⟨a| |b⟩ into ⟨a|b⟩
  const latex = factors.join(' ').replace(/\\langle ([^|]*)\| \|([^|]*)\\rangle/g, '\\langle $1|$2\\rangle');
  return { latex, assumptions, isSum: false };
}

function _opName(n) {
  const lbl = n.label || n.kind;
  if (lbl.length === 1 && /[a-zA-Z]/.test(lbl)) return lbl;
  if (GREEK[lbl]) return GREEK[lbl];
  return `\\operatorname{${lbl}}`;
}

/** @returns {{ latex: string, isSum: boolean }} */
function _nodeToLatex(n) {
  const isSpider = n.kind === GenKind.Z_SPIDER || n.kind === GenKind.X_SPIDER;
  if (isSpider) return _spiderLatex(n);
  if (generatorTensor(n)) {
    if (n.kind === GenKind.HADAMARD) return { latex: 'H', isSum: false };
    if (n.kind === GenKind.SWAP) return { latex: '\\operatorname{SWAP}', isSum: false };
    return { latex: _opName(n), isSum: false };
  }
  const lbl = toTex(n.label || n.kind);
  const nIn = n.totalIn, nOut = n.totalOut;
  if (nIn === 0 && nOut === 1) return { latex: `|${lbl}\\rangle`, isSum: false };
  if (nIn === 1 && nOut === 0) return { latex: `\\langle ${lbl}|`, isSum: false };
  return { latex: _opName(n), isSum: false };
}

function _spiderLatex(n) {
  const [a, b] = n.kind === GenKind.Z_SPIDER ? ['0', '1'] : ['+', '-'];
  const term = (s) => (n.totalOut ? `|${s.repeat(n.totalOut)}\\rangle` : '')
                    + (n.totalIn ? `\\langle ${s.repeat(n.totalIn)}|` : '');
  const phase = n.phaseSymbolic ? `e^{i ${toTex(n.label)}}`
    : (n.phase && !n.phase.isZero()) ? `e^{i ${n.phase.toLatex()}}` : '';
  const t0 = term(a) || '1', t1 = term(b) || '';
  return { latex: `${t0} + ${phase}${t1}`, isSum: true };
}

function _nodeAssumptions(n) {
  if (generatorTensor(n)) return [];
  if (n.phaseSymbolic) return [`Symbolic phase ${n.label} on ${n.kind === GenKind.Z_SPIDER ? 'Z' : 'X'} spider`];
  const kind = n.totalIn === 0 && n.totalOut === 1 ? 'state'
             : n.totalIn === 1 && n.totalOut === 0 ? 'effect'
             : 'box';
  return [`Symbolic ${kind}: no matrix given for ${n.label || n.kind}`];
}

function _topoSort(graph) {
  const inDeg = new Map();
  for (const n of graph.nodes.values()) inDeg.set(n.id, 0);
  for (const e of graph.edges) inDeg.set(e.tgtNodeId, (inDeg.get(e.tgtNodeId) || 0) + 1);
  const q = [];
  for (const [id, d] of inDeg) if (d === 0) q.push(id);
  const sorted = [];
  while (q.length) {
    const id = q.shift();
    sorted.push(graph.nodes.get(id));
    for (const e of graph.edges) {
      if (e.srcNodeId === id) {
        inDeg.set(e.tgtNodeId, inDeg.get(e.tgtNodeId) - 1);
        if (inDeg.get(e.tgtNodeId) === 0) q.push(e.tgtNodeId);
      }
    }
  }
  return sorted.length === graph.nodes.size ? sorted.reverse() : null;
}
