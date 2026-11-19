/**
 * CircuitEditor — Quirk-style circuit editor (no tool modes).
 *
 *   - Drag a gate from the palette onto a wire: onto a step to add it there,
 *     or into the gap between steps to insert a new step. An occupied cell
 *     is replaced.
 *   - Drag a placed gate to move it; drag it off the circuit to remove it.
 *   - Click a gate or a qubit label to select it; 🗑 / Delete removes it.
 *   - The inspector shows the selection; Z(θ) and X(θ) take a phase.
 *   - Each wire end has a picker for its input state / output effect.
 *   - View: Circuit (time →) or Algebraic (time ←, reads like the formula).
 *   - ⊗ order: the document's tensor order (see IR.TENSOR_ORDERS).
 *
 * Every circuit keeps a generated PQP diagram (CircuitDiagramLink); the
 * Diagram button shows it in a Diagram Editor and links a Dirac editor.
 */
import CircuitDocument, { MAX_QUBITS } from './CircuitDocument.js';
import DocumentStore from '../DocumentStore.js';
import { derivedDiagram } from './CircuitDiagramLink.js';
import { GATES, CONTROL, ANTI_CONTROL, SWAP } from '../../core/CircuitGates.js';

const PALETTE = [
  { gate: 'H' }, { gate: 'X' }, { gate: 'Y' }, { gate: 'Z' },
  { gate: 'S' }, { gate: 'Sdg' }, { gate: 'T' }, { gate: 'Tdg' },
  { gate: 'P', param: 'π/4' }, { gate: 'XP', param: 'π/4' },
  { gate: CONTROL }, { gate: ANTI_CONTROL }, { gate: SWAP },
];
const TITLES = {
  H: 'Hadamard', X: 'Pauli X (X spider, phase π)', Y: 'Pauli Y', Z: 'Pauli Z (Z spider, phase π)',
  S: 'S = Z(π/2)', Sdg: 'S† = Z(−π/2)', T: 'T = Z(π/4)', Tdg: 'T† = Z(−π/4)',
  P: 'Z-phase gate diag(1, e^{iθ}) — a Z spider', XP: 'X-phase gate — an X spider',
  [CONTROL]: 'Control: conditions every gate in its step on |1⟩',
  [ANTI_CONTROL]: 'Anti-control: conditions every gate in its step on |0⟩',
  [SWAP]: 'Swap: put two in one step',
};
const STATE_LABELS = { open: 'open', 0: '|0⟩', 1: '|1⟩', '+': '|+⟩', '-': '|−⟩' };
const EFFECT_LABELS = { open: 'open', 0: '⟨0|', 1: '⟨1|', '+': '⟨+|', '-': '⟨−|' };

// Layout (circuit frame: time →; the Algebraic view mirrors it horizontally)
const DT = 58, DQ = 56, LEFT = 112, RIGHT = 84, TOP = 16, GATE = 38, DRAG_THRESHOLD = 4;

export default class CircuitEditor {
  static get typeName() { return 'Circuit Editor'; }

  constructor(containerEl, options = {}) {
    const st = options.state || {};
    this.container = containerEl;
    this.selection = null;      // { kind:'cell', t, q } | { kind:'qubit', q }
    this.orientation = st.orientation === 'algebraic' ? 'algebraic' : 'circuit';
    this.drag = null;

    this.el = document.createElement('div');
    this.el.className = 'circuit-editor';
    this.container.appendChild(this.el);
    this._buildToolbar();
    this._buildDocBar();
    this._buildStage();

    let doc = (st.docId && DocumentStore.get(st.docId)) || DocumentStore.list('circuit')[0];
    if (!doc) doc = DocumentStore.add(new CircuitDocument('Circuit 1', 2));
    this._onDocChange = () => this.render();
    this._setDoc(doc);

    this._onStoreChange = () => this._refreshDocSelect();
    DocumentStore.onListChange(this._onStoreChange);
    window.addEventListener('mousemove', this._mm = e => this._onMouseMove(e));
    window.addEventListener('mouseup', this._mu = e => this._onMouseUp(e));
  }

  /* ---------------- Documents ---------------- */

  /** Panel state for workbooks. */
  getState() { return { docId: this.doc && this.doc.id, orientation: this.orientation }; }

  _setDoc(doc) {
    if (this.doc) this.doc.offChange(this._onDocChange);
    this.doc = doc;
    this.doc.onChange(this._onDocChange);
    this.selection = null;
    derivedDiagram(doc);                   // make sure its diagram exists and follows it
    this._refreshDocSelect();
    this.render();
  }

  _refreshDocSelect() {
    const sel = this.docSelectEl;
    sel.innerHTML = '';
    for (const d of DocumentStore.list('circuit')) {
      const o = document.createElement('option'); o.value = d.id; o.textContent = d.name; sel.appendChild(o);
    }
    if (this.doc) sel.value = this.doc.id;
  }

  _newCircuit() {
    const n = DocumentStore.list('circuit').length + 1;
    const c = DocumentStore.add(new CircuitDocument(`Circuit ${n}`, 2));
    this._setDoc(c);
  }

  /** Show this circuit's diagram in a Diagram Editor and link a Dirac editor to it. */
  _showDiagram() {
    const d = derivedDiagram(this.doc);
    window.dispatchEvent(new CustomEvent('qpp:show-circuit', { detail: {
      circuitId: this.doc.id, diagramId: d.id, orientation: this.orientation,
    } }));
  }

  /* ---------------- Building the UI ---------------- */

  _buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'diagram-toolbar circuit-toolbar';
    const group = document.createElement('div');
    group.className = 'tool-group';
    for (const cell of PALETTE) {
      const b = document.createElement('button');
      b.className = 'diagram-tool-btn circuit-palette-btn';
      b.dataset.gate = cell.gate;
      b.title = `${TITLES[cell.gate]} — drag onto a wire`;
      b.appendChild(this._cellFace(cell));
      b.addEventListener('mousedown', e => this._startDrag(e, { kind: 'new', cell }));
      group.appendChild(b);
    }
    bar.appendChild(group);

    const util = document.createElement('div');
    util.className = 'tool-group';
    const trash = document.createElement('button');
    trash.className = 'diagram-tool-btn';
    trash.title = 'Delete selected (Del)';
    trash.textContent = '🗑';
    trash.addEventListener('click', () => this.deleteSelected());
    util.appendChild(trash);
    bar.appendChild(util);
    this.el.appendChild(bar);
  }

  _buildDocBar() {
    const bar = document.createElement('div');
    bar.className = 'diagram-toolbar doc-bar';
    const add = (...els) => els.forEach(e => bar.appendChild(e));
    const span = (text, cls = '') => { const s = document.createElement('span'); s.textContent = text; s.className = cls; return s; };
    const button = (text, title, fn) => {
      const b = document.createElement('button');
      b.className = 'diagram-tool-btn circuit-text-btn'; b.textContent = text; b.title = title;
      b.addEventListener('click', fn); return b;
    };
    const select = (options, title, fn) => {
      const s = document.createElement('select');
      s.className = 'editor-type-select'; s.title = title;
      for (const [v, t] of options) { const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o); }
      s.addEventListener('change', () => fn(s.value));
      return s;
    };

    this.docSelectEl = select([], 'Circuit', id => { const d = DocumentStore.get(id); if (d) this._setDoc(d); });
    this.viewSelectEl = select([['circuit', 'Circuit (time →)'], ['algebraic', 'Algebraic (time ←)']],
      'Which way time flows (drawing only)', v => { this.orientation = v; this.render(); });
    this.orderSelectEl = select([['big-endian', 'First wire first (N&C)'], ['little-endian', 'First wire last (Qiskit)']],
      'Which qubit is the first tensor factor / leftmost ket digit', v => this.doc.setTensorOrder(v));

    const viewLab = span('View', 'diagram-bar-field'); viewLab.appendChild(this.viewSelectEl);
    const orderLab = span('⊗ order', 'diagram-bar-field'); orderLab.appendChild(this.orderSelectEl);
    add(span('Circuit:', 'circuit-dim'), this.docSelectEl,
      button('＋ New', 'Create a new circuit', () => this._newCircuit()),
      button('＋ Qubit', 'Add a qubit (wire)', () => this._addQubit()),
      viewLab, orderLab,
      button('◇ Diagram', 'Show the PQP diagram of this circuit and link the Dirac editor', () => this._showDiagram()));

    this.inspectorEl = document.createElement('div');
    this.inspectorEl.className = 'diagram-inspector';
    this.inspTextEl = span('', 'insp-type');
    this.inspParamWrap = document.createElement('label');
    this.inspParamWrap.className = 'insp-field';
    this.inspParamWrap.append('Phase');
    this.inspParamEl = document.createElement('input');
    this.inspParamEl.type = 'text'; this.inspParamEl.spellcheck = false;
    this.inspParamEl.placeholder = 'π/4, -π/2, α, …';
    this.inspParamEl.addEventListener('change', () => this._setParam(this.inspParamEl.value.trim()));
    this.inspParamEl.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') { this.inspParamEl.blur(); this.stageWrap.focus({ preventScroll: true }); }
    });
    this.inspParamWrap.appendChild(this.inspParamEl);
    this.inspectorEl.append(this.inspTextEl, this.inspParamWrap);
    bar.appendChild(this.inspectorEl);
    this.el.appendChild(bar);
  }

  _buildStage() {
    this.stageWrap = document.createElement('div');
    this.stageWrap.className = 'circuit-stage-wrap';
    this.stageWrap.tabIndex = 0;
    this.stageWrap.addEventListener('keydown', e => this._onKeyDown(e));
    this.stageWrap.addEventListener('mousedown', e => {
      if (e.target === this.stageWrap || e.target === this.stage || e.target.tagName === 'svg' || e.target.tagName === 'line') {
        this._select(null);
      }
    });
    this.stage = document.createElement('div');
    this.stage.className = 'circuit-stage';
    this.stageWrap.appendChild(this.stage);
    this.el.appendChild(this.stageWrap);
  }

  /** The visual face of a cell (gate box, control dot, …). */
  _cellFace(cell) {
    const f = document.createElement('div');
    if (cell.gate === CONTROL) { f.className = 'cg-ctrl'; return f; }
    if (cell.gate === ANTI_CONTROL) { f.className = 'cg-actrl'; return f; }
    if (cell.gate === SWAP) { f.className = 'cg-swap'; f.textContent = '×'; return f; }
    const g = GATES[cell.gate];
    const family = cell.gate === 'H' ? 'h' : g.zx.spider === 'x' ? 'x' : g.zx.spider === 'z' ? 'z' : 'y';
    f.className = `cg-gate cg-${family}`;
    f.textContent = g.param ? g.label.replace('θ', cell.param || 'θ') : g.label;
    return f;
  }

  /* ---------------- Rendering ---------------- */

  _geom() {
    const n = this.doc.nQubits, T = this.doc.columns.length + 1;   // +1: an empty step to drop into
    const W = LEFT + T * DT + RIGHT, H = TOP * 2 + n * DQ;
    const alg = this.orientation === 'algebraic';
    return {
      n, T, W, H, alg,
      colX: t => LEFT + DT / 2 + t * DT,                 // circuit frame
      wireY: q => TOP + q * DQ + DQ / 2,
      X: (cx, w = 0) => (alg ? W - cx - w : cx),          // left edge on screen for a box of width w
    };
  }

  render() {
    const doc = this.doc;
    if (!doc) return;
    this._validateSelection();
    const G = this._geom();
    this.viewSelectEl.value = this.orientation;
    this.orderSelectEl.value = doc.tensorOrder;
    const st = this.stage;
    st.innerHTML = '';
    st.style.width = G.W + 'px';
    st.style.height = G.H + 'px';

    // Wires and connectors (SVG)
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', G.W); svg.setAttribute('height', G.H);
    const line = (x1, y1, x2, y2, cls) => {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', G.X(x1)); l.setAttribute('x2', G.X(x2));
      l.setAttribute('y1', y1); l.setAttribute('y2', y2);
      l.setAttribute('class', cls);
      svg.appendChild(l);
    };
    const wireStart = LEFT - 4, wireEnd = LEFT + G.T * DT + 4;
    for (let q = 0; q < G.n; q++) line(wireStart, G.wireY(q), wireEnd, G.wireY(q), 'cw-wire');
    doc.columns.forEach((col, t) => {
      const qs = col.map((c, q) => (c ? q : -1)).filter(q => q >= 0);
      const linked = col.some(c => c && (c.gate === CONTROL || c.gate === ANTI_CONTROL || c.gate === SWAP));
      if (linked && qs.length > 1)
        line(G.colX(t), G.wireY(Math.min(...qs)), G.colX(t), G.wireY(Math.max(...qs)), 'cw-link');
    });
    st.appendChild(svg);

    const place = (el, cx, cy, w, h) => {
      el.style.left = G.X(cx - w / 2, w) + 'px';
      el.style.top = (cy - h / 2) + 'px';
      el.style.width = w + 'px'; el.style.height = h + 'px';
      st.appendChild(el);
    };

    // Cells
    doc.columns.forEach((col, t) => col.forEach((cell, q) => {
      if (!cell) return;
      const holder = document.createElement('div');
      holder.className = 'circuit-cell';
      holder.dataset.t = t; holder.dataset.q = q;
      const face = this._cellFace(cell);
      holder.appendChild(face);
      const sel = this.selection;
      if (sel && sel.kind === 'cell' && sel.t === t && sel.q === q) holder.classList.add('selected');
      holder.title = TITLES[cell.gate];
      holder.addEventListener('mousedown', e => this._startDrag(e, { kind: 'move', from: { t, q }, cell }));
      const w = face.className.startsWith('cg-gate') ? Math.max(GATE, 12 + 7.5 * face.textContent.length) : GATE;
      place(holder, G.colX(t), G.wireY(q), w, GATE);
    }));

    // Wire ends: input pickers, qubit labels, output pickers
    for (let q = 0; q < G.n; q++) {
      const y = G.wireY(q);
      place(this._picker(STATE_LABELS, doc.inputs[q], v => doc.setInput(q, v), `Input of qubit ${q}`),
        38, y, 58, 22);
      const lab = document.createElement('div');
      lab.className = 'circuit-qubit-label';
      lab.textContent = `q${q}`;
      lab.title = 'Click to select this qubit (🗑 removes it)';
      const sel = this.selection;
      if (sel && sel.kind === 'qubit' && sel.q === q) lab.classList.add('selected');
      lab.addEventListener('mousedown', e => { e.stopPropagation(); this._select({ kind: 'qubit', q }); this.stageWrap.focus({ preventScroll: true }); });
      place(lab, 88, y, 28, 20);
      place(this._picker(EFFECT_LABELS, doc.outputs[q], v => doc.setOutput(q, v), `Output of qubit ${q}`),
        wireEnd + 40, y, 58, 22);
    }

    // Drop indicator
    this.indicator = document.createElement('div');
    this.indicator.className = 'circuit-drop-indicator';
    this.indicator.hidden = true;
    st.appendChild(this.indicator);
    this._refreshInspector();
  }

  _picker(labels, value, onChange, title) {
    const s = document.createElement('select');
    s.className = 'circuit-picker' + (value === 'open' ? ' open' : '');
    s.title = title;
    for (const [v, t] of Object.entries(labels)) {
      const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o);
    }
    s.value = value;
    s.addEventListener('mousedown', e => e.stopPropagation());
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  /* ---------------- Selection & inspector ---------------- */

  _select(sel) {
    this.selection = sel;
    this.render();
  }

  _validateSelection() {
    const s = this.selection;
    if (!s) return;
    if (s.kind === 'cell' && !this.doc.cell(s.t, s.q)) this.selection = null;
    if (s.kind === 'qubit' && s.q >= this.doc.nQubits) this.selection = null;
  }

  _refreshInspector() {
    const s = this.selection;
    const cell = s && s.kind === 'cell' ? this.doc.cell(s.t, s.q) : null;
    const g = cell && GATES[cell.gate];
    this.inspParamWrap.hidden = !(g && g.param);
    if (!s) { this.inspTextEl.textContent = 'Drag gates onto the wires'; return; }
    if (s.kind === 'qubit') { this.inspTextEl.textContent = `Qubit ${s.q} selected (🗑 to remove)`; return; }
    const name = g ? (g.param ? g.label : g.label) : cell.gate === CONTROL ? 'Control •'
      : cell.gate === ANTI_CONTROL ? 'Anti-control ∘' : 'Swap ×';
    this.inspTextEl.textContent = `${name} · step ${s.t + 1}, qubit ${s.q}`;
    if (g && g.param && document.activeElement !== this.inspParamEl) this.inspParamEl.value = cell.param || '';
  }

  _setParam(value) {
    const s = this.selection;
    const cell = s && s.kind === 'cell' && this.doc.cell(s.t, s.q);
    if (!cell || !value || value === cell.param) return;
    this.doc.setCell(s.t, s.q, { ...cell, param: value });
  }

  deleteSelected() {
    const s = this.selection;
    if (!s) { this._toast('Select a gate or a qubit to delete'); return; }
    if (s.kind === 'cell') this.doc.setCell(s.t, s.q, null);
    else if (this.doc.nQubits <= 1) { this._toast('A circuit needs at least one qubit'); return; }
    else this.doc.removeQubit(s.q);
    this.selection = null;
    this.render();
  }

  _addQubit() {
    if (this.doc.nQubits >= MAX_QUBITS) { this._toast(`At most ${MAX_QUBITS} qubits`); return; }
    this.doc.addQubit();
  }

  /* ---------------- Drag and drop ---------------- */

  _startDrag(e, info) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    this.stageWrap.focus({ preventScroll: true });
    const ghost = document.createElement('div');
    ghost.className = 'circuit-ghost';
    ghost.appendChild(this._cellFace(info.cell));
    ghost.hidden = true;
    document.body.appendChild(ghost);
    this.drag = { ...info, ghost, sx: e.clientX, sy: e.clientY, moved: false, target: null };
  }

  _onMouseMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD) return;
    d.moved = true;
    d.ghost.hidden = false;
    d.ghost.style.left = e.clientX + 'px';
    d.ghost.style.top = e.clientY + 'px';
    d.target = this._dropTarget(e.clientX, e.clientY);
    d.ghost.classList.toggle('removing', d.kind === 'move' && !!d.target && d.target.off);
    this._showIndicator(d.target);
  }

  _onMouseUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.ghost.remove();
    this._showIndicator(null);
    if (!d.moved) {
      if (d.kind === 'move') this._select({ kind: 'cell', ...d.from });
      return;
    }
    const t = d.target;
    if (!t) return;
    if (d.kind === 'new') {
      if (t.off) return;
      const pos = t.insert ? this.doc.insertCell(t.t, t.q, d.cell) : this.doc.setCell(t.t, t.q, d.cell);
      this._select(pos ? { kind: 'cell', ...pos } : null);
    } else if (t.off) {
      this.doc.setCell(d.from.t, d.from.q, null);       // dragged off the circuit: remove
      this._select(null);
    } else if (!(t.t === d.from.t && t.q === d.from.q && !t.insert)) {
      const pos = this.doc.moveCell(d.from, t);
      this._select(pos ? { kind: 'cell', ...pos } : null);
    }
  }

  /**
   * Where a drop at client (x, y) lands: { t, q, insert } for a step or a
   * gap between steps, { off: true } outside the circuit, or null.
   */
  _dropTarget(clientX, clientY) {
    const r = this.stage.getBoundingClientRect();
    const wr = this.stageWrap.getBoundingClientRect();
    if (clientX < wr.left || clientX > wr.right || clientY < wr.top || clientY > wr.bottom) return { off: true };
    const G = this._geom();
    const x = clientX - r.left, y = clientY - r.top;
    const cx = G.alg ? G.W - x : x;
    const q = Math.floor((y - TOP) / DQ);
    if (q < 0 || q >= G.n) return { off: true };
    if (cx < LEFT - DT / 2 || cx > LEFT + G.T * DT + DT / 2) return { off: true };
    const u = (cx - G.colX(0)) / DT;
    const nearest = Math.round(u);
    const nCols = this.doc.columns.length;
    if (Math.abs(u - nearest) <= 0.3 || u < 0) {
      return { t: Math.max(0, Math.min(nearest, nCols)), q, insert: false };
    }
    const gap = Math.ceil(u);
    return gap >= nCols ? { t: nCols, q, insert: false } : { t: gap, q, insert: true };
  }

  _showIndicator(t) {
    const ind = this.indicator;
    if (!ind) return;
    if (!t || t.off) { ind.hidden = true; return; }
    const G = this._geom();
    ind.hidden = false;
    if (t.insert) {
      const cx = G.colX(t.t) - DT / 2;
      ind.className = 'circuit-drop-indicator gap';
      ind.style.left = G.X(cx - 2, 4) + 'px'; ind.style.top = (TOP / 2) + 'px';
      ind.style.width = '4px'; ind.style.height = (G.H - TOP) + 'px';
    } else {
      ind.className = 'circuit-drop-indicator slot';
      ind.style.left = G.X(G.colX(t.t) - GATE / 2 - 3, GATE + 6) + 'px';
      ind.style.top = (G.wireY(t.q) - GATE / 2 - 3) + 'px';
      ind.style.width = (GATE + 6) + 'px'; ind.style.height = (GATE + 6) + 'px';
    }
  }

  /* ---------------- Keyboard ---------------- */

  _onKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelected(); }
    else if (e.key === 'Escape') { this._select(null); }
    else if (e.key === 'z' && mod && !e.shiftKey) { e.preventDefault(); if (!this.doc.undo()) this._toast('Nothing to undo'); }
    else if ((e.key === 'z' && mod && e.shiftKey) || (e.key === 'y' && mod)) { e.preventDefault(); if (!this.doc.redo()) this._toast('Nothing to redo'); }
  }

  _toast(msg) {
    const el = document.createElement('div');
    el.className = 'circuit-toast';
    el.textContent = msg;
    this.el.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  onResize() { /* layout is intrinsic; the stage scrolls */ }

  destroy() {
    if (this.doc) this.doc.offChange(this._onDocChange);
    DocumentStore.offListChange(this._onStoreChange);
    window.removeEventListener('mousemove', this._mm);
    window.removeEventListener('mouseup', this._mu);
    if (this.drag) this.drag.ghost.remove();
    this.el.remove();
  }
}
