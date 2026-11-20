/**
 * DiagramEditor — Full editor component for quantum pictorial diagrams.
 * Composes DiagramToolbar + DiagramCanvas + palette sidebar.
 * Supports multiple diagrams via DocumentStore.
 */
import DiagramCanvas from './DiagramCanvas.js';
import DiagramToolbar from './DiagramToolbar.js';
import { rulesFor } from './Rewrites.js';
import { NODE_TYPES } from './DiagramNode.js';
import DocumentStore from '../DocumentStore.js';
import { ORIENTATIONS } from '../../core/FlowDirection.js';
import { TENSOR_ORDERS } from '../../core/IR.js';

/** How an oriented symbol reads: f, fᵀ, f†, f̄ (for states: the adjoint is ⟨ψ|). */
function orientedName(n) {
  const lbl = n.label || '?', f = n.flip || {};
  if (f.v && f.h) return lbl + 'ᵀ';
  if (f.v) return lbl + '†';
  if (f.h) return lbl + '\u0305';     // combining overline: f̄
  return lbl;
}

export default class DiagramEditor {
  static get typeName() { return 'Diagram Editor'; }

  /**
   * @param {HTMLElement} containerEl
   * @param {{ doc?: object, embedded?: boolean }} [options] — embedded: shown
   *   inside another editor (e.g. a proof step): edits `doc`, no document picker.
   */
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.embedded = !!options.embedded;
    this.el = document.createElement('div');
    this.el.className = 'diagram-editor';
    this.container.appendChild(this.el);

    // Toolbar (includes diagram selector on the left)
    this.toolbar = new DiagramToolbar(this.el, {
      addNode: (t) => this.canvas.addNode(t),
      togglePalette: () => this._togglePalette(),
      deleteSelected: () => this.canvas.deleteSelected(),
      pullTaut: () => this.canvas.previewPullTaut(),
      copy: () => this.canvas.copySelection(),
      paste: e => this.canvas.paste({ alongside: !!(e && e.shiftKey) }),
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
    this.canvasWrap.appendChild(this.inspector);

    // The document to show: given, saved in the panel state, the first
    // diagram, or a new empty one
    const st = options.state || {};
    let doc = options.doc || (st.docId && DocumentStore.get(st.docId))
      || DocumentStore.list('diagram').find(d => !d.ownerProof);
    if (!doc) doc = DocumentStore.createDiagram(`Diagram ${DocumentStore.list('diagram').filter(d => !d.ownerProof).length + 1}`);
    this.currentDocId = doc.id;

    // Canvas — pass the shared document
    this.canvas = new DiagramCanvas(this.canvasWrap, doc, {
      onSelectionChange: () => { this._refreshInspector(); this._refreshDerivedNote(); },
      onEditLabel: () => { this._refreshInspector(); this.inspLabel.focus({ preventScroll: true }); this.inspLabel.select(); },
    });

    // Restore the saved view (orientation, then pan/zoom or "fit to content")
    if (st.orientation && ORIENTATIONS[st.orientation]) {
      this.canvas.orientation = ORIENTATIONS[st.orientation];
      this.viewSelectEl.value = st.orientation;
    }
    if (st.structure) { this.canvas.showStructure = true; this.structureBox.checked = true; }
    if (st.view) {
      if (st.view.fitted) this.canvas._fitted = true;      // fits as soon as it has a size
      else Object.assign(this.canvas, { panX: st.view.panX, panY: st.view.panY, zoom: st.view.zoom });
    }

    this._refreshDocSelect();
    this._refreshInspector();
    if (this.embedded) {
      this._docLabelEl.hidden = this.docSelectEl.hidden = this._newBtnEl.hidden = true;
    }

    // A circuit editor asked to show its diagram: the first Diagram Editor takes it
    this._onShowCircuit = e => {
      if (this.embedded || e.detail.diagramHandled) return;
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
    this._docLabelEl = label;
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
    this._newBtnEl = newBtn;

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

    // Σ over basis indices (PQP's sums): a diagram setting
    const sumLab = document.createElement('label');
    sumLab.className = 'diagram-bar-field';
    sumLab.title = 'Sum the diagram over a basis index: states and effects labelled with it range over |0⟩, |1⟩ (PQP: Σᵢ)';
    sumLab.append('Σ over');
    this.sumInputEl = document.createElement('input');
    this.sumInputEl.type = 'text'; this.sumInputEl.className = 'diagram-sum-input'; this.sumInputEl.placeholder = '—';
    this.sumInputEl.spellcheck = false;
    const applySum = () => { const d = DocumentStore.get(this.currentDocId); if (d) d.setSumIndices(this.sumInputEl.value.split(/[\s,]+/)); this._refreshDerivedNote(); };
    this.sumInputEl.addEventListener('change', applySum);
    this.sumInputEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') this.sumInputEl.blur(); });
    sumLab.appendChild(this.sumInputEl);
    this.docBarEl.appendChild(sumLab);

    // The ∘/⊗ structure: layers in sequence, pieces side by side (a view option)
    const structLab = document.createElement('label');
    structLab.className = 'diagram-bar-field';
    structLab.title = 'Show how the diagram reads as a formula: layers composed in sequence (∘, bottom to top) and pieces side by side (⊗)';
    this.structureBox = document.createElement('input');
    this.structureBox.type = 'checkbox';
    this.structureBox.addEventListener('change', () => { this.canvas.showStructure = this.structureBox.checked; this.canvas.draw(); });
    structLab.append(this.structureBox, '∘⊗');
    this.docBarEl.appendChild(structLab);

    this.derivedNoteEl = document.createElement('span');
    this.derivedNoteEl.className = 'diagram-derived-note';
    this.docBarEl.appendChild(this.derivedNoteEl);

    this._buildInspector();
    this.el.appendChild(this.docBarEl);

    // Listen for store changes (other editors may create/delete docs)
    this._onStoreChange = () => this._refreshDocSelect();
    DocumentStore.onListChange(this._onStoreChange);
  }

  /** Panel state for workbooks. */
  getState() {
    const c = this.canvas;
    return { docId: this.currentDocId, orientation: c.orientation.id, structure: !!c.showStructure,
      view: { panX: c.panX, panY: c.panY, zoom: c.zoom, fitted: !!c._fitted } };
  }

  /** Show and edit another document (used when embedded). */
  showDocument(doc) {
    if (!doc || doc.id === this.currentDocId) return;
    this.currentDocId = doc.id;
    this.canvas.setDocument(doc);
    this._refreshDocSelect();
    this._refreshInspector();
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
      if (e.key === 'Enter') { this.inspLabel.blur(); this.canvas.canvas.focus({ preventScroll: true }); }
      if (e.key === 'Escape') {
        const n = this._inspNode(); this.inspLabel.value = n ? n.label : '';
        this.inspLabel.blur(); this.canvas.canvas.focus({ preventScroll: true });
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

    // Orientation (PQP's asymmetric shapes) and sliding round bends
    this.inspOrient = document.createElement('span');
    this.inspOrient.className = 'insp-field insp-orient';
    const obtn = (text, title, fn) => {
      const b = document.createElement('button'); b.textContent = text; b.title = title;
      b.addEventListener('click', () => { const n = this._inspNode(); if (n) fn(n); this.canvas.canvas.focus({ preventScroll: true }); });
      this.inspOrient.appendChild(b); return b;
    };
    obtn('ᵀ', 'Transpose: rotate 180°', n => this.canvas.flip(n, 'T'));
    obtn('†', 'Adjoint: reflect top↔bottom', n => this.canvas.flip(n, 'adj'));
    obtn('‾', 'Conjugate: reflect left↔right', n => this.canvas.flip(n, 'conj'));
    this.inspSlide = obtn('↷ Slide', 'Slide round the cup/cap it touches — it becomes its transpose (S)', n => {
      const o = this.canvas.doc.slideOptions(n);
      if (o.length) this.canvas.slide(n, o[0]);
    });
    el.appendChild(this.inspOrient);

    // The doubled picture: thick (doubled) generators, pure vs general processes, leg types
    this.inspThick = document.createElement('label');
    this.inspThick.className = 'insp-field';
    this.inspThickBox = document.createElement('input');
    this.inspThickBox.type = 'checkbox';
    this.inspThickBox.title = 'Doubled (thick): the quantum process f̂ = f̄ ⊗ f';
    this.inspThickBox.addEventListener('change', () => { const n = this._inspNode(); if (n) this.canvas.setThick(n, this.inspThickBox.checked); });
    this.inspThick.append(this.inspThickBox, 'Thick');
    el.appendChild(this.inspThick);
    this.inspProcess = document.createElement('select');
    this.inspProcess.className = 'insp-select';
    for (const [v, t] of [['pure', 'Pure (doubled)'], ['process', 'General process']]) {
      const o = document.createElement('option'); o.value = v; o.textContent = t; this.inspProcess.appendChild(o);
    }
    this.inspProcess.title = 'Pure: the double of a symbol (f̄ ⊗ f). General: any quantum process, whose legs can be thin or thick';
    this.inspProcess.addEventListener('change', () => { const n = this._inspNode(); if (n) this.canvas.setProcess(n, this.inspProcess.value === 'process'); });
    el.appendChild(this.inspProcess);
    this.inspLeg = document.createElement('span');
    this.inspLeg.className = 'insp-field insp-orient';
    this.inspLeg.append('Leg');
    for (const [label, thick] of [['Thin', false], ['Thick', true]]) {
      const b = document.createElement('button'); b.textContent = label; b.dataset.thick = thick;
      b.title = thick ? 'A quantum leg (thick wire)' : 'A classical leg (thin wire)';
      b.addEventListener('click', () => {
        const sp = this.canvas.selectedPort, n = sp && this.canvas.nodes.get(sp.nodeId);
        if (n) { const keep = { ...sp }; this.canvas.setLegThick(n, sp.dir, sp.port, thick); this.canvas.selectedPort = keep; this.canvas.draw(); this._refreshInspector(); }
      });
      this.inspLeg.appendChild(b);
    }
    el.appendChild(this.inspLeg);

    // Rewrites that apply to the selection (Rewrites.js): fusion, colour change, …
    this.inspRules = document.createElement('span');
    this.inspRules.className = 'insp-field insp-rules';
    el.appendChild(this.inspRules);

    // Floats over the canvas (mounted in the constructor), so selecting
    // something never changes the toolbar layout or moves the canvas
    el.classList.add('floating');
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
    this.inspType.title = '';
    this.inspLabelWrap.hidden = !n;
    this.inspIn.wrap.hidden = this.inspOut.wrap.hidden = !(n && n.type.variableArity);
    this.inspector.hidden = !n && sel.length < 2;
    if (!n) this.inspOrient.hidden = this.inspThick.hidden = this.inspProcess.hidden = this.inspLeg.hidden = true;
    if (!n) {
      if (sel.length > 1) {
        const l = this.canvas.selectionLegs();
        this.inspType.textContent = `${sel.length} nodes selected · ${l.inputs} in, ${l.outputs} out`;
        this.inspType.title = 'Cmd+C copies them as one piece; Cmd+V with a piece of the same legs replaces them';
      } else this.inspType.textContent = '';
      this._refreshRules(sel);
      return;
    }
    this.inspType.textContent = sp && sel.length === 0
      ? `${n.type.label} — ${sp.dir === 'in' ? 'input' : 'output'} leg selected (🗑 to remove)`
      : n.isOrientable() ? `${n.type.label} · ${orientedName(n)}` : n.type.label;
    const legView = !!(sp && sel.length === 0);
    this.inspOrient.hidden = !(n.isOrientable() && !legView);
    this.inspSlide.hidden = !this.canvas.doc.slideOptions(n).length;
    this.inspThick.hidden = !(n.isDoubleable() && !legView);
    this.inspThickBox.checked = !!n.thick;
    this.inspProcess.hidden = !(n.thick && n.isOrientable() && !legView);
    this.inspProcess.value = n.process ? 'process' : 'pure';
    this.inspLeg.hidden = !(legView && n.hasLegTypes());
    if (!this.inspLeg.hidden) {
      const t = n.portIsThick(sp.dir, sp.port);
      for (const b of this.inspLeg.querySelectorAll('button')) b.classList.toggle('on', (b.dataset.thick === 'true') === t);
    }
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
    this._refreshRules(legView ? [] : sel);
  }

  /** Buttons for the rewrites that apply to the selected nodes. */
  _refreshRules(sel) {
    const rules = sel.length ? rulesFor(this.canvas.doc, sel.map(n => n.id)) : [];
    const key = rules.map(r => r.id + r.name).join('|') + '#' + sel.map(n => n.id).join(',');
    this.inspRules.hidden = !rules.length;
    if (key === this._rulesKey) return;
    this._rulesKey = key;
    this.inspRules.innerHTML = '';
    if (!rules.length) return;
    const lab = document.createElement('span'); lab.textContent = 'Rewrite'; lab.className = 'insp-dim';
    this.inspRules.appendChild(lab);
    for (const r of rules) {
      const b = document.createElement('button');
      b.textContent = r.name;
      b.title = `${r.ref} — checked before it is applied`;
      b.addEventListener('click', () => { this.canvas.rewrite(r.id); this.canvas.canvas.focus({ preventScroll: true }); });   // keys (Cmd+Z) go to the canvas
      this.inspRules.appendChild(b);
    }
  }

  _refreshDocSelect() {
    // Proof steps are edited in the equation editor; listing them here would
    // let two panels edit one step at once (so they are left out)
    const docs = DocumentStore.list('diagram').filter(d => !d.ownerProof || d.id === this.currentDocId);
    this.docSelectEl.innerHTML = '';
    for (const d of docs) {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = DocumentStore.displayName(d);
      this.docSelectEl.appendChild(opt);
    }
    this.docSelectEl.value = this.currentDocId;
    this._refreshDerivedNote();
  }

  _refreshDerivedNote() {
    const doc = DocumentStore.get(this.currentDocId);
    const src = doc && doc.derivedFrom ? DocumentStore.get(doc.derivedFrom) : null;
    if (doc) this.orderSelectEl.value = doc.tensorOrder || 'big-endian';
    if (doc && document.activeElement !== this.sumInputEl) this.sumInputEl.value = (doc.sumIndices || []).join(', ');
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
      if (t.shape === 'box') swatch.style.borderRadius = '3px';
      else if (t.shape === 'morphbox') {
        swatch.style.borderRadius = '0'; swatch.style.border = 'none'; swatch.style.width = '22px'; swatch.style.height = '13px';
        swatch.style.clipPath = 'polygon(0 0,100% 0,68% 100%,0 100%)';
      }
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
      } else if (t.shape === 'dot') {
        swatch.style.width = '11px'; swatch.style.height = '11px'; swatch.style.margin = '0 4px';
        swatch.style.background = '#f4f4f4'; swatch.style.borderColor = '#1e1e1e'; swatch.style.borderWidth = '1.5px';
      } else if (t.shape === 'ground') {
        swatch.style.border = 'none'; swatch.style.background = 'transparent';
        swatch.textContent = '⏚'; swatch.style.color = t.color; swatch.style.fontSize = '16px'; swatch.style.lineHeight = '18px'; swatch.style.textAlign = 'center';
      } else if (t.shape === 'wire') {
        swatch.style.width = '2px'; swatch.style.borderRadius = '0';
        swatch.style.border = 'none'; swatch.style.margin = '0 8px';
      } else if (t.shape === 'triangle-down' || t.shape === 'triangle-up') {
        swatch.style.border = 'none'; swatch.style.borderRadius = '0';
        swatch.style.clipPath = t.shape === 'triangle-down'
          ? 'polygon(0 0,100% 0,50% 100%,0 35%)' : 'polygon(0 100%,100% 100%,50% 0,0 65%)';
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
