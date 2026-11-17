# Quantum Pictural Playground

A browser-based teaching tool for quantum pictorial diagrams and Dirac
notation, following Coecke & Kissinger's
[*Picturing Quantum Processes*](https://www.cambridge.org/core/books/picturing-quantum-processes/1119568B3101F3A685BE832FEEC53E52).
Features a **drag-and-drop diagram editor** and a **Dirac formula editor**
with **bidirectional synchronisation**: diagrams generate Dirac expressions,
and student-written expressions are verified against diagrams.

The interface uses a **Blender-style split-panel layout** where every panel
can be split, merged, resized, and assigned an arbitrary editor type.

---

## Features

### Diagram Editor
- **10 generator types** from ZX-calculus / categorical quantum mechanics:
  Z Spider, X Spider, Hadamard, Morphism box, Cup (η), Cap (ε), Swap (σ),
  State (ψ), Effect, Scalar
- **Bottom-to-top flow** (PQP convention): inputs from below, outputs above.
  "↑ time" indicator in the canvas corner.
- Tools: **Select**, **Wire**, **Delete**. Pan (Alt+drag), Zoom (scroll).
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
- **Tensor contraction** — brute-force for ≤6 qubits, sub-millisecond

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
| Wire nodes | **Wire** tool (⟶) → click source node → drag to target |
| Edit label/phase | **Double-click** node |
| Select | Click; **Shift+click** multi; drag box-select; **Cmd+A** all |
| Delete | **Delete**/**Backspace** key, or 🗑 button |
| Pan / Zoom | **Alt+drag** or middle-mouse / **Scroll wheel** |
| Undo / Redo | **Cmd+Z** / **Cmd+Shift+Z** |
| Switch diagram | **Diagram** dropdown; **＋ New** to create |

### Dirac Formula Editor

| Action | How |
|---|---|
| Enter formula | Type LaTeX — preview updates live |
| Insert snippet | Click a snippet button (kets, bras, ⊗, †, etc.) |
| Link to diagram | **Linked diagram** dropdown |
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
│   ├── Verify.js                     # Tensor comparison with pedagogical hints
│   ├── SyncController.js             # Sync state machine (stale/equivalent/etc.)
│   └── Config.js                     # Thresholds and settings
├── editors/
│   ├── EditorRegistry.js             # Pluggable editor type registry
│   ├── DiagramEditor/                # Canvas-based diagram editor
│   │   ├── DiagramEditor.js          # Toolbar + doc selector + canvas + palette
│   │   ├── DiagramCanvas.js          # Interactive canvas + boundary markers
│   │   ├── DiagramNode.js            # 10 generator types + rendering
│   │   ├── DiagramWire.js            # Bézier wires + hit-testing
│   │   ├── DiagramToolbar.js         # Tool & node-add buttons
│   │   ├── DiagramDocument.js        # Shared data model + undo/redo + observer
│   │   └── DiagramDocumentStore.js   # Singleton document registry
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
