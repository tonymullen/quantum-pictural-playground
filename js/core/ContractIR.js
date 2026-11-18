/**
 * ContractIR — Evaluate an IRGraph by contracting its tensor network.
 *
 * Returns the overall tensor of shape (2^nOut) × (2^nIn), whose row/column
 * index bits follow the graph's ordered boundaries:
 *   rows    ← graph.outputBoundary (first entry = most significant bit)
 *   columns ← graph.inputBoundary
 * The boundary is the single source of truth for wire order; if it is
 * missing or inconsistent with the open ports, openPorts() order is used.
 *
 * Strategy: every generator becomes a labelled tensor (one axis per port;
 * the two ports of a wire share a label). Tensors are merged pairwise,
 * summing over shared labels, in a greedy order that keeps intermediate
 * results small. Cost depends on the widest intermediate, not on the total
 * number of ports, so circuit-like diagrams stay cheap.
 */
import Tensor from './Tensor.js';
import Config from './Config.js';
import { generatorTensor } from './Interpret.js';

/**
 * @param {import('./IR.js').IRGraph} graph
 * @returns {{ tensor: Tensor|null, symbolic: boolean, tooLarge?: boolean, reason?: string }}
 */
export default function contractIR(graph) {
  const nodes = Array.from(graph.nodes.values());
  if (nodes.length === 0)
    return { tensor: new Tensor(1, 1, [[1, 0]]), symbolic: false };

  // --- Generator tensors ---
  const gens = [];
  for (const node of nodes) {
    const t = generatorTensor(node);
    if (!t) return { tensor: null, symbolic: true,
      reason: `"${node.label || node.kind}" has no concrete matrix` };
    gens.push({ node, t });
  }

  // --- Label ports: a wire's two ends share one label ---
  const portLabel = new Map();
  let nextLabel = 0;
  for (const e of graph.edges) {
    const L = nextLabel++;
    portLabel.set(`${e.srcNodeId}:out:${e.srcPort}`, L);
    portLabel.set(`${e.tgtNodeId}:in:${e.tgtPort}`, L);
  }
  const labelOf = key => {
    if (!portLabel.has(key)) portLabel.set(key, nextLabel++);
    return portLabel.get(key);
  };

  let pool = gens.map(({ node, t }) => {
    const labels = [];
    for (let i = 0; i < node.totalOut; i++) labels.push(labelOf(`${node.id}:out:${i}`));
    for (let i = 0; i < node.totalIn; i++) labels.push(labelOf(`${node.id}:in:${i}`));
    return _traceSelfLoops(_fromTensor(t, labels));
  });

  // --- Greedy pairwise contraction ---
  const maxRank = Config.maxContractionRank;
  while (pool.length > 1) {
    let best = null;
    for (let a = 0; a < pool.length; a++) {
      for (let b = a + 1; b < pool.length; b++) {
        const sa = new Set(pool[a].labels);
        const shared = pool[b].labels.filter(l => sa.has(l)).length;
        const rank = pool[a].labels.length + pool[b].labels.length - 2 * shared;
        // Prefer pairs that share wires; among those, the smallest result.
        const score = (shared > 0 ? 0 : 1e6) + rank * 1000 - shared;
        if (!best || score < best.score) best = { a, b, rank, score };
      }
    }
    if (best.rank > maxRank) {
      return { tensor: null, symbolic: false, tooLarge: true,
        reason: `Contraction needs a ${best.rank}-wire intermediate tensor (limit ${maxRank})` };
    }
    const merged = _contractPair(pool[best.a], pool[best.b]);
    pool = pool.filter((_, i) => i !== best.a && i !== best.b);
    pool.push(merged);
  }
  const final = pool[0];

  // --- Permute open labels into boundary order ---
  const { outLabels, inLabels } = _boundaryLabels(graph, final, labelOf);
  return { tensor: _toMatrix(final, outLabels, inLabels), symbolic: false };
}

/* ------------------------------------------------------------------ */
/* Labelled tensors: { labels: number[], re: Float64Array, im: Float64Array }
 * All axes have dimension 2; axis k of an r-axis tensor is bit (r-1-k)
 * of the flat index (axis 0 = most significant). */

function _fromTensor(t, labels) {
  const n = t.d.length;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) { re[i] = t.d[i][0]; im[i] = t.d[i][1]; }
  return { labels, re, im };
}

/** Bit position of each axis in a tensor of the given rank. */
const _bitPos = (rank, axis) => rank - 1 - axis;

/**
 * For every value v of an `positions.length`-bit counter (MSB first),
 * the flat-index offset obtained by placing bit j of v at positions[j].
 * A position of -1 contributes nothing.
 */
function _offsets(positions) {
  const n = positions.length, size = 1 << n;
  const off = new Int32Array(size);
  for (let v = 0; v < size; v++) {
    let o = 0;
    for (let j = 0; j < n; j++) {
      if (positions[j] >= 0 && ((v >> (n - 1 - j)) & 1)) o |= 1 << positions[j];
    }
    off[v] = o;
  }
  return off;
}

/** Sum over a repeated label within a single tensor (a wire from a node to itself). */
function _traceSelfLoops(T) {
  for (;;) {
    const seen = new Map();
    let pair = null;
    T.labels.forEach((l, i) => {
      if (pair) return;
      if (seen.has(l)) pair = [seen.get(l), i]; else seen.set(l, i);
    });
    if (!pair) return T;
    const r = T.labels.length;
    const keep = T.labels.map((_, i) => i).filter(i => i !== pair[0] && i !== pair[1]);
    const offKeep = _offsets(keep.map(i => _bitPos(r, i)));
    const diag = (1 << _bitPos(r, pair[0])) | (1 << _bitPos(r, pair[1]));
    const re = new Float64Array(offKeep.length), im = new Float64Array(offKeep.length);
    for (let k = 0; k < offKeep.length; k++) {
      re[k] = T.re[offKeep[k]] + T.re[offKeep[k] | diag];
      im[k] = T.im[offKeep[k]] + T.im[offKeep[k] | diag];
    }
    T = { labels: keep.map(i => T.labels[i]), re, im };
  }
}

/** Merge two labelled tensors, summing over every label they share. */
function _contractPair(A, B) {
  const ra = A.labels.length, rb = B.labels.length;
  const inB = new Map(B.labels.map((l, i) => [l, i]));
  const inA = new Map(A.labels.map((l, i) => [l, i]));
  const shared = A.labels.filter(l => inB.has(l));
  const freeA = A.labels.map((l, i) => i).filter(i => !inB.has(A.labels[i]));
  const freeB = B.labels.map((l, i) => i).filter(i => !inA.has(B.labels[i]));

  // Result axes: freeA then freeB
  const resPosA = [...freeA.map(i => _bitPos(ra, i)), ...freeB.map(() => -1)];
  const resPosB = [...freeA.map(() => -1), ...freeB.map(i => _bitPos(rb, i))];
  const offRA = _offsets(resPosA), offRB = _offsets(resPosB);
  const offSA = _offsets(shared.map(l => _bitPos(ra, inA.get(l))));
  const offSB = _offsets(shared.map(l => _bitPos(rb, inB.get(l))));

  const nR = offRA.length, nS = offSA.length;
  const re = new Float64Array(nR), im = new Float64Array(nR);
  const Are = A.re, Aim = A.im, Bre = B.re, Bim = B.im;
  for (let r = 0; r < nR; r++) {
    const ba = offRA[r], bb = offRB[r];
    let sr = 0, si = 0;
    for (let s = 0; s < nS; s++) {
      const ia = ba | offSA[s], ib = bb | offSB[s];
      const ar = Are[ia], ai = Aim[ia], br = Bre[ib], bi = Bim[ib];
      sr += ar * br - ai * bi;
      si += ar * bi + ai * br;
    }
    re[r] = sr; im[r] = si;
  }
  return { labels: [...freeA.map(i => A.labels[i]), ...freeB.map(i => B.labels[i])], re, im };
}

/** Labels of the open wires in boundary order (falls back to openPorts order). */
function _boundaryLabels(graph, final, labelOf) {
  const toLabels = (list, dir) => list.map(b => labelOf(`${b.nodeId}:${dir}:${b.portIndex}`));
  const remaining = new Set(final.labels);
  let outLabels = toLabels(graph.outputBoundary || [], 'out');
  let inLabels = toLabels(graph.inputBoundary || [], 'in');
  const all = [...outLabels, ...inLabels];
  const consistent = all.length === remaining.size && all.every(l => remaining.has(l))
    && new Set(all).size === all.length;
  if (!consistent) {
    const open = graph.openPorts();
    outLabels = toLabels(open.outputs, 'out');
    inLabels = toLabels(open.inputs, 'in');
  }
  return { outLabels, inLabels };
}

/** Lay a labelled tensor out as a matrix: rows from outLabels, cols from inLabels. */
function _toMatrix(T, outLabels, inLabels) {
  const r = T.labels.length;
  const pos = new Map(T.labels.map((l, i) => [l, _bitPos(r, i)]));
  const off = _offsets([...outLabels, ...inLabels].map(l => pos.get(l)));
  const rows = 1 << outLabels.length, cols = 1 << inLabels.length;
  const d = new Array(rows * cols);
  for (let k = 0; k < d.length; k++) d[k] = [T.re[off[k]], T.im[off[k]]];
  return new Tensor(rows, cols, d);
}
