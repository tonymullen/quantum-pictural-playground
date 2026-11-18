/**
 * IR — Internal Representation for the sync hub.
 *
 * A typed open graph: generators with typed ports, wires, and
 * ordered input/output boundaries.
 *
 * This is the canonical representation that both editors translate
 * into and out of. Tensor interpretation of this graph is the
 * semantic ground truth for verification.
 */

/** Wire types (designed for future qudit extension). */
export const WireType = {
  QUBIT:     'qubit',       // thin, dimension 2
  QUBIT_D:   'qubit-thick', // doubled (CP map), dimension 4
  CLASSICAL: 'classical',   // classical, dimension 2 (computational basis only)
};

/** Generator kinds — mirrors DiagramNode NODE_TYPES but semantic. */
export const GenKind = {
  Z_SPIDER:  'z-spider',
  X_SPIDER:  'x-spider',
  HADAMARD:  'hadamard',
  MORPHISM:  'morphism',
  CUP:       'cup',
  CAP:       'cap',
  SWAP:      'swap',
  STATE:     'state',
  EFFECT:    'effect',
  SCALAR:    'scalar',
  DISCARD:   'discard',
  MEASURE:   'measure',
  PREPARE:   'prepare',
};

let _irNodeId = 0;
let _irEdgeId = 0;

/**
 * IRPort — A typed port on a generator.
 */
export class IRPort {
  /**
   * @param {'in'|'out'} direction
   * @param {number} index — port index on the generator
   * @param {string} wireType — from WireType
   */
  constructor(direction, index, wireType = WireType.QUBIT) {
    this.direction = direction;
    this.index = index;
    this.wireType = wireType;
  }
}

/**
 * IRNode — A generator in the graph.
 */
export class IRNode {
  /**
   * @param {string} kind — from GenKind
   * @param {IRPort[]} inPorts
   * @param {IRPort[]} outPorts
   */
  constructor(kind, inPorts, outPorts) {
    this.id = `ir-n-${_irNodeId++}`;
    this.kind = kind;
    this.inPorts = inPorts;
    this.outPorts = outPorts;
    this.phase = null;         // Phase instance or null
    this.label = '';           // Display label
    this.tensor = null;        // Tensor instance or null (concrete matrix)
    this.symbolicForm = null;  // string or null
    this.provenance = null;    // { editorType, elementId } for cross-highlighting
  }

  get totalIn() { return this.inPorts.length; }
  get totalOut() { return this.outPorts.length; }
}

/**
 * IREdge — A wire connecting two ports.
 */
export class IREdge {
  /**
   * @param {string} srcNodeId
   * @param {number} srcPort — output port index
   * @param {string} tgtNodeId
   * @param {number} tgtPort — input port index
   * @param {string} wireType — from WireType
   */
  constructor(srcNodeId, srcPort, tgtNodeId, tgtPort, wireType = WireType.QUBIT) {
    this.id = `ir-e-${_irEdgeId++}`;
    this.srcNodeId = srcNodeId;
    this.srcPort = srcPort;
    this.tgtNodeId = tgtNodeId;
    this.tgtPort = tgtPort;
    this.wireType = wireType;
  }
}

/**
 * IRGraph — The full typed open graph.
 */
export class IRGraph {
  constructor() {
    /** @type {Map<string, IRNode>} */
    this.nodes = new Map();
    /** @type {IREdge[]} */
    this.edges = [];
    /** Ordered boundary: open input ports (top-level inputs to the diagram).
     *  Each entry: { nodeId, portIndex } */
    this.inputBoundary = [];
    /** Ordered boundary: open output ports (top-level outputs). */
    this.outputBoundary = [];
    /** Well-formedness diagnostics. */
    this.diagnostics = [];
    /** Optional layout key per node (e.g. diagram x-position). Components are
     *  ordered by their smallest key; nodes without a key use insertion order. */
    this.layoutKey = new Map();
  }

  addNode(node) { this.nodes.set(node.id, node); return node; }
  addEdge(edge) { this.edges.push(edge); return edge; }

  /** Find all edges connected to a port. */
  edgesAt(nodeId, direction, portIndex) {
    if (direction === 'out') {
      return this.edges.filter(e => e.srcNodeId === nodeId && e.srcPort === portIndex);
    } else {
      return this.edges.filter(e => e.tgtNodeId === nodeId && e.tgtPort === portIndex);
    }
  }

  /** Get open (unconnected) ports. */
  openPorts() {
    const open = { inputs: [], outputs: [] };
    for (const node of this.nodes.values()) {
      for (let i = 0; i < node.totalIn; i++) {
        if (this.edgesAt(node.id, 'in', i).length === 0)
          open.inputs.push({ nodeId: node.id, portIndex: i, port: node.inPorts[i] });
      }
      for (let i = 0; i < node.totalOut; i++) {
        if (this.edgesAt(node.id, 'out', i).length === 0)
          open.outputs.push({ nodeId: node.id, portIndex: i, port: node.outPorts[i] });
      }
    }
    return open;
  }

  /** Add a diagnostic message. */
  addDiagnostic(severity, message, nodeId = null, edgeId = null) {
    this.diagnostics.push({ severity, message, nodeId, edgeId });
  }

  /** Is the graph well-formed (no errors)? */
  get isValid() { return !this.diagnostics.some(d => d.severity === 'error'); }

  /**
   * Decompose into connected components.
   * Returns an array of IRGraph, each a self-contained subgraph, sorted by
   * layoutKey (left to right). Each component's boundary keeps the relative
   * order of this graph's boundary, so when the parent boundary is grouped by
   * component (as DiagramToIR produces it), the tensor product of the
   * components in this order equals the parent's tensor.
   */
  connectedComponents() {
    if (this.nodes.size === 0) return [];
    // Union-find over node ids
    const parent = new Map();
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (a, b) => { parent.set(find(a), find(b)); };
    for (const id of this.nodes.keys()) parent.set(id, id);
    for (const e of this.edges) union(e.srcNodeId, e.tgtNodeId);

    // Group nodes by component root
    const groups = new Map(); // root → [nodeId]
    for (const id of this.nodes.keys()) {
      const r = find(id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(id);
    }

    // Order components by layout key (ties / missing keys → insertion order)
    const insertion = new Map(Array.from(this.nodes.keys()).map((id, i) => [id, i]));
    const keyOf = ids => {
      let k = Infinity, ins = Infinity;
      for (const id of ids) {
        if (this.layoutKey.has(id)) k = Math.min(k, this.layoutKey.get(id));
        ins = Math.min(ins, insertion.get(id));
      }
      return [k, ins];
    };
    const ordered = Array.from(groups.values())
      .map(ids => ({ ids, key: keyOf(ids) }))
      .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);

    // Build sub-graphs
    const components = [];
    for (const { ids: nodeIds } of ordered) {
      const idSet = new Set(nodeIds);
      const sub = new IRGraph();
      for (const id of nodeIds) {
        sub.nodes.set(id, this.nodes.get(id));
        if (this.layoutKey.has(id)) sub.layoutKey.set(id, this.layoutKey.get(id));
      }
      for (const e of this.edges) {
        if (idSet.has(e.srcNodeId) && idSet.has(e.tgtNodeId)) sub.edges.push(e);
      }
      // Inherit boundary order from the parent when it covers this component
      const open = sub.openPorts();
      const strip = p => ({ nodeId: p.nodeId, portIndex: p.portIndex });
      const inh = (list, n) => {
        const f = list.filter(b => idSet.has(b.nodeId)).map(strip);
        return f.length === n ? f : null;
      };
      sub.inputBoundary = inh(this.inputBoundary, open.inputs.length) || open.inputs.map(strip);
      sub.outputBoundary = inh(this.outputBoundary, open.outputs.length) || open.outputs.map(strip);
      components.push(sub);
    }
    return components;
  }
}
