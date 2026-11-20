/**
 * Fragment — copy, paste and replace pieces of diagrams.
 *
 * A fragment is some nodes and the wires between them. Every other port of
 * those nodes is one of the fragment's open legs: its inputs and outputs,
 * read left to right (the planar order used everywhere else, DiagramToIR).
 * So a fragment is itself a small open diagram with k inputs and m outputs.
 *
 *   copyFragment(doc, ids)          → fragment (plain data, no ids shared with doc)
 *   pasteFragment(doc, frag, x, y)  → the new nodes, centred on (x, y)
 *   regionBoundary(doc, ids)        → the legs of a region of doc, with the outside wire on each
 *   replaceRegion(doc, ids, frag)   → rewrite: the region becomes the fragment, reconnected in order
 *
 * There is one clipboard for the whole app (copy in one panel, paste in another).
 */
import DiagramDocument from './DiagramDocument.js';
import DiagramWire from './DiagramWire.js';

let _clipboard = null;
export const Clipboard = {
  get() { return _clipboard; },
  set(frag) { _clipboard = frag; },
  clear() { _clipboard = null; },
};

/** Spiders: legs interchangeable, so a lone spider can take any leg counts. */
const RESIZABLE = new Set(['z-spider', 'x-spider', 'dot']);

const portPos = (n, dir, i) => (dir === 'in' ? n.getInputPort(i) : n.getOutputPort(i));
const planar = (a, b) => (a.x - b.x) || (a.y - b.y) || (a.order - b.order) || (a.port - b.port);

/**
 * The open legs of a set of nodes in doc: every port not wired to another
 * node of the set, sorted left to right. Each leg carries the outside wire
 * on it (or null if the port is open in doc too).
 * @returns {{ in: Leg[], out: Leg[] }}  Leg = { nodeId, dir, port, thick, wire, x, y }
 */
export function regionBoundary(doc, ids) {
  const set = ids instanceof Set ? ids : new Set(ids);
  if (typeof doc.refreshLegs === 'function') doc.refreshLegs();
  const order = new Map([...doc.nodes.keys()].map((id, i) => [id, i]));
  const legs = { in: [], out: [] };
  for (const id of set) {
    const n = doc.nodes.get(id);
    if (!n) continue;
    for (const dir of ['in', 'out']) {
      for (let i = 0; i < (dir === 'in' ? n.inputs : n.outputs); i++) {
        const wire = doc.wireOnPort(id, dir, i);
        const other = wire && (dir === 'in' ? wire.fromNodeId : wire.toNodeId);
        if (wire && set.has(other)) continue;            // internal
        const p = portPos(n, dir, i);
        legs[dir].push({ nodeId: id, dir, port: i, thick: n.portIsThick(dir, i), wire: wire || null,
          x: p.x, y: p.y, order: order.get(id) });
      }
    }
  }
  legs.in.sort(planar); legs.out.sort(planar);
  return legs;
}

/** A fragment from the given nodes of doc (null if none). */
export function copyFragment(doc, ids) {
  const set = new Set([...ids].filter(id => doc.nodes.has(id)));
  if (!set.size) return null;
  const legs = regionBoundary(doc, set);
  const data = doc.toJSON();
  const nodes = data.nodes.filter(n => set.has(n.id));
  const wires = data.wires.filter(w => set.has(w.fromNodeId) && set.has(w.toNodeId));
  // Positions relative to the fragment's centre
  const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
  const cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
  for (const n of nodes) { n.x -= cx; n.y -= cy; }
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const leg = l => ({ node: index.get(l.nodeId), port: l.port, thick: l.thick });
  return { nodes, wires, inputs: legs.in.map(leg), outputs: legs.out.map(leg) };
}

/** "2 inputs, 1 output" */
export function describeLegs(k, m) {
  const p = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return `${p(k, 'input')}, ${p(m, 'output')}`;
}

/**
 * Add a copy of the fragment to doc, centred on (x, y). Nodes get fresh ids.
 * Not undoable by itself (the caller records the undo step).
 * @returns {import('./DiagramNode.js').default[]} the new nodes, in fragment order
 */
export function pasteFragment(doc, frag, x = 0, y = 0) {
  const tmp = DiagramDocument.fromJSON({ nodes: frag.nodes, wires: frag.wires });
  const added = [...tmp.nodes.values()];        // fromJSON keeps the order of frag.nodes
  for (const n of added) { n.x += x; n.y += y; n.selected = false; doc.nodes.set(n.id, n); }
  doc.wires.push(...tmp.wires);
  return added;
}

/**
 * Can the fragment replace this region? Same number of inputs and outputs,
 * and the same thickness leg by leg — except that a lone spider takes any
 * leg counts (its legs are interchangeable).
 * @returns {{ ok: boolean, why?: string, resize?: boolean }}
 */
export function fits(doc, ids, frag) {
  const legs = regionBoundary(doc, ids);
  const lone = frag.nodes.length === 1 && frag.wires.length === 0 && RESIZABLE.has(frag.nodes[0].typeKey);
  if (lone) {
    const t = frag.nodes[0];
    const thickOK = t.typeKey === 'dot' || [...legs.in, ...legs.out].every(l => l.thick === !!t.thick);
    return thickOK ? { ok: true, resize: true }
      : { ok: false, why: 'The spider and the selection have different wire types (thick/thin)' };
  }
  if (legs.in.length !== frag.inputs.length || legs.out.length !== frag.outputs.length) {
    return { ok: false, why: `The selection has ${describeLegs(legs.in.length, legs.out.length)}; `
      + `the copied piece has ${describeLegs(frag.inputs.length, frag.outputs.length)}` };
  }
  const bad = ['in', 'out'].some(dir => legs[dir].some((l, i) => l.thick !== (dir === 'in' ? frag.inputs : frag.outputs)[i].thick));
  if (bad) return { ok: false, why: 'Thick and thin legs of the selection and the copied piece don’t line up' };
  return { ok: true };
}

/**
 * Replace a region of doc by the fragment: the region's nodes go, the
 * fragment goes where they were, and each outside wire is reconnected to the
 * fragment's leg in the same position (left to right). The caller checks
 * fits() first and records the undo step.
 * @returns {import('./DiagramNode.js').default[]} the new nodes
 */
export function replaceRegion(doc, ids, frag) {
  const set = new Set(ids);
  const legs = regionBoundary(doc, set);
  const region = [...set].map(id => doc.nodes.get(id)).filter(Boolean);
  const cx = region.reduce((s, n) => s + n.x, 0) / region.length;
  const cy = region.reduce((s, n) => s + n.y, 0) / region.length;

  // Remove the region (outside spiders keep their legs: they are re-wired below)
  doc.wires = doc.wires.filter(w => !set.has(w.fromNodeId) && !set.has(w.toNodeId));
  for (const id of set) doc.nodes.delete(id);

  const added = pasteFragment(doc, frag, cx, cy);
  let ins = frag.inputs.map(l => ({ node: added[l.node], port: l.port }));
  let outs = frag.outputs.map(l => ({ node: added[l.node], port: l.port }));
  const lone = frag.nodes.length === 1 && frag.wires.length === 0 && RESIZABLE.has(frag.nodes[0].typeKey);
  if (lone && (ins.length !== legs.in.length || outs.length !== legs.out.length)) {
    const s = added[0];
    s.inputs = legs.in.length; s.outputs = legs.out.length;
    if (s.type.key === 'dot') s.legThick = { in: legs.in.map(l => l.thick), out: legs.out.map(l => l.thick) };
    ins = legs.in.map((_, i) => ({ node: s, port: i }));
    outs = legs.out.map((_, i) => ({ node: s, port: i }));
  }
  const connect = (fromId, fromPort, toId, toPort) => doc.wires.push(new DiagramWire(fromId, fromPort, toId, toPort));
  legs.in.forEach((l, i) => { if (l.wire) connect(l.wire.fromNodeId, l.wire.fromPort, ins[i].node.id, ins[i].port); });
  legs.out.forEach((l, i) => { if (l.wire) connect(outs[i].node.id, outs[i].port, l.wire.toNodeId, l.wire.toPort); });
  return added;
}

/**
 * Free ports of the moving nodes that lie close to a free port of a
 * stationary node they can join (output ↔ input, same thickness).
 * @param {number} radius — world distance
 * @returns {{ from: {nodeId, port}, to: {nodeId, port} }[]}  one per port, nearest first
 */
export function plugCandidates(doc, movingIds, radius) {
  const moving = movingIds instanceof Set ? movingIds : new Set(movingIds);
  if (typeof doc.refreshLegs === 'function') doc.refreshLegs();
  const free = [];
  for (const n of doc.nodes.values())
    for (const dir of ['in', 'out'])
      for (let i = 0; i < (dir === 'in' ? n.inputs : n.outputs); i++)
        if (!doc.wireOnPort(n.id, dir, i)) free.push({ n, dir, port: i, p: portPos(n, dir, i), thick: n.portIsThick(dir, i) });
  const pairs = [];
  for (const a of free) {
    if (!moving.has(a.n.id)) continue;
    for (const b of free) {
      if (moving.has(b.n.id) || a.dir === b.dir || a.thick !== b.thick) continue;
      const d = Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y);
      if (d <= radius) pairs.push({ a, b, d });
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  const used = new Set(), out = [];
  const key = q => `${q.n.id}:${q.dir}:${q.port}`;
  for (const { a, b } of pairs) {
    if (used.has(key(a)) || used.has(key(b))) continue;
    used.add(key(a)); used.add(key(b));
    const [o, i] = a.dir === 'out' ? [a, b] : [b, a];
    out.push({ from: { nodeId: o.n.id, port: o.port }, to: { nodeId: i.n.id, port: i.port }, ax: a.p.x, ay: a.p.y, bx: b.p.x, by: b.p.y });
  }
  return out;
}
