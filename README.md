# Quantum Pictural Playground

A browser-based teaching tool for quantum pictorial diagrams and Dirac
notation, following Coecke & Kissinger's
[*Picturing Quantum Processes*](https://www.cambridge.org/core/books/picturing-quantum-processes/1119568B3101F3A685BE832FEEC53E52).
Features a **drag-and-drop diagram editor** and a **Dirac formula editor**
with **bidirectional synchronisation**: diagrams generate Dirac expressions,
and student-written expressions are verified against diagrams.

The default layout shows a **Circuit Editor** and a **Diagram Editor** side by side above a **Dirac editor**.
The interface uses a **Blender-style split-panel layout** where every panel
can be split, merged, resized, and assigned an arbitrary editor type.

---

## Features

### Circuit Editor
- **Quirk-style circuits** — drag gates onto wires; controls, anti-controls, swaps, phase gates
- **Live PQP diagram** — each circuit keeps a generated ZX-style diagram (CNOT = spiders joined by a horizontal leg)
- **Dirac** — written step by step, e.g. `CNOT (H ⊗ I)|00⟩`, and verified like any diagram

### Diagram Editor
- **10 generator types** from ZX-calculus / categorical quantum mechanics:
  Z Spider, X Spider, Hadamard, Morphism box, Cup (η), Cap (ε), Swap (σ),
  State (ψ), Effect, Scalar
- **Bottom-to-top flow** (PQP convention): inputs from below, outputs above.
  "↑ time" indicator in the canvas corner.
- **No tool modes** — drag port handles to wire, drag nodes to move, 🗑 deletes the selection. Pan (Alt+drag), Zoom (scroll).
- **Inspector** — edit the selected node's label/phase and its number of input/output legs
- **Spider legs** — wires between two spiders are legs (direction-free, by flexsymmetry): drawn straight between the dots, added on demand, and removed together with the wire
- **Phase/label editing** — double-click any node
- **Palette sidebar**, **multiple diagrams**, **undo/redo** (Cmd/Ctrl+Z)
- **Boundary markers** — numbered "in/out" labels on open ports

### Dirac Formula Editor
- LaTeX textarea with **live KaTeX rendering** and **16 snippet buttons**
- **Linked to diagrams** — dropdown selector for which diagram to sync with
- **Generate** — diagram → Dirac expression (per-component, with recognition)
- **Verify** — student expression vs diagram: ✓ Equivalent / ✗ Not equivalent
- **Never overwrites student work** — generated forms shown as suggestions

### Diagram → Dirac Translation
- **Component decomposition** — disconnected pieces translated independently
- **Named-object recognition** — CNOT, CZ, SWAP, H, X, Y, Z, S, T, Bell
  states/effects, computational basis (up to scalar)
- **Pedagogical classification** (Categories A–G)
- **Scalar folding** — cancelling scalars simplified away
- **Tensor contraction** — pairwise tensor-network contraction (greedy order); wire order follows port positions, left to right

### Verification
- Shape-aware; phase vs scalar distinction; pedagogical hints on disagreement

### Layout Engine
- Split / merge / resize panels; switch editor type per-panel

---

## Getting Started

No build step required — pure vanilla ES modules + one CDN dependency (KaTeX).

```bash
cd QuantumPicturalPlayground
python3 serve.py 8080          # dev server with no-cache headers
```

Open **http://localhost:8080** in your browser.
Run tests at **http://localhost:8080/tests/test-fixtures.html**.

> **Note:** Must be served over HTTP (not `file://`). Use `serve.py` for
> development (sends no-cache headers on all responses including ES modules).

---

## Usage

### Diagram Editor

| Action | How |
|---|---|
| Add node | Toolbar shape button, or **☰** palette (click/drag) |
| Wire nodes | Drag from a port handle (dot) to a port on another node — or onto the node |
| Join two spiders | Hover/select a spider, drag its **+** handle onto another spider — both gain a leg, drawn straight between them (e.g. the CNOT's control–target wire) |
| Re-route / remove wire | Drag a connected port's handle to another port; drop on empty space to remove |
| Edit label/phase | **Double-click** node, or the **Label** field in the inspector |
| Change leg count | **In / Out ±** in the inspector (spiders, boxes); **−** removes an unconnected leg first |
| Remove a specific leg | Click its dot to select it, then 🗑 (or **Delete**) |
| Select / move | Click; **Shift+click** multi; drag box-select; **Cmd+A** all; drag to move the selection |
| Delete | 🗑 button (or **Delete**/**Backspace**) deletes the selection |
| Pan / Zoom | **Alt+drag** or middle-mouse / **Scroll wheel** |
| Undo / Redo | **Cmd+Z** / **Cmd+Shift+Z** |
| Switch diagram | **Diagram** dropdown; **＋ New** to create |

### Dirac Formula Editor

| Action | How |
|---|---|
| Enter formula | Type LaTeX — preview updates live |
| Insert snippet | Click a snippet button (kets, bras, ⊗, †, etc.) |
| Link to a diagram or circuit | **Linked to** dropdown — the generated expression appears and is verified at once (your own expression for the previous document goes to the saved list) |
| Generate Dirac | Click **Generate** — translates diagram to LaTeX |
| Verify | Click **Verify** — checks expression against diagram |
| Save / recall | **＋ Save Formula**; click to reload |

### Layout

| Action | How |
|---|---|
| Split panel | **⬌** / **⬍** in header, or drag corner grip |
| Close panel | **✕** in header |
| Resize | Drag divider between panels |
| Change editor | Dropdown in panel header |

---

## Architecture

```
js/
├── app.js                            # Boot: register editors, create LayoutManager
├── core/                             # Sync engine (pure computation, no DOM)
│   ├── FlowDirection.js              # Single source of truth for diagram convention
│   ├── Complex.js                    # Complex arithmetic as [re,im] pairs
│   ├── Tensor.js                     # Dense complex matrices: mul, kron, trace, etc.
│   ├── Phase.js                      # Rational π-multiple phases
│   ├── IR.js                         # Internal representation: typed open graph
│   ├── DiagramToIR.js                # Diagram → IR adapter + well-formedness checks
│   ├── ContractIR.js                 # Tensor network contraction
│   ├── Interpret.js                  # Generator → tensor (spiders, cups, caps, etc.)
│   ├── KnownGates.js                 # Recognition library (CNOT, H, Bell, etc.)
│   ├── Classify.js                   # Pedagogical classifier (Categories A–G)
│   ├── DiagramToDirac.js             # Diagram → Dirac LaTeX (component decomposition)
│   ├── DiracParser.js                # LaTeX → AST (recursive descent)
│   ├── DiracEval.js                  # AST → Tensor
│   ├── CircuitGates.js               # Gate library, column operators, reference simulator
│   ├── CircuitToIR.js                # Circuit → ZX-style IR (exact, scalars included)
│   ├── CircuitToDirac.js             # Circuit → Dirac, column by column
│   ├── Verify.js                     # Tensor comparison with pedagogical hints
│   ├── SyncController.js             # Sync state machine (stale/equivalent/etc.)
│   └── Config.js                     # Thresholds and settings
├── editors/
│   ├── EditorRegistry.js             # Pluggable editor type registry
│   ├── DocumentStore.js              # Registry of all documents (diagrams + circuits)
│   ├── DiagramEditor/                # Canvas-based diagram editor
│   │   ├── DiagramEditor.js          # Toolbar + doc selector + canvas + palette
│   │   ├── DiagramCanvas.js          # Interactive canvas + boundary markers
│   │   ├── DiagramNode.js            # 10 generator types + rendering
│   │   ├── DiagramWire.js            # Bézier wires + hit-testing
│   │   ├── DiagramToolbar.js         # Tool & node-add buttons
│   │   └── DiagramDocument.js        # Shared data model + undo/redo + observer
│   ├── CircuitEditor/
│   │   ├── CircuitEditor.js          # Drag-and-drop circuit editor (no tool modes)
│   │   ├── CircuitDocument.js        # Circuit model (Quirk-style columns) + undo/redo
│   │   ├── IRToDiagram.js            # Lay out a circuit's IR as a PQP diagram
│   │   └── CircuitDiagramLink.js     # Keep a generated diagram in sync with a circuit
│   └── DiracEditor/
│       └── DiracEditor.js            # Textarea + KaTeX + sync bar + Generate/Verify
└── layout/                           # Blender-style split-panel engine
    ├── LayoutManager.js, EditorArea.js, SplitHandle.js
```

### Key Design Patterns

- **Sync hub** — both editors translate into/out of a shared IR (typed open
  graph). They never translate directly into each other.
- **Observer pattern** — `DiagramDocument` fires change events; multiple
  canvases viewing the same document stay in sync automatically.
- **Component decomposition** — disconnected diagram pieces are translated
  independently and combined with ⊗.
- **Pluggable editors** — `EditorRegistry` decouples layout from editor types.
  New editors implement `typeName`, `constructor(el)`, `onResize()`, `destroy()`.

---

## Circuits

`CircuitDocument` models a Quirk-style circuit: qubits × time steps, where a
step's controls (•, ∘) condition every gate in that step and two × cells
swap. Qubit 0 is the leftmost tensor factor (leftmost wire in the diagram).
Inputs can be open or |0⟩, |1⟩, |+⟩, |−⟩; outputs open or post-selected.

- **→ diagram** (ZX style): phase gates become spiders, CNOT/CZ become spiders
  joined by legs, SWAP is a wire crossing, other controlled gates are boxes
  with their exact matrix. Scalars are collected into one scalar node, so the
  diagram equals the circuit exactly.
- **→ Dirac**: one factor per step, latest on the left, e.g.
  `\operatorname{CNOT}(H \otimes I)|00\rangle`; controlled gates in projector form.
- The Dirac editor can link to a circuit and verify against it.

### Circuit Editor

| Action | How |
|---|---|
| Add a gate | Drag it from the palette onto a wire — onto a step, or into the gap between steps to insert a new step (an occupied cell is replaced) |
| Controlled gates | Put • (control) or ∘ (anti-control) in the same step: they condition every gate in that step |
| Swap | Two × in one step |
| Move / remove | Drag a placed gate; drag it off the circuit to remove it |
| Select / delete | Click a gate or a qubit label (q0, q1, …), then 🗑 or **Delete** |
| Phase of Z(θ), X(θ) | Select the gate, type in the inspector's **Phase** field (π/8, −π/2, α, …) |
| Inputs / outputs | Pickers at each end of a wire: open, \|0⟩, \|1⟩, \|+⟩, \|−⟩ (outputs: post-selected effects) |
| Qubits | **＋ Qubit**; select a qubit label + 🗑 to remove |
| View | Circuit (time →) or Algebraic (time ←) |
| Show the diagram | **◇ Diagram** — opens the circuit's PQP diagram in the Diagram Editor and links the Dirac editor |
| Undo / Redo | **Cmd+Z** / **Cmd+Shift+Z** |


---

## Reading conventions

Two independent settings:

| Setting | Where | Options | Changes the maths? |
|---|---|---|---|
| **View** — which way time flows | each Diagram Editor panel | PQP (↑), Top-down (↓), Circuit (→), Algebraic (←, as in Wood, Biamonte & Cory: reads like the formula) | No — drawing only |
| **⊗ order** — which wire is the first tensor factor | each document (diagram or circuit) | First wire first (Nielsen & Chuang, PQP) · First wire last (Qiskit, Quirk) | Yes — Dirac output and verification follow it |

Documents are stored in the PQP frame; a view is a rotation/reflection of
it, so changing the view can never change a diagram's meaning. "First wire"
means leftmost in the PQP view (topmost in the Circuit and Algebraic views).
A diagram generated from a circuit takes the circuit's ⊗ order. The Dirac
editor shows the order of the document it is linked to.

---

## Diagram Convention

Diagrams follow the **PQP (bottom-to-top)** convention:

| Element | Role | Ports |
|---|---|---|
| Cup (∪) | State \|Φ⁺⟩ | 2 outputs (top) |
| Cap (∩) | Effect ⟨Φ⁺\| | 2 inputs (bottom) |
| State (▽) | State preparation | 1 output (top) |
| Effect (△) | Measurement/effect | 1 input (bottom) |
| Z/X Spider | Observable spider | Outputs top, inputs bottom |
| Box (H, f) | Process | Output top, input bottom |
| Swap | Wire crossing | Outputs top, inputs bottom |

The flow direction is controlled by `js/core/FlowDirection.js` and consulted
by port positioning, drawing, interpretation, and boundary ordering.

---

## Documentation

| Document | Path |
|---|---|
| Architecture analysis | `docs/existing-architecture.md` |
| Compute-location decision | `docs/decision-compute.md` |
| Component-decomposition fix | `docs/fix-disconnected-components.md` |
| Shape/scalar/direction fix | `docs/fix-bra-ket-shape-scalar.md` |

---

## Tests

Open **http://localhost:8080/tests/test-fixtures.html** in a browser.
Tests cover: component decomposition, cup/cap tensors, CNOT recognition,
scalar folding, round-trip (generate → parse → eval → verify), shape
mismatch rejection, and direction correctness.

---

## Dependencies

| Dependency | Source | Purpose |
|---|---|---|
| [KaTeX](https://katex.org/) 0.16.9 | CDN | LaTeX rendering |

Everything else is **vanilla JavaScript ES modules** — no bundler, no
framework, no transpilation. ~2,000 lines of core sync engine (`js/core/`).

---

## Browser Support

Modern Chromium (Chrome, Edge, Arc) and Firefox.
Requires ES module support (`<script type="module">`).

---

## License

MIT
