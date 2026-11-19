#!/usr/bin/env node
/**
 * build-demos — regenerate the Demo workbooks in demos/ from code.
 *
 *   node tools/build-demos.mjs
 *
 * Each demo is built with the same document model the app uses, every proof
 * in it must check (the build fails otherwise), and it is written as
 * workbook JSON (js/workbooks/Workbook.js) plus an entry in demos/index.json.
 * The JSON files are the data the app ships; edit this script, not them.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import DocumentStore from '../js/editors/DocumentStore.js';
import DiagramDocument from '../js/editors/DiagramEditor/DiagramDocument.js';
import DiagramNode, { NODE_TYPES as NT } from '../js/editors/DiagramEditor/DiagramNode.js';
import DiagramWire from '../js/editors/DiagramEditor/DiagramWire.js';
import CircuitDocument from '../js/editors/CircuitEditor/CircuitDocument.js';
import ProofDocument from '../js/editors/EquationEditor/ProofDocument.js';
import { derivedDiagram } from '../js/editors/CircuitEditor/CircuitDiagramLink.js';
import Tensor from '../js/core/Tensor.js';
import { captureWorkbook, openWorkbookDocuments } from '../js/workbooks/Workbook.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demos');

/* ---------------- Helpers ---------------- */

const add = (doc, type, x, y, { i, o, label, tensor } = {}) => {
  const n = new DiagramNode(type, x, y);
  if (i !== undefined) n.inputs = i;
  if (o !== undefined) n.outputs = o;
  if (label !== undefined) n.label = label;
  if (tensor) n.tensor = tensor;
  doc.nodes.set(n.id, n);
  return n;
};
const wire = (doc, a, ap, b, bp) => doc.wires.push(new DiagramWire(a.id, ap, b.id, bp));
const scalar = (doc, value, label, x = 340, y = 520) =>
  add(doc, NT.SCALAR, x, y, { label, tensor: new Tensor(1, 1, [[value, 0]]) });
const R2 = Math.SQRT1_2;

function circuit(name, n, cells, inputs) {
  const c = DocumentStore.add(new CircuitDocument(name, n));
  for (const [t, q, gate, param] of cells) c.setCell(t, q, param ? { gate, param } : { gate });
  (inputs || []).forEach((s, q) => c.setInput(q, s));
  derivedDiagram(c);
  return c;
}

/** A proof from a list of steps: { build(doc) | from: diagram, relation, note }. */
function proof(name, steps, assumptions = {}) {
  const p = DocumentStore.add(new ProofDocument(name));
  p.assumptions = { ...assumptions };
  steps.forEach((st, k) => {
    if (st.from) p.insertDiagram(st.from);
    else { p.addEmptyStep(); st.build(p.steps[k].diagram); }
    if (k > 0) { p.steps[k].relation = st.relation || '='; p.steps[k].note = st.note || ''; }
  });
  p._undoStack = [];
  const r = p.checkAll();
  if (r.status !== 'ok') {
    throw new Error(`Demo proof "${name}" does not check at step ${r.firstBad}: ${r.results[r.firstBad].hint}`);
  }
  return p;
}

const leaf = (editorType, state) => ({ type: 'leaf', editorType, state });
const split = (direction, ratio, a, b) => ({ type: 'split', direction, ratio, children: [a, b] });

/* ---------------- Demos ---------------- */

const DEMOS = [];

DEMOS.push({
  id: 'getting-started',
  name: 'Getting started: the Bell state',
  description: 'One state, four ways. The circuit (H, then CNOT, on |00⟩) prepares the Bell state; '
    + 'the Diagram Editor shows the same circuit as a PQP diagram; the proof simplifies that diagram, '
    + 'one checked rewrite at a time, to a cup; and the Dirac editor writes it out — click a saved formula '
    + 'to check another way of writing the same state. Edit the circuit and its diagram and Dirac follow '
    + '(the proof keeps its own copies).',
  build() {
    const bell = circuit('Bell state', 2, [[0, 0, 'H'], [1, 0, 'ctrl'], [1, 1, 'X']], ['0', '0']);
    const gen = derivedDiagram(bell);
    const p = proof('Bell state = cup', [
      { from: gen },
      { relation: '=', note: 'colour change: H turns the X state into a Z state', build: d => {
        const s0 = add(d, NT.Z_SPIDER, 120, 520, { i: 0, o: 1 }), s1 = add(d, NT.X_SPIDER, 230, 520, { i: 0, o: 1 });
        const zc = add(d, NT.Z_SPIDER, 120, 360, { i: 1, o: 2 }), xt = add(d, NT.X_SPIDER, 230, 360, { i: 2, o: 1 });
        wire(d, s0, 0, zc, 0); wire(d, s1, 0, xt, 0); wire(d, zc, 1, xt, 1); scalar(d, R2, '1/√2'); } },
      { relation: '=', note: 'spider fusion (Z)', build: d => {
        const s1 = add(d, NT.X_SPIDER, 230, 520, { i: 0, o: 1 });
        const zc = add(d, NT.Z_SPIDER, 120, 360, { i: 0, o: 2 }), xt = add(d, NT.X_SPIDER, 230, 360, { i: 2, o: 1 });
        wire(d, s1, 0, xt, 0); wire(d, zc, 1, xt, 1); scalar(d, R2, '1/√2'); } },
      { relation: '=', note: 'spider fusion (X)', build: d => {
        const zc = add(d, NT.Z_SPIDER, 120, 360, { i: 0, o: 2 }), xt = add(d, NT.X_SPIDER, 230, 360, { i: 1, o: 1 });
        wire(d, zc, 1, xt, 0); scalar(d, R2, '1/√2'); } },
      { relation: '=', note: 'identity removal', build: d => {
        add(d, NT.Z_SPIDER, 170, 360, { i: 0, o: 2 }); scalar(d, R2, '1/√2'); } },
      { relation: '=', note: 'a phase-free Z spider with two outputs is a cup', build: d => {
        add(d, NT.CUP, 170, 360); scalar(d, R2, '1/√2'); } },
      { relation: '≈', note: 'drop the scalar', build: d => add(d, NT.CUP, 170, 360) },
    ]);
    // 2×2: circuit | its diagram over the proof | Dirac — all about the same state
    return split('horizontal', 0.5,
      split('vertical', 0.42, leaf('Circuit Editor', { docId: bell.id }),
        leaf('Diagram Equation Editor', { proofId: p.id, selected: 0 })),
      split('vertical', 0.5, leaf('Diagram Editor', { docId: gen.id, orientation: 'pqp', view: { fitted: true } }),
        leaf('Dirac Formula Editor', { docId: bell.id, formulas: [
          '\\frac{1}{\\sqrt{2}}(|00\\rangle + |11\\rangle)',
          '|\\Phi^+\\rangle',
          '\\operatorname{CNOT} (|+\\rangle \\otimes |0\\rangle)',
        ] })));
  },
});

DEMOS.push({
  id: 'spider-rules',
  name: 'Spider rules',
  description: 'The basic ZX rewrites as checked proofs: spider fusion, colour change, π-copy, and '
    + 'identity removal. Each uses symbolic phases, checked for random values.',
  build() {
    const fusion = proof('Spider fusion', [
      { build: d => { const a = add(d, NT.Z_SPIDER, 200, 240, { label: 'α' }); const b = add(d, NT.Z_SPIDER, 200, 140, { label: 'β' }); wire(d, a, 0, b, 0); } },
      { build: d => add(d, NT.Z_SPIDER, 200, 190, { label: 'α+β' }), relation: '=', note: 'spider fusion' },
    ]);
    proof('Colour change', [
      { build: d => { const h1 = add(d, NT.HADAMARD, 200, 270), z = add(d, NT.Z_SPIDER, 200, 190, { label: 'α' }), h2 = add(d, NT.HADAMARD, 200, 110);
        wire(d, h1, 0, z, 0); wire(d, z, 0, h2, 0); } },
      { build: d => add(d, NT.X_SPIDER, 200, 190, { label: 'α' }), relation: '=', note: 'colour change' },
    ]);
    proof('π-copy', [
      { build: d => { const x = add(d, NT.X_SPIDER, 200, 270, { label: 'π' }), z = add(d, NT.Z_SPIDER, 200, 180, { i: 1, o: 2 }); wire(d, x, 0, z, 0); } },
      { build: d => { const z = add(d, NT.Z_SPIDER, 200, 270, { i: 1, o: 2 });
        const a = add(d, NT.X_SPIDER, 160, 170, { label: 'π' }), b = add(d, NT.X_SPIDER, 240, 170, { label: 'π' });
        wire(d, z, 0, a, 0); wire(d, z, 1, b, 0); }, relation: '=', note: 'π-copy' },
    ]);
    proof('Identity removal', [
      { build: d => { const a = add(d, NT.HADAMARD, 200, 250), b = add(d, NT.HADAMARD, 200, 150); wire(d, a, 0, b, 0); } },
      { build: d => add(d, NT.Z_SPIDER, 200, 200), relation: '=', note: 'H twice is a plain wire (a phase-free spider)' },
      { build: d => add(d, NT.IDENTITY, 200, 200), relation: '=', note: 'identity removal' },
    ]);
    return split('vertical', 0.7,
      leaf('Diagram Equation Editor', { proofId: fusion.id, selected: 1 }),
      leaf('Dirac Formula Editor', { docId: fusion.steps[0].diagram.id }));
  },
});

DEMOS.push({
  id: 'snake-equations',
  name: 'Snake equations',
  description: 'A cup followed by a cap straightens to a plain wire — the snake (yanking) equation — '
    + 'and a box f slides through the bend. f is symbolic: the check holds for random choices of f.',
  build() {
    const snake = proof('Snake', [
      { build: d => { const cap = add(d, NT.CAP, 100, 110), cup = add(d, NT.CUP, 160, 210); wire(d, cup, 0, cap, 1); } },
      { build: d => add(d, NT.IDENTITY, 130, 160), relation: '=', note: 'snake equation' },
    ]);
    proof('A box through a snake', [
      { build: d => { const f = add(d, NT.MORPHISM, 88, 210, { label: 'f' }), cap = add(d, NT.CAP, 100, 110), cup = add(d, NT.CUP, 160, 280);
        wire(d, f, 0, cap, 0); wire(d, cup, 0, cap, 1); } },
      { build: d => add(d, NT.MORPHISM, 130, 190, { label: 'f' }), relation: '=', note: 'yank the wire straight' },
    ]);
    return split('vertical', 0.7,
      leaf('Diagram Equation Editor', { proofId: snake.id, selected: 0 }),
      leaf('Dirac Formula Editor', { docId: snake.steps[0].diagram.id }));
  },
});

DEMOS.push({
  id: 'sliding-round-bends',
  name: 'Sliding round bends',
  description: 'Proposition 4.30 of Picturing Quantum Processes: a box slides round a cup or a cap and '
    + 'comes out as its transpose (drawn rotated 180°). Each step here was made with the slide handle '
    + '(select a box on a cup or cap leg and press S), and every step is checked for a random box. '
    + 'The necklace strings three boxes along a snake, slides them onto one strand, and yanks it straight.',
  build() {
    // Each step is a copy of the previous one, changed by one slide (exactly what the editor does)
    const slidThen = (prev, pick) => d => {
      const c = DiagramDocument.copyOf(prev);
      const node = [...c.nodes.values()].find(pick);
      c.slide(node, c.slideOptions(node)[0]);
      d.nodes = c.nodes; d.wires = c.wires;
    };
    const lbl = l => n => n.type.key === 'morphism' && n.label === l;

    const cup1 = new DiagramDocument('cup');
    { const cup = add(cup1, NT.CUP, 180, 260), f = add(cup1, NT.MORPHISM, 168, 160, { label: 'f' }); wire(cup1, cup, 0, f, 0); }
    const pCup = proof('A box round a cup', [
      { build: d => { const c = DiagramDocument.copyOf(cup1); d.nodes = c.nodes; d.wires = c.wires; } },
      { build: slidThen(cup1, lbl('f')), relation: '=', note: 'slide (Prop. 4.30)' },
    ]);

    const cap1 = new DiagramDocument('cap');
    { const cap = add(cap1, NT.CAP, 180, 120), f = add(cap1, NT.MORPHISM, 168, 220, { label: 'f' }); wire(cap1, f, 0, cap, 0); }
    proof('A box round a cap', [
      { build: d => { const c = DiagramDocument.copyOf(cap1); d.nodes = c.nodes; d.wires = c.wires; } },
      { build: slidThen(cap1, lbl('f')), relation: '=', note: 'slide (Prop. 4.30)' },
    ]);

    // The necklace: a → cap → b (↓) → cup → c, a snake with three beads
    const n0 = new DiagramDocument('necklace');
    {
      const a = add(n0, NT.MORPHISM, 120, 260, { label: 'a' });
      const cap = add(n0, NT.CAP, 160, 150);
      const b = add(n0, NT.MORPHISM, 200, 260, { label: 'b' });
      const cup = add(n0, NT.CUP, 240, 370);
      const c = add(n0, NT.MORPHISM, 280, 260, { label: 'c' });
      wire(n0, a, 0, cap, 0); wire(n0, cup, 0, b, 0); wire(n0, b, 0, cap, 1); wire(n0, cup, 1, c, 0);
    }
    const n1 = DiagramDocument.copyOf(n0); slidThen(n0, lbl('a'))(n1);
    const n2 = DiagramDocument.copyOf(n1); slidThen(n1, lbl('c'))(n2);
    proof('The necklace', [
      { build: d => { const c = DiagramDocument.copyOf(n0); d.nodes = c.nodes; d.wires = c.wires; } },
      { build: d => { const c = DiagramDocument.copyOf(n1); d.nodes = c.nodes; d.wires = c.wires; }, relation: '=', note: 'slide a round the cap' },
      { build: d => { const c = DiagramDocument.copyOf(n2); d.nodes = c.nodes; d.wires = c.wires; }, relation: '=', note: 'slide c round the cup' },
      // The strand runs backwards through aᵀ b cᵀ, so the straight wire is (aᵀ b cᵀ)ᵀ = c bᵀ a:
      // a first (bottom), then bᵀ, then c
      { relation: '=', note: 'yank the snake straight: (aᵀ b cᵀ)ᵀ = c bᵀ a', build: d => {
        const a = add(d, NT.MORPHISM, 200, 300, { label: 'a' });
        const b = add(d, NT.MORPHISM, 200, 210, { label: 'b' }); b.flip = { v: true, h: true };
        const c = add(d, NT.MORPHISM, 200, 120, { label: 'c' });
        wire(d, a, 0, b, 0); wire(d, b, 0, c, 0); } },
    ]);
    return split('vertical', 0.72,
      leaf('Diagram Equation Editor', { proofId: pCup.id, selected: 1 }),
      leaf('Dirac Formula Editor', { docId: pCup.steps[0].diagram.id }));
  },
});

DEMOS.push({
  id: 'measurement-and-discarding',
  name: 'Measurement and discarding',
  description: 'The doubled picture of Picturing Quantum Processes: thick wires are quantum, thin wires '
    + 'classical. White dots with thin and thick legs measure (thick in, thin out), encode (thin in, thick '
    + 'out), copy and delete; ⏚ discards. The proofs: measuring then deleting is discarding, encoding then '
    + 'discarding is deleting, measuring then encoding is decoherence, discarding a pure state gives the '
    + 'Born rule, and a doubled unitary is causal.',
  build() {
    const T = (d, type, x, y, o = {}) => { const n = add(d, type, x, y, o); n.thick = true; return n; };
    const dot = (d, x, y, ins, outs) => {
      const n = add(d, NT.DOT, x, y, { i: ins.length, o: outs.length });
      n.legThick = { in: ins.map(t => t === 'q'), out: outs.map(t => t === 'q') };
      return n;
    };
    const p1 = proof('Measure, then delete = discard', [
      { build: d => { const m = dot(d, 200, 230, ['q'], ['c']), del = dot(d, 200, 150, ['c'], []); wire(d, m, 0, del, 0); } },
      { build: d => add(d, NT.DISCARD, 200, 190), relation: '=', note: 'spider fusion (white dots)' },
    ]);
    proof('Encode, then discard = delete', [
      { build: d => { const e = dot(d, 200, 230, ['c'], ['q']), ds = add(d, NT.DISCARD, 200, 150); wire(d, e, 0, ds, 0); } },
      { build: d => dot(d, 200, 190, ['c'], []), relation: '=', note: 'the discard is a white dot on the pair' },
    ]);
    proof('Measure, then encode = decoherence', [
      { build: d => { const m = dot(d, 200, 240, ['q'], ['c']), e = dot(d, 200, 140, ['c'], ['q']); wire(d, m, 0, e, 0); } },
      { build: d => dot(d, 200, 190, ['q'], ['q']), relation: '=', note: 'spider fusion' },
    ]);
    proof('Discarding a pure state: the Born rule', [
      { build: d => { const st = T(d, NT.STATE, 200, 240, { label: 'ψ' }), ds = add(d, NT.DISCARD, 200, 150); wire(d, st, 0, ds, 0); } },
      { build: d => { const st = add(d, NT.STATE, 200, 240, { label: 'ψ' }), ef = add(d, NT.STATE, 200, 150, { label: 'ψ' });
        d.flipNode(ef, 'adj'); wire(d, st, 0, ef, 0); }, relation: '=', note: 'the discard of ψ̂ is ⟨ψ|ψ⟩' },
    ]);
    proof('A doubled unitary is causal', [
      { build: d => { const h = T(d, NT.HADAMARD, 200, 240), ds = add(d, NT.DISCARD, 200, 150); wire(d, h, 0, ds, 0); } },
      { build: d => add(d, NT.DISCARD, 200, 190), relation: '=', note: 'Ĥ is unitary, so ⏚ ∘ Ĥ = ⏚' },
    ]);
    // A diagram to experiment with: a general state ρ, measured, the outcome copied
    const play = DocumentStore.createDiagram('Measure and copy');
    {
      const rho = T(play, NT.STATE, 200, 330, { label: 'ρ' }); rho.process = true;
      const m = dot(play, 200, 230, ['q'], ['c']);
      const cp = dot(play, 200, 140, ['c'], ['c', 'c']);
      wire(play, rho, 0, m, 0); wire(play, m, 0, cp, 0);
    }
    return split('horizontal', 0.6,
      leaf('Diagram Equation Editor', { proofId: p1.id, selected: 0 }),
      leaf('Diagram Editor', { docId: play.id, orientation: 'pqp', view: { fitted: true } }));
  },
});

DEMOS.push({
  id: 'causality',
  name: 'Causality',
  description: 'Proofs that need assumptions and sums (PQP ch. 8). A proof can assume things about its '
    + 'symbols — Φ causal, U unitary — shown in the bar above the steps; every check then uses random values '
    + 'satisfying them. Composing causal processes is causal; measuring is causal (a sum over a basis, Σᵢ); '
    + 'a unitary undoes itself; a doubled isometry is causal; and Σᵢ |i⟩⟨i| is the identity.',
  build() {
    const T = (d, type, x, y, o = {}) => { const n = add(d, type, x, y, o); n.thick = true; return n; };
    const dot = (d, x, y, ins, outs) => {
      const n = add(d, NT.DOT, x, y, { i: ins.length, o: outs.length });
      n.legThick = { in: ins.map(t => t === 'q'), out: outs.map(t => t === 'q') };
      return n;
    };
    const proc = (d, x, y, label, ins, outs) => {
      const n = add(d, NT.MORPHISM, x, y, { label, i: ins.length, o: outs.length });
      n.thick = true; n.process = true;
      n.legThick = { in: ins.map(t => t === 'q'), out: outs.map(t => t === 'q') };
      return n;
    };
    const p1 = proof('Composing causal processes', [
      { build: d => { const phi = proc(d, 200, 330, 'Φ', ['q'], ['q', 'c']), psi = proc(d, 188, 220, 'Ψ', ['q'], ['q']);
        const ds = add(d, NT.DISCARD, 188, 130), del = dot(d, 250, 230, ['c'], []);
        wire(d, phi, 0, psi, 0); wire(d, psi, 0, ds, 0); wire(d, phi, 1, del, 0); } },
      { relation: '=', note: 'Ψ is causal', build: d => { const phi = proc(d, 200, 330, 'Φ', ['q'], ['q', 'c']);
        const ds = add(d, NT.DISCARD, 188, 230), del = dot(d, 250, 230, ['c'], []); wire(d, phi, 0, ds, 0); wire(d, phi, 1, del, 0); } },
      { relation: '=', note: 'Φ is causal', build: d => add(d, NT.DISCARD, 200, 280) },
    ], { 'Φ': 'causal', 'Ψ': 'causal' });
    proof('Measuring is causal', [
      { build: d => { const m = dot(d, 200, 240, ['q'], ['c']), del = dot(d, 200, 150, ['c'], []); wire(d, m, 0, del, 0); } },
      { relation: '=', note: 'delete = Σᵢ ⟨i|  (8.14)', build: d => { d.sumIndices = ['i'];
        const m = dot(d, 200, 240, ['q'], ['c']), e = add(d, NT.EFFECT, 200, 150, { label: 'i' }); wire(d, m, 0, e, 0); } },
      { relation: '=', note: 'measuring then ⟨i| = doubled ⟨i|  (8.6)', build: d => { d.sumIndices = ['i'];
        T(d, NT.EFFECT, 200, 190, { label: 'i' }); } },
      { relation: '=', note: 'Σᵢ doubled ⟨i| = ⏚  (5.37)', build: d => add(d, NT.DISCARD, 200, 190) },
    ]);
    proof('A unitary undoes itself', [
      { build: d => { const u = add(d, NT.MORPHISM, 200, 240, { label: 'U' }), ud = add(d, NT.MORPHISM, 200, 140, { label: 'U' });
        d.flipNode(ud, 'adj'); wire(d, u, 0, ud, 0); } },
      { relation: '=', note: 'U†U = 1', build: d => add(d, NT.IDENTITY, 200, 190) },
    ], { U: 'unitary' });
    proof('A doubled isometry is causal', [
      { build: d => { const f = T(d, NT.MORPHISM, 200, 240, { label: 'V', o: 2 }), a = add(d, NT.DISCARD, 188, 140), b = add(d, NT.DISCARD, 212, 140);
        wire(d, f, 0, a, 0); wire(d, f, 1, b, 0); } },
      { relation: '=', note: 'V̂ is causal since V†V = 1', build: d => add(d, NT.DISCARD, 200, 190) },
    ], { V: 'isometry' });
    proof('Resolution of the identity', [
      { build: d => { d.sumIndices = ['i']; add(d, NT.EFFECT, 200, 240, { label: 'i' }); add(d, NT.STATE, 200, 140, { label: 'i' }); } },
      { relation: '=', note: 'Σᵢ |i⟩⟨i| = 1', build: d => add(d, NT.IDENTITY, 200, 190) },
    ]);
    return leaf('Diagram Equation Editor', { proofId: p1.id, selected: 0 });
  },
});

DEMOS.push({
  id: 'ghz-state',
  name: 'GHZ state',
  description: 'Three qubits: H, then a staircase of CNOTs, prepares (|000⟩ + |111⟩)/√2. '
    + 'Compare the circuit with its PQP diagram — each CNOT is a green and a red spider joined by a leg.',
  build() {
    const ghz = circuit('GHZ', 3, [[0, 0, 'H'], [1, 0, 'ctrl'], [1, 1, 'X'], [2, 1, 'ctrl'], [2, 2, 'X']], ['0', '0', '0']);
    return split('vertical', 0.6,
      split('horizontal', 0.45, leaf('Circuit Editor', { docId: ghz.id }),
        leaf('Diagram Editor', { docId: derivedDiagram(ghz).id, orientation: 'pqp', view: { fitted: true } })),
      leaf('Dirac Formula Editor', { docId: ghz.id }));
  },
});

DEMOS.push({
  id: 'teleportation',
  name: 'Quantum teleportation',
  description: 'Alice holds a qubit (q0) and half of a Bell pair (q1); Bob holds the other half (q2). '
    + 'She measures q0 and q1 in the Bell basis — the wires turn classical (double lines) — and Bob corrects '
    + 'with an X and a Z controlled by her two bits. Because the circuit measures, its PQP diagram is doubled: '
    + 'thick quantum wires, thin classical ones, white dots for the measurements and the classical controls. '
    + 'The proof checks that the whole process, with the bits discarded, is just a wire: the state arrives intact.',
  build() {
    const c = circuit('Teleportation', 3, [
      [0, 1, 'H'], [1, 1, 'ctrl'], [1, 2, 'X'],                     // Bell pair on q1, q2
      [2, 0, 'ctrl'], [2, 1, 'X'], [3, 0, 'H'],                     // Bell-basis measurement…
      [4, 0, 'measure'], [4, 1, 'measure'],
      [5, 1, 'ctrl'], [5, 2, 'X'], [6, 0, 'ctrl'], [6, 2, 'Z'],     // …and Bob's corrections
    ], ['open', '0', '0']);
    c.setOutput(0, 'discard'); c.setOutput(1, 'discard');
    c._undoStack = [];
    const diagram = derivedDiagram(c);
    const p = proof('Teleportation is a wire', [
      { from: diagram },
      { relation: '=', note: 'teleportation: measure, correct, discard the bits = the identity channel',
        build: d => { const w = add(d, NT.IDENTITY, 200, 200); w.thick = true; } },
    ]);
    return split('vertical', 0.55,
      split('horizontal', 0.5, leaf('Circuit Editor', { docId: c.id }),
        leaf('Diagram Editor', { docId: diagram.id, orientation: 'pqp', view: { fitted: true } })),
      leaf('Diagram Equation Editor', { proofId: p.id, selected: 1 }));
  },
});

/* ---------------- Build ---------------- */

mkdirSync(OUT, { recursive: true });
const index = [];
for (const demo of DEMOS) {
  DocumentStore.clear();
  const layout = demo.build();
  const wb = captureWorkbook({ name: demo.name, description: demo.description }, layout);
  delete wb.savedAt;   // demos are versioned with the app, not timestamped
  // Round trip: the written workbook must open and its proofs must still check
  openWorkbookDocuments(JSON.parse(JSON.stringify(wb)));
  for (const p of DocumentStore.list('proof')) {
    if (p.checkAll().status !== 'ok') throw new Error(`Demo "${demo.name}": proof "${p.name}" fails after reopening`);
  }
  writeFileSync(path.join(OUT, `${demo.id}.json`), JSON.stringify(wb, null, 1) + '\n');
  index.push({ id: demo.id, name: wb.name, description: wb.description, summary: wb.summary });
  console.log(`✓ ${demo.id}.json  (${Object.entries(wb.summary).map(([k, v]) => `${v} ${k}`).join(', ')})`);
}
writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ demos: index }, null, 1) + '\n');
console.log(`✓ index.json  (${index.length} demos)`);
