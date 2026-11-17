# Existing Architecture

Document produced by reading the full codebase as the first step of the
bidirectional-sync project. All descriptions reflect the code at commit time;
no changes have been made.

---

## 1. Technology stack

| Aspect | Detail |
|---|---|
| Language | Vanilla JavaScript, ES modules (`<script type="module">`) |
| Framework | None |
| Bundler | None — static files served by `serve.py` (Python `http.server` subclass with no-cache headers) |
| Rendering (diagrams) | HTML5 `<canvas>` 2D context, manual draw loop |
| Rendering (Dirac) | [KaTeX](https://katex.org/) 0.16.9 loaded from CDN (`jsdelivr`) |
| Layout | Custom Blender-style binary split-tree layout engine |

## 2. File map

```
index.html                                    Entry point
serve.py                                      Dev server (no-cache headers)
css/
  main.css                                    Theme variables, reset
  layout.css                                  Split panels, handles, grips
  diagram-editor.css                          Canvas, toolbar, palette
  dirac-editor.css                            Textarea, preview, formula list
js/
  app.js                                      Boot: register editors, create LayoutManager
  layout/
    LayoutManager.js                          Binary split-tree; render(); split/close/focus
    EditorArea.js                             Panel: header dropdown + mounted editor
    SplitHandle.js                            Draggable divider
  editors/
    EditorRegistry.js                         Map<typeName, class>; pluggable editor types
    DiagramEditor/
      DiagramEditor.js                        Composes toolbar + doc selector + canvas + palette
      DiagramCanvas.js                        Interactive canvas; pan/zoom/drag/wire/select/undo
      DiagramNode.js                          Node model + per-shape rendering
      DiagramWire.js                          Wire model + Bézier rendering + hit-testing
      DiagramToolbar.js                       Tool & node-add buttons
      DiagramDocument.js                      Shared data: nodes Map, wires Array, undo/redo, observer
      DiagramDocumentStore.js                 Singleton registry of DiagramDocuments
    DiracEditor/
      DiracEditor.js                          Textarea + KaTeX preview + snippets + formula list
```

---

## 3. Layout engine

### LayoutManager (`js/layout/LayoutManager.js`)

Maintains a binary tree:
- **Leaf**: `{ type:'leaf', areaId, area: EditorArea }`
- **Split**: `{ type:'split', direction:'horizontal'|'vertical', ratio:0–1, children:[node,node], handle: SplitHandle }`

`render()` clears the root element and rebuilds the DOM with explicit pixel
sizes computed from the tree. A `ResizeObserver` on the root re-renders on
window resize. Each re-render calls `area.onResize()` on every leaf, which
propagates to the editor's `onResize()`.

### EditorArea (`js/layout/EditorArea.js`)

Each panel has:
- A **header** with a `<select>` listing all registered editor type names,
  plus split-H/split-V/close buttons and a drag-to-split corner grip.
- A **body** (`div.editor-area-body`) into which the chosen editor is
  instantiated via `EditorRegistry.create(typeName, bodyEl)`.
- Switching the dropdown calls `_destroyEditor()` then `_mountEditor()` with
  the new type.

### Editor interface contract

```
static get typeName() → string
constructor(containerEl)             — mount into DOM element
onResize()                           — respond to container size changes
destroy()                            — clean up DOM + listeners
```

---

## 4. Diagram Editor — data model

### DiagramDocument (`DiagramDocument.js`)

The authoritative data container. Multiple `DiagramCanvas` instances can
subscribe to the same document via the observer pattern.

```
DiagramDocument {
  id:    string            "doc-0", "doc-1", …
  name:  string            User-visible name
  nodes: Map<string, DiagramNode>
  wires: DiagramWire[]
  _undoStack: string[]     JSON snapshots (max 50)
  _redoStack: string[]
  _listeners: Set<Function>

  onChange(fn) / offChange(fn)   Observer subscription
  commit()                       Fires all listeners (call after mutation)
  pushUndo()                     Snapshot before mutation
  undo() → bool                  Pop undo, push redo, notify
  redo() → bool                  Pop redo, push undo, notify
}
```

Serialization format (undo snapshots):
```json
{
  "nodes": [{ "id", "typeKey", "x", "y", "label", "inputs", "outputs", "selected" }],
  "wires": [{ "id", "fromNodeId", "fromPort", "toNodeId", "toPort", "selected" }]
}
```

### DiagramDocumentStore (`DiagramDocumentStore.js`)

Module-level singleton. `Map<id, DiagramDocument>`. Fires `onListChange` when
documents are created or removed. DiagramEditor instances use this to populate
the document-selector dropdown.

### DiagramNode (`DiagramNode.js`)

```
DiagramNode {
  id:       string          "node-0", "node-1", …
  type:     NODE_TYPE       Reference to a static type descriptor (see below)
  x, y:    number           World-space position (canvas origin at top-left)
  label:   string           Phase for spiders, name for morphisms/states; free text
  inputs:  number           Current input port count (mutable; initialized from defIn)
  outputs: number           Current output port count (mutable; initialized from defOut)
  selected: boolean
  radius:  number           Computed from shape
}
```

**NODE_TYPES** — static descriptors (not instances):

| Key | `key` string | shape | defIn | defOut | Semantic |
|-----|-------------|-------|-------|--------|----------|
| Z_SPIDER | `z-spider` | circle (green) | 1 | 1 | Z observable spider |
| X_SPIDER | `x-spider` | circle (red) | 1 | 1 | X observable spider |
| HADAMARD | `hadamard` | box (yellow) | 1 | 1 | Colour-change gate |
| MORPHISM | `morphism` | morphbox (blue) | 1 | 1 | Generic labelled process |
| CUP | `cup` | cup (gray) | 0 | 2 | Bell-state ∪ |
| CAP | `cap` | cap (gray) | 2 | 0 | Bell-effect ∩ |
| SWAP | `swap` | swap (gray) | 2 | 2 | Wire crossing σ |
| STATE | `state` | triangle-down (blue) | 0 | 1 | State preparation |
| EFFECT | `effect` | triangle-up (purple) | 1 | 0 | Effect / measurement |
| SCALAR | `scalar` | scalar (purple) | 0 | 0 | Scalar I→I |

**Key observations for the sync project:**
- `inputs`/`outputs` are **mutable** per-instance (default from `defIn`/`defOut` but
  overridden by the default diagram, e.g. Z-spider set to 1-in/2-out). Spiders
  can have arbitrary leg counts.
- `label` is **free text**. For spiders it is a phase string like `α`, `π/2`; for
  morphisms it is a name like `f`; for states it is `ψ`, etc. There is **no
  structured phase representation** — the label is not parsed. This will need
  to be addressed for the internal representation.
- There is **no wire type** — all wires are untyped. The spec requires qubit-thin,
  qubit-thick, and classical. This must be added to DiagramWire.
- There is **no tensor / matrix data** on nodes. The spec requires optional
  concrete matrices and symbolic forms.
- There is **no provenance tracking** for cross-highlighting.
- There is **no boundary ordering** — open inputs/outputs of the diagram are
  not explicitly ordered.

### DiagramWire (`DiagramWire.js`)

```
DiagramWire {
  id:         string
  fromNodeId: string    Source node id
  fromPort:   number    Output port index on source
  toNodeId:   string    Target node id
  toPort:     number    Input port index on target
  selected:   boolean
}
```

Wires are **directed** (output → input). There is no wire type, no decoration,
and no identity / identity-wire concept.

---

## 5. Diagram Editor — rendering and event flow

### DiagramCanvas (`DiagramCanvas.js`)

The interactive view layer. Each instance is bound to one `DiagramDocument` via
its constructor and can be switched to a different document at runtime via
`setDocument(doc)`.

**Data access.** `DiagramCanvas` does not own nodes or wires. It exposes proxy
getters:
```js
get nodes() { return this.doc.nodes; }
get wires() { return this.doc.wires; }
set wires(v) { this.doc.wires = v; }
```
All reads/writes go through `this.doc`.

**Observer subscription.** On construction, the canvas registers
`this._onDocChange = () => this.draw()` via `doc.onChange(fn)`. When any editor
(including itself) calls `doc.commit()`, all subscribed canvases redraw. This is
the mechanism by which two diagram editors viewing the same document stay in sync.

**Render loop.** `draw()` is not a continuous rAF loop — it is called on-demand:
1. After any user interaction that mutates the view (pan, zoom, selection).
2. After any data mutation, via the observer callback.

Draw order:
1. Clear canvas.
2. `ctx.translate(panX, panY); ctx.scale(zoom, zoom);` — applies pan/zoom transform.
3. `_drawGrid()` — 30px grid lines at 15% white opacity, in world space.
4. Wires — each `DiagramWire.draw(ctx, nodesMap)` draws a vertical Bézier.
5. Wiring preview — dashed Bézier from source port to mouse position (if in progress).
6. Nodes — each `DiagramNode.draw(ctx)` draws its shape, label, and port dots.
7. Restore transform.
8. Selection rectangle (if active) — drawn in screen space.

**Canvas sizing.** `resize()` reads `wrapEl.getBoundingClientRect()`, sets the
canvas buffer to `width×dpr, height×dpr`, and applies `ctx.setTransform`. A
retry loop (`_retryResize`) handles the case where the DOM hasn't laid out yet.

**Tool modes.** `activeTool` is one of `TOOLS.SELECT`, `TOOLS.WIRE`, or
`TOOLS.DELETE`. Behaviour per tool on mousedown:

| Tool | Click on node | Click on empty space |
|------|---------------|---------------------|
| SELECT | Select + start drag (pushUndo) | Start box-selection rect |
| WIRE | `_findOutputPort()` → start wiring state | Toast "Click on a node" |
| DELETE | pushUndo, delete node + connected wires | Try wire hit-test, delete if hit |

**Wire creation.** Uses `_findOutputPort(wx,wy)` on mousedown and
`_findInputPort(wx,wy)` on mouseup. Both try exact port-dot hit first
(radius 8px), then fall back to nearest port on the node body. Feedback toasts
for: empty space, no ports, self-loop, duplicate wire.

**Undo/redo delegation.** `pushUndo()`, `undo()`, and `redo()` all delegate to
`this.doc`. After every mutation, `_commit()` calls `this.doc.commit()` which
triggers the observer, which calls `draw()` on all subscribed canvases.

**Keyboard shortcuts:**
- Delete/Backspace → `deleteSelected()`
- Cmd/Ctrl+A → select all
- Cmd/Ctrl+Z → undo
- Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y → redo

### DiagramEditor (`DiagramEditor.js`)

The top-level editor component registered with `EditorRegistry`. Composes:

1. **DiagramToolbar** — tool buttons (Select/Wire/Delete), node quick-add
   buttons (one per NODE_TYPE with shape-specific swatch icons), palette toggle
   (☰), delete-selected (🗑).
2. **Document selector bar** — a `<select>` dropdown populated from
   `DiagramDocumentStore.list()`, plus a "＋ New" button that calls
   `DiagramDocumentStore.create(name)`. Listens to `onListChange` so if
   another editor creates a document, all dropdowns update.
3. **Canvas wrapper** — a `position:relative` div hosting the `DiagramCanvas`.
4. **Palette sidebar** — a slide-out panel (toggle with ☰) listing all
   NODE_TYPES. Items can be clicked (adds at canvas center) or dragged onto the
   canvas (adds at drop position via `dragover`/`drop` events).
5. **DiagramCanvas** — instantiated with the current `DiagramDocument`.

Document switching: `_onDocSelectChange()` calls `this.canvas.setDocument(doc)`,
which unsubscribes from the old doc's observer and subscribes to the new one.

**Default diagram.** On first creation (when `DiagramDocumentStore` is empty),
creates an "Example" document and populates it with a demo layout: cup, cap,
morphism box, Z-spider (α, 1→2), X-spider (β, 2→1), Hadamard, swap, state
(ψ), effect (φ), and several wires.

---

## 6. Dirac Formula Editor — data model and behaviour

### DiracEditor (`js/editors/DiracEditor/DiracEditor.js`)

**Data model: none.** The editor's content is a raw LaTeX string in a
`<textarea>`. There is no parsed AST, no structured representation, and no
semantic model. The textarea's `.value` is the single source of truth.

**Rendering.** On every `input` event, `_render()` passes the trimmed textarea
value to `katex.render(latex, el, { displayMode: true, throwOnError: true })`.
If KaTeX throws, the error message is displayed in a `.render-error` div. There
is no debounce — rendering is synchronous and per-keystroke.

**Snippets.** 16 hardcoded LaTeX fragments are presented as buttons in a
toolbar. Clicking inserts the fragment at the cursor position in the textarea
and re-renders. The snippets are:

| Label | LaTeX |
|-------|-------|
| \|ψ⟩ | `\|\psi\rangle` |
| ⟨ψ\| | `\langle\psi\|` |
| ⟨φ\|ψ⟩ | `\langle\phi\|\psi\rangle` |
| \|0⟩, \|1⟩, \|+⟩, \|−⟩ | Corresponding kets |
| ⊗, ⊕, † | `\otimes`, `\oplus`, `^\dagger` |
| Σ | `\sum_{i}` |
| √ | `\frac{1}{\sqrt{2}}` |
| H | `\hat{H}` |
| CNOT | `\text{CNOT}` |
| I | `\mathbb{I}` |
| α\|0⟩+β\|1⟩ | Full expression |

**Saved formula list.** `this.formulas` is a plain `string[]` local to each
editor instance. The "＋ Save Formula" button pushes the current textarea value.
Clicking a saved formula reloads it into the textarea. The ✕ button splices it
from the array. The list is **not shared** between editor instances and is
**not persisted** — it is lost on editor destruction.

**No connection to diagram editor.** There is no import of diagram types, no
observer subscription to `DiagramDocument`, no document-selector dropdown, and
no sync logic of any kind. The two editors are entirely independent.

---

## 7. Gaps relative to the sync spec

Organized by whether the gap is an **extension** of an existing structure or an
**entirely new** component.

### 7a. Extensions to existing structures

| Existing structure | What's missing | Spec reference |
|---|---|---|
| **DiagramNode.label** | Currently free text. Needs a **structured phase** (rational multiple of π or symbolic expression) alongside the display label. | "optional tensor, optional symbolic form" |
| **DiagramNode** | No **tensor / matrix data**. Nodes need an optional concrete complex array and an optional symbolic form. | "each node carries an optional tensor" |
| **DiagramNode** | No **provenance** field for cross-highlighting. | "provenance (which editor element produced it)" |
| **DiagramWire** | No **wire type**. All wires are untyped. Needs `qubit-thin`, `qubit-thick`, `classical` (designed for future qudits). | "Wire types: qubit-thin, qubit-thick, classical" |
| **DiagramDocument** | No **boundary ordering**. Open (unconnected) inputs and outputs have no explicit order, which is required to interpret the diagram as a linear map. | "ordered input/output boundaries" |
| **DiagramDocument** | No concept of **well-formedness** validation. | "Reject with located diagnostics" |
| **DiracEditor** | No **parser**. Only KaTeX rendering; no AST or semantic model. | "parsing … grammar should cover atoms, structure, named states" |
| **DiracEditor** | No **document selector**. Not linked to any shared document or diagram. | "sync semantics" |
| **DiracEditor** | No **debounce** — re-renders per-keystroke. | "debounced, never per-keystroke rewriting" |
| **DiracEditor.formulas** | Local to each instance, not shared/persisted. | Implicit: needs to participate in the shared document model. |
| **NODE_TYPES** | Missing: **discard**, **measurement**, **preparation** (linking classical and quantum wires). Also no named standard gates (CNOT, CZ, S, T, Paulis as first-class types vs. labels). | "Generators to support" list |

### 7b. Entirely new components needed

| Component | Purpose | Spec reference |
|---|---|---|
| **Internal representation** | Typed open graph: generators with typed ports, wires, ordered boundaries. The sync hub that both editors translate into/out of. | "Shared internal representation" |
| **Diagram → IR adapter** | Walk `DiagramDocument` nodes/wires, build the internal graph, run well-formedness checks. | "Diagram → internal representation" |
| **IR → Diagram adapter** | Synthesize or update `DiagramDocument` from IR, preserving existing positions. | "layout preservation" |
| **Dirac parser** | Parse extended Dirac LaTeX into an expression AST. Grammar for kets, bras, brakets, tensor products, sums, scalars, operators, adjoints, superoperator forms. | "Dirac editor → internal representation: parsing" |
| **Dirac printer** | Generate LaTeX from IR or expression AST. Must round-trip with the parser. | "Diagram → Dirac: simplification and printing" |
| **Dirac → IR adapter** | Map parsed expression tree to the internal graph representation. | "Dirac → diagram: diagram synthesis" |
| **IR → Dirac adapter** | Interpret the internal graph as a tensor network, simplify, generate candidate Dirac forms, choose by cost metric. | "Diagram → Dirac: simplification and printing" |
| **Tensor contraction engine** | Pure JS. Evaluate IR as a tensor network over small complex arrays. Powers both directions and verification. | "Verification (mandatory, pure JS)" |
| **Verification module** | Numerically compare tensors from two representations up to scalar/phase. | "numerically check every generated expression" |
| **Recognition library** | Match tensor/structure against known gates, states, channels. | "Named states and gates" list, Category B |
| **Pedagogical classifier** | Assign Category A–G to each translation result. | "Pedagogical-usefulness assessment" |
| **Sync controller** | Manages the sync state machine: stale/equivalent/not-equivalent. Debounce. Never silently overwrites authored content. | "Sync semantics" |
| **Cross-highlighting** | Click a Dirac term → highlight diagram region, and reverse. Requires provenance. | "Cross-highlighting" |
| **Config module** | Thresholds: term budget, matrix size, Kraus rank, qubit limit, debounce delay. | "Put thresholds in one config module" |
| **Simplification engine** | Spider fusion, identity removal, snake equations, π-copy, Hopf, bialgebra. Pure JS or Pyodide+PyZX (Phase 0 decides). | "Simplify diagrammatically first" |
| **Circuit panel** (optional) | Visual circuit rendering, OpenQASM export. | "Circuit generation" |

---

## 8. Proposed minimal data-model changes

The goal is to extend existing structures without replacing their internals.
All new fields are **optional** (`null` or `undefined` by default) so existing
code that doesn't use them is unaffected. Rendering, hit-testing, interaction,
undo/redo serialization — all continue to work unchanged until the sync system
explicitly populates the new fields.

### 8a. DiagramNode — add optional fields

```js
// Add to constructor (all default null/undefined):
this.phase = null;        // { num: number, den: number } | null
                          // Rational multiple of π: phase = (num/den)·π
                          // Replaces semantic role of 'label' for spiders.
                          // 'label' remains the display string; phase is the parsed form.

this.tensor = null;       // Complex[][] | null
                          // Optional concrete matrix, row-major.
                          // Complex numbers as [re, im] pairs.

this.symbolicForm = null; // string | null
                          // Optional symbolic expression string for the IR.

this.provenance = null;   // string | null
                          // Opaque tag linking this node to a Dirac AST node id
                          // for cross-highlighting.
```

**Serialization impact.** `_snapshot()` in `DiagramDocument` already serializes
only `{ id, typeKey, x, y, label, inputs, outputs, selected }`. The new fields
should be added to the snapshot so undo/redo preserves them. This is a one-line
change per field in `_snapshot` and `_restore`.

### 8b. DiagramWire — add wire type

```js
// Add to constructor:
this.wireType = 'qubit';  // 'qubit' | 'qubit-thick' | 'classical'
                          // Default 'qubit' (thin). Rendering can vary
                          // stroke width / dash pattern per type.
```

**Rendering impact.** `draw()` currently uses a fixed `lineWidth: 2`. This
would branch on `wireType`:
- `qubit`: lineWidth 2 (unchanged)
- `qubit-thick`: lineWidth 4, or double line
- `classical`: lineWidth 2, dashed

### 8c. DiagramDocument — add boundary ordering

```js
// Add to constructor:
this.inputBoundary = [];   // string[] — ordered list of {nodeId, portIndex}
this.outputBoundary = [];  // for open (unconnected) ports that form the
                           // diagram's external interface.
```

These are populated by the diagram-to-IR adapter when it analyses the graph.
They need not be manually maintained by the user; the adapter computes them
from the spatial layout (top-to-bottom, left-to-right) of unconnected ports.

### 8d. NODE_TYPES — add missing generator types

```js
// Add to NODE_TYPES:
DISCARD:     { key: 'discard',     label: 'Discard',     color: '#888', shape: 'ground',       defIn: 1, defOut: 0 },
MEASURE:     { key: 'measure',     label: 'Measure',     color: '#888', shape: 'meter',        defIn: 1, defOut: 1 },
PREPARE:     { key: 'prepare',     label: 'Prepare',     color: '#888', shape: 'triangle-down', defIn: 0, defOut: 1 },
// (PREPARE reuses STATE's shape but with classical output semantics)
```

Additional rendering for `ground` (a ⏚ symbol) and `meter` (a measurement arc)
shapes would be added to `DiagramNode.draw()`. These are purely additive — no
existing shape code changes.

### 8e. DiracEditor — add document binding

The Dirac editor needs to participate in the shared document model so it can
be linked to a specific diagram for sync. Proposal:

- Add a **document selector** row (identical pattern to `DiagramEditor`'s) that
  reads from `DiagramDocumentStore`.
- Add a `this.linkedDocId` field that tracks which diagram the Dirac editor is
  syncing with.
- Subscribe to the linked document's `onChange` to know when the diagram side
  has been modified (for stale/equivalence checking).

This does **not** change the Dirac editor's core textarea+KaTeX rendering. It
adds a linkage layer alongside it.

---

## 9. Summary: what can be built without changing existing internals

The key architectural insight: the **internal representation (IR)** and all sync
logic can be built as **new modules alongside the existing code**. The adapters
read from `DiagramDocument.nodes`/`.wires` and from the Dirac editor's
`textarea.value`. They write results into new UI areas (sync status bar,
generated expression panel, diagnostics overlay) or, with explicit user action
("replace with generated form"), into the existing data models.

The only changes to existing files are:
1. **Additive optional fields** on DiagramNode, DiagramWire, DiagramDocument
   (§8a–c).
2. **Additive NODE_TYPES** entries (§8d).
3. **A document selector** added to DiracEditor (§8e, same pattern already used
   by DiagramEditor).
4. **Undo snapshot** format extended to include the new fields (one-line changes
   in `_snapshot` and `_restore`).

No existing method signatures change. No existing rendering code changes. No
framework is introduced.
