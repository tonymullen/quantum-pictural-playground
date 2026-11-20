/**
 * Chapter 3 — Processes as diagrams (PQP ch. 3): its demos and exercise starters.
 *
 * Text: textbook/ch03.html. Every exercise here has a starter workbook
 * (Demos ▸ Textbook ▸ Chapter 3 ▸ Exercises); its statement is shown in the
 * workbook's Exercise panel and, with hints, in the book.
 */
import {
  add, wire, proof, goalProof, diagram, circuit, leaf, split, withExercise,
  DiagramDocument, NT, derivedDiagram,
} from '../demo-kit.mjs';
import * as K from '../../js/core/KnownGates.js';

/* ---------------- Little diagrams used below ---------------- */

/** ψ → f → π, a column (inputs at the bottom: PQP's convention). */
const statBoxEffect = d => {
  const s = add(d, NT.STATE, 200, 320, { label: 'ψ' }), f = add(d, NT.MORPHISM, 200, 220, { label: 'f' });
  const e = add(d, NT.EFFECT, 200, 120, { label: 'π' });
  wire(d, s, 0, f, 0); wire(d, f, 0, e, 0);
};
/** A number node: a label that reads as a number (2, 0, 1/√2) is that number. */
const num = (d, label, x, y) => add(d, NT.SCALAR, x, y, { label });
/** A box with a concrete matrix (e.g. X), drawn as a PQP box. */
const gate = (d, label, tensor, x, y) => add(d, NT.MORPHISM, x, y, { label, tensor });
/** Two boxes on two wires; `lift` raises the right-hand column. */
const twoColumns = (d, lift = 0, labels = ['f', 'g']) => {
  const a = add(d, NT.IDENTITY, 140, 330), b = add(d, NT.IDENTITY, 260, 330 - lift);
  const f = add(d, NT.MORPHISM, 140, 230, { label: labels[0] }), g = add(d, NT.MORPHISM, 260, 230 - lift, { label: labels[1] });
  wire(d, a, 0, f, 0); wire(d, b, 0, g, 0);
};

/* ---------------- Demos ---------------- */

const demos = [];

demos.push({
  id: 'pqp03-tour',
  anchor: 'playground',
  name: '3.0 Getting around the Playground',
  description: 'The workbook used in the walkthrough at the start of Chapter 3: a state ψ, a box f and an effect π '
    + 'in the Diagram Editor (with its ∘⊗ reading switched on), the same diagram in Dirac notation, and a first '
    + 'proof — moving a box changes nothing, because only connectivity matters (PQP Cor. 3.5).',
  build() {
    const d = diagram('ψ, f and π', statBoxEffect);
    const moved = new DiagramDocument('moved');
    statBoxEffect(moved);
    for (const n of moved.nodes.values()) if (n.label === 'f') { n.x = 300; n.y = 240; }
    const p = proof('Moving a box changes nothing', [
      { build: d2 => { const c = DiagramDocument.copyOf(d); d2.nodes = c.nodes; d2.wires = c.wires; } },
      { build: d2 => { const c = DiagramDocument.copyOf(moved); d2.nodes = c.nodes; d2.wires = c.wires; },
        relation: '=', note: 'deformation: only connectivity matters (PQP Cor. 3.5)' },
    ]);
    return split('horizontal', 0.5,
      split('vertical', 0.6, leaf('Diagram Editor', { docId: d.id, orientation: 'pqp', structure: true, view: { fitted: true } }),
        leaf('Dirac Formula Editor', { docId: d.id })),
      leaf('Diagram Equation Editor', { proofId: p.id, selected: 1 }));
  },
});

demos.push({
  id: 'pqp03-composing',
  anchor: 'sec-3-2',
  name: '3.1 Composing processes',
  description: 'Parallel (⊗) and sequential (∘) composition (PQP §3.2). The interchange law '
    + '(g₁ ⊗ g₂) ∘ (f₁ ⊗ f₂) = (g₁ ∘ f₁) ⊗ (g₂ ∘ f₂), equation (3.16), is one picture drawn twice; an effect '
    + 'followed by a state is the two side by side; and a circuit — H, then CNOT — shown with its ∘⊗ layers.',
  build() {
    const inter = proof('The interchange law (3.16)', [
      { build: d => {   // drawn as layers: f₁ ⊗ f₂ first, then g₁ ⊗ g₂
        const a = add(d, NT.IDENTITY, 140, 330), b = add(d, NT.IDENTITY, 260, 330);
        const f1 = add(d, NT.MORPHISM, 140, 250, { label: 'f₁' }), f2 = add(d, NT.MORPHISM, 260, 250, { label: 'f₂' });
        const g1 = add(d, NT.MORPHISM, 140, 150, { label: 'g₁' }), g2 = add(d, NT.MORPHISM, 260, 150, { label: 'g₂' });
        wire(d, a, 0, f1, 0); wire(d, b, 0, f2, 0); wire(d, f1, 0, g1, 0); wire(d, f2, 0, g2, 0); } },
      { relation: '=', note: 'the same diagram: (3.16) is free in pictures', build: d => {   // drawn as two columns
        const a = add(d, NT.IDENTITY, 140, 330), b = add(d, NT.IDENTITY, 260, 300);
        const f1 = add(d, NT.MORPHISM, 140, 280, { label: 'f₁' }), f2 = add(d, NT.MORPHISM, 260, 200, { label: 'f₂' });
        const g1 = add(d, NT.MORPHISM, 140, 200, { label: 'g₁' }), g2 = add(d, NT.MORPHISM, 260, 110, { label: 'g₂' });
        wire(d, a, 0, f1, 0); wire(d, b, 0, f2, 0); wire(d, f1, 0, g1, 0); wire(d, f2, 0, g2, 0); } },
    ]);
    proof('An effect, then a state', [
      { build: d => { add(d, NT.EFFECT, 200, 280, { label: 'π' }); add(d, NT.STATE, 200, 160, { label: 'ψ' }); } },
      { relation: '=', note: 'ψ ∘ π = ψ ⊗ π: nothing is connected (PQP §3.2.4)', build: d => {
        add(d, NT.EFFECT, 140, 220, { label: 'π' }); add(d, NT.STATE, 260, 220, { label: 'ψ' }); } },
    ]);
    const bell = circuit('H, then CNOT', 2, [[0, 0, 'H'], [1, 0, 'ctrl'], [1, 1, 'X']], ['0', '0']);
    return split('horizontal', 0.5,
      leaf('Diagram Equation Editor', { proofId: inter.id, selected: 0 }),
      split('vertical', 0.45, leaf('Circuit Editor', { docId: bell.id }),
        leaf('Diagram Editor', { docId: derivedDiagram(bell).id, orientation: 'pqp', structure: true, view: { fitted: true } })));
  },
});

demos.push({
  id: 'pqp03-special',
  anchor: 'sec-3-4',
  name: '3.2 States, effects and numbers',
  description: 'PQP §3.4: a state meets an effect and a number pops out. Here ⟨+|0⟩ = 1/√2 in the Diagram Editor, '
    + 'its Dirac form and its Numbers; ⟨1|0⟩ is the impossible number 0; and 2·f ≈ f, equal up to a number '
    + '(PQP Def. 3.39).',
  build() {
    const plus0 = diagram('⟨+|0⟩', d => { const s = add(d, NT.STATE, 200, 260, { label: '0' }), e = add(d, NT.EFFECT, 200, 160, { label: '+' }); wire(d, s, 0, e, 0); });
    proof('⟨1|0⟩ is impossible', [
      { build: d => { const s = add(d, NT.STATE, 200, 260, { label: '0' }), e = add(d, NT.EFFECT, 200, 160, { label: '1' }); wire(d, s, 0, e, 0); } },
      { relation: '=', note: '⟨1|0⟩ = 0: the zero number (PQP §3.4.2)', build: d => num(d, '0', 200, 210) },
    ]);
    const upTo = proof('2·f is f up to a number', [
      { build: d => { num(d, '2', 120, 220); const w = add(d, NT.IDENTITY, 220, 320), f = add(d, NT.MORPHISM, 220, 220, { label: 'f' }); wire(d, w, 0, f, 0); } },
      { relation: '≈', note: 'equal up to a number (PQP Def. 3.39)', build: d => { const w = add(d, NT.IDENTITY, 220, 320), f = add(d, NT.MORPHISM, 220, 220, { label: 'f' }); wire(d, w, 0, f, 0); } },
    ]);
    return split('horizontal', 0.5,
      leaf('Diagram Equation Editor', { proofId: upTo.id, selected: 1 }),
      split('vertical', 0.5, leaf('Diagram Editor', { docId: plus0.id, orientation: 'pqp', view: { fitted: true } }),
        split('horizontal', 0.5, leaf('Dirac Formula Editor', { docId: plus0.id }), leaf('Numbers', { docId: plus0.id }))));
  },
});

/* ---------------- Exercises ----------------
 * Each: title, level (1 ★ warm-up, 2 ★★ practice, 3 ★★★ challenge),
 * statement and done (MiniMarkup, shown in the Exercise panel), summary (the
 * browser's one-liner), build() → layout. Numbered 3.1, 3.2, … in order.
 */

const exercises = [];

exercises.push({
  title: 'A state, a box and an effect',
  level: 1,
  summary: 'Blank starter: build ψ → f → π and read it in Dirac notation.',
  statement: 'In the Diagram Editor, add a **state**, a **box** and an **effect** with the toolbar buttons, and wire them '
    + 'into a column: drag from the state\'s output handle to the box\'s input, and from the box\'s output to the effect. '
    + 'Double-click a node to rename it: call them ψ, f and π.\n\n'
    + 'Now press **Generate** in the Dirac Formula Editor. Compare the order of the symbols in the formula with the order '
    + 'of the boxes in the picture.',
  done: 'Generate shows $\\langle \\pi | f | \\psi \\rangle$, and you can say why the formula reads right to left while the diagram reads bottom to top.',
  build() {
    const d = diagram('My diagram', () => {});
    return withExercise(split('vertical', 0.62,
      leaf('Diagram Editor', { docId: d.id, orientation: 'pqp' }),
      leaf('Dirac Formula Editor', { docId: d.id })));
  },
});

exercises.push({
  title: 'Side by side, one after the other',
  level: 1,
  summary: 'Two empty diagrams: build f ⊗ g and g ∘ f and compare their ∘⊗ readings and Dirac forms.',
  statement: 'In the diagram **f ⊗ g**, put two boxes f and g side by side, each on its own wire. In the diagram '
    + '**g ∘ f** (choose it in the top panel\'s diagram menu), wire f\'s output into g\'s input, with g above f.\n\n'
    + 'Tick **∘⊗** in the Diagram Editor\'s bar to see each diagram as layers composed in sequence, with pieces side '
    + 'by side in a layer. Then Generate each one in the Dirac Formula Editor (it follows the diagram chosen in its menu).',
  done: 'Generate gives $f \\otimes g$ for the first and $g\\,f$ for the second, and the ∘⊗ view shows one layer with a ⊗ in it, and two layers joined by ∘.',
  build() {
    const a = diagram('f ⊗ g', () => {}), b = diagram('g ∘ f', () => {});
    return withExercise(split('vertical', 0.62,
      leaf('Diagram Editor', { docId: a.id, orientation: 'pqp', structure: true }),
      leaf('Dirac Formula Editor', { docId: a.id })));
  },
});

exercises.push({
  title: 'Numbers from states and effects',
  level: 1,
  summary: 'Blank starter: plug basis states into basis effects and read off the numbers.',
  statement: 'A state or effect labelled **0**, **1**, **+** or **−** is that basis vector, $|0\\rangle$, $|1\\rangle$, '
    + '$|+\\rangle$ or $|-\\rangle$ (any other label is a symbol). Build three small diagrams, each a state wired '
    + 'into an effect: $\\langle 0|0\\rangle$, $\\langle 1|0\\rangle$ and $\\langle +|0\\rangle$ (use ＋ New in the Diagram '
    + 'Editor\'s bar for each).\n\n'
    + 'Read each number in the Dirac Formula Editor (Generate) and in the Numbers panel.',
  done: 'You have the three numbers, and you can say which one PQP would call *impossible* (§3.4.2) and why.',
  build() {
    const d = diagram('⟨0|0⟩', () => {});
    return withExercise(split('vertical', 0.55,
      leaf('Diagram Editor', { docId: d.id, orientation: 'pqp' }),
      split('horizontal', 0.5, leaf('Dirac Formula Editor', { docId: d.id }), leaf('Numbers', { docId: d.id }))));
  },
});

exercises.push({
  title: 'Only connectivity matters',
  level: 1,
  summary: 'Four diagrams and two proofs to finish: which pairs are equal, and why?',
  statement: 'The workbook has four diagrams: **A**, **A moved**, **B** and **B crossed**. Each proof starts from one of '
    + 'them. In the proof **A = ?**, use **Insert diagram…** to add *A moved* as the next step; in **B = ?** (choose it in '
    + 'the Proof menu), add *B crossed*.\n\n'
    + 'One proof checks and the other does not. Look closely at where each wire goes, and explain the difference in the '
    + 'second step\'s **rule…** box.',
  done: 'A = A moved shows ✓; B = B crossed shows ✗; and your note says what distinguishes them (compare PQP equations (3.5) and (3.6)).',
  build() {
    const A = diagram('A', d => twoColumns(d, 0));
    diagram('A moved', d => twoColumns(d, 90));
    const twoIn = crossed => d => {
      const s = add(d, NT.STATE, 150, 320, { label: 'ψ' }), t = add(d, NT.STATE, 250, 320, { label: 'φ' });
      const m = add(d, NT.MORPHISM, 200, 200, { label: 'm', i: 2, o: 1 });
      wire(d, s, 0, m, crossed ? 1 : 0); wire(d, t, 0, m, crossed ? 0 : 1);
    };
    const B = diagram('B', twoIn(false));
    diagram('B crossed', twoIn(true));
    const pA = proof('A = ?', [{ from: A }]);
    proof('B = ?', [{ from: B }]);
    return withExercise(split('vertical', 0.4,
      leaf('Diagram Editor', { docId: A.id, orientation: 'pqp', view: { fitted: true } }),
      leaf('Diagram Equation Editor', { proofId: pA.id, selected: 0 })));
  },
});

exercises.push({
  title: 'Equal up to a number',
  level: 2,
  summary: 'A proof that fails with = : make it hold, then see why zero is special.',
  statement: 'The proof claims $2\\cdot f = f$, and the checker says ✗.\n\n'
    + '- (a) Read the checker\'s message (hover the ✗). Change the step\'s relation from = to ≈. What does ≈ claim (PQP Def. 3.39)?\n'
    + '- (b) Change it back to =, and make the claim true by adding a **number** node (the Scalar in the toolbar) to D₂. A label that reads as a number — 2, 1/2, 0.5, 1/√2, −i — is that number; any other label is a symbol.\n'
    + '- (c) Now change the 2 in D₁ to 0. Why does neither = nor ≈ hold any more, and why does Def. 3.39 insist that the numbers be non-zero?',
  done: 'After (b) the proof shows ✓ with =, and you can answer (c).',
  mayFail: ['2·f and f'],
  build() {
    const p = proof('2·f and f', [
      { build: d => { num(d, '2', 120, 220); const w = add(d, NT.IDENTITY, 220, 320), f = add(d, NT.MORPHISM, 220, 220, { label: 'f' }); wire(d, w, 0, f, 0); } },
      { relation: '=', note: '', build: d => { const w = add(d, NT.IDENTITY, 220, 320), f = add(d, NT.MORPHISM, 220, 220, { label: 'f' }); wire(d, w, 0, f, 0); } },
    ], {}, { mayFail: true });
    return withExercise(leaf('Diagram Equation Editor', { proofId: p.id, selected: 1 }));
  },
});

exercises.push({
  title: 'A circuit is a diagram',
  level: 2,
  summary: 'A two-gate circuit: find its layers and write it as one ∘/⊗ formula.',
  statement: 'The Circuit Editor builds circuits from gates; its PQP diagram is shown below it with the ∘⊗ layers '
    + 'switched on. (The CNOT is drawn as a green and a red dot joined by a line — a picture PQP explains in Chapter 9. '
    + 'For now, treat the pair as one box with two inputs and two outputs.)\n\n'
    + '- (a) Write the whole circuit, starting state included, as one formula using ⊗ and composition, in the Dirac Formula Editor, and press **Verify**. Remember that composition is written right to left: $BA$ means *A first*.\n'
    + '- (b) Add a gate in a new column of the circuit and extend your formula to match.\n'
    + '- (c) PQP Theorem 3.22 says a diagram is a circuit exactly when it has no directed cycles. Describe a diagram that is not a circuit.',
  done: 'Verify shows ✓ Equivalent for your formula, before and after (b).',
  build() {
    const c = circuit('Two gates', 2, [[0, 0, 'H'], [1, 0, 'ctrl'], [1, 1, 'X']], ['0', '0']);
    return withExercise(split('horizontal', 0.5,
      split('vertical', 0.45, leaf('Circuit Editor', { docId: c.id }),
        leaf('Diagram Editor', { docId: derivedDiagram(c).id, orientation: 'pqp', structure: true, view: { fitted: true } })),
      leaf('Dirac Formula Editor', { docId: c.id })));
  },
});

exercises.push({
  title: 'Diagram substitution',
  level: 2,
  summary: 'A goal proof: replace part of a diagram using an equation (PQP §3.1.5).',
  statement: 'Two H boxes in a row are a plain wire: $H H = 1$ (you will see why in Chapter 5). Use this equation to '
    + 'get from the proof\'s given first step to its given last step.\n\n'
    + '- Select D₁ and press **＋ Step**: a copy appears as the next step.\n'
    + '- In the diagram **H H = 1** (right), select the plain wire and copy it (Cmd/Ctrl+C).\n'
    + '- In your new step, select both H boxes (Shift-click) and paste (Cmd/Ctrl+V): the pair is replaced by the wire, reconnected in order — the "same place" rule of PQP Remark 3.16.\n'
    + '- Write the rule you used in the step\'s **rule…** box.\n\n'
    + 'Afterwards, try the one-click way: select the two H boxes and look in the inspector for *Cancel H·H*.',
  done: 'The Exercise panel shows ✓ Solved.',
  build() {
    const p = goalProof('Substitute H H = 1', {
      build: d => {
        const s = add(d, NT.STATE, 200, 380, { label: 'ψ' }), h1 = add(d, NT.HADAMARD, 200, 300), h2 = add(d, NT.HADAMARD, 200, 230);
        const f = add(d, NT.MORPHISM, 200, 150, { label: 'f' });
        wire(d, s, 0, h1, 0); wire(d, h1, 0, h2, 0); wire(d, h2, 0, f, 0);
      } }, {
      build: d => { const s = add(d, NT.STATE, 200, 300, { label: 'ψ' }), f = add(d, NT.MORPHISM, 200, 190, { label: 'f' }); wire(d, s, 0, f, 0); } });
    const rule = diagram('H H = 1', d => {
      const h1 = add(d, NT.HADAMARD, 120, 260), h2 = add(d, NT.HADAMARD, 120, 190); wire(d, h1, 0, h2, 0);
      add(d, NT.IDENTITY, 260, 225);
    });
    return withExercise(split('horizontal', 0.68,
      leaf('Diagram Equation Editor', { proofId: p.id, selected: 0 }),
      leaf('Diagram Editor', { docId: rule.id, orientation: 'pqp', view: { fitted: true } })));
  },
});

exercises.push({
  title: 'Dirac notation on one line',
  level: 2,
  summary: 'Three diagrams to write in Dirac notation and verify.',
  statement: 'For each of the diagrams **A**, **B** and **C**, write a Dirac expression in the Dirac Formula Editor '
    + '(choose the diagram in its menu) and press **Verify**. Write your own before you look at Generate.\n\n'
    + '- **A** is a state, a box and an effect: the box is the X gate, with matrix $\\begin{pmatrix}0&1\\\\1&0\\end{pmatrix}$.\n'
    + '- **B** has two outputs. Write it twice: once with $\\otimes$, and once with the kets side by side, $|a\\rangle|b\\rangle$ or $|ab\\rangle$.\n'
    + '- **C** has an effect on only one of two wires: you will need an identity, $I$, on the other.',
  done: 'Verify shows ✓ Equivalent for A, for both forms of B, and for C.',
  build() {
    const A = diagram('A', d => { const s = add(d, NT.STATE, 200, 300, { label: '1' }), x = gate(d, 'X', K.X, 200, 210), e = add(d, NT.EFFECT, 200, 120, { label: '0' }); wire(d, s, 0, x, 0); wire(d, x, 0, e, 0); });
    diagram('B', d => { const s = add(d, NT.STATE, 150, 300, { label: '0' }), h = add(d, NT.HADAMARD, 150, 200); add(d, NT.STATE, 260, 250, { label: '1' }); wire(d, s, 0, h, 0); });
    diagram('C', d => { const s = add(d, NT.STATE, 150, 280, { label: '0' }), e = add(d, NT.EFFECT, 150, 170, { label: '0' }); add(d, NT.STATE, 260, 230, { label: '+' }); wire(d, s, 0, e, 0); });
    return withExercise(split('vertical', 0.5,
      leaf('Diagram Editor', { docId: A.id, orientation: 'pqp', view: { fitted: true } }),
      leaf('Dirac Formula Editor', { docId: A.id })));
  },
});

exercises.push({
  title: 'Zero eats everything',
  level: 3,
  summary: 'A goal proof about the zero number (PQP §3.4.2), plus a question on paper.',
  statement: 'PQP §3.4.2: if part of a process is impossible, the whole process is — a zero process absorbs everything '
    + 'it is composed with (equations (3.27)). In the Playground the two sides of an equation must have the same wires, '
    + 'so "zero" here is the number 0 beside a plain wire.\n\n'
    + '- (a) Prove the given equation in **at least two steps**, naming each rule. (Number nodes: a label that reads as a number is that number.)\n'
    + '- (b) On paper: PQP Exercise 3.40 asks you to show that if $f \\approx 0$ then $f = 0$, in a theory with no zero-divisors. Prove it, and say where you use that λ and μ in Def. 3.39 are non-zero.',
  done: 'The Exercise panel shows ✓ Solved, and you have a proof of (b).',
  build() {
    const p = goalProof('Zero eats f', {
      build: d => {
        const w = add(d, NT.IDENTITY, 140, 330), f = add(d, NT.MORPHISM, 140, 220, { label: 'f' }); wire(d, w, 0, f, 0);
        const s = add(d, NT.STATE, 280, 270, { label: '0' }), e = add(d, NT.EFFECT, 280, 180, { label: '1' }); wire(d, s, 0, e, 0);
      } }, {
      build: d => { add(d, NT.IDENTITY, 140, 260); num(d, '0', 280, 230); } }, { minSteps: 2 });
    return withExercise(leaf('Diagram Equation Editor', { proofId: p.id, selected: 0 }));
  },
});

exercises.push({
  title: 'What the checker checks',
  level: 3,
  summary: 'Two look-alike claims, one ✓ and one ✗: diagram equations vs process equations.',
  statement: 'The two proofs look alike: **H twice is nothing** checks, **f twice is nothing?** does not.\n\n'
    + '- (a) The Playground interprets every diagram in one process theory: linear maps on qubits (PQP Chapter 5). A box with a symbol for a label, like f, stands for *any* such map, and the checker tries random ones. Explain both results.\n'
    + '- (b) PQP §3.1.4 distinguishes *diagram equations*, true in every process theory just by deforming the picture, from *process equations*, true in a particular theory. Which kind is each claim? Is either a diagram equation?\n'
    + '- (c) Build one proof of each kind yourself: a diagram equation with symbolic boxes, and a process equation with concrete ones (a state labelled 0 or +, an H box, a number).',
  done: 'You have answered (a) and (b) in the proofs\' rule notes or on paper, and your two proofs from (c) show ✓.',
  mayFail: ['f twice is nothing?'],
  build() {
    const p = proof('H twice is nothing', [
      { build: d => { const a = add(d, NT.HADAMARD, 200, 260), b = add(d, NT.HADAMARD, 200, 170); wire(d, a, 0, b, 0); } },
      { relation: '=', note: '', build: d => add(d, NT.IDENTITY, 200, 215) },
    ]);
    proof('f twice is nothing?', [
      { build: d => { const a = add(d, NT.MORPHISM, 200, 260, { label: 'f' }), b = add(d, NT.MORPHISM, 200, 170, { label: 'f' }); wire(d, a, 0, b, 0); } },
      { relation: '=', note: '', build: d => add(d, NT.IDENTITY, 200, 215) },
    ], {}, { mayFail: true });
    return withExercise(leaf('Diagram Equation Editor', { proofId: p.id, selected: 1 }));
  },
});

export default {
  number: 3,
  title: 'Processes as diagrams',
  page: 'ch03.html',
  demos,
  exercises,
};

