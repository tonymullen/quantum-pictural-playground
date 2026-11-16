/**
 * DiagramEditor — Full editor component for quantum pictorial diagrams.
 * Composes DiagramToolbar + DiagramCanvas + palette sidebar.
 * Supports multiple diagrams via DiagramDocumentStore.
 */
import DiagramCanvas from './DiagramCanvas.js';
import DiagramToolbar, { TOOLS } from './DiagramToolbar.js';
import { NODE_TYPES } from './DiagramNode.js';
import DiagramWire from './DiagramWire.js';
import DiagramDocumentStore from './DiagramDocumentStore.js';

export default class DiagramEditor {
  static get typeName() { return 'Diagram Editor'; }

  constructor(containerEl) {
    this.container = containerEl;
    this.el = document.createElement('div');
    this.el.className = 'diagram-editor';
    this.container.appendChild(this.el);

    // Toolbar (includes diagram selector on the left)
    this.toolbar = new DiagramToolbar(this.el, {
      setTool: (t) => this.canvas.setTool(t),
      addNode: (t) => this.canvas.addNode(t),
      togglePalette: () => this._togglePalette(),
      deleteSelected: () => this.canvas.deleteSelected(),
    });

    // --- Diagram document selector row ---
    this._buildDocSelector();

    // Canvas area wrapper
    this.canvasWrap = document.createElement('div');
    this.canvasWrap.style.flex = '1';
    this.canvasWrap.style.minHeight = '0';
    this.canvasWrap.style.position = 'relative';
    this.canvasWrap.style.overflow = 'hidden';
    this.el.appendChild(this.canvasWrap);

    // Palette sidebar
    this._buildPalette();

    // Get or create the initial document
    let doc = DiagramDocumentStore.list()[0];
    if (!doc) {
      doc = DiagramDocumentStore.create('Example');
      this._needsDefault = true; // flag to load example content
    }
    this.currentDocId = doc.id;

    // Canvas — pass the shared document
    this.canvas = new DiagramCanvas(this.canvasWrap, doc);

    // Load default content into the first-ever document
    if (this._needsDefault) {
      this._loadDefaultDiagram();
      this._needsDefault = false;
    }

    this._refreshDocSelect();
  }

  /* ---- Document selector ---- */

  _buildDocSelector() {
    this.docBarEl = document.createElement('div');
    this.docBarEl.className = 'diagram-toolbar';
    this.docBarEl.style.height = '26px';
    this.docBarEl.style.minHeight = '26px';
    this.docBarEl.style.paddingLeft = '6px';
    this.docBarEl.style.gap = '6px';
    this.docBarEl.style.fontSize = '11px';

    const label = document.createElement('span');
    label.textContent = 'Diagram:';
    label.style.color = 'var(--text-secondary)';
    this.docBarEl.appendChild(label);

    this.docSelectEl = document.createElement('select');
    this.docSelectEl.className = 'editor-type-select';
    this.docSelectEl.style.maxWidth = '160px';
    this.docSelectEl.addEventListener('change', () => this._onDocSelectChange());
    this.docBarEl.appendChild(this.docSelectEl);

    const newBtn = document.createElement('button');
    newBtn.className = 'diagram-tool-btn';
    newBtn.style.width = 'auto'; newBtn.style.padding = '0 6px';
    newBtn.style.fontSize = '11px';
    newBtn.textContent = '＋ New';
    newBtn.title = 'Create new diagram';
    newBtn.addEventListener('click', () => this._createNewDiagram());
    this.docBarEl.appendChild(newBtn);

    this.el.appendChild(this.docBarEl);

    // Listen for store changes (other editors may create/delete docs)
    this._onStoreChange = () => this._refreshDocSelect();
    DiagramDocumentStore.onListChange(this._onStoreChange);
  }

  _refreshDocSelect() {
    const docs = DiagramDocumentStore.list();
    this.docSelectEl.innerHTML = '';
    for (const d of docs) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      this.docSelectEl.appendChild(opt);
    }
    this.docSelectEl.value = this.currentDocId;
  }

  _onDocSelectChange() {
    const id = this.docSelectEl.value;
    if (id === this.currentDocId) return;
    const doc = DiagramDocumentStore.get(id);
    if (!doc) return;
    this.currentDocId = id;
    this.canvas.setDocument(doc);
  }

  _createNewDiagram() {
    const name = prompt('Diagram name:', `Diagram ${DiagramDocumentStore.list().length + 1}`);
    if (!name) return;
    const doc = DiagramDocumentStore.create(name);
    this.currentDocId = doc.id;
    this.canvas.setDocument(doc);
    this._refreshDocSelect();
  }

  /**
   * Creates a small default CNOT-style diagram to provide immediate
   * visual feedback that the editor is working.
   */
  _loadDefaultDiagram() {
    const NT = NODE_TYPES;
    // Quantum teleportation protocol (from paper Section 4.2 / Figure 9)
    // Shows Bell-state (cup), Bell-effect (cap), and a morphism box
    const cup1 = this.canvas.addNode(NT.CUP, 180, 80);
    const f = this.canvas.addNode(NT.MORPHISM, 150, 170);
    f.label = 'f';
    const cap1 = this.canvas.addNode(NT.CAP, 180, 260);

    // A Z-spider with phase and an X-spider
    const z1 = this.canvas.addNode(NT.Z_SPIDER, 320, 100);
    z1.label = 'α'; z1.inputs = 1; z1.outputs = 2;
    const x1 = this.canvas.addNode(NT.X_SPIDER, 320, 240);
    x1.label = 'β'; x1.inputs = 2; x1.outputs = 1;
    const h1 = this.canvas.addNode(NT.HADAMARD, 420, 170);

    // Swap, state, and effect examples
    const sw = this.canvas.addNode(NT.SWAP, 520, 170);
    const st = this.canvas.addNode(NT.STATE, 620, 100);
    st.label = 'ψ';
    const eff = this.canvas.addNode(NT.EFFECT, 620, 240);
    eff.label = 'φ';

    // Wire: z1 out0 → x1 in0, z1 out1 → h1 in0, h1 out0 → x1 in1
    this.canvas.wires.push(new DiagramWire(z1.id, 0, x1.id, 0));
    this.canvas.wires.push(new DiagramWire(z1.id, 1, h1.id, 0));
    this.canvas.wires.push(new DiagramWire(h1.id, 0, x1.id, 1));
    // Wire: cup out0 → f in0, f out0 → cap in0
    this.canvas.wires.push(new DiagramWire(cup1.id, 0, f.id, 0));
    this.canvas.wires.push(new DiagramWire(f.id, 0, cap1.id, 0));
    // Wire: state out0 → effect in0
    this.canvas.wires.push(new DiagramWire(st.id, 0, eff.id, 0));

    this.canvas.draw();
  }

  _buildPalette() {
    this.paletteEl = document.createElement('div');
    this.paletteEl.className = 'diagram-palette';

    const h4 = document.createElement('h4');
    h4.textContent = 'Components';
    this.paletteEl.appendChild(h4);

    for (const t of Object.values(NODE_TYPES)) {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.draggable = true;

      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.style.borderColor = t.color;
      swatch.style.background = t.color;
      // Adjust swatch shape per type
      if (t.shape === 'box' || t.shape === 'morphbox') swatch.style.borderRadius = '3px';
      else if (t.shape === 'cup') {
        swatch.style.background = 'transparent';
        swatch.style.borderBottom = `2px solid ${t.color}`;
        swatch.style.borderLeft = `2px solid ${t.color}`;
        swatch.style.borderRight = `2px solid ${t.color}`;
        swatch.style.borderTop = 'none';
        swatch.style.borderRadius = '0 0 50% 50%';
      } else if (t.shape === 'cap') {
        swatch.style.background = 'transparent';
        swatch.style.borderTop = `2px solid ${t.color}`;
        swatch.style.borderLeft = `2px solid ${t.color}`;
        swatch.style.borderRight = `2px solid ${t.color}`;
        swatch.style.borderBottom = 'none';
        swatch.style.borderRadius = '50% 50% 0 0';
      } else if (t.shape === 'swap') {
        swatch.style.background = 'transparent';
        swatch.textContent = '╳';
        swatch.style.fontSize = '14px';
        swatch.style.color = t.color;
        swatch.style.textAlign = 'center';
        swatch.style.lineHeight = '18px';
        swatch.style.border = 'none';
      } else if (t.shape === 'triangle-down' || t.shape === 'triangle-up') {
        swatch.style.width = '0'; swatch.style.height = '0';
        swatch.style.background = 'transparent'; swatch.style.border = 'none';
        if (t.shape === 'triangle-down') {
          swatch.style.borderLeft = '9px solid transparent';
          swatch.style.borderRight = '9px solid transparent';
          swatch.style.borderTop = `14px solid ${t.color}`;
        } else {
          swatch.style.borderLeft = '9px solid transparent';
          swatch.style.borderRight = '9px solid transparent';
          swatch.style.borderBottom = `14px solid ${t.color}`;
        }
      }
      item.appendChild(swatch);

      const label = document.createElement('span');
      label.textContent = t.label;
      item.appendChild(label);

      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', t.key);
      });
      item.addEventListener('click', () => {
        this.canvas.addNode(t);
      });

      this.paletteEl.appendChild(item);
    }

    // Handle drops onto canvas
    this.canvasWrap.addEventListener('dragover', e => { e.preventDefault(); });
    this.canvasWrap.addEventListener('drop', e => {
      e.preventDefault();
      const key = e.dataTransfer.getData('text/plain');
      const type = Object.values(NODE_TYPES).find(t => t.key === key);
      if (!type) return;
      const rect = this.canvas.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const wc = this.canvas._screenToWorld(sx, sy);
      this.canvas.addNode(type, wc.x, wc.y);
    });

    this.canvasWrap.appendChild(this.paletteEl);
  }

  _togglePalette() {
    this.paletteEl.classList.toggle('open');
  }

  onResize() {
    if (this.canvas) this.canvas.resize();
  }

  destroy() {
    DiagramDocumentStore.offListChange(this._onStoreChange);
    if (this.canvas) this.canvas.destroy();
    this.el.remove();
  }
}
