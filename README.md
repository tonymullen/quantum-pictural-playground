# Quantum Pictural Playground

A browser-based workbench for editing and analysing quantum pictorial diagrams
in the style of Coecke & Kissinger's
[*Picturing Quantum Processes*](https://www.cambridge.org/core/books/picturing-quantum-processes/1119568B3101F3A685BE832FEEC53E52).
The interface follows a **Blender-style split-panel layout** where every panel
can be split, merged, resized, and assigned an arbitrary editor type from a
dropdown menu.

---

## Features

### Blender-Style Layout Engine
- **Split** any panel horizontally or vertically via header buttons or corner grip drag
- **Close / merge** panels — the sibling absorbs the freed space
- **Resize** panels by dragging the divider handles
- **Switch editor type** per-panel with the dropdown in each panel header
- **Focus highlight** — the active panel is outlined in blue

### Diagram Editor
- Five node types: **Z Spider** (green), **X Spider** (red), **Hadamard**
  (yellow box), **State/Effect** (blue diamond), **Scalar** (purple)
- Tools: **Select**, **Wire**, **Delete**
- **Pan** (Alt+drag / middle-mouse) and **Zoom** (scroll wheel)
- **Phase labels** — double-click any node to set a phase (e.g. `π/2`)
- **Slide-out component palette** — toggle with ☰, drag-and-drop or click to add
- Box selection, Shift multi-select, and keyboard shortcuts

### Dirac Formula Editor
- LaTeX textarea with **live KaTeX rendering**
- **16 snippet buttons** for common Dirac notation
- **Save & recall** formulas in a per-editor list

---

## Getting Started

No build step required — pure vanilla ES modules + one CDN dependency (KaTeX).

```bash
cd QuantumPicturalPlayground
python3 -m http.server 8080
```

Open **http://localhost:8080** in your browser.

> **Note:** Must be served over HTTP, not opened as `file://` (browsers block
> ES module imports from the filesystem).

---

## Usage

### Layout Controls

| Action | How |
|---|---|
| Split horizontally | Click **⬌** in panel header |
| Split vertically | Click **⬍** in panel header |
| Split via drag | Drag the **corner grip** (top-right triangle) |
| Close / merge | Click **✕** in panel header |
| Resize | Drag the **divider bar** between panels |
| Change editor type | **Dropdown** in the panel header |

### Diagram Editor

| Action | How |
|---|---|
| Add node (toolbar) | Click a **coloured shape button** |
| Add node (palette) | Click **☰** → **click** or **drag** item onto canvas |
| Move node | Select tool → **drag** the node |
| Connect nodes | **Wire** tool (⟶) → click output port → drag to input port |
| Set phase | **Double-click** node → type e.g. `π/2` |
| Select | **Click** node; **Shift+click** to multi-select; **drag** empty area to box-select |
| Select all | **Cmd+A** / **Ctrl+A** |
| Delete | **Delete**/**Backspace** key, or **Delete** tool (✕) + click |
| Clear canvas | Click **🗑** button |
| Pan | **Alt+click drag** or **middle-mouse drag** |
| Zoom | **Scroll wheel** (anchored to cursor) |

### Dirac Formula Editor

| Action | How |
|---|---|
| Enter formula | Type LaTeX in the **textarea** — preview updates live |
| Insert snippet | Click a **snippet button** (e.g. \|ψ⟩, ⊗, †) |
| Save formula | Click **＋ Save Formula** |
| Reload saved | Click its preview in the list |
| Delete saved | Click **✕** next to it |

---

## Architecture

```
QuantumPicturalPlayground/
├── index.html                        # Entry point (loads KaTeX CDN + app module)
├── css/
│   ├── main.css                      # Global reset, dark theme, scrollbars
│   ├── layout.css                    # Split panels, handles, grips, headers
│   ├── diagram-editor.css            # Diagram canvas, toolbar, palette
│   └── dirac-editor.css              # LaTeX input, KaTeX preview, formula list
└── js/
    ├── app.js                        # Boot: register editors → create LayoutManager
    ├── layout/
    │   ├── LayoutManager.js          # Binary split-tree layout engine
    │   ├── EditorArea.js             # Panel: header dropdown + editor instance
    │   └── SplitHandle.js            # Draggable divider between panels
    └── editors/
        ├── EditorRegistry.js         # Pluggable editor type registry
        ├── DiagramEditor/
        │   ├── DiagramEditor.js      # Composes toolbar + canvas + palette
        │   ├── DiagramCanvas.js      # Interactive canvas: pan, zoom, drag, wire
        │   ├── DiagramNode.js        # Node model + rendering
        │   ├── DiagramWire.js        # Wire model + Bézier rendering + hit-testing
        │   └── DiagramToolbar.js     # Tool & node-add buttons
        └── DiracEditor/
            └── DiracEditor.js        # LaTeX input + KaTeX preview + snippets
```

### Key Design Patterns

- **Binary split-tree** — `LayoutManager` maintains a tree where leaves are
  `EditorArea` instances and internal nodes hold a split ratio, direction, and
  handle. `render()` rebuilds the DOM with explicit pixel sizes.
- **Editor Registry** — A `Map<string, class>` decoupling layout from editors.
  `EditorArea` reads it to populate dropdowns and instantiate by name.
- **Editor contract** — Any registered class must implement:
  - `static get typeName()` → display name
  - `constructor(containerEl)` — mount into DOM element
  - `onResize()` — respond to size changes
  - `destroy()` — clean up

---

## Adding a New Editor Type

```js
// js/editors/MyEditor/MyEditor.js
export default class MyEditor {
  static get typeName() { return 'My Editor'; }

  constructor(containerEl) {
    this.el = document.createElement('div');
    this.el.textContent = 'Hello from My Editor';
    containerEl.appendChild(this.el);
  }

  onResize() { /* handle container size changes */ }
  destroy()  { this.el.remove(); }
}
```

Register in `app.js`:

```js
import MyEditor from './editors/MyEditor/MyEditor.js';
EditorRegistry.register(MyEditor);
```

It will immediately appear in every panel's editor-type dropdown.

---

## Dependencies

| Dependency | Source | Purpose |
|---|---|---|
| [KaTeX](https://katex.org/) 0.16.9 | CDN (jsdelivr) | LaTeX rendering in the Dirac Formula Editor |

Everything else is **vanilla JavaScript ES modules** — no bundler, no
framework, no transpilation.

---

## Browser Support

Tested in modern Chromium-based browsers (Chrome, Edge, Arc) and Firefox.
Requires ES module support (`<script type="module">`).

---

## License

MIT
