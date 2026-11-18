/**
 * IRToDiagram — Draw an IR graph that carries layout hints (from
 * CircuitToIR) as diagram nodes and wires, PQP-style: qubit q is a vertical
 * wire at x = X0 + q·DX, and time step t is at height y = Y0 − t·DT
 * (time flows upward). Gates on one step sit side by side, so a CNOT's
 * control and target spiders are joined by a horizontal leg.
 */
import DiagramNode, { NODE_TYPES } from '../DiagramEditor/DiagramNode.js';
import DiagramWire from '../DiagramEditor/DiagramWire.js';

const X0 = 120, DX = 110, Y0 = 520, DT = 80;
const TYPE_BY_KEY = Object.fromEntries(Object.values(NODE_TYPES).map(t => [t.key, t]));

/**
 * @param {import('../../core/IR.js').IRGraph} ir — with node.layout = { q, t }
 * @returns {{ nodes: DiagramNode[], wires: DiagramWire[] }}
 */
export default function irToDiagram(ir) {
  const nodes = [], wires = [], idMap = new Map();
  for (const n of ir.nodes.values()) {
    const type = TYPE_BY_KEY[n.kind];
    if (!type) throw new Error(`No diagram node type for "${n.kind}"`);
    const { q = 0, t = 0 } = n.layout || {};
    const d = new DiagramNode(type, X0 + q * DX, Y0 - t * DT);
    d.inputs = n.totalIn;
    d.outputs = n.totalOut;
    d.label = _label(n);
    if (n.tensor && (n.kind === 'morphism' || n.kind === 'scalar')) d.tensor = n.tensor;
    // A multi-qubit box puts each port on its own qubit's wire
    const pq = n.layout && n.layout.portQ;
    if (n.kind === 'morphism' && pq && pq.in.length > 1) d.portXOffsets = pq.in.map(qq => (qq - q) * DX);
    idMap.set(n.id, d.id);
    nodes.push(d);
  }
  for (const e of ir.edges) {
    wires.push(new DiagramWire(idMap.get(e.srcNodeId), e.srcPort, idMap.get(e.tgtNodeId), e.tgtPort));
  }
  return { nodes, wires };
}

function _label(n) {
  if (n.kind === 'z-spider' || n.kind === 'x-spider') {
    if (n.phaseSymbolic) return n.label;
    return n.phase && !n.phase.isZero() ? n.phase.toString() : '';
  }
  if (n.kind === 'hadamard' || n.kind === 'identity') return '';
  return n.label || '';
}
