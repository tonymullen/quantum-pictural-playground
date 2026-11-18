/**
 * DiagramEditor — Full editor component for quantum pictorial diagrams.
 * Composes DiagramToolbar + DiagramCanvas + palette sidebar.
 * Supports multiple diagrams via DocumentStore.
 */
import DiagramCanvas from './DiagramCanvas.js';
import DiagramToolbar from './DiagramToolbar.js';
import { NODE_TYPES } from './DiagramNode.js';
import DiagramWire from './DiagramWire.js';
import DocumentStore from '../DocumentStore.js';
import { ORIENTATIONS } from '../../core/FlowDirection.js';
import { TENSOR_ORDERS } from '../../core/IR.js';

export default class DiagramEditor {
  static get typeName() { return 'Diagram Editor'; }

  constructor(containerEl) {
    this.container = containerEl;
    this.el = document.createElement('div');
    this.el.className = 'diagram-editor';
    this.container.appendChild(this.el);

    // Toolbar (includes diagram selector on the left)
    this.toolbar = new DiagramToolbar(this.el, {
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
    let doc = DocumentStore.list('diagram')[0];
    if (!doc) {
      doc = DocumentStore.createDiagram('Example');
      this._needsDefault = true; // flag to load example content
    }
    this.currentDocId = doc.id;

    // Canvas — pass the shared document
    this.canvas = new DiagramCanvas(this.canvasWrap, doc, {
      onSelectionChange: () => { this._refreshInspector(); this._refreshDerivedNote(); },
      onEditLabel: () => { this._refreshInspector(); this.inspLabel.focus(); this.inspLabel.select(); },
    });

    // Load default content into the first-ever document
    if (this._needsDefault) {
      this._loadDefaultDiagram();
      doc._undoStack = []; doc._redoStack = [];  // the example is the starting point
      this._needsDefault = false;
    }

    this._refreshDocSelect();
    this._refreshInspector();

    // A circuit editor asked to show its diagram: the first Diagram Editor takes it
    this._onShowCircuit = e => {
      if (e.detail.diagramHandled) return;
      e.detail.diagramHandled = true;
      const doc = DocumentStore.get(e.detail.diagramId);
      if (!doc) return;
      this.currentDocId = doc.id;
      this._refreshDocSelect();
      // Match the circuit editor's view (Circuit → or Algebraic ←)
      this.viewSelectEl.value = e.detail.orientation;
      this.canvas.setDocument(doc);
      this.canvas.setOrientation(e.detail.orientation);
      this._refreshDerivedNote();
    };
    window.addEventListener('qpp:show-circuit', this._onShowCircuit);
  }

  /* ---- Document selector ---- */

  _buildDocSelector() {
    this.docBarEl = document.createElement('div');
    this.docBarEl.className = 'diagram-toolbar doc-bar';

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

    // View orientation (this panel only) and tensor order (the document's setting)
    const mkSelect = (labelText, options, title, onChange) => {
      const lab = document.createElement('label');
      lab.className = 'diagram-bar-field';
      lab.title = title;
      lab.append(labelText);
      const sel = document.createElement('select');
      sel.className = 'editor-type-select';
      for (const [value, text] of options) {
        const o = document.createElement('option'); o.value = value; o.textContent = text; sel.appendChild(o);
      }
      sel.addEventListener('change', () => onChange(sel.value));
      lab.appendChild(sel);
      this.docBarEl.appendChild(lab);
      return sel;
    };
    this.viewSelectEl = mkSelect('View', Object.values(ORIENTATIONS).map(o => [o.id, o.label]),
      'Which way time flows in this panel (drawing only — does not change the maths)',
      id => this.canvas.setOrientation(id));
    this.orderSelectEl = mkSelect('⊗ order', [
        ['big-endian', 'First wire first (N&C)'], ['little-endian', 'First wire last (Qiskit)']],
      'Which wire is the first tensor factor / leftmost ket digit (a setting of this diagram)',
      order => { const d = DocumentStore.get(this.currentDocId); if (d) d.setTensorOrder(order); });
    this.orderSelectEl.title = Object.values(TENSOR_ORDERS).join('\n');

    this.derivedNoteEl = document.createElement('span');
    this.derivedNoteEl.className = 'diagram-derived-note';
    this.docBarEl.appendChild(this.derivedNoteEl);

    this._buildInspector();
    this.el.appendChild(this.docBarEl);

    // Listen for store changes (other editors may create/delete docs)
    this._onStoreChange = () => this._refreshDocSelect();
    DocumentStore.onListChange(this._onStoreChange);
  }

  /* ---- Inspector: label + leg counts of the selected node ---- */

  _buildInspector() {
    const el = document.createElement('div');
    el.className = 'diagram-inspector';
    this.inspector = el;

    this.inspType = document.createElement('span');
    this.inspType.className = 'insp-type';
    el.appendChild(this.inspType);

    this.inspLabelWrap = document.createElement('label');
    this.inspLabelWrap.className = 'insp-field';
    this.inspLabelWrap.append('Label');
    this.inspLabel = document.createElement('input');
    this.inspLabel.type = 'text';
    this.inspLabel.spellcheck = false;
    this.inspLabel.addEventListener('change', () => {
      const n = this._inspNode();
      if (n) this.canvas.setLabel(n, this.inspLabel.value.trim());
    });
    this.inspLabel.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.inspLabel.blur(); this.canvas.canvas.focus(); }
      if (e.key === 'Escape') {
        const n = this._inspNode(); this.inspLabel.value = n ? n.label : '';
        this.inspLabel.blur(); this.canvas.canvas.focus();
      }
    });
    this.inspLabelWrap.appendChild(this.inspLabel);
    el.appendChild(this.inspLabelWrap);

    const stepper = (name, get, set) => {
      const wrap = document.createElement('span');
      wrap.className = 'insp-field insp-stepper';
      wrap.append(name);
      const minus = document.createElement('button'); minus.textContent = '−';
      const val = document.createElement('span'); val.className = 'insp-count';
      const plus = document.createElement('button'); plus.textContent = '+';
      minus.title = `Remove ${name.toLowerCase()} leg`; plus.title = `Add ${name.toLowerCase()} leg`;
      minus.addEventListener('click', () => { const n = this._inspNode(); if (n) set(n, get(n) - 1); });
      plus.addEventListener('click', () => { const n = this._inspNode(); if (n) set(n, get(n) + 1); });
      wrap.append(minus, val, plus);
      el.appendChild(wrap);
      return { wrap, val, minus, plus };
    };
    const MAX_LEGS = 8;
    this.inspIn = stepper('In', n => n.inputs,
      (n, v) => this.canvas.setArity(n, Math.min(v, MAX_LEGS), n.outputs));
    this.inspOut = stepper('Out', n => n.outputs,
      (n, v) => this.canvas.setArity(n, n.inputs, Math.min(v, MAX_LEGS)));
    this._maxLegs = MAX_LEGS;

    this.docBarEl.appendChild(el);
  }

  /** The single selected node (or the node of a selected leg), or null. */
  _inspNode() {
    if (!this.canvas) return null;
    const sel = this.canvas.selectedNodes();
    if (sel.length === 1) return sel[0];
    const sp = this.canvas.selectedPort;
    return sel.length === 0 && sp ? this.canvas.nodes.get(sp.nodeId) || null : null;
  }

  _refreshInspector() {
    if (!this.inspector || !this.canvas) return;
    const sel = this.canvas.selectedNodes();
    const n = this._inspNode();
    const sp = this.canvas.selectedPort;
    this.inspLabelWrap.hidden = !n;
    this.inspIn.wrap.hidden = this.inspOut.wrap.hidden = !(n && n.type.variableArity);
    if (!n) {
      this.inspType.textContent = sel.length > 1 ? `${sel.length} nodes selected` : '';
      return;
    }
    this.inspType.textContent = sp && sel.length === 0
      ? `${n.type.label} — ${sp.dir === 'in' ? 'input' : 'output'} leg selected (🗑 to remove)`
      : n.type.label;
    if (document.activeElement !== this.inspLabel || this._inspNodeId !== n.id) {
      this.inspLabel.value = n.label;
    }
    this._inspNodeId = n.id;
    const isSpider = n.type.key === 'z-spider' || n.type.key === 'x-spider';
    this.inspLabel.placeholder = isSpider ? 'phase: π/2, α, …' : 'name';
    this.inspIn.val.textContent = n.inputs;
    this.inspOut.val.textContent = n.outputs;
    this.inspIn.minus.disabled = n.inputs === 0;
    this.inspOut.minus.disabled = n.outputs === 0;
    this.inspIn.plus.disabled = n.inputs >= this._maxLegs;
    this.inspOut.plus.disabled = n.outputs >= this._maxLegs;
  }

  _refreshDocSelect() {
    const docs = DocumentStore.list('diagram');
    this.docSelectEl.innerHTML = '';
    for (const d of docs) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      this.docSelectEl.appendChild(opt);
    }
    this.docSelectEl.value = this.currentDocId;
    this._refreshDerivedNote();
  }

  _refreshDerivedNote() {
    const doc = DocumentStore.get(this.currentDocId);
    const src = doc && doc.derivedFrom ? DocumentStore.get(doc.derivedFrom) : null;
    if (doc) this.orderSelectEl.value = doc.tensorOrder || 'big-endian';
    this.orderSelectEl.disabled = !!src;   // a generated diagram follows its circuit
    this.derivedNoteEl.textContent = src ? `Generated from circuit “${src.name}” — edits are replaced when it changes` : '';
    this.derivedNoteEl.hidden = !src;
  }

  _onDocSelectChange() {
    const id = this.docSelectEl.value;
    if (id === this.currentDocId) return;
    const doc = DocumentStore.get(id);
    if (!doc) return;
    this.currentDocId = id;
    this.canvas.setDocument(doc);
    this._refreshDerivedNote();
  }

  _createNewDiagram() {
    const name = prompt('Diagram name:', `Diagram ${DocumentStore.list('diagram').length + 1}`);
    if (!name) return;
    const doc = DocumentStore.createDiagram(name);
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
    // CNOT gate from ZX-calculus: Z-spider (control, left) and X-spider
    // (target, right) side by side, joined by a horizontal leg.
    // Wire order follows port positions, so this reads as CNOT (Category B).
    const z1 = this.canvas.addNode(NT.Z_SPIDER, 200, 170);
    z1.inputs = 1; z1.outputs = 2;
    const x1 = this.canvas.addNode(NT.X_SPIDER, 270, 170);
    x1.inputs = 2; x1.outputs = 1;

    // Leg: z1's right output → x1's left input
    this.canvas.wires.push(new DiagramWire(z1.id, 1, x1.id, 0));

    // Bell state: a cup produces |00⟩+|11⟩
    const cup1 = this.canvas.addNode(NT.CUP, 400, 170);

    // Hadamard gate
    const h1 = this.canvas.addNode(NT.HADAMARD, 520, 170);

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
      } else if (t.shape === 'wire') {
        swatch.style.width = '2px'; swatch.style.borderRadius = '0';
        swatch.style.border = 'none'; swatch.style.margin = '0 8px';
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
    DocumentStore.offListChange(this._onStoreChange);
    window.removeEventListener('qpp:show-circuit', this._onShowCircuit);
    if (this.canvas) this.canvas.destroy();
    this.el.remove();
  }
}
