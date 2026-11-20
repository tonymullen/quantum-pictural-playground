/**
 * PullTaut — pull a diagram's wires taut (PQP §4.1–4.3: wires are string,
 * only connectivity matters).
 *
 * Cups, caps, swaps and plain-wire nodes are pure wiring. Following a wire
 * through them from one real end to the other gives a *strand*; strands
 * joined through one-input-one-output processes (the *beads* riding the
 * string) make a *string*. Pulled taut, a string keeps only the bends its
 * ends force:
 *
 *   an output (below) to an input (above)    no bend — a straight wire
 *   two outputs, or two diagram inputs       one cap ∩
 *   two inputs, or two diagram outputs       one cup ∪
 *
 * Snakes vanish (the yanking equations), crossings go (wires just cross), and
 * each bead stays in its place along the string. A bead that ends up on a leg
 * running the other way has gone round a bend, so it comes out transposed —
 * rotated 180°, as PQP draws fᵀ (Prop. 4.30). Where the one remaining bend
 * goes is chosen so that as few beads as possible change.
 *
 * Only what rides on a changed string moves: its beads slide into place
 * between the string's ends, which stay put (a process with several wires is
 * an end, and is only nudged up or down if a wire would otherwise run
 * backwards in time). Closed loops (traces) are left as they are.
 *
 *   planPullTaut(doc)        → { changed, strings }        (what would change; no edit)
 *   pullTaut(doc, {align})   → { changed, beadsTransposed, removed, ... }  (edits doc)
 *   pullTautChecked(doc)     → the same, or { ok: false, why } — the result is checked
 *                              equal to the original with the proof checker first
 *
 * align (default true): a string's open ends (diagram inputs/outputs) line up
 * with it, so it comes out straight. That can move a diagram input or output
 * past another and so change the map; pullTautChecked then falls back to
 * leaving the open ends exactly where they were.
 */
import DiagramNode, { NODE_TYPES } from './DiagramNode.js';
import DiagramWire from './DiagramWire.js';
import DiagramDocument from './DiagramDocument.js';
import { checkStep } from '../../core/ProofCheck.js';

const WIRING = new Set(['cup', 'cap', 'swap', 'identity']);
const BENDS = new Set(['cup', 'cap']);
const STEP = 70;          // vertical room per bead along a string
const MIN_GAP = 40;       // a straight wire needs its top this far above its bottom

const pk = (id, dir, port) => `${id}:${dir}:${port}`;

/** The port of a wiring node that a wire entering at (dir, port) leaves by. */
function partner(node, dir, port) {
  switch (node.type.key) {
    case 'identity': return { dir: dir === 'in' ? 'out' : 'in', port: 0 };
    case 'cup': return { dir: 'out', port: 1 - port };
    case 'cap': return { dir: 'in', port: 1 - port };
    case 'swap': return { dir: dir === 'in' ? 'out' : 'in', port: 1 - port };
    default: return null;
  }
}

const isWiring = n => WIRING.has(n.type.key);
/** A bead: one input and one output, both wired (an open one makes it an end). */
const isBead = (doc, n) => !isWiring(n) && n.inputs === 1 && n.outputs === 1
  && !!doc.wireOnPort(n.id, 'in', 0) && !!doc.wireOnPort(n.id, 'out', 0);

/**
 * Follow a wire from a real port (or an open port of a wiring node) through
 * the wiring to its other end.
 * @returns {{ a, b, wiring: Set<string>, wires: DiagramWire[] }}  ends are
 *   { nodeId, dir, port, open } — open: an unwired port of a wiring node (a diagram boundary)
 */
function strandFrom(doc, start) {
  const wiring = new Set(), wires = [];
  const startNode = doc.nodes.get(start.nodeId);
  if (isWiring(startNode)) start = { ...start, open: true };   // a diagram boundary
  let cur = start;
  if (isWiring(startNode)) {               // an open wiring port: go through its node
    wiring.add(startNode.id);
    cur = { nodeId: startNode.id, ...partner(startNode, start.dir, start.port) };
  }
  for (let guard = 0; guard < 10000; guard++) {
    const w = doc.wireOnPort(cur.nodeId, cur.dir, cur.port);
    if (!w) {
      if (cur === start) return { a: start, b: start, wiring, wires };
      return { a: start, b: { ...cur, open: true }, wiring, wires };
    }
    wires.push(w);
    const other = cur.dir === 'out'
      ? { nodeId: w.toNodeId, dir: 'in', port: w.toPort }
      : { nodeId: w.fromNodeId, dir: 'out', port: w.fromPort };
    const on = doc.nodes.get(other.nodeId);
    if (!isWiring(on)) return { a: start, b: other, wiring, wires };
    if (wiring.has(on.id) && on.type.key !== 'swap') return null;        // a closed loop of wiring
    wiring.add(on.id);
    cur = { nodeId: on.id, ...partner(on, other.dir, other.port) };
  }
  return null;
}

/** All strands, each found once. */
function strands(doc) {
  const seen = new Set(), out = [];
  for (const n of doc.nodes.values())
    for (const dir of ['in', 'out'])
      for (let i = 0; i < (dir === 'in' ? n.inputs : n.outputs); i++) {
        const start = { nodeId: n.id, dir, port: i };
        if (isWiring(n) && doc.wireOnPort(n.id, dir, i)) continue;      // only open wiring ports start strands
        if (seen.has(pk(n.id, dir, i))) continue;
        const s = strandFrom(doc, start);
        if (!s) continue;
        seen.add(pk(s.a.nodeId, s.a.dir, s.a.port)); seen.add(pk(s.b.nodeId, s.b.dir, s.b.port));
        out.push(s);
      }
  return out;
}

/** Which way an end points: a real output or a diagram input is a bottom end; the rest are top ends. */
const endKind = e => (e.open ? (e.dir === 'in' ? 'bottom' : 'top') : (e.dir === 'out' ? 'bottom' : 'top'));

/**
 * Chain strands through beads into strings.
 * @returns {{ ends: [end, end], beads: { node, entered: 'in'|'out' }[], strands }[]}
 */
function strings(doc) {
  const all = strands(doc);
  const byEnd = new Map();
  for (const s of all) { byEnd.set(pk(s.a.nodeId, s.a.dir, s.a.port), s); byEnd.set(pk(s.b.nodeId, s.b.dir, s.b.port), s); }
  const used = new Set(), out = [];
  const otherEnd = (s, e) => (s.a.nodeId === e.nodeId && s.a.dir === e.dir && s.a.port === e.port ? s.b : s.a);
  const beadEnd = e => !e.open && isBead(doc, doc.nodes.get(e.nodeId));
  for (const s of all) {
    if (used.has(s)) continue;
    // Start from an end that is not a bead (strings through beads only would be loops)
    const startEnd = !beadEnd(s.a) ? s.a : !beadEnd(s.b) ? s.b : null;
    if (!startEnd) continue;
    const ends = [startEnd], beads = [], ss = [], rev = [];
    let cur = s, from = startEnd, ok = true;
    for (let guard = 0; guard < 10000; guard++) {
      if (used.has(cur)) { ok = false; break; }
      used.add(cur); ss.push(cur);
      rev.push(!(cur.a.nodeId === from.nodeId && cur.a.dir === from.dir && cur.a.port === from.port));   // walked b → a
      const to = otherEnd(cur, from);
      if (!beadEnd(to)) { ends.push(to); break; }
      const bead = doc.nodes.get(to.nodeId);
      beads.push({ node: bead, entered: to.dir });
      const exit = { nodeId: bead.id, dir: to.dir === 'in' ? 'out' : 'in', port: 0 };
      cur = byEnd.get(pk(exit.nodeId, exit.dir, exit.port));
      from = exit;
      if (!cur) { ok = false; break; }
    }
    if (ok && ends.length === 2) out.push({ ends, beads, strands: ss, reversed: rev });
  }
  return out;
}

/** A string's slack: bends beyond the ones its ends force, or any crossing. */
function slack(str, doc) {
  let bends = 0, crossings = 0, wires = 0;
  for (const s of str.strands)
    for (const id of s.wiring) {
      const k = doc.nodes.get(id).type.key;
      if (BENDS.has(k)) bends++; else if (k === 'swap') crossings++; else wires++;
    }
  const [k0, k1] = str.ends.map(endKind);
  const needed = k0 === k1 ? 1 : 0;
  return { bends, crossings, wires, needed, slack: bends - needed + crossings };
}

/**
 * What pulling taut would change (no edit).
 * @returns {{ changed: boolean, strings: object[] }}
 */
export function planPullTaut(doc) {
  if (typeof doc.refreshLegs === 'function') doc.refreshLegs();
  const all = strings(doc);
  const touches = new Map();          // wiring node id → strings through it (swaps carry two)
  all.forEach((st, k) => { for (const s of st.strands) for (const id of s.wiring) {
    if (!touches.has(id)) touches.set(id, new Set()); touches.get(id).add(k);
  } });
  const change = new Set(all.map((st, k) => (slack(st, doc).slack > 0 ? k : -1)).filter(k => k >= 0));
  // A crossing shared with a changed string goes too, so its other string is rebuilt as well
  for (let grew = true; grew;) {
    grew = false;
    for (const k of [...change]) for (const s of all[k].strands) for (const id of s.wiring)
      for (const j of touches.get(id)) if (!change.has(j)) { change.add(j); grew = true; }
  }
  const strs = [...change].map(k => all[k]);
  return { changed: strs.length > 0, strings: strs };
}

/** Transpose a one-input-one-output bead (spiders, H and dots are their own transpose). */
function transposeBead(n) {
  if (n.isOrientable && n.isOrientable()) n.flip = { v: !n.flip.v, h: !n.flip.h };
  if (n.legThick && (n.legThick.in.length || n.legThick.out.length)) n.legThick = { in: [...n.legThick.out], out: [...n.legThick.in] };
}

/**
 * Pull the diagram taut, in place. The caller records the undo step and
 * should check the result (pullTautChecked does both checks for you).
 * @returns {{ changed: boolean, strings: number, removed: number, beadsTransposed: number, nudged: number }}
 */
export function pullTaut(doc, { align = true } = {}) {
  const plan = planPullTaut(doc);
  const report = { changed: plan.changed, strings: plan.strings.length, removed: 0, beadsTransposed: 0, nudged: 0 };
  if (!plan.changed) return report;
  const pos = e => {
    const n = doc.nodes.get(e.nodeId);
    return e.dir === 'in' ? n.getInputPort(e.port) : n.getOutputPort(e.port);
  };
  // Remember where every end and thickness is before anything is removed
  const work = plan.strings.map(st => ({
    ...st,
    endPos: st.ends.map(pos),
    endThick: st.ends.map(e => doc.nodes.get(e.nodeId).portIsThick(e.dir, e.port)),
  }));
  // Remove the wiring and the wires of every changed string
  const gone = new Set(), dropWires = new Set();
  for (const st of work) for (const s of st.strands) { for (const id of s.wiring) gone.add(id); for (const w of s.wires) dropWires.add(w); }
  doc.wires = doc.wires.filter(w => !dropWires.has(w));
  for (const id of gone) doc.nodes.delete(id);
  report.removed = gone.size;

  const add = (type, x, y, thick) => {
    const n = new DiagramNode(type, x, y);
    n.thick = !!thick;
    doc.nodes.set(n.id, n);
    return n;
  };
  const wire = (from, fp, to, tp) => doc.wires.push(new DiagramWire(from.id, fp, to.id, tp));
  /** A real end, or a stub (a short plain wire) standing where an open boundary end was. */
  const realize = (st, k) => {
    const e = st.ends[k], p = st.endPos[k];
    if (!e.open) return { node: doc.nodes.get(e.nodeId), port: e.port, kind: endKind(e) };
    const stub = add(NODE_TYPES.IDENTITY, p.x, p.y, st.endThick[k]);
    const off = e.dir === 'in' ? stub.getInputPort(0) : stub.getOutputPort(0);
    stub.x += p.x - off.x; stub.y += p.y - off.y;            // its open port where the old one was
    return { node: stub, port: 0, kind: endKind(e), stub: true };
  };

  for (const st of work) {
    let A = realize(st, 0), B = realize(st, 1);
    const n = st.beads.length;
    if (align && A.kind !== B.kind) {
      // Straight strings: open ends line up with the string, so it is vertical
      const xOf = e => portOf(e).x;
      const shift = (e, x) => { e.node.x += x - xOf(e); };
      if (A.stub && B.stub && n === 0) {
        // a bare wire from a diagram input to a diagram output: one plain wire
        const lo = A.kind === 'bottom' ? A : B, hi = lo === A ? B : A;
        const x = (xOf(lo) + xOf(hi)) / 2, y = (portOf(lo).y + portOf(hi).y) / 2;
        doc.nodes.delete(lo.node.id); doc.nodes.delete(hi.node.id);
        add(NODE_TYPES.IDENTITY, x, y, st.endThick[0]);
        continue;
      }
      // An end may slide sideways if it only rides the string: a stub, or a
      // one-in-one-out process whose other side is a diagram input/output
      const movable = e => e.stub || (e.node.inputs === 1 && e.node.outputs === 1 && !isWiring(e.node)
        && !(e.kind === 'bottom' ? doc.wireOnPort(e.node.id, 'in', 0) : doc.wireOnPort(e.node.id, 'out', 0)));
      const mA = movable(A), mB = movable(B);
      if (mA && !mB) shift(A, xOf(B));
      else if (mB && !mA) shift(B, xOf(A));
      else if (mA && mB) { const x = (xOf(A) + xOf(B)) / 2; shift(A, x); shift(B, x); }
    }
    const fwd = st.beads.map(b => b.entered === 'in');       // entered at its input, going from end A
    const kinds = [A.kind, B.kind];
    // Legs: each a list of beads, laid out upward from a bottom end (or downward to a top end)
    if (kinds[0] !== kinds[1]) {
      // ---- bottom → top: one straight wire, every bead upright going up ----
      const [lo, hi, order] = kinds[0] === 'bottom' ? [A, B, st.beads.map((b, i) => i)] : [B, A, st.beads.map((b, i) => n - 1 - i)];
      const up = kinds[0] === 'bottom';
      const beadsUp = order.map(i => ({ node: st.beads[i].node, flip: (up ? fwd[i] : !fwd[i]) ? false : true }));
      report.nudged += layoutStraight(doc, lo, hi, beadsUp);
      chain(lo, beadsUp, hi, wire, report);
    } else {
      // ---- two bottoms (a cap ∩ on top) or two tops (a cup ∪ below) ----
      const top = kinds[0] === 'bottom';      // the bend is a cap above
      // Beads [0, k) on A's leg, [k, n) on B's leg. Going from A: on A's leg a
      // bead should be entered at its input if A is a bottom end; past the bend, the reverse.
      const wantA = i => (top ? fwd[i] : !fwd[i]);
      let best = 0, bestScore = -1;
      for (let k = 0; k <= n; k++) {
        let score = 0;
        for (let i = 0; i < n; i++) score += (i < k ? wantA(i) : !wantA(i)) ? 1 : 0;
        if (score > bestScore) { bestScore = score; best = k; }
      }
      const legA = st.beads.slice(0, best).map((b, i) => ({ node: b.node, flip: !wantA(i) }));
      const legB = st.beads.slice(best).map((b, j) => ({ node: b.node, flip: wantA(best + j) })).reverse();   // listed from B outward
      report.nudged += layoutBend(doc, A, B, legA, legB, top, st, add, wire, report);
    }
  }
  doc.fitBends();          // each new cup/cap as wide as its legs are apart
  return report;
}

/** Wire end → beads → end, transposing the beads that need it. */
function chain(lo, beads, hi, wire, report) {
  let prev = { node: lo.node, port: lo.port };
  for (const b of beads) {
    if (b.flip) { transposeBead(b.node); report.beadsTransposed++; }
    wire(prev.node, prev.port, b.node, 0);
    prev = { node: b.node, port: 0 };
  }
  wire(prev.node, prev.port, hi.node, hi.port);
}

/** Place beads evenly on the straight wire from a bottom end to a top end; nudge the top end up if needed. */
function layoutStraight(doc, lo, hi, beads) {
  const pLo = portOf(lo), pHi0 = portOf(hi);
  const need = (beads.length + 1) * (beads.length ? STEP : MIN_GAP);
  let nudged = 0;
  if (pLo.y - pHi0.y < need) {                     // the top end must be higher (time flows up)
    hi.node.y -= need - (pLo.y - pHi0.y);
    nudged = 1;
  }
  const pHi = portOf(hi);
  beads.forEach((b, i) => {
    const t = (i + 1) / (beads.length + 1);
    b.node.x = pLo.x + (pHi.x - pLo.x) * t;
    b.node.y = pLo.y + (pHi.y - pLo.y) * t;
  });
  return nudged;
}

/** Two ends of one kind: legs up to a cap (or down to a cup) between them. */
function layoutBend(doc, A, B, legA, legB, cap, st, add, wire, report) {
  const pA = portOf(A), pB = portOf(B);
  const depth = (Math.max(legA.length, legB.length) + 1) * STEP;
  const yBend = cap ? Math.min(pA.y, pB.y) - depth : Math.max(pA.y, pB.y) + depth;
  const thickAt = st.endThick[0];
  const bend = add(cap ? NODE_TYPES.CAP : NODE_TYPES.CUP, (pA.x + pB.x) / 2, yBend, thickAt);
  // The bend's left port takes the leg on the left
  const aLeft = pA.x <= pB.x;
  const portA = aLeft ? 0 : 1, portB = 1 - portA;
  const bp = i => (cap ? bend.getInputPort(i) : bend.getOutputPort(i));
  const place = (leg, from, to) => leg.forEach((b, i) => {
    const t = (i + 1) / (leg.length + 1);
    b.node.x = from.x + (to.x - from.x) * t; b.node.y = from.y + (to.y - from.y) * t;
  });
  place(legA, pA, bp(portA)); place(legB, pB, bp(portB));
  const flipAll = leg => leg.forEach(b => { if (b.flip) { transposeBead(b.node); report.beadsTransposed++; } });
  flipAll(legA); flipAll(legB);
  if (cap) {
    // bottom ends: A → legA (upward) → cap.portA ; B → legB → cap.portB
    const up = (end, leg, port) => {
      let prev = { node: end.node, port: end.port };
      for (const b of leg) { wire(prev.node, prev.port, b.node, 0); prev = { node: b.node, port: 0 }; }
      wire(prev.node, prev.port, bend, port);
    };
    up(A, legA, portA); up(B, legB, portB);
  } else {
    // top ends: cup.portA → legA (upward, listed from A down, so reversed) → A
    const down = (end, leg, port) => {
      let prev = { node: bend, port };
      for (const b of [...leg].reverse()) { wire(prev.node, prev.port, b.node, 0); prev = { node: b.node, port: 0 }; }
      wire(prev.node, prev.port, end.node, end.port);
    };
    down(A, legA, portA); down(B, legB, portB);
  }
  return 0;
}

function portOf(end) {
  return end.kind === 'bottom' && !end.stub ? end.node.getOutputPort(end.port)
    : end.kind === 'top' && !end.stub ? end.node.getInputPort(end.port)
      : end.kind === 'bottom' ? end.node.getOutputPort(0) : end.node.getInputPort(0);
}

/**
 * Pull taut, keeping the result only if the proof checker confirms it equals
 * the original (aligned first; if aligning the open ends changed the map,
 * again without aligning). The caller records the undo step beforehand.
 * @returns {{ ok: boolean, why?: string, aligned?: boolean } & ReturnType<typeof pullTaut>}
 */
export function pullTautChecked(doc) {
  const plan = planPullTaut(doc);
  if (!plan.changed) return { ok: false, changed: false, why: 'Already taut — nothing to straighten' };
  const before = DiagramDocument.copyOf(doc);
  const snapshot = doc._snapshot();
  let lastWhy = '';
  for (const align of [true, false]) {
    const report = pullTaut(doc, { align });
    const r = checkStep(before.toIR(), doc.toIR(), '=');
    if (r.status === 'ok') return { ok: true, aligned: align, ...report };
    lastWhy = r.hint || r.status;
    doc._restore(snapshot);
  }
  return { ok: false, changed: true, why: `Pulling taut would change the diagram (${lastWhy}) — left as it was` };
}

/* ---------------- Geometry of strings (for the animation) ---------------- */

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const bez = ([p1, c1, c2, p2], t) => {
  const u = 1 - t;
  return { x: u ** 3 * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * p2.x,
           y: u ** 3 * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * p2.y };
};

/** Points through a wiring node from the port a wire arrives at to the port the next leaves by. */
function throughWiring(node, a, b) {
  const k = node.type.key;
  if (k === 'cup' || k === 'cap') {
    // the bend exactly as it is drawn (DiagramNode._drawCup/_drawCap): a cubic from port to port
    const cy = node.bendControlY();
    const c = [a, { x: a.x, y: cy }, { x: b.x, y: cy }, b];
    const pts = [];
    for (let i = 1; i < 12; i++) pts.push(bez(c, i / 12));
    return pts;
  }
  return [];   // identity, swap: straight through
}

/**
 * Each string of doc as a path: points from end A to end B through its
 * wires (their drawn curves), its wiring nodes (bends as arcs) and its beads,
 * with each bead's place along it.
 * @returns {{ key: string, points: {x,y}[], beads: { id, at: number }[], thick: boolean, wiring: string[], wires: object[] }[]}
 *   at: the bead's index into points
 */
export function stringPaths(doc) {
  if (typeof doc.refreshLegs === 'function') doc.refreshLegs();
  const out = [];
  for (const st of strings(doc)) {
    const pts = [], beads = [], wiring = [], wires = [];
    const portPt = (id, dir, port) => { const n = doc.nodes.get(id); return dir === 'in' ? n.getInputPort(port) : n.getOutputPort(port); };
    const e0 = st.ends[0], e1 = st.ends[1];
    pts.push(portPt(e0.nodeId, e0.dir, e0.port));
    // An open end on a wiring node (a diagram input/output on a cup, cap or plain wire):
    // the string starts by running through that node
    if (e0.open) {
      const W = doc.nodes.get(e0.nodeId), p = partner(W, e0.dir, e0.port), pp = portPt(W.id, p.dir, p.port);
      pts.push(...throughWiring(W, pts[0], pp), pp);
      wiring.push(W.id);
    }
    st.strands.forEach((s, i) => {
      if (i > 0) {                                   // passing through bead i-1
        const b = st.beads[i - 1];
        beads.push({ id: b.node.id, at: pts.length });
        pts.push({ x: b.node.x, y: b.node.y });
        const exit = b.entered === 'in' ? b.node.getOutputPort(0) : b.node.getInputPort(0);
        pts.push(exit);
      }
      const ws = st.reversed[i] ? [...s.wires].reverse() : s.wires;
      ws.forEach((w, j) => {
        wires.push(w);
        const c = w.curve(doc.nodes);
        if (!c) return;
        // walk the wire's curve from whichever end the path has reached
        const forward = dist(c[0], pts[pts.length - 1]) <= dist(c[3], pts[pts.length - 1]);
        for (let k = 1; k <= 12; k++) pts.push(bez(c, forward ? k / 12 : 1 - k / 12));
        // then through the wiring node at the far end (if the next wire continues from it)
        const next = ws[j + 1];
        if (next) {
          const farId = forward ? w.toNodeId : w.fromNodeId;
          const far = doc.nodes.get(farId);
          wiring.push(farId);
          const nc = next.curve(doc.nodes);
          const nStart = nc && (dist(nc[0], pts[pts.length - 1]) < dist(nc[3], pts[pts.length - 1]) ? nc[0] : nc[3]);
          if (nStart) pts.push(...throughWiring(far, pts[pts.length - 1], nStart));
        }
      });
    });
    // …and ends by running through the wiring node of an open far end
    if (e1.open && !(e1.nodeId === e0.nodeId && st.strands.every(s => !s.wires.length))) {
      const W = doc.nodes.get(e1.nodeId), end = portPt(e1.nodeId, e1.dir, e1.port);
      pts.push(...throughWiring(W, pts[pts.length - 1], end), end);
      if (!wiring.includes(W.id)) wiring.push(W.id);
    }
    const thick = (() => { const n = doc.nodes.get(e0.nodeId); return n.portIsThick(e0.dir, e0.port); })();
    const key = [st.ends.map(e => (e.open ? '' : e.nodeId)).join('|'), st.beads.map(b => b.node.id).join(',')].join('#');
    out.push({ key, points: pts, beads, thick, wiring, wires, ends: st.ends });
  }
  return out;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Resample a polyline to n points evenly spaced along its length. */
export function resample(points, n) {
  const L = [0];
  for (let i = 1; i < points.length; i++) L.push(L[i - 1] + dist(points[i], points[i - 1]));
  const total = L[L.length - 1] || 1, out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const s = total * k / (n - 1);
    while (j < L.length - 2 && L[j + 1] < s) j++;
    const seg = L[j + 1] - L[j] || 1;
    out.push(lerp(points[j], points[j + 1] || points[j], (s - L[j]) / seg));
  }
  return { points: out, length: total, frac: i => (L[Math.min(i, L.length - 1)] / total) };
}
