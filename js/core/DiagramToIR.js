/**
 * DiagramToIR — Adapter: reads a DiagramDocument and builds an IRGraph.
 * Performs well-formedness checks with located diagnostics.
 */
import { IRGraph, IRNode, IREdge, IRPort, WireType, GenKind } from './IR.js';
import Phase from './Phase.js';

/**
 * Convert a DiagramDocument to an IRGraph.
 * @param {import('../editors/DiagramEditor/DiagramDocument.js').default} doc
 * @returns {IRGraph}
 */
export default function diagramToIR(doc) {
  const graph = new IRGraph();
  const nodeIdMap = new Map(); // diagram nodeId → IR nodeId
  // Port positions (used for boundary order) depend on which ports are spider legs
  if (typeof doc.refreshLegs === 'function') doc.refreshLegs();

  // --- 1. Convert nodes to IR generators ---
  for (const dNode of doc.nodes.values()) {
    const kind = dNode.type.key; // already matches GenKind values
    const inPorts = [];
    for (let i = 0; i < dNode.inputs; i++)
      inPorts.push(new IRPort('in', i, WireType.QUBIT));
    const outPorts = [];
    for (let i = 0; i < dNode.outputs; i++)
      outPorts.push(new IRPort('out', i, WireType.QUBIT));

    const irNode = new IRNode(kind, inPorts, outPorts);
    irNode.label = dNode.label || '';
    irNode.provenance = { editorType: 'diagram', elementId: dNode.id };

    // Parse phase from label for spiders. An unparseable label (e.g. "α")
    // is a symbolic phase: the spider then has no concrete tensor.
    if (kind === GenKind.Z_SPIDER || kind === GenKind.X_SPIDER) {
      const parsed = Phase.parse(dNode.label);
      irNode.phase = parsed;
      irNode.phaseSymbolic = parsed === null;
    }

    graph.addNode(irNode);
    nodeIdMap.set(dNode.id, irNode.id);
  }

  // --- 2. Convert wires to IR edges ---
  const portConnections = new Map(); // "nodeId:dir:portIdx" → count

  for (const wire of doc.wires) {
    const srcIR = nodeIdMap.get(wire.fromNodeId);
    const tgtIR = nodeIdMap.get(wire.toNodeId);

    if (!srcIR) {
      graph.addDiagnostic('error',
        `Wire references missing source node "${wire.fromNodeId}"`,
        null, wire.id);
      continue;
    }
    if (!tgtIR) {
      graph.addDiagnostic('error',
        `Wire references missing target node "${wire.toNodeId}"`,
        null, wire.id);
      continue;
    }

    // Check port bounds
    const srcNode = graph.nodes.get(srcIR);
    const tgtNode = graph.nodes.get(tgtIR);
    if (wire.fromPort >= srcNode.totalOut) {
      graph.addDiagnostic('error',
        `Wire from port ${wire.fromPort} but "${srcNode.label||srcNode.kind}" has only ${srcNode.totalOut} output(s)`,
        srcIR, wire.id);
      continue;
    }
    if (wire.toPort >= tgtNode.totalIn) {
      graph.addDiagnostic('error',
        `Wire to port ${wire.toPort} but "${tgtNode.label||tgtNode.kind}" has only ${tgtNode.totalIn} input(s)`,
        tgtIR, wire.id);
      continue;
    }

    // Track port connections for double-connection check
    const srcKey = `${srcIR}:out:${wire.fromPort}`;
    const tgtKey = `${tgtIR}:in:${wire.toPort}`;
    portConnections.set(srcKey, (portConnections.get(srcKey) || 0) + 1);
    portConnections.set(tgtKey, (portConnections.get(tgtKey) || 0) + 1);

    const edge = new IREdge(srcIR, wire.fromPort, tgtIR, wire.toPort);
    edge.provenance = { editorType: 'diagram', elementId: wire.id };
    graph.addEdge(edge);
  }

  // --- 3. Well-formedness checks ---

  // Double-connected ports
  for (const [key, count] of portConnections) {
    if (count > 1) {
      const [nodeId, dir, port] = key.split(':');
      const node = graph.nodes.get(nodeId);
      graph.addDiagnostic('error',
        `${dir === 'out' ? 'Output' : 'Input'} port ${port} of "${node.label||node.kind}" is connected ${count} times — each port must have exactly one wire`,
        nodeId);
    }
  }

  // --- 4. Boundary ordering (planar, grouped by component) ---
  // Components are ordered left-to-right by their leftmost node; within a
  // component, open ports are ordered by their on-screen position (x, then y).
  // Grouping by component keeps Generate (⊗ of components) and Verify
  // (whole-graph contraction) on the same wire order.
  const irToDiagram = new Map();
  for (const [dId, irId] of nodeIdMap) irToDiagram.set(irId, doc.nodes.get(dId));
  const insertion = new Map(Array.from(graph.nodes.keys()).map((id, i) => [id, i]));
  for (const [irId, dNode] of irToDiagram) graph.layoutKey.set(irId, dNode.x);

  const portPos = (p, dir) => {
    const dNode = irToDiagram.get(p.nodeId);
    return dir === 'in' ? dNode.getInputPort(p.portIndex) : dNode.getOutputPort(p.portIndex);
  };
  const planar = dir => (a, b) => {
    const pa = portPos(a, dir), pb = portPos(b, dir);
    return (pa.x - pb.x) || (pa.y - pb.y)
      || (insertion.get(a.nodeId) - insertion.get(b.nodeId)) || (a.portIndex - b.portIndex);
  };
  const strip = p => ({ nodeId: p.nodeId, portIndex: p.portIndex });
  const orderedInputs = [], orderedOutputs = [];
  for (const comp of graph.connectedComponents()) {
    const open = comp.openPorts();
    orderedInputs.push(...open.inputs.sort(planar('in')).map(strip));
    orderedOutputs.push(...open.outputs.sort(planar('out')).map(strip));
  }
  graph.inputBoundary = orderedInputs;
  graph.outputBoundary = orderedOutputs;

  // Store the reverse map (IR nodeId → diagram nodeId) for boundary markers
  graph._irToDiagramId = new Map();
  for (const [dId, irId] of nodeIdMap) graph._irToDiagramId.set(irId, dId);

  // Also store boundaries in diagram-node-id space on the document
  doc.inputBoundary = orderedInputs.map(b => ({
    nodeId: graph._irToDiagramId.get(b.nodeId) || b.nodeId,
    portIndex: b.portIndex
  }));
  doc.outputBoundary = orderedOutputs.map(b => ({
    nodeId: graph._irToDiagramId.get(b.nodeId) || b.nodeId,
    portIndex: b.portIndex
  }));

  return graph;
}
