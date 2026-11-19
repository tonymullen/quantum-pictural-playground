/**
 * EquationEditor — Compose and check diagrammatic proofs.
 *
 *   ┌ doc bar: proof · ＋ New · ＋ Step · Insert… · 🗑 · step inspector ┐
 *   │ strip:  [D₁] ≈✓ [D₂] =✓ [D₃] …         (click a step to edit it) │
 *   │ embedded Diagram Editor for the selected step                     │
 *   └ summary: D₁ ≈ D₃ ✓                                                ┘
 *
 * Steps are copies (never live links): "＋ Step" duplicates the selected
 * step — the usual way to make the next step of a proof — and "Insert…"
 * copies in a diagram (or a circuit's generated diagram) from elsewhere.
 * Each step is checked against the previous one as soon as either changes
 * (ProofCheck: exact, or by random substitution for symbolic f, ψ, α).
 */
import ProofDocument, { ASSUMPTIONS } from './ProofDocument.js';
import DocumentStore from '../DocumentStore.js';
import DiagramEditor from '../DiagramEditor/DiagramEditor.js';
import DiagramNode, { NODE_TYPES, uprightText } from '../DiagramEditor/DiagramNode.js';
import DiagramWire from '../DiagramEditor/DiagramWire.js';
import { drawSigma } from '../DiagramEditor/DiagramCanvas.js';
import { derivedDiagram } from '../CircuitEditor/CircuitDiagramLink.js';
import { orient } from '../../core/FlowDirection.js';

const SUB = n => String(n).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[d]).join('');
const THUMB_W = 112, THUMB_H = 78;

export default class EquationEditor {
  static get typeName() { return 'Diagram Equation Editor'; }

  constructor(containerEl, options = {}) {
    const st = options.state || {};
    this.container = containerEl;
    this.selected = 0;
    this.el = document.createElement('div');
    this.el.className = 'equation-editor';
    this.container.appendChild(this.el);

    this._buildDocBar();
    this.assumeEl = document.createElement('div');
    this.assumeEl.className = 'equation-assumptions';
    this.el.appendChild(this.assumeEl);
    this.stripEl = document.createElement('div');
    this.stripEl.className = 'equation-strip';
    this.stripEl.tabIndex = 0;
    this.stripEl.addEventListener('keydown', e => this._onStripKey(e));
    this.el.appendChild(this.stripEl);

    this.editorWrap = document.createElement('div');
    this.editorWrap.className = 'equation-step-editor';
    this.el.appendChild(this.editorWrap);

    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'equation-summary';
    this.el.appendChild(this.summaryEl);

    let proof = (st.proofId && DocumentStore.get(st.proofId)) || DocumentStore.list('proof')[0];
    if (!proof) proof = this._createEmptyProof();
    this._onProofChange = () => this._scheduleRender();
    this._setProof(proof);
    if (Number.isInteger(st.selected)) { this.selected = st.selected; this.render(); }

    this._onStoreChange = () => { this._refreshProofSelect(); this._refreshInsertSelect(); };
    DocumentStore.onListChange(this._onStoreChange);
  }

  /* ---------------- Documents ---------------- */

  /** Panel state for workbooks. */
  getState() { return { proofId: this.proof && this.proof.id, selected: this.selected }; }

  _createEmptyProof() {
    const p = DocumentStore.add(new ProofDocument(`Proof ${DocumentStore.list('proof').length + 1}`));
    p.addEmptyStep();
    p._undoStack = [];
    return p;
  }

  _setProof(proof) {
    if (this.proof) this.proof.offChange(this._onProofChange);
    this.proof = proof;
    this.proof.onChange(this._onProofChange);
    this.selected = proof.steps.length - 1;   // continue from the end of the proof
    this._refreshProofSelect();
    this._refreshInsertSelect();
    this.render();
  }

  _newProof() { this._setProof(this._createEmptyProof()); }

  /* ---------------- UI ---------------- */

  _buildDocBar() {
    const bar = document.createElement('div');
    bar.className = 'diagram-toolbar doc-bar';
    const span = (t, cls = 'circuit-dim') => { const s = document.createElement('span'); s.className = cls; s.textContent = t; return s; };
    const btn = (t, title, fn) => {
      const b = document.createElement('button');
      b.className = 'diagram-tool-btn circuit-text-btn'; b.textContent = t; b.title = title;
      b.addEventListener('click', fn); return b;
    };
    this.proofSelectEl = document.createElement('select');
    this.proofSelectEl.className = 'editor-type-select';
    this.proofSelectEl.addEventListener('change', () => {
      const p = DocumentStore.get(this.proofSelectEl.value); if (p) this._setProof(p);
    });
    this.insertSelectEl = document.createElement('select');
    this.insertSelectEl.className = 'editor-type-select';
    this.insertSelectEl.title = 'Copy a diagram (or a circuit\'s diagram) in as the next step';
    this.insertSelectEl.addEventListener('change', () => this._insertChosen());

    bar.append(span('Proof:'), this.proofSelectEl,
      btn('＋ New', 'Start a new proof', () => this._newProof()),
      btn('＋ Step', 'Duplicate the selected step as the next step (then edit it)', () => this._duplicate()),
      this.insertSelectEl,
      btn('🗑', 'Delete the selected step (Del)', () => this._deleteStep()));

    this.inspEl = document.createElement('div');
    this.inspEl.className = 'diagram-inspector';
    this.inspTextEl = span('', 'insp-type');
    this.updateBtn = btn('↻ Update from source', 'Replace this step with a fresh copy of the diagram it was inserted from', () => {
      if (this.proof.updateFromSource(this.selected)) this.render();
    });
    this.applyBtn = btn('⇡ Apply to source', 'Overwrite the diagram this step came from with this step (undoable there)', () => {
      const src = this.proof.sourceOf(this.selected);
      if (this.proof.applyToSource(this.selected)) this._toast(`Copied D${this.selected + 1} into “${src.name}”`);
    });
    this.saveBtn = btn('⇣ Save as new diagram', 'Make a standalone copy of this step for the Diagram Editor', () => {
      const d = this.proof.saveAsNewDiagram(this.selected);
      this._toast(`Saved as diagram “${d.name}”`);
    });
    this.inspEl.append(this.inspTextEl, this.updateBtn, this.applyBtn, this.saveBtn);
    bar.appendChild(this.inspEl);
    this.el.appendChild(bar);
  }

  _refreshProofSelect() {
    const s = this.proofSelectEl;
    s.innerHTML = '';
    for (const p of DocumentStore.list('proof')) {
      const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; s.appendChild(o);
    }
    if (this.proof) s.value = this.proof.id;
  }

  _refreshInsertSelect() {
    const s = this.insertSelectEl;
    s.innerHTML = '';
    const head = document.createElement('option');
    head.value = ''; head.textContent = 'Insert diagram…';
    s.appendChild(head);
    const groups = [
      ['Diagrams', DocumentStore.list('diagram').filter(d => !d.ownerProof)],
      ['Circuits (their PQP diagram)', DocumentStore.list('circuit')],
      ['Steps of other proofs', DocumentStore.list('diagram').filter(d => d.ownerProof && d.ownerProof !== (this.proof && this.proof.id))],
    ];
    for (const [label, docs] of groups) {
      if (!docs.length) continue;
      const g = document.createElement('optgroup'); g.label = label;
      for (const d of docs) {
        const o = document.createElement('option'); o.value = d.id; o.textContent = DocumentStore.displayName(d); g.appendChild(o);
      }
      s.appendChild(g);
    }
    s.value = '';
  }

  /* ---------------- Actions ---------------- */

  _duplicate() {
    const at = this.proof.steps.length
      ? this.proof.duplicateStep(this.selected)
      : this.proof.addEmptyStep();
    this.selected = at;
    this.render();
  }

  _insertChosen() {
    const doc = DocumentStore.get(this.insertSelectEl.value);
    this.insertSelectEl.value = '';
    if (!doc) return;
    const src = doc.kind === 'circuit' ? derivedDiagram(doc) : doc;
    this.selected = this.proof.insertDiagram(src, this.proof.steps.length ? this.selected + 1 : 0);
    this.render();
  }

  _deleteStep() {
    if (this.proof.steps.length <= 1) { this._toast('A proof keeps at least one step'); return; }
    this.proof.removeStep(this.selected);
    this.selected = Math.min(this.selected, this.proof.steps.length - 1);
    this.render();
  }

  _onStripKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this._deleteStep(); }
    else if (e.key === 'ArrowLeft') { this.selected = Math.max(0, this.selected - 1); this.render(); }
    else if (e.key === 'ArrowRight') { this.selected = Math.min(this.proof.steps.length - 1, this.selected + 1); this.render(); }
    else if (e.key === 'z' && mod && !e.shiftKey) { e.preventDefault(); if (this.proof.undo()) this._clampAndRender(); }
    else if ((e.key === 'z' && mod && e.shiftKey) || (e.key === 'y' && mod)) { e.preventDefault(); if (this.proof.redo()) this._clampAndRender(); }
  }

  _clampAndRender() {
    this.selected = Math.max(0, Math.min(this.selected, this.proof.steps.length - 1));
    this.render();
  }

  /* ---------------- Rendering ---------------- */

  _scheduleRender() {
    if (this._pending) return;
    this._pending = requestAnimationFrame(() => { this._pending = null; this.render(); });
  }

  render() {
    const p = this.proof;
    if (!p) return;
    this.selected = Math.max(0, Math.min(this.selected, p.steps.length - 1));
    const check = p.checkAll();
    this._renderAssumptions();
    this._renderStrip(check);
    this._renderSummary(check);
    this._renderInspector();
    this._showSelectedStep();
  }

  _renderStrip(check) {
    const strip = this.stripEl;
    strip.innerHTML = '';
    const p = this.proof;
    const orientation = this.stepEditor ? this.stepEditor.canvas.orientation : null;
    p.steps.forEach((st, i) => {
      if (i > 0) strip.appendChild(this._relationEl(i, check.results[i]));
      const card = document.createElement('div');
      card.className = 'equation-card' + (i === this.selected ? ' selected' : '');
      card.title = 'Click to edit this step';
      const cv = document.createElement('canvas');
      card.appendChild(cv);
      const cap = document.createElement('div');
      cap.className = 'equation-card-caption';
      const src = p.sourceOf(i);
      cap.textContent = `D${SUB(i + 1)}`;
      if (src) card.title = `Copy of “${DocumentStore.displayName(src)}” — click to edit this step`;
      card.appendChild(cap);
      card.addEventListener('mousedown', () => { this.selected = i; this.render(); this.stripEl.focus({ preventScroll: true }); });
      strip.appendChild(card);
      drawThumbnail(cv, st.diagram, orientation);
    });
  }

  _relationEl(i, result) {
    const st = this.proof.steps[i];
    const box = document.createElement('div');
    box.className = 'equation-relation';
    const rel = document.createElement('select');
    rel.className = 'equation-rel-select';
    rel.title = '= exactly equal · ≈ equal up to a nonzero scalar';
    for (const r of ['≈', '=']) { const o = document.createElement('option'); o.value = r; o.textContent = r; rel.appendChild(o); }
    rel.value = st.relation;
    rel.addEventListener('mousedown', e => e.stopPropagation());
    rel.addEventListener('change', () => this.proof.setRelation(i, rel.value));
    const badge = document.createElement('div');
    const cls = result.status === 'ok' ? 'ok' : result.status === 'fail' ? 'fail' : 'unknown';
    badge.className = `equation-badge ${cls}`;
    badge.textContent = cls === 'ok' ? '✓' : cls === 'fail' ? '✗' : '?';
    badge.title = result.hint;
    const note = document.createElement('input');
    note.className = 'equation-note';
    note.placeholder = 'rule…';
    note.value = st.note;
    note.title = 'The rule used in this step (a note; not checked)';
    note.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') note.blur(); });
    note.addEventListener('change', () => this.proof.setNote(i, note.value.trim()));
    box.append(rel, badge, note);
    return box;
  }

  /** "Assume: Φ causal ✕  U unitary ✕   [symbol] [property] Assume" — PQP's "for causal Φ …". */
  _renderAssumptions() {
    const el = this.assumeEl, p = this.proof;
    el.innerHTML = '';
    const lab = document.createElement('span'); lab.className = 'circuit-dim'; lab.textContent = 'Assume:'; el.appendChild(lab);
    const entries = Object.entries(p.assumptions);
    if (!entries.length) { const n = document.createElement('span'); n.className = 'equation-dim'; n.textContent = 'nothing'; el.appendChild(n); }
    for (const [sym, prop] of entries) {
      const chip = document.createElement('span');
      chip.className = 'equation-chip';
      chip.title = `${sym} is ${ASSUMPTIONS[prop]}`;
      chip.append(`${sym} ${prop}`);
      const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Drop this assumption';
      x.addEventListener('click', () => p.setAssumption(sym, null));
      chip.appendChild(x);
      el.appendChild(chip);
    }
    const syms = p.symbols().filter(s => !p.assumptions[s]);
    if (!syms.length) return;
    const sel = document.createElement('select'); sel.className = 'editor-type-select';
    for (const s of syms) { const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); }
    const prop = document.createElement('select'); prop.className = 'editor-type-select';
    for (const [k, v] of Object.entries(ASSUMPTIONS)) { const o = document.createElement('option'); o.value = k; o.textContent = k; o.title = v; prop.appendChild(o); }
    const add = document.createElement('button'); add.className = 'diagram-tool-btn circuit-text-btn'; add.textContent = 'Assume';
    add.title = 'Every check then uses random values satisfying this';
    add.addEventListener('click', () => p.setAssumption(sel.value, prop.value));
    el.append(sel, prop, add);
  }

  _renderSummary(check) {
    const n = this.proof.steps.length;
    const el = this.summaryEl;
    el.className = 'equation-summary';
    if (check.status === 'empty') { el.textContent = 'Add a step (＋ Step duplicates this one) to start the proof'; return; }
    const claim = `D${SUB(1)} ${check.relation} D${SUB(n)}`;
    if (check.status === 'ok') {
      el.classList.add('ok');
      el.textContent = `✓ ${claim} — every step checks`;
    } else {
      const i = check.firstBad;
      el.classList.add(check.status === 'fail' ? 'fail' : 'unknown');
      el.textContent = `${check.status === 'fail' ? '✗' : '?'} ${claim} not established — step D${SUB(i)} → D${SUB(i + 1)}: ${check.results[i].hint}`;
    }
  }

  _renderInspector() {
    const st = this.proof.steps[this.selected];
    if (!st) { this.inspTextEl.textContent = ''; this.updateBtn.hidden = this.applyBtn.hidden = true; return; }
    const src = this.proof.sourceOf(this.selected);
    this.inspTextEl.textContent = `Editing D${SUB(this.selected + 1)}` + (src ? ` · copy of “${DocumentStore.displayName(src)}”` : '');
    this.updateBtn.hidden = !src;
    this.applyBtn.hidden = !this.proof.canApplyToSource(this.selected);
  }

  _showSelectedStep() {
    const st = this.proof.steps[this.selected];
    if (!st) return;
    if (!this.stepEditor) {
      this.stepEditor = new DiagramEditor(this.editorWrap, { doc: st.diagram, embedded: true });
      requestAnimationFrame(() => this.stepEditor.canvas.fitToContent());
      // Thumbnails follow the step editor's view orientation
      this.stepEditor.viewSelectEl.addEventListener('change', () => this.render());
    } else if (this.stepEditor.currentDocId !== st.diagram.id) {
      this.stepEditor.showDocument(st.diagram);
      this.stepEditor.canvas.fitToContent();
    }
  }

  _toast(msg) {
    const el = document.createElement('div');
    el.className = 'circuit-toast';
    el.textContent = msg;
    this.el.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  onResize() { if (this.stepEditor) this.stepEditor.onResize(); }

  destroy() {
    if (this.proof) this.proof.offChange(this._onProofChange);
    DocumentStore.offListChange(this._onStoreChange);
    if (this._pending) cancelAnimationFrame(this._pending);
    if (this.stepEditor) this.stepEditor.destroy();
    this.el.remove();
  }
}

/** Draw a diagram, fitted, into a small canvas (in the given view orientation). */
export function drawThumbnail(cv, doc, orientation) {
  const dpr = window.devicePixelRatio || 1;
  cv.width = THUMB_W * dpr; cv.height = THUMB_H * dpr;
  cv.style.width = THUMB_W + 'px'; cv.style.height = THUMB_H + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  if (!doc.nodes.size) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('empty', THUMB_W / 2, THUMB_H / 2);
    return;
  }
  doc.refreshLegs();
  const o = orientation || { a: 1, b: 0, c: 0, d: 1 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of doc.nodes.values()) {
    const p = orient(o, n.x, n.y), pad = n.radius + 14;
    x0 = Math.min(x0, p.x - pad); x1 = Math.max(x1, p.x + pad);
    y0 = Math.min(y0, p.y - pad); y1 = Math.max(y1, p.y + pad);
  }
  const z = Math.min(1, (THUMB_W - 8) / (x1 - x0), (THUMB_H - 8) / (y1 - y0));
  const sums = doc.sumIndices || [];
  const shift = sums.length ? 10 : 0;          // room for Σᵢ on the left
  ctx.save();
  ctx.translate(THUMB_W / 2 + shift - ((x0 + x1) / 2) * z, THUMB_H / 2 - ((y0 + y1) / 2) * z);
  ctx.scale(z, z);
  ctx.transform(o.a, o.b, o.c, o.d, 0, 0);
  ctx.__orient = o;
  for (const w of doc.wires) w.draw(ctx, doc.nodes);
  for (const n of doc.nodes.values()) {
    const sel = n.selected; n.selected = false;
    n.draw(ctx);
    n.selected = sel;
  }
  ctx.restore();
  if (sums.length) drawSigma(ctx, THUMB_W / 2 + shift - ((x1 - x0) / 2) * z - 2, THUMB_H / 2, sums, 18);
}
