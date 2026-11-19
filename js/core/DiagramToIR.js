/**
 * DiagramToIR — Adapter: reads a DiagramDocument and builds an IRGraph.
 * Performs well-formedness checks with located diagnostics.
 *
 * The doubled picture (PQP ch. 6–8) is expanded here, so the IR — and
 * everything after it (contraction, Dirac, proof checking) — only ever sees
 * thin wires: a thick wire is a pair of thin wires (conjugate, normal).
 *
 *   doubled generator (thick)  →  its conjugate copy and itself (f̄ ⊗ f):
 *                                 spider phases negated, boxes reflected
 *                                 left↔right (= conjugated, see orientTensor)
 *   general process (thick, legs thin or thick)  →  one box over the expanded legs
 *   white dot (legs thin or thick)  →  one phase-free spider; a thick leg gives two legs
 *   discard ⏚                   →  a cap on the pair (the trace)
 */
import { IRGraph, IRNode, IREdge, IRPort, WireType, GenKind, applyTensorOrder } from './IR.js';
import Phase from './Phase.js';

/** Thin generators that are quantum: not allowed on (classical) thin wires of a doubled diagram. */
const QUANTUM_THIN = new Set(['z-spider', 'x-spider', 'hadamard']);

/**
 * Convert a DiagramDocument to an IRGraph.
 * @param {import('../editors/DiagramEditor/DiagramDocument.js').default} doc
 * @returns {IRGraph}
 */
export default function diagramToIR(doc) {
  const graph = new IRGraph();
  // Port positions (used for boundary order) depend on which ports are spider legs
  if (typeof doc.refreshLegs === 'function') doc.refreshLegs();

  const portMap = new Map();      // "diagramNodeId:dir:i" → [{ irId, port }]  (1 thin, 2 thick: conj, normal)
  const firstIR = new Map();      // diagram node id → its first IR node id (for located diagnostics)
  const pk = (id, dir, i) => `${id}:${dir}:${i}`;
  const thick = (n, dir, i) => (typeof n.portIsThick === 'function' ? n.portIsThick(dir, i) : false);
  const doubledDiagram = [...doc.nodes.values()].some(n => typeof n.hasThick === 'function' && n.hasThick());

  const mk = (dNode, kind, nIn, nOut, props = {}) => {
    const irNode = new IRNode(kind,
      Array.from({ length: nIn }, (_, i) => new IRPort('in', i, WireType.QUBIT)),
      Array.from({ length: nOut }, (_, i) => new IRPort('out', i, WireType.QUBIT)));
    irNode.label = dNode.label || '';
    irNode.provenance = { editorType: 'diagram', elementId: dNode.id };
    Object.assign(irNode, props);
    graph.addNode(irNode);
    graph.layoutKey.set(irNode.id, dNode.x);
    if (!firstIR.has(dNode.id)) firstIR.set(dNode.id, irNode.id);
    return irNode;
  };

  /** A thin generator (or one copy of a doubled one). conj: the conjugate copy. */
  const single = (dNode, conj) => {
    const kind = dNode.type.key;
    const props = {};
    if (dNode.tensor) props.tensor = dNode.tensor;     // e.g. a box generated from a circuit
    const flip = { v: !!(dNode.flip && dNode.flip.v), h: !!(dNode.flip && dNode.flip.h) !== !!conj };
    if (flip.v || flip.h) props.flip = flip;            // ᵀ, †, conjugate (and the conjugate copy)
    if (kind === GenKind.Z_SPIDER || kind === GenKind.X_SPIDER) {
      const parsed = Phase.parse(dNode.label);
      props.phase = parsed;
      props.phaseSymbolic = parsed === null;            // e.g. "α": no concrete tensor
      if (conj) props.conj = true;                       // the conjugate copy negates the phase
    }
    return mk(dNode, kind, dNode.inputs, dNode.outputs, props);
  };

  /** One IR node whose ports are the expansion of dNode's legs (thick → two). */
  const expanded = (dNode, kind, props = {}) => {
    const legs = dir => (dir === 'in' ? dNode.inputs : dNode.outputs);
    const count = dir => { let c = 0; for (let i = 0; i < legs(dir); i++) c += thick(dNode, dir, i) ? 2 : 1; return c; };
    // legGroups: how many IR ports each diagram leg became (1 thin, 2 thick) — used
    // by the proof checker to sample processes satisfying assumptions (causality)
    const groups = dir => Array.from({ length: legs(dir) }, (_, i) => (thick(dNode, dir, i) ? 2 : 1));
    const ir = mk(dNode, kind, count('in'), count('out'), { ...props, legGroups: { in: groups('in'), out: groups('out') } });
    for (const dir of ['in', 'out']) {
      let k = 0;
      for (let i = 0; i < legs(dir); i++) {
        const ports = thick(dNode, dir, i) ? [k, k + 1] : [k];
        portMap.set(pk(dNode.id, dir, i), ports.map(port => ({ irId: ir.id, port })));
        k += ports.length;
      }
    }
    return ir;
  };

  // --- 1. Nodes ---
  for (const dNode of doc.nodes.values()) {
    const kind = dNode.type.key;
    if (kind === 'dot') {
      expanded(dNode, GenKind.Z_SPIDER, { phase: Phase.ZERO, phaseSymbolic: false, label: '' });
    } else if (kind === 'discard') {
      const cap = mk(dNode, GenKind.CAP, 2, 0);
      portMap.set(pk(dNode.id, 'in', 0), [{ irId: cap.id, port: 0 }, { irId: cap.id, port: 1 }]);
    } else if (typeof dNode.isMixed === 'function' && dNode.isMixed()) {
      // A general quantum process: one (symbolic) box over the expanded legs
      const props = {};
      if (dNode.flip && (dNode.flip.v || dNode.flip.h)) props.flip = { ...dNode.flip };
      props.process = true;
      expanded(dNode, GenKind.MORPHISM, props);
    } else if (dNode.thick) {
      const c = single(dNode, true), n = single(dNode, false);
      c.doubledHalf = n.doubledHalf = true;         // f̂ = f̄ ⊗ f: "causal" for f̂ means f is an isometry
      for (const dir of ['in', 'out'])
        for (let i = 0; i < (dir === 'in' ? dNode.inputs : dNode.outputs); i++)
          portMap.set(pk(dNode.id, dir, i), [{ irId: c.id, port: i }, { irId: n.id, port: i }]);
    } else {
      const ir = single(dNode, false);
      for (const dir of ['in', 'out'])
        for (let i = 0; i < (dir === 'in' ? dNode.inputs : dNode.outputs); i++)
          portMap.set(pk(dNode.id, dir, i), [{ irId: ir.id, port: i }]);
    }
    // Strict PQP typing: in the doubled picture thin wires are classical
    if (doubledDiagram && !dNode.thick && QUANTUM_THIN.has(kind)) {
      graph.addDiagnostic('error',
        `${dNode.type.label} on a thin wire: in a diagram with thick (quantum) wires, thin wires are classical. `
        + 'Make it doubled (thick), or use a white dot.', firstIR.get(dNode.id));
    }
  }

  // --- 2. Wires ---
  const portConnections = new Map(); // "diagramNodeId:dir:port" → count
  for (const wire of doc.wires) {
    const sNode = doc.nodes.get(wire.fromNodeId), tNode = doc.nodes.get(wire.toNodeId);
    if (!sNode || !tNode) {
      graph.addDiagnostic('error', `Wire references a missing node "${!sNode ? wire.fromNodeId : wire.toNodeId}"`, null, wire.id);
      continue;
    }
    if (wire.fromPort >= sNode.outputs || wire.toPort >= tNode.inputs) {
      const n = wire.fromPort >= sNode.outputs ? sNode : tNode;
      graph.addDiagnostic('error', `A wire is attached to a port that "${n.label || n.type.key}" does not have`,
        firstIR.get(n.id), wire.id);
      continue;
    }
    const src = portMap.get(pk(sNode.id, 'out', wire.fromPort));
    const tgt = portMap.get(pk(tNode.id, 'in', wire.toPort));
    if (src.length !== tgt.length) {
      graph.addDiagnostic('error', 'A thick (quantum) wire and a thin (classical) port cannot be joined',
        firstIR.get(sNode.id), wire.id);
      continue;
    }
    for (const key of [pk(sNode.id, 'out', wire.fromPort), pk(tNode.id, 'in', wire.toPort)])
      portConnections.set(key, (portConnections.get(key) || 0) + 1);
    src.forEach((s, k) => {
      const edge = new IREdge(s.irId, s.port, tgt[k].irId, tgt[k].port);
      edge.provenance = { editorType: 'diagram', elementId: wire.id };
      graph.addEdge(edge);
    });
  }

  // --- 3. Well-formedness: each port takes at most one wire ---
  for (const [key, count] of portConnections) {
    if (count > 1) {
      const [nodeId, dir, port] = key.split(':');
      const node = doc.nodes.get(nodeId);
      graph.addDiagnostic('error',
        `${dir === 'out' ? 'Output' : 'Input'} port ${port} of "${node.label || node.type.key}" is connected ${count} times — each port must have exactly one wire`,
        firstIR.get(nodeId));
    }
  }

  // --- 4. Boundary order: planar on the diagram's own ports (left to right,
  // as in PQP); a thick port expands in place to its pair. (Generate copes with
  // components whose wires interleave — see DiagramToDirac.tensorFactors.)
  const insertion = new Map(Array.from(doc.nodes.keys()).map((id, i) => [id, i]));
  const open = { in: [], out: [] };
  for (const n of doc.nodes.values()) {
    for (const dir of ['in', 'out'])
      for (let i = 0; i < (dir === 'in' ? n.inputs : n.outputs); i++)
        if (!portConnections.has(pk(n.id, dir, i))) open[dir].push({ node: n, dir, i });
  }
  const pos = p => (p.dir === 'in' ? p.node.getInputPort(p.i) : p.node.getOutputPort(p.i));
  const planar = (a, b) => {
    const pa = pos(a), pb = pos(b);
    return (pa.x - pb.x) || (pa.y - pb.y)
      || (insertion.get(a.node.id) - insertion.get(b.node.id)) || (a.i - b.i);
  };
  for (const dir of ['in', 'out']) {
    open[dir].sort(planar);
    if (doc.tensorOrder === 'little-endian') open[dir].reverse();   // wire order → ⊗ order
  }
  const expand = list => list.flatMap(p => portMap.get(pk(p.node.id, p.dir, p.i))
    .map(e => ({ nodeId: e.irId, portIndex: e.port })));
  graph.inputBoundary = expand(open.in);
  graph.outputBoundary = expand(open.out);

  // Boundaries in diagram terms, for the in/out markers on the canvas
  doc.inputBoundary = open.in.map(p => ({ nodeId: p.node.id, portIndex: p.i }));
  doc.outputBoundary = open.out.map(p => ({ nodeId: p.node.id, portIndex: p.i }));
  // Σ over these labels (PQP's sums over a basis): states/effects so labelled range over the basis
  graph.sumIndices = Array.isArray(doc.sumIndices) ? [...doc.sumIndices] : [];
  return graph;
}

// Kept for callers that apply an order to a graph built elsewhere
export { applyTensorOrder };
