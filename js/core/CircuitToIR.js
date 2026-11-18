/**
 * CircuitToIR — Translate a circuit into a ZX-style IR graph.
 *
 * The IR equals the circuit exactly (scalars included). Boundary order is
 * qubit order, reversed when circ.tensorOrder is 'little-endian'. Translation:
 *   H                      → Hadamard box
 *   Z, S, S†, T, T†, Z(θ)  → Z spider with that phase
 *   X, X(θ)                → X spider (phase π / θ)
 *   Y                      → Z(π) then X(π), times a scalar i   (Y = iXZ)
 *   CNOT (one •, X targets) → Z spider on the control, legs to X spiders
 *   CZ   (one •, Z targets) → Z spider on the control, legs through H to Z spiders
 *   SWAP (two ×)           → wires cross (no generator)
 *   anything else          → one box over the involved qubits, carrying
 *                            its exact matrix (labelled e.g. "CCX", "CH")
 *   input |0⟩,|1⟩,|+⟩,|−⟩  → X(0), X(π), Z(0), Z(π) state spiders
 *   output ⟨0|,…           → the matching effect spiders
 * The scalars the spider forms introduce (√2 per leg, 1/√2 per state/effect,
 * i for Y) are collected in one scalar node, so the result is exact.
 *
 * Each IR node gets `layout = { q, t, portQ: { in: [...], out: [...] } }`
 * (qubit position, time step, and the qubit each port belongs to), which
 * IRToDiagram uses to draw the circuit as a PQP diagram.
 */
import C from './Complex.js';
import Tensor from './Tensor.js';
import Phase from './Phase.js';
import { IRGraph, IRNode, IREdge, IRPort, GenKind, applyTensorOrder } from './IR.js';
import { GATES, analyzeColumn, columnOperator, cellPhase } from './CircuitGates.js';

const SQRT2 = Math.SQRT2;

/**
 * @param {{ nQubits:number, inputs:string[], outputs:string[], columns:any[][] }} circ
 * @returns {IRGraph}
 */
export default function circuitToIR(circ) {
  const g = new IRGraph();
  const n = circ.nQubits;
  const cur = new Array(n);     // per qubit position: dangling output { nodeId, port }
  let scalar = C.ONE;

  const mk = (kind, nIn, nOut, layout, props = {}) => {
    const node = new IRNode(kind,
      Array.from({ length: nIn }, (_, i) => new IRPort('in', i)),
      Array.from({ length: nOut }, (_, i) => new IRPort('out', i)));
    Object.assign(node, props);
    node.layout = layout;
    node.provenance = { editorType: 'circuit', elementId: circ.id || null, t: layout.t };
    g.addNode(node);
    return node;
  };
  const feed = (q, node, port) => {
    g.addEdge(new IREdge(cur[q].nodeId, cur[q].port, node.id, port));
  };
  const spider = (color, phase, nIn, nOut, layout) => {
    const symbolic = phase === null;
    return mk(color === 'z' ? GenKind.Z_SPIDER : GenKind.X_SPIDER, nIn, nOut, layout, {
      phase, phaseSymbolic: symbolic,
    });
  };
  const lay = (q, t, portIn, portOut) => ({ q, t, portQ: { in: portIn, out: portOut } });

  // --- Inputs (t = 0) ---
  const inputBoundary = [];
  for (let q = 0; q < n; q++) {
    const inp = circ.inputs[q] || 'open';
    if (inp === 'open') {
      const id = mk(GenKind.IDENTITY, 1, 1, lay(q, 0, [q], [q]));
      inputBoundary.push({ nodeId: id.id, portIndex: 0 });
      cur[q] = { nodeId: id.id, port: 0 };
    } else {
      const st = _stateSpider(inp, 0, 1, lay(q, 0, [], [q]), spider);
      scalar = C.scale(1 / SQRT2, scalar);
      cur[q] = { nodeId: st.id, port: 0 };
    }
  }

  // --- Columns (t = 1 …) ---
  circ.columns.forEach((col, ci) => {
    const t = ci + 1;
    const { controls, targets, swaps, diagnostics } = analyzeColumn(col);
    for (const d of diagnostics) g.addDiagnostic('warning', `Step ${t}: ${d}`);
    if (targets.length === 0 && swaps.length === 0) return;

    if (controls.length === 0) {
      for (const { q, cell } of targets) scalar = C.mul(scalar, _singleQubit(q, t, cell, cur, mk, spider, feed, lay));
      if (swaps.length === 2) { const [a, b] = swaps; [cur[a], cur[b]] = [cur[b], cur[a]]; }
      return;
    }

    const one = controls.length === 1 && !controls[0].anti && swaps.length === 0;
    const allOf = id => targets.length > 0 && targets.every(x => x.cell.gate === id);
    if (one && (allOf('X') || allOf('Z'))) {
      // CNOT / CZ (with fan-out): Z spider on the control, one leg per target
      const c = controls[0].q, k = targets.length, isX = allOf('X');
      const zc = spider('z', Phase.ZERO, 1, 1 + k, lay(c, t, [c], [c]));
      feed(c, zc, 0);
      cur[c] = { nodeId: zc.id, port: 0 };
      targets.forEach(({ q }, j) => {
        const tg = spider(isX ? 'x' : 'z', Phase.ZERO, 2, 1, lay(q, t, [q], [q]));
        feed(q, tg, 0);
        if (isX) {
          g.addEdge(new IREdge(zc.id, 1 + j, tg.id, 1));
        } else {
          const h = mk(GenKind.HADAMARD, 1, 1, lay((c + q) / 2, t, [], []));
          g.addEdge(new IREdge(zc.id, 1 + j, h.id, 0));
          g.addEdge(new IREdge(h.id, 0, tg.id, 1));
        }
        cur[q] = { nodeId: tg.id, port: 0 };
      });
      scalar = C.scale(SQRT2 ** k, scalar);
      return;
    }

    // General controlled operation: one box with the exact matrix
    const qs = [...new Set([...controls.map(x => x.q), ...targets.map(x => x.q), ...swaps])].sort((a, b) => a - b);
    const box = mk(GenKind.MORPHISM, qs.length, qs.length,
      lay(qs.reduce((s, q) => s + q, 0) / qs.length, t, qs, qs), {
        label: _boxLabel(controls, targets, swaps),
        tensor: columnOperator(col, qs),
      });
    qs.forEach((q, i) => { feed(q, box, i); cur[q] = { nodeId: box.id, port: i }; });
  });

  // --- Outputs (t = last + 1) ---
  const tOut = circ.columns.length + 1;
  const outputBoundary = [];
  for (let q = 0; q < n; q++) {
    const out = circ.outputs[q] || 'open';
    if (out === 'open') {
      // After a swap the wire may end on a node at another qubit position:
      // route it to position q with a plain wire so the diagram reads correctly
      const end = g.nodes.get(cur[q].nodeId);
      if ((end.layout.portQ.out[cur[q].port] ?? end.layout.q) !== q) {
        const id = mk(GenKind.IDENTITY, 1, 1, lay(q, tOut, [q], [q]));
        feed(q, id, 0);
        cur[q] = { nodeId: id.id, port: 0 };
      }
      outputBoundary.push({ nodeId: cur[q].nodeId, portIndex: cur[q].port });
    } else {
      const ef = _stateSpider(out, 1, 0, lay(q, tOut, [q], []), spider);
      feed(q, ef, 0);
      scalar = C.scale(1 / SQRT2, scalar);
    }
  }

  // --- Collected scalar ---
  if (!C.eq(scalar, C.ONE)) {
    mk(GenKind.SCALAR, 0, 0, lay(n, 0, [], []), {
      label: scalarLabel(scalar), tensor: new Tensor(1, 1, [scalar]),
    });
  }

  g.inputBoundary = inputBoundary;
  g.outputBoundary = outputBoundary;
  for (const node of g.nodes.values()) g.layoutKey.set(node.id, node.layout.q);
  _spliceIdentities(g);
  applyTensorOrder(g, circ.tensorOrder);   // qubit order → ⊗ order
  return g;
}

/** Spider form of a basis state (nIn=0,nOut=1) or effect (nIn=1,nOut=0); scalar 1/√2 handled by caller. */
function _stateSpider(label, nIn, nOut, layout, spider) {
  const [color, phase] = { '0': ['x', Phase.ZERO], '1': ['x', Phase.PI],
                           '+': ['z', Phase.ZERO], '-': ['z', Phase.PI] }[label];
  return spider(color, phase, nIn, nOut, layout);
}

/** Append one uncontrolled single-qubit gate on qubit q. Returns the scalar it introduces. */
function _singleQubit(q, t, cell, cur, mk, spider, feed, lay) {
  const zx = GATES[cell.gate].zx;
  const append = node => { feed(q, node, 0); cur[q] = { nodeId: node.id, port: 0 }; };
  if (zx.h) { append(mk(GenKind.HADAMARD, 1, 1, lay(q, t, [q], [q]))); return C.ONE; }
  if (zx.y) {
    append(spider('z', Phase.PI, 1, 1, lay(q, t - 0.3, [q], [q])));
    append(spider('x', Phase.PI, 1, 1, lay(q, t + 0.3, [q], [q])));
    return C.I;
  }
  const phase = zx.phase === 'param' ? cellPhase(cell) : zx.phase;
  const node = spider(zx.spider, phase, 1, 1, lay(q, t, [q], [q]));
  if (phase === null) node.label = cell.param;   // symbolic phase, e.g. α
  append(node);
  return C.ONE;
}

function _boxLabel(controls, targets, swaps) {
  const pre = controls.map(c => (c.anti ? 'C̄' : 'C')).join('');
  const names = [...new Set(targets.map(x => GATES[x.cell.gate].label.replace('θ', x.cell.param || 'θ')))];
  const body = [...names, ...(swaps.length ? ['SWAP'] : [])].join('');
  return pre + (body || 'I');
}

/**
 * Remove identity nodes that are not needed: a wire through an identity is
 * just a wire. Kept: bare wires (both ends open), and identities that carry
 * a wire to a different qubit position (after a swap), which the diagram
 * needs so the open ends line up with their qubits.
 */
function _spliceIdentities(g) {
  const qOf = (node, dir, port) => node.layout.portQ[dir][port] ?? node.layout.q;
  for (const node of [...g.nodes.values()]) {
    if (node.kind !== GenKind.IDENTITY) continue;
    const inE = g.edgesAt(node.id, 'in', 0)[0] || null;
    const outE = g.edgesAt(node.id, 'out', 0)[0] || null;
    const inB = g.inputBoundary.findIndex(b => b.nodeId === node.id);
    const outB = g.outputBoundary.findIndex(b => b.nodeId === node.id);
    const q = node.layout.q;
    if (inE && outE) {
      g.edges = g.edges.filter(e => e !== inE && e !== outE);
      g.addEdge(new IREdge(inE.srcNodeId, inE.srcPort, outE.tgtNodeId, outE.tgtPort));
    } else if (inB >= 0 && outE) {
      const tgt = g.nodes.get(outE.tgtNodeId);
      if (qOf(tgt, 'in', outE.tgtPort) !== q) continue;
      g.edges = g.edges.filter(e => e !== outE);
      g.inputBoundary[inB] = { nodeId: outE.tgtNodeId, portIndex: outE.tgtPort };
    } else if (outB >= 0 && inE) {
      const src = g.nodes.get(inE.srcNodeId);
      if (qOf(src, 'out', inE.srcPort) !== q) continue;
      g.edges = g.edges.filter(e => e !== inE);
      g.outputBoundary[outB] = { nodeId: inE.srcNodeId, portIndex: inE.srcPort };
    } else {
      continue;
    }
    g.nodes.delete(node.id);
    g.layoutKey.delete(node.id);
  }
}

/** Short label for a scalar: √2, 2, 1/√2, i√2, … */
export function scalarLabel(z) {
  const mag = C.abs(z), arg = C.arg(z);
  const k = Math.round(2 * Math.log2(mag));               // mag = √2^k ?
  const quarter = Math.round(arg / (Math.PI / 2));        // phase = i^quarter ?
  if (Math.abs(mag - SQRT2 ** k) > 1e-9 || Math.abs(arg - quarter * Math.PI / 2) > 1e-9)
    return C.str(z, 3);
  const a = Math.abs(k), whole = 2 ** Math.floor(a / 2), root = a % 2 ? '√2' : '';
  let m = (whole === 1 && root ? '' : String(whole)) + root;   // '1', '√2', '2', '2√2', …
  if (k < 0) m = '1/' + m;
  const pre = ['', 'i', '-', '-i'][((quarter % 4) + 4) % 4];
  if (m === '1') return pre === '' ? '1' : pre === '-' ? '-1' : pre;
  return pre + m;
}
