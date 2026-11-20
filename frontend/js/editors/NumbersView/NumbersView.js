/**
 * NumbersView — the numbers behind a picture.
 *
 * Linked to a circuit or diagram (or the nodes selected in a diagram), it shows:
 *   · the matrix, as a colour map: brightness = magnitude, hue = phase
 *     (red 0, yellow π/2, cyan π, blue 3π/2), rows and columns labelled by basis states
 *   · for a state: Born-rule probabilities of measuring every qubit, as bars
 *   · for one qubit: the Bloch sphere (a pure state on the surface, a mixed one inside)
 *   · for a quantum process (the doubled picture): its density operator /
 *     channel, and the probabilities of its classical outcomes
 *
 * PQP makes the point that pictures and numbers say the same thing; this
 * panel keeps the numbers one glance away.
 */
import DocumentStore from '../DocumentStore.js';
import DiagramDocument from '../DiagramEditor/DiagramDocument.js';
import { copyFragment, pasteFragment } from '../DiagramEditor/Fragment.js';
import { evaluateDiagram } from '../../core/ProcessDirac.js';
import Tensor from '../../core/Tensor.js';
import C from '../../core/Complex.js';

const MAX_DIM = 64;           // matrices up to 64 × 64 (6 qubits) are drawn

export default class NumbersView {
  static get typeName() { return 'Numbers'; }

  constructor(containerEl, options = {}) {
    const st = options.state || {};
    this.container = containerEl;
    this.el = document.createElement('div');
    this.el.className = 'numbers-view';
    containerEl.appendChild(this.el);

    // Linked to: …
    const bar = document.createElement('div');
    bar.className = 'numbers-bar';
    const lab = document.createElement('span'); lab.textContent = 'Linked to:'; lab.className = 'numbers-dim';
    this.selectEl = document.createElement('select');
    this.selectEl.className = 'editor-type-select';
    this.selectEl.addEventListener('change', () => this._link(this.selectEl.value || null));
    this.selNoteEl = document.createElement('span'); this.selNoteEl.className = 'numbers-dim';
    this.wholeBtn = document.createElement('button');
    this.wholeBtn.className = 'numbers-btn'; this.wholeBtn.textContent = 'Whole diagram';
    this.wholeBtn.title = 'Show the whole diagram rather than the selection';
    this.wholeBtn.hidden = true;
    this.wholeBtn.addEventListener('click', () => { this.selection = null; this.render(); });
    bar.append(lab, this.selectEl, this.selNoteEl, this.wholeBtn);
    this.el.appendChild(bar);
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'numbers-body';
    this.el.appendChild(this.bodyEl);
    this.tipEl = document.createElement('div');
    this.tipEl.className = 'numbers-tip'; this.tipEl.hidden = true;
    this.el.appendChild(this.tipEl);

    this._onStore = () => this._refreshSelect();
    DocumentStore.onListChange(this._onStore);
    this._onDocChange = () => this._scheduleRender();
    this._onSelection = e => {
      if (!this.doc || e.detail.docId !== this.doc.id) return;
      this.selection = e.detail.nodeIds.length ? e.detail.nodeIds : null;
      this._scheduleRender();
    };
    window.addEventListener('qpp:selection', this._onSelection);

    this.doc = null; this.selection = null;
    const start = (st.docId && DocumentStore.get(st.docId)) || DocumentStore.list('circuit')[0] || DocumentStore.list('diagram')[0];
    this._refreshSelect();
    this._link(start ? start.id : null);
  }

  getState() { return { docId: this.doc ? this.doc.id : null }; }

  _refreshSelect() {
    const cur = this.doc ? this.doc.id : '';
    this.selectEl.innerHTML = '';
    const none = document.createElement('option'); none.value = ''; none.textContent = '(none)'; this.selectEl.appendChild(none);
    for (const [label, docs] of [['Circuits', DocumentStore.list('circuit')], ['Diagrams', DocumentStore.list('diagram').filter(d => !d.ownerProof)],
      ['Proof steps', DocumentStore.list('diagram').filter(d => d.ownerProof)]]) {
      if (!docs.length) continue;
      const g = document.createElement('optgroup'); g.label = label;
      for (const d of docs) { const o = document.createElement('option'); o.value = d.id; o.textContent = DocumentStore.displayName(d); g.appendChild(o); }
      this.selectEl.appendChild(g);
    }
    this.selectEl.value = cur;
  }

  _link(id) {
    if (this.doc) this.doc.offChange(this._onDocChange);
    this.doc = id ? DocumentStore.get(id) : null;
    this.selection = null;
    if (this.doc) this.doc.onChange(this._onDocChange);
    this.selectEl.value = this.doc ? this.doc.id : '';
    this.render();
  }

  _scheduleRender() {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this.render());
  }

  /** What to evaluate: the selection (a fragment of a diagram) or the whole document. */
  _subject() {
    const doc = this.doc;
    if (this.selection && doc.kind === 'diagram') {
      const ids = this.selection.filter(id => doc.nodes.has(id));
      if (ids.length) {
        const frag = copyFragment(doc, ids);
        const d = new DiagramDocument('selection');
        d.tensorOrder = doc.tensorOrder;
        pasteFragment(d, frag, 0, 0);
        return { ir: d.toIR(), what: `Selection: ${ids.length} node${ids.length === 1 ? '' : 's'}` };
      }
    }
    return { ir: doc.toIR(), what: '' };
  }

  render() {
    this.bodyEl.innerHTML = '';
    this.tipEl.hidden = true;
    this.wholeBtn.hidden = !this.selection;
    if (!this.doc) { this._note('Link a circuit or diagram to see its numbers'); this.selNoteEl.textContent = ''; return; }
    let subj;
    try { subj = this._subject(); } catch (e) { this._note(`Could not read the diagram: ${e.message}`); return; }
    this.selNoteEl.textContent = subj.what;
    const ir = subj.ir;
    if (!ir.isValid) { this._note('The diagram has errors: ' + ir.diagnostics.filter(d => d.severity === 'error').map(d => d.message).join('; ')); return; }
    const { tensor: T, symbolic, reason } = evaluateDiagram(ir);
    if (!T) { this._note(symbolic ? 'It has symbols (boxes f, phases α, …), so it has no numbers — give them values to see them' : (reason || 'No numbers for this')); return; }
    const kinds = ir.doubled && ir.boundaryKinds ? ir.boundaryKinds : null;
    if (kinds) this._process(T, kinds); else this._linear(T, ir);
  }

  /* ---------------- An ordinary linear map ---------------- */

  _linear(T, ir) {
    const nOut = Math.round(Math.log2(T.rows)), nIn = Math.round(Math.log2(T.cols));
    const what = T.rows === 1 && T.cols === 1 ? 'a scalar' : nIn === 0 ? `a state of ${nOut} qubit${nOut === 1 ? '' : 's'}`
      : nOut === 0 ? `an effect on ${nIn} qubit${nIn === 1 ? '' : 's'}` : `a map from ${nIn} to ${nOut} qubit${nOut === 1 ? '' : 's'}`;
    this._head(`It is ${what}`, `${T.rows} × ${T.cols}`);
    if (T.rows === 1 && T.cols === 1) { this._big(fmt(T.get(0, 0))); return; }
    if (nIn === nOut && nIn > 0) {
      const U = T, UdU = Tensor.mul(Tensor.dagger(U), U), k = UdU.get(0, 0);
      const isUnitary = Math.abs(k[1]) < 1e-9 && k[0] > 1e-12 && Tensor.equal(UdU, Tensor.scale(k, Tensor.identity(T.cols)), 1e-8);
      if (isUnitary) this._badge(Math.abs(k[0] - 1) < 1e-9 ? 'unitary: U†U = 1' : `unitary up to the scalar √${round(k[0])}: U†U = ${round(k[0])}·1`);
    }
    this._section('Matrix', 'brightness: size · colour: phase (hover a cell)');
    this._heatmap(T, basisLabels(nOut), basisLabels(nIn));
    if (nIn === 0) {
      const norm2 = T.d.reduce((s, z) => s + C.abs2(z), 0);
      this._section('Measuring every qubit', `Born rule: p(i) = |⟨i|ψ⟩|²${Math.abs(norm2 - 1) > 1e-9 ? ' / ⟨ψ|ψ⟩ (normalised: ⟨ψ|ψ⟩ = ' + round(norm2) + ')' : ''}`);
      this._bars(basisLabels(nOut).map((l, i) => ({ label: l, p: C.abs2(T.get(i, 0)) / norm2 })));
      if (nOut === 1) {
        const a = T.get(0, 0), b = T.get(1, 0);
        const rho = Tensor.mul(T, Tensor.dagger(T));
        this._section('Bloch sphere', 'a pure state is on the surface');
        this._bloch(blochOf(rho), `${fmt(a)} |0⟩ + ${fmt(b)} |1⟩`);
      }
    }
  }

  /* ---------------- A quantum process (the doubled picture) ---------------- */

  _process(T, kinds) {
    const nq = k => k.filter(x => x === 'q').length, nc = k => k.filter(x => x === 'c').length;
    const isState = kinds.in.length === 0;
    const desc = isState
      ? `a quantum state (${nq(kinds.out)} qubit${nq(kinds.out) === 1 ? '' : 's'}${nc(kinds.out) ? `, ${nc(kinds.out)} classical bit${nc(kinds.out) === 1 ? '' : 's'}` : ''})`
      : `a quantum process: ${kinds.in.length} wire${kinds.in.length === 1 ? '' : 's'} in, ${kinds.out.length} out`;
    this._head(`It is ${desc}`, 'doubled picture');
    if (!isState) {
      const causal = isCausal(T, kinds);
      this._badge(causal ? 'causal: discarding the output = discarding the input' : 'not causal (discarding its output ≠ discarding its input)');
      this._section('As a doubled matrix', 'each quantum wire is a pair (conjugate, plain) — PQP’s f̂ = f̄ ⊗ f');
      this._heatmap(T, pairLabels(kinds.out), pairLabels(kinds.in));
      return;
    }
    // A state: its density operator (classical wires on the diagonal)
    const rho = densityOf(T, kinds.out);
    const n = kinds.out.length;
    const tr = Tensor.trace(rho)[0];
    this._section('Density operator ρ', `ρ = Σ ${'|b⟩⟨a|'} · ρ(a,b)${nc(kinds.out) ? ' — a classical wire’s block is diagonal' : ''}${Math.abs(tr - 1) > 1e-9 ? ` (tr ρ = ${round(tr)})` : ''}`);
    this._heatmap(rho, basisLabels(n), basisLabels(n).map(l => l.replace('|', '⟨').replace('⟩', '|')));
    if (nc(kinds.out) && nq(kinds.out)) {
      const cIdx = kinds.out.map((k, i) => (k === 'c' ? i : -1)).filter(i => i >= 0);
      const probs = new Map();
      for (let i = 0; i < rho.rows; i++) {
        const key = cIdx.map(w => (i >> (n - 1 - w)) & 1).join('');
        probs.set(key, (probs.get(key) || 0) + rho.get(i, i)[0] / tr);
      }
      this._section('Classical outcomes', 'the probability of each value of the classical wires');
      this._bars([...probs].sort().map(([k, p]) => ({ label: k, p })));
    }
    this._section('Measuring every wire', 'Born rule: p(i) = ⟨i|ρ|i⟩ / tr ρ');
    this._bars(basisLabels(n).map((l, i) => ({ label: l, p: rho.get(i, i)[0] / tr })));
    if (n === 1 && kinds.out[0] === 'q') {
      this._section('Bloch sphere', 'a mixed state is inside the sphere; its length is its purity');
      this._bloch(blochOf(rho), `purity tr ρ² = ${round(Tensor.trace(Tensor.mul(rho, rho))[0] / (tr * tr))}`);
    }
  }

  /* ---------------- Drawing ---------------- */

  _note(text) { const p = document.createElement('div'); p.className = 'numbers-note'; p.textContent = text; this.bodyEl.appendChild(p); }
  _head(text, side) {
    const h = document.createElement('div'); h.className = 'numbers-head';
    const a = document.createElement('span'); a.textContent = text;
    const b = document.createElement('span'); b.className = 'numbers-dim'; b.textContent = side;
    h.append(a, b); this.bodyEl.appendChild(h);
  }
  _badge(text) { const b = document.createElement('div'); b.className = 'numbers-badge'; b.textContent = text; this.bodyEl.appendChild(b); }
  _big(text) { const b = document.createElement('div'); b.className = 'numbers-big'; b.textContent = text; this.bodyEl.appendChild(b); }
  _section(title, sub) {
    const s = document.createElement('div'); s.className = 'numbers-section';
    const t = document.createElement('span'); t.textContent = title;
    const d = document.createElement('span'); d.className = 'numbers-dim'; d.textContent = sub || '';
    s.append(t, d); this.bodyEl.appendChild(s);
  }

  /** A colour map of a complex matrix (hue = phase, lightness = magnitude). */
  _heatmap(M, rowLabels, colLabels) {
    if (M.rows > MAX_DIM || M.cols > MAX_DIM) { this._note(`${M.rows} × ${M.cols}: too large to draw (up to ${MAX_DIM} × ${MAX_DIM})`); return; }
    const max = Math.max(1e-12, ...M.d.map(z => C.abs(z)));
    const cell = Math.max(10, Math.min(40, Math.floor(360 / Math.max(M.rows, M.cols))));
    const labW = Math.min(64, 8 + 7 * Math.max(...rowLabels.map(l => l.length))), labH = M.cols > 1 ? 18 : 0;
    const dpr = window.devicePixelRatio || 1;
    const cv = document.createElement('canvas');
    const W = labW + M.cols * cell + 2, H = labH + M.rows * cell + 2;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    cv.className = 'numbers-heat';
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.font = '10px var(--font-mono, monospace)'; ctx.fillStyle = '#9a9a9a'; ctx.textBaseline = 'middle';
    const showCols = M.cols > 1 && cell >= 14;
    if (showCols) { ctx.textAlign = 'center'; colLabels.forEach((l, j) => ctx.fillText(l, labW + j * cell + cell / 2, labH / 2)); }
    ctx.textAlign = 'right';
    if (cell >= 12) rowLabels.forEach((l, i) => ctx.fillText(l, labW - 4, labH + i * cell + cell / 2));
    for (let i = 0; i < M.rows; i++) for (let j = 0; j < M.cols; j++) {
      const z = M.get(i, j), m = C.abs(z) / max;
      ctx.fillStyle = m < 1e-9 ? '#202020' : colourOf(z, m);
      ctx.fillRect(labW + j * cell + 1, labH + i * cell + 1, cell - 1, cell - 1);
    }
    cv.addEventListener('mousemove', e => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left - labW, y = e.clientY - r.top - labH;
      const j = Math.floor(x / cell), i = Math.floor(y / cell);
      if (i < 0 || j < 0 || i >= M.rows || j >= M.cols) { this.tipEl.hidden = true; return; }
      const z = M.get(i, j);
      this.tipEl.textContent = `${rowLabels[i]}${M.cols > 1 ? colLabels[j] : ''} : ${fmt(z)}${C.abs(z) > 1e-9 ? `   (|·| ${round(C.abs(z))}, phase ${phaseText(z)})` : ''}`;
      const er = this.el.getBoundingClientRect();
      this.tipEl.style.left = (e.clientX - er.left + 12) + 'px'; this.tipEl.style.top = (e.clientY - er.top + 12) + 'px';
      this.tipEl.hidden = false;
    });
    cv.addEventListener('mouseleave', () => { this.tipEl.hidden = true; });
    const wrap = document.createElement('div'); wrap.className = 'numbers-scroll'; wrap.appendChild(cv);
    this.bodyEl.appendChild(wrap);
  }

  /** Probabilities as horizontal bars. */
  _bars(items) {
    const box = document.createElement('div'); box.className = 'numbers-bars';
    const shown = items.length > 64 ? items.filter(x => x.p > 1e-9) : items;
    for (const { label, p } of shown) {
      const row = document.createElement('div'); row.className = 'numbers-bar-row';
      const l = document.createElement('span'); l.className = 'numbers-bar-label'; l.textContent = label;
      const track = document.createElement('span'); track.className = 'numbers-bar-track';
      const fill = document.createElement('span'); fill.className = 'numbers-bar-fill'; fill.style.width = `${Math.max(0, Math.min(1, p)) * 100}%`;
      track.appendChild(fill);
      const v = document.createElement('span'); v.className = 'numbers-bar-value'; v.textContent = pct(p);
      row.append(l, track, v); box.appendChild(row);
    }
    this.bodyEl.appendChild(box);
  }

  /** A Bloch sphere with the state's vector (x, y, z). */
  _bloch({ x, y, z }, caption) {
    const S = 220, dpr = window.devicePixelRatio || 1, R = 80, cx = S / 2, cy = S / 2 + 4;
    const cv = document.createElement('canvas');
    cv.width = S * dpr; cv.height = S * dpr; cv.style.width = S + 'px'; cv.style.height = S + 'px';
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    // view: z up, x toward the viewer (down-left), y to the right
    const P = (a, b, c) => ({ px: cx + R * (b - 0.42 * a), py: cy - R * (c - 0.28 * a) });
    ctx.strokeStyle = '#7a7a7a'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#5a5a5a';
    ctx.beginPath();
    for (let k = 0; k <= 64; k++) { const t = 2 * Math.PI * k / 64, p = P(Math.cos(t), Math.sin(t), 0); k ? ctx.lineTo(p.px, p.py) : ctx.moveTo(p.px, p.py); }
    ctx.stroke(); ctx.setLineDash([]);
    const axis = (a, b, c, label) => {
      const o = P(0, 0, 0), e = P(a, b, c);
      ctx.strokeStyle = '#555'; ctx.beginPath(); ctx.moveTo(o.px, o.py); ctx.lineTo(e.px, e.py); ctx.stroke();
      const t = P(a * 1.18, b * 1.18, c * 1.18);
      ctx.fillStyle = '#a0a0a0'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, t.px, t.py);
    };
    axis(0, 0, 1, '|0⟩'); axis(0, 0, -1, '|1⟩'); axis(1, 0, 0, '|+⟩'); axis(0, 1, 0, '|+i⟩');
    const o = P(0, 0, 0), e = P(x, y, z);
    ctx.strokeStyle = '#ffc400'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(o.px, o.py); ctx.lineTo(e.px, e.py); ctx.stroke();
    ctx.fillStyle = '#ffc400'; ctx.beginPath(); ctx.arc(e.px, e.py, 4.5, 0, Math.PI * 2); ctx.fill();
    const wrap = document.createElement('div'); wrap.className = 'numbers-bloch';
    const cap = document.createElement('div'); cap.className = 'numbers-dim';
    const r = Math.hypot(x, y, z);
    cap.textContent = `r = (${round(x)}, ${round(y)}, ${round(z)}), |r| = ${round(r)}${caption ? ' · ' + caption : ''}`;
    wrap.append(cv, cap);
    this.bodyEl.appendChild(wrap);
  }

  onResize() {}
  destroy() {
    window.removeEventListener('qpp:selection', this._onSelection);
    DocumentStore.offListChange(this._onStore);
    if (this.doc) this.doc.offChange(this._onDocChange);
    cancelAnimationFrame(this._raf);
    this.el.remove();
  }
}

/* ---------------- Helpers ---------------- */

const basisLabels = n => (n === 0 ? ['·'] : Array.from({ length: 1 << n }, (_, i) => `|${i.toString(2).padStart(n, '0')}⟩`));
/** Labels for the doubled picture's index: a pair (a, b) per quantum wire, one bit per classical wire. */
const pairLabels = kinds => {
  let labels = [''];
  for (const k of kinds) labels = labels.flatMap(l => (k === 'q' ? ['00', '01', '10', '11'].map(p => l + (l ? ' ' : '') + p) : ['0', '1'].map(b => l + (l ? ' ' : '') + b)));
  return labels.map(l => l || '·');
};

/** The density operator of a doubled state (pairs (a, b) ↔ |b⟩⟨a|; a classical wire is diagonal). */
function densityOf(T, kinds) {
  const n = kinds.length, N = 1 << n, rho = Tensor.zeros(N, N);
  for (let idx = 0; idx < T.rows; idx++) {
    const v = T.get(idx, 0);
    if (C.isZero(v)) continue;
    let rest = idx, r = 0, c = 0;
    const digits = [];
    for (let w = n - 1; w >= 0; w--) { const base = kinds[w] === 'q' ? 4 : 2; digits[w] = rest % base; rest = Math.floor(rest / base); }
    for (let w = 0; w < n; w++) {
      const d = digits[w];
      const [a, b] = kinds[w] === 'q' ? [d >> 1, d & 1] : [d, d];
      r = (r << 1) | b; c = (c << 1) | a;
    }
    rho.set(r, c, C.add(rho.get(r, c), v));
  }
  return rho;
}

/** Bloch vector of a one-qubit (possibly unnormalised) density matrix. */
function blochOf(rho) {
  const tr = Tensor.trace(rho)[0] || 1;
  const r01 = rho.get(0, 1);
  return { x: 2 * r01[0] / tr, y: -2 * r01[1] / tr, z: (rho.get(0, 0)[0] - rho.get(1, 1)[0]) / tr };
}

/** Causal: discarding the output gives discarding the input (D = trace on pairs, sum on bits). */
function isCausal(T, kinds) {
  const disc = list => {
    let v = [[1, 0]];
    for (const k of list) v = v.flatMap(x => (k === 'q' ? [x, [0, 0], [0, 0], x] : [x, x]));
    return Tensor.fromRows([v]);
  };
  return Tensor.equal(Tensor.mul(disc(kinds.out), T), disc(kinds.in), 1e-8);
}

function colourOf(z, m) {
  const hue = ((C.arg(z) / (2 * Math.PI)) * 360 + 360) % 360;
  return `hsl(${hue.toFixed(0)}, 80%, ${(12 + 48 * Math.sqrt(m)).toFixed(0)}%)`;
}
const round = x => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : x.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));
const pct = p => (p < 1e-12 ? '0' : p > 1 - 1e-12 ? '100%' : `${(100 * p).toFixed(p < 0.01 ? 2 : 1)}%`);
function fmt([a, b]) {
  if (Math.abs(b) < 1e-9) return round(a);
  if (Math.abs(a) < 1e-9) return `${round(b)}i`;
  return `${round(a)}${b < 0 ? ' − ' : ' + '}${round(Math.abs(b))}i`;
}
function phaseText(z) {
  const t = C.arg(z) / Math.PI;
  for (const den of [1, 2, 3, 4, 6, 8]) {
    const num = Math.round(t * den);
    if (Math.abs(t * den - num) < 1e-6) return num === 0 ? '0' : `${num === 1 ? '' : num === -1 ? '−' : num}π${den === 1 ? '' : '/' + den}`;
  }
  return `${(C.arg(z)).toFixed(3)} rad`;
}
