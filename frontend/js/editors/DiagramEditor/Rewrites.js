/**
 * Rewrites — PQP's diagrammatic rules, applied to a selection.
 *
 *   spider fusion        two connected spiders of one colour → one; phases add   (PQP 8.1)
 *   identity             a phase-free spider with one input and one output → a wire
 *   H–H                  two Hadamards in a row → a wire (H is self-inverse)
 *   colour change        Z(α) ↔ X(α) with H on every leg  (and back)            (PQP 9.2)
 *   π-copy               X(π) through Z(α): Z(−α) with X(π) on every other leg  (PQP 9.4)
 *   state copy           a basis state through a phase-free spider: copied      (PQP 8.4)
 *   complementarity      a Z and an X spider joined by two wires: disconnected  (PQP 9.3, Hopf)
 *
 * Every rewrite is checked with the proof checker before it is kept, so a
 * rule can only ever give an equal diagram. Scalars are exact where they can
 * be: if both sides are numbers, the factor a rule introduces is added as a
 * scalar node (the step is =); with symbols the step is ≈ (equal up to a
 * non-zero scalar), which the checker confirms the same way.
 *
 *   rulesFor(doc, ids)              → [{ id, name, ref, ctx }]   (what applies to this selection)
 *   applyRewrite(doc, rule, ctx)    → { ok, relation, scalar?, why?, nodes }   (edits doc; caller records undo)
 */
import DiagramNode, { NODE_TYPES } from './DiagramNode.js';
import DiagramWire from './DiagramWire.js';
import DiagramDocument from './DiagramDocument.js';
import Phase from '../../core/Phase.js';
import Tensor from '../../core/Tensor.js';
import C from '../../core/Complex.js';
import { checkStep, parsePhaseExpr } from '../../core/ProofCheck.js';
import { evaluateDiagram } from '../../core/ProcessDirac.js';
import { scalarLabel } from '../../core/CircuitToIR.js';

const SPIDERS = new Set(['z-spider', 'x-spider']);
const isSpider = n => SPIDERS.has(n.type.key);
const other = key => (key === 'z-spider' ? NODE_TYPES.X_SPIDER : NODE_TYPES.Z_SPIDER);

/* ---------------- Phases as labels ---------------- */

/** A phase label as { constant: Phase, symbols: {name: {num, den}} } ('' is 0). */
function phaseOf(label) {
  if (!label || !String(label).trim()) return { constant: Phase.ZERO, symbols: {} };
  const p = Phase.parse(label);
  if (p) return { constant: p, symbols: {} };
  return parsePhaseExpr(label);           // null if not a phase expression
}
const ratStr = ({ num, den }, sym) => {
  const n = Math.abs(num);
  return `${n === 1 ? '' : n}${sym}${den === 1 ? '' : '/' + den}`;
};
/** Back to a label: e.g. "α+β", "-α+π/2", "" for 0. */
function labelOf(ph) {
  const terms = [];
  for (const [sym, r] of Object.entries(ph.symbols)) if (r.num) terms.push({ neg: r.num < 0, s: ratStr(r, sym) });
  const c = ph.constant.mod2();
  if (!c.isZero()) {
    const v = c.num / c.den > 1 ? c.sub(new Phase(2)) : c;          // −π/2 rather than 3π/2
    terms.push({ neg: v.num < 0, s: new Phase(Math.abs(v.num), v.den).toString() });
  }
  return terms.map((t, i) => (t.neg ? '-' : i ? '+' : '') + t.s).join('');
}
const addRat = (a, b) => { const num = a.num * b.den + b.num * a.den, den = a.den * b.den; const g = gcd(num, den); return { num: num / g, den: den / g }; };
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; }
function addPhases(a, b) {
  const s = { ...a.symbols };
  for (const [k, r] of Object.entries(b.symbols)) { s[k] = s[k] ? addRat(s[k], r) : r; if (!s[k].num) delete s[k]; }
  return { constant: a.constant.add(b.constant), symbols: s };
}
const negPhase = p => ({ constant: p.constant.neg(), symbols: Object.fromEntries(Object.entries(p.symbols).map(([k, r]) => [k, { num: -r.num, den: r.den }])) });
const isZeroPhase = p => p && p.constant.mod2().isZero() && !Object.keys(p.symbols).length;
const isPiPhase = p => p && p.constant.mod2().isPI() && !Object.keys(p.symbols).length;

/* ---------------- Graph helpers ---------------- */

/** The wires on a node, with which port of it each is on and the node at the other end. */
function legs(doc, n) {
  const out = [];
  for (const w of doc.wires) {
    if (w.fromNodeId === n.id) out.push({ w, dir: 'out', port: w.fromPort, other: doc.nodes.get(w.toNodeId), otherDir: 'in', otherPort: w.toPort });
    if (w.toNodeId === n.id) out.push({ w, dir: 'in', port: w.toPort, other: doc.nodes.get(w.fromNodeId), otherDir: 'out', otherPort: w.fromPort });
  }
  return out;
}
const wireBetween = (doc, a, b) => doc.wires.filter(w => (w.fromNodeId === a.id && w.toNodeId === b.id) || (w.fromNodeId === b.id && w.toNodeId === a.id));
const add = (doc, type, x, y, props = {}) => { const n = new DiagramNode(type, x, y); Object.assign(n, props); doc.nodes.set(n.id, n); return n; };
const connect = (doc, from, fp, to, tp) => doc.wires.push(new DiagramWire(from.id, fp, to.id, tp));
const portPos = (n, dir, i) => (dir === 'in' ? n.getInputPort(i) : n.getOutputPort(i));
const drop = (doc, ws) => { const s = new Set(ws); doc.wires = doc.wires.filter(w => !s.has(w)); };

/**
 * Put a one-in-one-out node on a spider's leg (dir, port): between it and
 * whatever that leg is wired to, or just beyond it if the leg is open.
 */
function insertOnLeg(doc, s, dir, port, type, props) {
  const w = doc.wireOnPort(s.id, dir, port);
  const p = portPos(s, dir, port);
  let q;
  if (w) { const o = dir === 'out' ? doc.nodes.get(w.toNodeId) : doc.nodes.get(w.fromNodeId); q = portPos(o, dir === 'out' ? 'in' : 'out', dir === 'out' ? w.toPort : w.fromPort); }
  else q = { x: p.x + (p.x - s.x) * 0.6, y: p.y + (dir === 'out' ? -45 : 45) };
  const m = add(doc, type, (p.x + q.x) / 2, (p.y + q.y) / 2, props);
  if (w) drop(doc, [w]);
  if (dir === 'out') {
    connect(doc, s, port, m, 0);
    if (w) connect(doc, m, 0, doc.nodes.get(w.toNodeId), w.toPort);
  } else {
    connect(doc, m, 0, s, port);
    if (w) connect(doc, doc.nodes.get(w.fromNodeId), w.fromPort, m, 0);
  }
  return m;
}

/** Replace a one-in-one-out node by a plain wire between its neighbours (or a wire node, if a side is open). */
function bypass(doc, n) {
  const wi = doc.wireOnPort(n.id, 'in', 0), wo = doc.wireOnPort(n.id, 'out', 0);
  drop(doc, [wi, wo].filter(Boolean));
  doc.nodes.delete(n.id);
  if (wi && wo) { connect(doc, doc.nodes.get(wi.fromNodeId), wi.fromPort, doc.nodes.get(wo.toNodeId), wo.toPort); return null; }
  const id = add(doc, NODE_TYPES.IDENTITY, n.x, n.y, { thick: !!n.thick });
  if (wi) connect(doc, doc.nodes.get(wi.fromNodeId), wi.fromPort, id, 0);
  if (wo) connect(doc, id, 0, doc.nodes.get(wo.toNodeId), wo.toPort);
  return id;
}

/* ---------------- The rules ---------------- */

const RULES = [
  {
    id: 'fuse', name: 'Fuse spiders', ref: 'spider fusion (PQP 8.1)',
    match(doc, sel) {
      const pair = (a, b) => a && b && a !== b && isSpider(a) && a.type === b.type && !!a.thick === !!b.thick && wireBetween(doc, a, b).length > 0;
      if (sel.length === 2 && pair(sel[0], sel[1])) return { a: sel[0], b: sel[1] };
      if (sel.length === 1 && isSpider(sel[0])) {
        const ns = [...new Set(legs(doc, sel[0]).map(l => l.other))].filter(o => pair(sel[0], o));
        if (ns.length === 1) return { a: sel[0], b: ns[0] };
      }
      return null;
    },
    apply(doc, { a, b }) {
      const pa = phaseOf(a.label), pb = phaseOf(b.label);
      if (!pa || !pb) return { ok: false, why: 'A phase is not of the form α, 2α−π/2, …' };
      const between = new Set(wireBetween(doc, a, b));
      const s = add(doc, a.type, (a.x + b.x) / 2, (a.y + b.y) / 2, { thick: !!a.thick, label: labelOf(addPhases(pa, pb)) });
      let nin = 0, nout = 0;
      const moves = [];
      for (const n of [a, b]) for (const l of legs(doc, n)) {
        if (between.has(l.w)) continue;
        moves.push({ l, port: l.dir === 'in' ? nin++ : nout++ });
      }
      // open legs of a and b stay legs of the fused spider
      const openIn = [a, b].reduce((k, n) => k + countOpen(doc, n, 'in'), 0), openOut = [a, b].reduce((k, n) => k + countOpen(doc, n, 'out'), 0);
      s.inputs = nin + openIn; s.outputs = nout + openOut;
      drop(doc, [...between, ...moves.map(m => m.l.w)]);
      for (const { l, port } of moves) {
        if (l.dir === 'in') connect(doc, l.other, l.otherPort, s, port);
        else connect(doc, s, port, l.other, l.otherPort);
      }
      doc.nodes.delete(a.id); doc.nodes.delete(b.id);
      return { nodes: [s] };
    },
  },
  {
    id: 'identity', name: 'Remove identity', ref: 'a phase-free spider with two legs is a wire',
    match(doc, sel) {
      const n = sel.length === 1 && sel[0];
      return n && isSpider(n) && n.inputs === 1 && n.outputs === 1 && isZeroPhase(phaseOf(n.label)) ? { n } : null;
    },
    apply(doc, { n }) { const id = bypass(doc, n); return { nodes: id ? [id] : [] }; },
  },
  {
    id: 'hh', name: 'Cancel H·H', ref: 'H is self-inverse',
    match(doc, sel) {
      const isH = n => n && n.type.key === 'hadamard' && n.inputs === 1 && n.outputs === 1;
      const next = h => { const w = doc.wireOnPort(h.id, 'out', 0); return w ? doc.nodes.get(w.toNodeId) : null; };
      const prev = h => { const w = doc.wireOnPort(h.id, 'in', 0); return w ? doc.nodes.get(w.fromNodeId) : null; };
      if (sel.length === 2 && isH(sel[0]) && isH(sel[1]) && !!sel[0].thick === !!sel[1].thick) {
        if (next(sel[0]) === sel[1]) return { a: sel[0], b: sel[1] };
        if (next(sel[1]) === sel[0]) return { a: sel[1], b: sel[0] };
      }
      if (sel.length === 1 && isH(sel[0])) {
        const h = sel[0];
        if (isH(next(h)) && !!next(h).thick === !!h.thick) return { a: h, b: next(h) };
        if (isH(prev(h)) && !!prev(h).thick === !!h.thick) return { a: prev(h), b: h };
      }
      return null;
    },
    apply(doc, { a, b }) {
      const wi = doc.wireOnPort(a.id, 'in', 0), wo = doc.wireOnPort(b.id, 'out', 0), mid = doc.wireOnPort(a.id, 'out', 0);
      drop(doc, [wi, wo, mid].filter(Boolean));
      doc.nodes.delete(a.id); doc.nodes.delete(b.id);
      if (wi && wo) { connect(doc, doc.nodes.get(wi.fromNodeId), wi.fromPort, doc.nodes.get(wo.toNodeId), wo.toPort); return { nodes: [] }; }
      const id = add(doc, NODE_TYPES.IDENTITY, (a.x + b.x) / 2, (a.y + b.y) / 2, { thick: !!a.thick });
      if (wi) connect(doc, doc.nodes.get(wi.fromNodeId), wi.fromPort, id, 0);
      if (wo) connect(doc, id, 0, doc.nodes.get(wo.toNodeId), wo.toPort);
      return { nodes: [id] };
    },
  },
  {
    id: 'colour', name: 'Colour change', ref: 'colour change: Z(α) = H X(α) H on every leg (PQP 9.2)',
    match(doc, sel) {
      const n = sel.length === 1 && sel[0];
      if (!n || !isSpider(n)) return null;
      // back: every leg goes into its own H → drop them and change colour
      const ls = legs(doc, n);
      const total = n.inputs + n.outputs;
      const hs = ls.map(l => l.other).filter(o => o.type.key === 'hadamard' && o.inputs === 1 && o.outputs === 1 && !!o.thick === !!n.thick);
      const back = total > 0 && ls.length === total && hs.length === total && new Set(hs).size === total;
      return { n, back };
    },
    apply(doc, { n, back }) {
      const s = add(doc, other(n.type.key), n.x, n.y, { label: n.label, thick: !!n.thick, inputs: n.inputs, outputs: n.outputs });
      if (back) {
        // each H's far side wires straight to the new spider (same port), or the port stays open
        for (const l of legs(doc, n)) {
          const h = l.other;
          const far = l.dir === 'in' ? doc.wireOnPort(h.id, 'in', 0) : doc.wireOnPort(h.id, 'out', 0);
          drop(doc, [l.w, far].filter(Boolean));
          doc.nodes.delete(h.id);
          if (far) {
            if (l.dir === 'in') connect(doc, doc.nodes.get(far.fromNodeId), far.fromPort, s, l.port);
            else connect(doc, s, l.port, doc.nodes.get(far.toNodeId), far.toPort);
          }
        }
      } else {
        for (const l of legs(doc, n)) {
          drop(doc, [l.w]);
          if (l.dir === 'in') connect(doc, l.other, l.otherPort, s, l.port); else connect(doc, s, l.port, l.other, l.otherPort);
        }
      }
      doc.nodes.delete(n.id);
      const hs = [];
      if (!back) {
        doc.refreshLegs && doc.refreshLegs();
        for (let i = 0; i < s.inputs; i++) hs.push(insertOnLeg(doc, s, 'in', i, NODE_TYPES.HADAMARD, { thick: !!s.thick }));
        for (let i = 0; i < s.outputs; i++) hs.push(insertOnLeg(doc, s, 'out', i, NODE_TYPES.HADAMARD, { thick: !!s.thick }));
      }
      return { nodes: [s, ...hs] };
    },
  },
  {
    id: 'picopy', name: 'π-copy', ref: 'π-copy: X(π) passes through Z(α), which becomes Z(−α) (PQP 9.4)',
    match(doc, sel) {
      const isPi = (p, s) => p && isSpider(p) && p.type !== s.type && p.inputs === 1 && p.outputs === 1 && !!p.thick === !!s.thick && isPiPhase(phaseOf(p.label));
      const piOn = s => legs(doc, s).filter(l => isPi(l.other, s));
      if (sel.length === 2) for (const [s, p] of [[sel[0], sel[1]], [sel[1], sel[0]]])
        if (isSpider(s) && isPi(p, s) && wireBetween(doc, s, p).length === 1 && phaseOf(s.label)) return { s, p };
      if (sel.length === 1 && isSpider(sel[0]) && phaseOf(sel[0].label)) {
        const ps = piOn(sel[0]);
        if (ps.length === 1) return { s: sel[0], p: ps[0].other };
      }
      return null;
    },
    apply(doc, { s, p }) {
      const link = wireBetween(doc, s, p)[0];
      const sDir = link.fromNodeId === s.id ? 'out' : 'in', sPort = sDir === 'out' ? link.fromPort : link.toPort;
      // p's other leg (its far side) takes p's place on s
      const far = legs(doc, p).find(l => l.w !== link);
      drop(doc, [link, far ? far.w : null].filter(Boolean));
      doc.nodes.delete(p.id);
      // p sat on one wire: whatever was on its far side now meets s directly
      if (far) {
        if (sDir === 'in') connect(doc, far.other, far.otherPort, s, sPort);
        else connect(doc, s, sPort, far.other, far.otherPort);
      }
      s.label = labelOf(negPhase(phaseOf(s.label)));
      doc.refreshLegs && doc.refreshLegs();
      const added = [];
      const typ = p.type;
      for (let i = 0; i < s.inputs; i++) if (!(sDir === 'in' && i === sPort)) added.push(insertOnLeg(doc, s, 'in', i, typ, { label: 'π', thick: !!s.thick }));
      for (let i = 0; i < s.outputs; i++) if (!(sDir === 'out' && i === sPort)) added.push(insertOnLeg(doc, s, 'out', i, typ, { label: 'π', thick: !!s.thick }));
      return { nodes: [s, ...added] };
    },
  },
  {
    id: 'copy', name: 'Copy state', ref: 'a basis state copies through a phase-free spider (PQP 8.4)',
    match(doc, sel) {
      // k: an other-colour spider with one leg, phase 0 or π, wired to the spider s
      const basis = (k, s) => k && isSpider(k) && k.type !== s.type && k.inputs + k.outputs === 1 && !!k.thick === !!s.thick
        && (isZeroPhase(phaseOf(k.label)) || isPiPhase(phaseOf(k.label)));
      const ok = s => isSpider(s) && isZeroPhase(phaseOf(s.label));
      if (sel.length === 2) for (const [s, k] of [[sel[0], sel[1]], [sel[1], sel[0]]])
        if (ok(s) && basis(k, s) && wireBetween(doc, s, k).length === 1) return { s, k };
      if (sel.length === 1 && ok(sel[0])) {
        const ks = legs(doc, sel[0]).filter(l => basis(l.other, sel[0]));
        if (ks.length === 1) return { s: sel[0], k: ks[0].other };
      }
      return null;
    },
    apply(doc, { s, k }) {
      const link = wireBetween(doc, s, k)[0];
      const added = [];
      for (const l of legs(doc, s)) {
        if (l.w === link) continue;
        drop(doc, [l.w]);
        // the copy points the way the leg went: a state feeding what s fed, an effect taking what fed s
        const p = portPos(s, l.dir, l.port), q = portPos(l.other, l.otherDir, l.otherPort);
        const at = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const c = add(doc, k.type, at.x, at.y, { label: k.label, thick: !!k.thick, inputs: l.dir === 'out' ? 0 : 1, outputs: l.dir === 'out' ? 1 : 0 });
        if (l.dir === 'out') connect(doc, c, 0, l.other, l.otherPort); else connect(doc, l.other, l.otherPort, c, 0);
        added.push(c);
      }
      // open legs of s get a copy each, too
      for (const dir of ['in', 'out']) for (let i = 0; i < (dir === 'in' ? s.inputs : s.outputs); i++) {
        if (doc.wireOnPort(s.id, dir, i)) continue;
        const p = portPos(s, dir, i);
        added.push(add(doc, k.type, p.x, p.y + (dir === 'out' ? -30 : 30), { label: k.label, thick: !!k.thick, inputs: dir === 'out' ? 0 : 1, outputs: dir === 'out' ? 1 : 0 }));
      }
      drop(doc, [link]);
      doc.nodes.delete(s.id); doc.nodes.delete(k.id);
      return { nodes: added };
    },
  },
  {
    id: 'hopf', name: 'Disconnect (complementarity)', ref: 'complementarity: two wires between a Z and an X spider disconnect (PQP 9.3)',
    match(doc, sel) {
      if (sel.length !== 2) return null;
      const [a, b] = sel;
      if (!isSpider(a) || !isSpider(b) || a.type === b.type || !!a.thick !== !!b.thick) return null;
      return wireBetween(doc, a, b).length >= 2 ? { a, b } : null;
    },
    apply(doc, { a, b }) {
      const ws = wireBetween(doc, a, b).slice(0, 2);
      doc.removeWires(ws);                       // spider–spider wires are legs: the legs go too
      return { nodes: [a, b] };
    },
  },
];

function countOpen(doc, n, dir) {
  let k = 0;
  for (let i = 0; i < (dir === 'in' ? n.inputs : n.outputs); i++) if (!doc.wireOnPort(n.id, dir, i)) k++;
  return k;
}

/** The rules that apply to this selection (node ids), each with its match. */
export function rulesFor(doc, ids) {
  const sel = ids.map(id => doc.nodes.get(id)).filter(Boolean);
  if (!sel.length) return [];
  if (typeof doc.refreshLegs === 'function') doc.refreshLegs();
  const out = [];
  for (const r of RULES) {
    const ctx = r.match(doc, sel);
    if (ctx) out.push({ id: r.id, name: r.id === 'colour' && ctx.back ? 'Colour change (remove the H’s)' : r.name, ref: r.ref, ctx });
  }
  return out;
}

/**
 * Apply a rule (from rulesFor) to doc, keeping the result only if it checks.
 * Adds the scalar the rule introduces when both sides are numbers (so the
 * relation is =); otherwise the relation is ≈.
 * @returns {{ ok: boolean, relation?: '='|'≈', scalar?: string, why?: string, nodes?: DiagramNode[] }}
 */
export function applyRewrite(doc, rule, ctx = rule.ctx) {
  const r = RULES.find(x => x.id === rule.id);
  if (!r) return { ok: false, why: `No rule ${rule.id}` };
  const before = DiagramDocument.copyOf(doc);
  const snapshot = doc._snapshot();
  let res;
  try { res = r.apply(doc, ctx) || {}; } catch (e) { doc._restore(snapshot); return { ok: false, why: e.message }; }
  if (res.ok === false) { doc._restore(snapshot); return res; }
  // The scalar it introduces, when both sides are numeric
  let relation = '=', scalar = null;
  const tb = safeEval(before), ta = safeEval(doc);
  if (tb && ta && tb.rows === ta.rows && tb.cols === ta.cols) {
    const lam = ratio(tb, ta);
    if (lam && !C.eq(lam, C.ONE, 1e-9)) {
      const xs = res.nodes && res.nodes.length ? res.nodes : [...doc.nodes.values()];
      const cx = Math.max(...xs.map(n => n.x)) + 60, cy = xs.reduce((s, n) => s + n.y, 0) / xs.length;
      scalar = niceScalar(lam);
      add(doc, NODE_TYPES.SCALAR, cx, cy, { label: scalar, tensor: new Tensor(1, 1, [lam]) });
    }
  } else {
    // Symbols: exact if the checker says so (fusion, colour change, …), else up to a scalar
    relation = checkStep(before.toIR(), doc.toIR(), '=').status === 'ok' ? '=' : '≈';
  }
  const check = checkStep(before.toIR(), doc.toIR(), relation);
  if (check.status !== 'ok') {
    doc._restore(snapshot);
    return { ok: false, why: `This rewrite would change the diagram here (${check.hint || check.status}) — left as it was` };
  }
  return { ok: true, relation, scalar, nodes: res.nodes || [] };
}

/** A scalar's label: 1/2, √2, -i, e^(iπ/4), √2·e^(iπ/4), … */
function niceScalar(z) {
  const mag = C.abs(z), arg = C.arg(z) / Math.PI;
  const m = scalarLabel([mag, 0]);
  for (const den of [1, 2, 4, 8]) {
    const num = Math.round(arg * den);
    if (Math.abs(arg * den - num) > 1e-9) continue;
    const ph = new Phase(num, den).mod2();
    if (ph.isZero()) return m;
    if (ph.isPI()) return m === '1' ? '-1' : '-' + m;
    if (ph.equals(new Phase(1, 2))) return m === '1' ? 'i' : 'i' + m;
    if (ph.equals(new Phase(3, 2))) return m === '1' ? '-i' : '-i' + m;
    const e = `e^(i${ph.num / ph.den > 1 ? ph.sub(new Phase(2)).toString() : ph.toString()})`;
    return m === '1' ? e : `${m}·${e}`;
  }
  return scalarLabel(z);
}

function safeEval(doc) {
  try { const ir = doc.toIR(); if (!ir.isValid) return null; return evaluateDiagram(ir).tensor; } catch { return null; }
}
/** λ with before = λ · after (null if not a multiple). */
function ratio(B, A) {
  let k = -1, best = 0;
  for (let i = 0; i < A.d.length; i++) { const m = C.abs(A.d[i]); if (m > best) { best = m; k = i; } }
  if (k < 0 || best < 1e-12) return null;
  const lam = C.div(B.d[k], A.d[k]);
  for (let i = 0; i < A.d.length; i++) if (!C.eq(B.d[i], C.mul(lam, A.d[i]), 1e-8)) return null;
  return lam;
}

export const REWRITE_RULES = RULES.map(r => ({ id: r.id, name: r.name, ref: r.ref }));
