# Curriculum outline: *Learning Quantum Picturalism with the Quantum Pictural Playground*

A draft for review. Nothing here is built yet.

**Source text.** B. Coecke and A. Kissinger, *Picturing Quantum Processes: A First Course in Quantum Theory and Diagrammatic Reasoning* (Cambridge University Press, 2017). Below it is called **PQP**. **Edition cited: the author's PDF** (cs.ox.ac.uk/people/aleks.kissinger/PQP.pdf, 921 pp.), chosen because it is freely available. Section numbers here come from its outline.

- **How the textbook will cite PQP:**
  - by section number (§4.2.1) and by result number (Prop. 4.30);
  - never by PDF page;
  - with the text paraphrased, never quoted at length;
  - with every figure redrawn in the Playground, never copied.

---

## 1. Learning goals → how the book meets them

| Goal | How |
|---|---|
| **G1. Fluency with every feature of the software** | Each feature is introduced at the chapter where PQP first needs it (see the feature map in §4). It is then reused in later chapters until it becomes routine. Every chapter opens with a short "In the Playground" section for its new features. |
| **G2. Understand quantum picturalism and use it for insight and problem solving** | <ul><li>Each chapter follows PQP's argument and has the reader *build* the key diagrams and *check* the key equations.</li><li>The ★★★ exercises ask for proofs and explanations, not just constructions.</li><li>"Why the picture helps" sidebars point out where the diagram shows something the algebra hides.</li></ul> |
| **Augmentation: links to Dirac notation and density matrices** | A recurring, clearly marked **"Two notations"** box. It shows the PQP diagram and the textbook formula side by side, with an explicit term-by-term dictionary and a cited source for the standard formalism. The Dirac editor's familiar and PQP forms are used to *check* the correspondence. |

## 2. Shape of every chapter

1. **Overview.** What this PQP chapter is about and which sections it covers. A link to PQP for the full treatment.
2. **In the Playground.** The new software features, as a guided walkthrough that opens a chapter demo workbook.
3. **Tutorial sections.** One per major PQP section. Each section:
   - restates the idea (paraphrased and cited);
   - has the reader build it;
   - checks the result;
   - interprets it.
   It also includes "Two notations" boxes where relevant.
4. **Exercises.** About ten, graded as follows:
   - ★ **Warm-up:** build or reproduce something with guidance (about 3–4 per chapter);
   - ★★ **Practice:** apply an idea to a new case with no step-by-step guidance (about 4);
   - ★★★ **Challenge:** a proof, an explanation, or a small investigation (about 2–3).

   Exercises have graded hints (no solutions). Every exercise has its own starter workbook (blank if no starter material is needed). Each exercise says how you know you are done, usually "the proof's chain is all ✓" or "the Numbers panel shows …".
5. **Summary.** A dictionary table (picture ↔ formula) for the chapter.
6. **References** for the chapter (they also feed a global bibliography page).

## 3. Chapters

PQP chapters 1–2 (introduction, reading guide) have no chapter of their own. A short **"Before you begin"** page covers what the software is, how to open a workbook, and how to save a copy.

---

### Chapter 3 — Processes as diagrams (PQP ch. 3)

**PQP sections:**
- §3.1 boxes, wires, process theories, process equations, substitution
- §3.2 circuits: parallel and sequential composition, "diagrams beat algebra"
- §3.3 functions and relations
- §3.4 states, effects, numbers, zero diagrams, "up to a number", Dirac notation

**New in the Playground:**
- **Workbooks:** the Workbook Browser; opening, saving and saving a copy.
- **Panel layout:** split, merge and resize; switching a panel's editor.
- **Diagram Editor:**
  - adding boxes, states and effects;
  - wiring by dragging port handles;
  - the inspector (labels, number of legs);
  - moving, panning, zooming, undo, 🗑;
  - boundary markers;
  - the ∘⊗ formula bar.
- **First proof in the Equation Editor:** ＋ Step, and = vs ≈.
- **Dirac editor:** Generate and Verify.

**Two notations:**
- state / effect / number ↔ ket |ψ⟩, bra ⟨φ|, scalar ⟨φ|ψ⟩;
- ⊗ and ∘ ↔ Kronecker product and matrix product. This is previewed here and made precise in ch. 5.

Sources: Dirac 1939; Nielsen & Chuang §2.1.

**Exercises:**
1. ★ Compose two boxes in sequence and read the ∘⊗ bar; write the formula by hand first.
2. ★ Build (f⊗g)∘(h⊗k) and (f∘h)⊗(g∘k). Make a two-step proof that they are equal (the interchange law, as a picture).
3. ★ Plug a state into an effect. Find the number, and have the Dirac editor generate ⟨φ|ψ⟩.
4. ★ Build H then CNOT in the Circuit Editor. Arrange the circuit, its PQP diagram and its Dirac formula in three panels.
5. ★★ *(starter diagram)* Write the same diagram as two different ∘/⊗ formulas, and verify both.
6. ★★ *(starter)* Diagram substitution: replace a box by its definition using copy–paste rewriting, and check the step.
7. ★★ *(starter)* Two diagrams equal "up to a number". Find the number, add it as a scalar, and turn ≈ into =.
8. ★★ Translate three Dirac expressions (e.g. (⟨0|⊗1)(|ψ⟩⊗|φ⟩)) into diagrams, and verify each.
9. ★★★ Zero diagrams (§3.4.2). Show that any diagram containing a zero number is zero, then build an example and check it.
10. ★★★ *(paper)* Functions vs relations (§3.3). Find an equation that holds for all functions but fails for some relation, and explain it with diagrams.

---

### Chapter 4 — String diagrams (PQP ch. 4)

**PQP sections:**
- §4.1 cups and caps, separability, process–state duality, yanking
- §4.2 transpose and trace
- §4.3 adjoints, conjugates, inner product, unitarity, positivity, projectors
- §4.4 no-go theorems (universal separability, cloning), "as if time flows backwards", teleportation

**New in the Playground:**
- cups and caps;
- sliding a box round a bend (S), and pulling taut (T) with its preview and scrubber;
- the PQP shapes for f, fᵀ, f†, f̄;
- symbolic boxes in proofs (checking by random substitution, and what a pass means);
- proof assumptions (U unitary);
- the Numbers panel's matrix view.

**Two notations:**
- process–state duality ↔ the Choi–Jamiołkowski isomorphism (Choi 1975; Jamiołkowski 1972);
- the cup ↔ Σᵢ|ii⟩ (an unnormalised Bell state);
- transpose, conjugate and adjoint ↔ the corresponding matrix operations;
- the trace and partial trace ↔ Tr and Tr_B;
- no-cloning ↔ Wootters & Zurek 1982 and Dieks 1982;
- teleportation ↔ Bennett et al. 1993; Nielsen & Chuang §1.3.7.

**Exercises:**
1. ★ *(starter: a snake)* Prove the yanking equation with Pull taut, and with explicit steps.
2. ★ Bend f's input round to make a state, then bend it back (process–state duality).
3. ★ Slide f round a cap. Confirm that fᵀ appears, and compare the two matrices in Numbers.
4. ★ Draw f, fᵀ, f†, f̄ and check (fᵀ)ᵀ = f and f̄ = (f†)ᵀ.
5. ★★ Draw tr(f) with a cup and a cap. Prove tr(g∘f) = tr(f∘g) by sliding.
6. ★★ Partial trace of a two-wire process. Generate its Dirac form and match it to Tr_B.
7. ★★ Prove (g∘f)† = f†∘g† and (f⊗g)† = f†⊗g†.
8. ★★ Assuming U and V are unitary, prove that U⊗V and V∘U are unitary.
9. ★★★ Teleportation, pure and post-selected (§4.4.4). Build it with a Bell effect and a correction, and prove it is a wire up to a number.
10. ★★★ The cup is not separable (§4.1.1). Give the diagrammatic argument, then confirm it numerically: the cup's matrix has rank 2.

---

### Chapter 5 — Hilbert space from diagrams (PQP ch. 5)

**PQP sections:**
- §5.1 bases, matrices, sums, isometries, unitaries, positive processes, traces
- §5.2 matrix calculus, including the matrices of cups and caps
- §5.3 Hilbert spaces, the X basis and Hadamard, Bell maps, classical logic gates
- §5.4 completeness of string diagrams for linear maps

**New in the Playground:**
- sums Σᵢ over a basis;
- the Numbers panel in depth (colour map, unitary/causal flags, hovering for values);
- the Dirac editor's sums;
- linked highlighting between a term, its nodes and its gate.

**Two notations:**
- a matrix entry ↔ ⟨i|f|j⟩;
- ⊗ ↔ Kronecker product;
- resolution of the identity;
- Hermitian and positive operators;
- the Bell basis.

Sources: Nielsen & Chuang §2.1–2.2; Watrous ch. 1.

**Exercises:**
1. ★ Read off one matrix entry of a box by sandwiching it between a basis effect and a basis state. Check it against Numbers.
2. ★ Prove Σᵢ|i⟩⟨i| = 1 (a sum in a proof).
3. ★ Look at H, X, Z and CNOT in Numbers. Which are unitary, and why?
4. ★ Compare the matrix of f⊗g with those of f and g (the Kronecker product).
5. ★★ Write the cup and the cap as matrices, then as vectors through process–state duality.
6. ★★ The X basis: build |±⟩ with H and show it is orthonormal.
7. ★★ Build the four Bell states from circuits, and prove they are orthonormal.
8. ★★ Classical logic as linear maps (§5.3.4): CNOT as XOR, the Toffoli gate as reversible AND.
9. ★★★ Show that f†∘f is self-adjoint and positive: give a diagrammatic proof, and inspect the matrix.
10. ★★★ The checker uses random substitution. Explain why a pass is evidence but not proof, and how completeness (§5.4.1) bears on that. Find an equation whose check can fail, and read its counterexample.

---

### Chapter 6 — Quantum processes (PQP ch. 6)

**PQP sections:**
- §6.1 doubling: probabilities and global phases
- §6.2 discarding, impurity, causality, Kraus decomposition, no-broadcasting
- §6.3 causal structure and non-signalling
- §6.4 non-deterministic processes, purification, controlled processes, teleportation in detail

**New in the Playground:**
- the doubled picture (thick wires, doubled generators, ⏚);
- the "causal" assumption;
- Numbers: density operator, Born-rule bars, Bloch sphere;
- the Dirac editor's two forms (ρ ↦ ΣKρK† vs the doubled hat), and the Write in choice;
- measurement in the Circuit Editor.

**Two notations:**
- a doubled state ↔ the density operator |ψ⟩⟨ψ|;
- discarding ↔ partial trace;
- a causal map ↔ a trace-preserving map;
- a quantum map ↔ a CP map, with its Kraus form (Kraus 1983) and Stinespring dilation (Stinespring 1955);
- purification;
- no-broadcasting (Barnum et al. 1996).

Sources: Nielsen & Chuang §2.4, §2.5, ch. 8; Watrous ch. 2.

**Exercises:**
1. ★ Prove that ψ and e^{iα}ψ become equal once doubled (global phase).
2. ★ The Born rule: compute |⟨φ|ψ⟩|² from the doubled picture and compare it with the Numbers bars.
3. ★ Discard half of a Bell state. Show the result is maximally mixed: the centre of the Bloch sphere, and ½·1 in Dirac.
4. ★ Mix two pure states with a sum, and watch the Bloch vector move inside the sphere.
5. ★★ Prove that a doubled unitary is causal (with the assumption).
6. ★★ Build a bit-flip channel from two Kraus operators. Check its familiar form ρ ↦ ΣKρK† and its doubled form.
7. ★★ Purify a given mixed state, and verify it.
8. ★★ Non-signalling (§6.3.2): for a causal process on A⊗B, show that Bob's input cannot affect Alice's marginal.
9. ★★★ Follow the no-broadcasting argument (§6.2.8) as a chain of checked steps.
10. ★★★ Teleportation in detail (§6.4.6): verify the doubled protocol is a wire, then show that without the classical correction it is not (§6.4.4).

---

### Chapter 7 — Quantum measurement (PQP ch. 7)

**PQP sections:**
- §7.1 ONB measurements (demolition and non-demolition), interference
- §7.2 backaction, gate teleportation, collapse, entanglement swapping
- §7.3 von Neumann measurements, POVMs, Naimark and Ozawa dilation
- §7.4 state, process and local tomography

**New in the Playground:**
- measuring and classically controlled steps in circuits;
- the probabilities of classical outcomes in Numbers;
- sums used for measurement outcomes.

**Two notations:**
- projective measurement {Pᵢ} with pᵢ = Tr(Pᵢρ) and post-measurement state PᵢρPᵢ/pᵢ;
- POVMs {Eᵢ} with ΣEᵢ = 1;
- Naimark dilation;
- tomography from Pauli expectation values;
- gate teleportation (Gottesman & Chuang 1999);
- entanglement swapping (Żukowski et al. 1993).

Sources: Nielsen & Chuang §2.2.3–2.2.6 and §8.4.2.

**Exercises:**
1. ★ Measure |+⟩ in the Z basis and read the probabilities.
2. ★ Draw a demolition and a non-demolition ONB measurement, and say what differs.
3. ★ Interference: compare H–H with H–measure–H.
4. ★★ Measurement backaction (§7.2.1) on a two-qubit state.
5. ★★ Gate teleportation (§7.2.2): verify it.
6. ★★ Entanglement swapping (§7.2.4): verify the end qubits are left in a Bell state.
7. ★★ A von Neumann measurement with rank-2 projectors: the two-qubit parity measurement.
8. ★★ A four-outcome POVM. Check ΣEᵢ = 1 and the outcome probabilities.
9. ★★★ Naimark dilation (§7.3.4): realise that POVM as an ONB measurement on a larger system.
10. ★★★ State tomography (§7.4.1): reconstruct ρ from three Pauli expectation values and compare it with the Bloch sphere.

---

### Chapter 8 — Picturing classical-quantum processes (PQP ch. 8)

**PQP sections:**
- §8.1 classical wires, dense coding, measuring and encoding, cq-maps, deleting
- §8.2 spiders: copying, deleting, fusion, completeness
- §8.3 measuring and encoding as spiders, decoherence, "bastard" spiders, mixing, impure entanglement
- §8.4 protocols with spiders: teleportation, dense coding, swapping, von Neumann measurements, POVMs

**New in the Playground:**
- spiders and legs;
- one-click rewrites (fusion, identity, copy);
- thin classical wires and white dots;
- strict typing (a thin phase spider shown in red);
- rewriting by copy and paste in proofs.

**Two notations:**
- a classical wire ↔ a diagonal |i⟩⟨i| (familiar form) and a single index (PQP form);
- cq-states Σpᵢ|i⟩⟨i|⊗ρᵢ;
- decoherence ↔ the dephasing channel;
- spiders ↔ orthonormal bases (Coecke, Pavlović & Vicary 2013);
- dense coding (Bennett & Wiesner 1992).

**Exercises:**
1. ★ A basis state copies through a spider; a non-basis state does not. Check both.
2. ★ Fuse a chain of spiders in one proof.
3. ★ Prove that measuring then encoding is decoherence.
4. ★★ Dense coding (§8.1.2 and §8.4.4): build it and verify both bits arrive.
5. ★★ A classically controlled unitary (§8.4.2). Check both of its forms.
6. ★★ Teleportation with spiders (§8.4.3): a shorter proof than ch. 6's.
7. ★★ Mixing with spiders: the maximally mixed state as a spider plus a discard.
8. ★★ Entanglement swapping with spiders (§8.4.5).
9. ★★★ Bastard spiders (§8.3.3): which spiders with mixed thick and thin legs are causal, and why?
10. ★★★ "If it behaves like a spider it is one" (§8.2.4): test a candidate map against the spider equations, and show that a non-orthogonal "basis" fails.

---

### Chapter 9 — Picturing phases and complementarity (PQP ch. 9)

**PQP sections:**
- §9.1 phase states, phase spiders, phase fusion, the phase group, phase gates
- §9.2 complementarity, CNOT from complementarity, complementary measurements, QKD, teleportation
- §9.3 strong complementarity, the classical subgroup, parity maps
- §9.4 ZX-calculus: universality, Clifford, completeness

**New in the Playground:**
- phases and symbolic phases;
- colour change, π-copy and complementarity rewrites;
- H nodes;
- the circuit-to-ZX link (CNOT as two spiders);
- *needs adding:* the bialgebra rule (see §5).

**Two notations:**
- Z and X bases;
- phase gates R_Z(α), S, T;
- Paulis and Cliffords;
- mutually unbiased bases;
- BB84 (Bennett & Brassard 1984);
- ZX-calculus (Coecke & Duncan 2011; van de Wetering 2020).

**Exercises:**
1. ★ Phase spider fusion with symbolic α and β.
2. ★ S, T and Z(θ) in a circuit and in ZX. Show T∘T = S.
3. ★ Unbiasedness: |⟨+|i⟩|² = ½ in numbers and in pictures.
4. ★ Colour change, and back again.
5. ★★ Prove CNOT∘CNOT = 1 using fusion and complementarity.
6. ★★ Push an X through a CNOT (π-copy) and read off the Pauli propagation rule.
7. ★★ BB84 (§9.2.6): show that an eavesdropper measuring in the wrong basis learns nothing and disturbs the state.
8. ★★ Teleportation with complementary measurements (§9.2.7).
9. ★★★ Strong complementarity: prove that three CNOTs make a SWAP. *(Needs the bialgebra rule.)*
10. ★★★ Simplify a small Clifford circuit to a normal form, justifying each step (§9.4.2).

---

### Chapter 10 — Quantum theory: the full picture (PQP ch. 10)

PQP's summary chapter: the diagrams, processes and laws gathered in one place. This becomes a **review and synthesis** chapter; it introduces no new features.

**Two notations:** a one-page master dictionary covering pure, mixed, classical, cq and ZX, each with Dirac and density-matrix equivalents and sources.

**Exercises:**
1. ★ Classify given diagrams: circuit, string, doubled, spider or ZX.
2. ★ Express one process five ways.
3. ★ Match the laws to the demos.
4. ★★ Translate a protocol from Dirac to a diagram.
5. ★★ The same in reverse, from a diagram to Dirac.
6. ★★ Find the error in a "proof" (*starter*: the checker shows a red step).
7. ★★ Causality checks.
8. ★★ Find the no-broadcasting step inside a protocol.
9. ★★★ Design a protocol for a stated task.
10. ★★★ Explain one result where the diagram gives insight that the matrices do not.

---

### Chapter 11 — Quantum foundations (PQP ch. 11)

**PQP sections:**
- §11.1 non-locality: GHZ–Mermin scenarios, "drawing a contradiction"
- §11.2 quantum-like process theories: complementarity in relations, Spekkens' toy theory, phases and ZX in spek, non-locality in spek

**Two notations:**
- GHZ (Greenberger, Horne & Zeilinger 1989; Mermin 1990);
- local hidden variables;
- Spekkens 2007.

**Exercises:**
1. ★ GHZ from a circuit; read it as a single spider.
2. ★ Measure GHZ in X and Y; see the phases appear on the spider.
3. ★★ Compute the Mermin outcome products by phase arithmetic.
4. ★★ "Drawing a contradiction" (§11.1.3): the parity argument against local hidden variables.
5. ★★ Four-party GHZ: generalise the argument.
6. ★★ Compare with a CHSH-style Dirac calculation (cited).
7. ★ *(paper)* Relations as a process theory.
8. ★★ *(paper)* Complementarity in relations.
9. ★★★ *(paper)* Phases in spek.
10. ★★★ *(paper)* Why spek has no GHZ non-locality.

Exercises 7–10 are on paper: the Playground computes only with complex matrices (see §5).

---

### Chapter 12 — Quantum computation (PQP ch. 12)

**PQP sections:**
- §12.1 circuits as ZX diagrams, building gates, universality
- §12.2 oracles, Deutsch–Jozsa, quantum search, the hidden subgroup problem
- §12.3 MBQC: graph and cluster states, measurement, feed-forward, universality

**Two notations:**
- the circuit model (Nielsen & Chuang ch. 4);
- Deutsch–Jozsa (Deutsch & Jozsa 1992);
- Grover 1996;
- MBQC (Raussendorf & Briegel 2001);
- graph states (Hein et al. 2004).

**Exercises:**
1. ★ Turn a circuit into ZX and simplify it.
2. ★ CZ = (1⊗H)∘CNOT∘(1⊗H), in pictures.
3. ★ An oracle as a box, and phase kickback.
4. ★★ An Euler decomposition, and the universality of single-qubit gates.
5. ★★ Deutsch–Jozsa on two input bits: constant vs balanced.
6. ★★ Grover's algorithm with two qubits: one iteration finds the marked item (Numbers bars).
7. ★★ Simon's problem in the smallest case (the HSP, §12.2.4).
8. ★★ Build a linear cluster state and a graph state.
9. ★★★ MBQC: implement a single-qubit rotation by measurement and feed-forward on classical wires.
10. ★★★ Show that the MBQC pattern implements Z(α)∘X(β) for every α and β.

---

### Chapter 13 — Quantum resources (PQP ch. 13)

**PQP sections:**
- §13.1 resource theories: free processes, comparing and measuring resources
- §13.2 purity theory
- §13.3 LOCC and SLOCC entanglement, "exploding spiders", arithmetic

**Two notations:**
- majorisation (Nielsen 1999);
- LOCC, Schmidt coefficients and entanglement entropy;
- SLOCC classes, GHZ vs W (Dür, Vidal & Cirac 2000);
- Coecke & Kissinger 2010.

**Exercises:**
1. ★ Free processes in purity theory.
2. ★ Compare the purity of two states by Bloch radius.
3. ★★ Check majorisation between two states.
4. ★★ An LOCC conversion of a Bell state into a less entangled state.
5. ★★ Schmidt coefficients from a matrix.
6. ★★ GHZ and W as diagrams.
7. ★★ Measuring an impurity monotone.
8. ★★★ GHZ and W are not SLOCC-equivalent.
9. ★★★ Exploding spiders (§13.3.3).
10. ★★★ The arithmetic of W-type spiders (§13.3.4).

---

### Chapter 14 — Quantomatic (PQP ch. 14): omitted

Its ideas become Playground features instead (§9).

## 4. Feature coverage map (G1)

| Feature | First taught | Reused in |
|---|---|---|
| Workbook Browser, save / save a copy | 3 | every chapter |
| Panel split, merge, resize, editor switch | 3 | every chapter |
| Diagram Editor basics, inspector, legs, ∘⊗ bar | 3 | every chapter |
| Circuit Editor (gates, controls) | 3 | 5, 9, 12 |
| Circuit measurement, classical control, ⏚ | 6 | 7, 8, 12 |
| Equation Editor (＋ Step, Insert diagram, = vs ≈) | 3 | every chapter |
| Copy–paste rewriting | 3 | 8, 9 |
| Cups, caps, sliding (S), Pull taut (T) | 4 | 5, 6 |
| PQP shapes f, fᵀ, f†, f̄ | 4 | 5, 6 |
| Symbolic boxes and phases, random-substitution checks | 4 | 5, 9 |
| Assumptions (unitary, causal, isometry) | 4 / 6 | 6, 7 |
| Sums Σᵢ | 5 | 6, 7, 8 |
| Numbers panel (matrix, flags, Born bars, density operator, Bloch sphere) | 4 / 5 / 6 | 7, 11, 13 |
| Dirac editor (generate, verify, familiar / PQP forms, hover links) | 3 / 5 / 6 | every chapter |
| Doubled picture, white dots, strict typing | 6 / 8 | 7, 9, 12 |
| One-click spider rewrites | 8 / 9 | 9, 11, 12 |

## 5. Software work this curriculum needs

**Textbook and workbook infrastructure (needed from chapter 3):**

1. **The textbook site, `frontend/textbook/`.**
   - Plain static HTML, one page per chapter, with sidebar navigation and previous/next links.
   - KaTeX for formulas.
   - "Open in Playground" links using the existing `?demo=<id>`.
   - A global bibliography page.
   - It deploys with `frontend/`, needs no build step, and uses relative paths only.
2. **Figures rendered by the app's own drawing code.**
   - A small read-only `<qpp-figure>` element that draws a diagram straight from a workbook.
   - The book's pictures are then exactly what students see, and are checked by `build-demos`.
3. **Folders in the Workbook Browser's Demos tree:**
   - *Textbook ▸ Chapter N ▸ Demos / Exercises*;
   - *Software tour*: the nine existing demos, moved here.
   - Files go in `demos/textbook/chNN/…` and `demos/software/…`. Everything is still generated by `tools/build-demos.mjs`, which already fails the build if any proof doesn't check.
4. **Exercise workbooks:**
   - A read-only **task note** shown in the workbook: the exercise's statement and a link back to the book.
   - An optional **goal** on a proof: its first and last steps are locked, and it shows "✓ Solved" when the whole chain checks.

**Mathematical features needed by specific chapters:**

5. **Bialgebra (strong complementarity) rewrite** (ch. 9, 12). Already on the to-do list.
6. **More assumptions:** self-adjoint, positive, projector (ch. 4, 5, 7).
7. **Entering a box's matrix in the inspector** (ch. 5, 7 POVMs, 13 W state). Today a box's matrix can only be set in code.
8. **Numbers additions:** eigenvalues / Schmidt coefficients, and purity Tr ρ² (ch. 4 ex. 10, ch. 13).

**Out of scope, taught on paper:**

9. Relations and Spekkens' toy theory (ch. 3 ex. 10, ch. 11 ex. 7–10): the Playground computes only with complex matrices.

## 6. Citation and copyright policy

- PQP is cited by section, definition, proposition or theorem number, from the author's PDF.
- PQP prose is always paraphrased.
- Exercises are original, or marked "adapted from PQP Exercise x.y".
- Every "Two notations" box cites a standard source for the familiar formalism, at section or equation level. The core sources are:
  - Nielsen & Chuang, *Quantum Computation and Quantum Information*, 10th anniversary ed. (CUP 2010);
  - Watrous, *The Theory of Quantum Information* (CUP 2018);
  - the original papers named above.
- Every citation is checked against the source when the chapter is written. None is cited from memory.
- The bibliography is one shared file. Each chapter cites by key, and the page renders the numbered list.

## 7. Proposed build order

1. Infrastructure: items 1–4 in §5, and the Demos reorganisation.
2. Chapter 3 complete (text, demos, ten starters) as a pilot for review.
3. Chapters 4–6, adding the math features as each chapter needs them.
4. Chapters 7–9, then 12.
5. Chapters 10, 11, 13 and the appendix.

## 8. Decisions (2026-11-20)

- **Solutions: hints only.**
  - Each exercise has graded, collapsible hints in the book.
  - No solution workbooks are shipped.
  - Hint reveals and answer checks are designed as events, so that student-activity logging can record them later through `backend/`.
- **Chapter 14 (Quantomatic): omitted as a chapter.** Its ideas are taken up as Playground features instead (§9).
- **Starters: one workbook per exercise, in a folder per chapter.** For example, *Textbook ▸ Chapter 4 ▸ Exercises ▸ 4.3 Slide f round a cap*, with id `pqp04-ex03`.
- **Edition: the author's PDF.** Section numbers follow its outline. Page numbers, where needed at all, are PDF page labels.

## 9. Quantomatic, and what to adopt from it

**Status.**
- PQP ch. 14 describes it as a diagrammatic proof assistant. It does step-by-step and automated rewriting ("simprocs"), uses !-box rule families, and synthesises conjectures from generators given as matrices.
- The repository (github.com/Quantomatic/quantomatic) was archived on 13 March 2026. Its README says it is no longer maintained and names no direct successor. It points to two related projects:
  - ZXLive (zxcalc/zxlive): a Python/Qt desktop ZX editor and prover built on PyZX, Apache-2.0;
  - Chyp (akissinger/chyp): a prover for symmetric monoidal theories with a proof language.
- Quantomatic is GPL, written in Scala and ML, and is a desktop program, so we reuse its ideas and not its code.

**Overlap with the Playground.** Both have:
- diagram editing;
- rule-based rewriting with a recorded derivation.

Quantomatic is purely syntactic, a rewrite engine, and has no semantics shown to the user. The Playground checks every step semantically, covers all of PQP (doubled, classical, cq), and links to Dirac and matrices. That pedagogical layer has no counterpart in Quantomatic, ZXLive or Chyp.

**Ideas to adopt, by value:**
1. **Lemmas.** A proved equation can be saved as a rule and then applied like a built-in rewrite. Students build their own calculus, which is PQP's "build your own calculus" (§9.4.4) made concrete. *High value: chapters 8–12.*
2. **Simplify.** An automated strategy (fusion, identity removal, H·H, colour change toward a normal form) that records every step in the proof. This is like Quantomatic's simprocs or PyZX's simplifiers. It can be disabled inside exercises. *Needed for big MBQC and circuit diagrams in ch. 12.*
3. **Exporting proofs** as an image or LaTeX/TikZ for write-ups. *Medium.*
4. **!-box rule families.** Spiders of any arity already cover the main use, so this is only for general lemmas. *Low.*
5. **Conjecture synthesis.** Enumerate small diagrams from given generators and report the equations that hold. It could be an optional "discovery lab" (ch. 13's W/GHZ anti-spiders are PQP's own example). *Research-grade, optional.*
