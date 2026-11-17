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

    // Parse phase from label for spiders
    if (kind === GenKind.Z_SPIDER || kind === GenKind.X_SPIDER) {
      const parsed = Phase.parse(dNode.label);
      irNode.phase = parsed || Phase.ZERO;
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

  // --- 4. Compute boundary ordering via through-wire tracing ---
  const open = graph.openPorts();
  const { orderedInputs, orderedOutputs } = _orderBoundaries(graph, open, doc, nodeIdMap);
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

/**
 * Order boundaries by through-wire identity.
 * A through-wire is a path from an open input port to an open output port
 * through the graph. Paired input/output get the same position index.
 * Through-wires are ordered by x-position of their output end.
 * Unpaired ports are appended in x-position order.
 */
function _orderBoundaries(graph, open, doc, nodeIdMap) {
  // Trace each open output port backwards to find its paired open input
  const pairs = [];       // { input, output, outX }
  const pairedInputs = new Set();
  const pairedOutputs = new Set();

  for (const outPort of open.outputs) {
    const inPort = _traceBackToInput(graph, outPort, open.inputs);
    const dNode = _findDiagramNode(doc, nodeIdMap, outPort.nodeId);
    const outX = dNode ? dNode.x + outPort.portIndex * 24 : 0;

    if (inPort) {
      const key = `${inPort.nodeId}:${inPort.portIndex}`;
      if (!pairedInputs.has(key)) {
        pairs.push({ input: inPort, output: outPort, outX });
        pairedInputs.add(key);
        pairedOutputs.add(`${outPort.nodeId}:${outPort.portIndex}`);
      }
    }
  }

  // Sort pairs by output x-position
  pairs.sort((a, b) => a.outX - b.outX);

  // Collect paired boundaries in order
  const orderedInputs = pairs.map(p => ({ nodeId: p.input.nodeId, portIndex: p.input.portIndex }));
  const orderedOutputs = pairs.map(p => ({ nodeId: p.output.nodeId, portIndex: p.output.portIndex }));

  // Append unpaired inputs (sorted by x)
  for (const inp of open.inputs) {
    const key = `${inp.nodeId}:${inp.portIndex}`;
    if (!pairedInputs.has(key)) {
      const dNode = _findDiagramNode(doc, nodeIdMap, inp.nodeId);
      orderedInputs.push({ nodeId: inp.nodeId, portIndex: inp.portIndex, _x: dNode ? dNode.x : 0 });
    }
  }
  // Append unpaired outputs (sorted by x)
  for (const outp of open.outputs) {
    const key = `${outp.nodeId}:${outp.portIndex}`;
    if (!pairedOutputs.has(key)) {
      const dNode = _findDiagramNode(doc, nodeIdMap, outp.nodeId);
      orderedOutputs.push({ nodeId: outp.nodeId, portIndex: outp.portIndex, _x: dNode ? dNode.x : 0 });
    }
  }

  return { orderedInputs, orderedOutputs };
}

/**
 * Trace backwards from an open output port through the graph to find
 * which open input port it connects to (if any).
 * Follows: output port ← edge ← node ← edge ← ... ← input port.
 */
function _traceBackToInput(graph, outPort, openInputs) {
  // The open output port is on a node. We trace backwards:
  // find the edge that feeds into this node's input that is on
  // the "same wire" (port 0 ↔ port 0 for simple 1-in/1-out nodes).
  const openInSet = new Set(openInputs.map(p => `${p.nodeId}:${p.portIndex}`));

  let currentNodeId = outPort.nodeId;
  let currentPortIdx = outPort.portIndex;
  const visited = new Set();

  for (let step = 0; step < 100; step++) { // safety limit
    const node = graph.nodes.get(currentNodeId);
    if (!node) return null;
    const visitKey = `${currentNodeId}:out:${currentPortIdx}`;
    if (visited.has(visitKey)) return null; // cycle
    visited.add(visitKey);

    // For the output port, find the corresponding input port on the same node.
    // For 1-in/1-out nodes (H, spiders with 1-1), port 0 maps to port 0.
    // For multi-port nodes, use the same index if available.
    const inIdx = Math.min(currentPortIdx, node.totalIn - 1);
    if (node.totalIn === 0) return null; // no inputs (state/cup) — no through-wire

    // Check if this input port is an open input
    const inKey = `${currentNodeId}:${inIdx}`;
    if (openInSet.has(inKey)) {
      return { nodeId: currentNodeId, portIndex: inIdx };
    }

    // Follow the edge into this input port
    const edges = graph.edgesAt(currentNodeId, 'in', inIdx);
    if (edges.length === 0) return null; // dangling
    const edge = edges[0];
    currentNodeId = edge.srcNodeId;
    currentPortIdx = edge.srcPort;
  }
  return null;
}

/** Reverse-lookup: find the diagram node corresponding to an IR node id. */
function _findDiagramNode(doc, nodeIdMap, irNodeId) {
  for (const [dId, irId] of nodeIdMap) {
    if (irId === irNodeId) return doc.nodes.get(dId);
  }
  return null;
}
