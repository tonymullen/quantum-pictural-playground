/**
 * DiracEditor — LaTeX-based Dirac notation formula editor.
 * Features a snippet toolbar, LaTeX textarea, live KaTeX preview,
 * saved formula list, and sync with diagram documents.
 *
 * Quantum processes (doubled diagrams, circuits that measure) have two
 * notations, and both are shown side by side: the familiar one (ρ ↦ Σ K ρ K†,
 * or a density operator) and PQP's doubled one (Σ K̂). "Write in" picks which
 * goes in the editor; either is checked against the diagram.
 */
import DocumentStore from '../DocumentStore.js';
import SyncController from '../../core/SyncController.js';

export default class DiracEditor {
  static get typeName() { return 'Dirac Formula Editor'; }

  constructor(containerEl, options = {}) {
    const st = options.state || {};
    this.container = containerEl;
    this.formulas = Array.isArray(st.formulas) ? [...st.formulas] : [];  // saved formulas
    this.notation = st.notation === 'pqp' ? 'pqp' : 'familiar';            // for quantum processes
    this.syncController = null;
    this.linkedDocId = null;
    this.el = document.createElement('div');
    this.el.className = 'dirac-editor';
    this.container.appendChild(this.el);

    this._buildDocSelector();
    this._buildSyncBar();
    this._buildToolbar();
    this._buildBody();
    this._renderList();
    if (st.docId && DocumentStore.get(st.docId)) {
      // A saved expression is restored as it was; otherwise generate one
      this._linkToDoc(st.docId, st.text ? { text: st.text, authored: !!st.authored } : null);
      this._refreshDocSelect();
    } else {
      this._linkToFirstDoc();
    }
    this._render();

    // A circuit editor asked to be linked: the first Dirac editor takes it
    this._onShowCircuit = e => {
      if (e.detail.diracHandled) return;
      e.detail.diracHandled = true;
      this._linkToDoc(e.detail.circuitId);
      this._refreshDocSelect();
    };
    window.addEventListener('qpp:show-circuit', this._onShowCircuit);
  }

  /* ---- Document selector ---- */

  _buildDocSelector() {
    this.docBarEl = document.createElement('div');
    this.docBarEl.className = 'dirac-toolbar';
    this.docBarEl.style.height = '26px';
    this.docBarEl.style.minHeight = '26px';
    this.docBarEl.style.gap = '6px';

    const label = document.createElement('span');
    label.textContent = 'Linked to:';
    label.style.color = 'var(--text-secondary)';
    label.style.fontSize = '11px';
    this.docBarEl.appendChild(label);

    this.docSelectEl = document.createElement('select');
    this.docSelectEl.className = 'editor-type-select';
    this.docSelectEl.style.maxWidth = '160px';
    this.docSelectEl.addEventListener('change', () => this._onDocSelectChange());
    this.docBarEl.appendChild(this.docSelectEl);

    this.orderNoteEl = document.createElement('span');
    this.orderNoteEl.className = 'dirac-order-note';
    this.docBarEl.appendChild(this.orderNoteEl);

    // Quantum processes: which notation to write in (both are shown for comparison)
    this.notationWrapEl = document.createElement('span');
    this.notationWrapEl.className = 'dirac-notation';
    this.notationWrapEl.hidden = true;
    const nl = document.createElement('span'); nl.textContent = 'Write in';
    nl.style.color = 'var(--text-secondary)'; nl.style.fontSize = '11px';
    this.notationSelectEl = document.createElement('select');
    this.notationSelectEl.className = 'editor-type-select';
    this.notationSelectEl.title = 'A quantum process can be written the familiar way (ρ ↦ Σ K ρ K†, or a density operator) or in PQP’s doubled notation (Σ K̂, with K̂ = K̄ ⊗ K)';
    for (const [v, t] of [['familiar', 'Familiar (ρ ↦ …)'], ['pqp', 'PQP (doubled)']]) {
      const o = document.createElement('option'); o.value = v; o.textContent = t; this.notationSelectEl.appendChild(o);
    }
    this.notationSelectEl.value = this.notation;
    this.notationSelectEl.addEventListener('change', () => {
      this.notation = this.notationSelectEl.value;
      // Switch the editor's text only if it is still the generated one
      if (this.syncController && !this.syncController.diracAuthored) this._generateInto();
    });
    this.notationWrapEl.append(nl, this.notationSelectEl);
    this.docBarEl.appendChild(this.notationWrapEl);

    this.el.appendChild(this.docBarEl);

    this._onStoreChange = () => this._refreshDocSelect();
    DocumentStore.onListChange(this._onStoreChange);
  }

  _refreshDocSelect() {
    const prev = this.docSelectEl.value;
    this.docSelectEl.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = ''; noneOpt.textContent = '(none)';
    this.docSelectEl.appendChild(noneOpt);
    // Grouped: circuits first, then diagrams (generated ones say so)
    const groups = [
      ['Circuits', DocumentStore.list('circuit')],
      ['Diagrams', DocumentStore.list('diagram').filter(d => !d.ownerProof)],
      ['Proof steps', DocumentStore.list('diagram').filter(d => d.ownerProof)],
    ];
    for (const [label, docs] of groups) {
      if (!docs.length) continue;
      const group = document.createElement('optgroup');
      group.label = label;
      for (const d of docs) {
        const opt = document.createElement('option');
        opt.value = d.id; opt.textContent = DocumentStore.displayName(d);
        group.appendChild(opt);
      }
      this.docSelectEl.appendChild(group);
    }
    this.docSelectEl.value = this.linkedDocId || prev || '';
  }

  _onDocSelectChange() {
    const id = this.docSelectEl.value;
    this._linkToDoc(id || null);
  }

  _linkToFirstDoc() {
    const docs = DocumentStore.list();
    if (docs.length > 0) this._linkToDoc(docs[0].id);
    this._refreshDocSelect();
  }

  /**
   * Link to a document and show its generated Dirac expression right away.
   * A student-authored expression for the previous document is kept in the
   * saved-formula list rather than discarded. Re-linking the same document
   * does nothing (so it never replaces work on the current document).
   */
  /** Panel state for workbooks: what is linked, the expression, saved formulas. */
  getState() {
    return { docId: this.linkedDocId, text: this.textarea.value, notation: this.notation,
      authored: !!(this.syncController && this.syncController.diracAuthored), formulas: [...this.formulas] };
  }

  /**
   * @param {string|null} docId
   * @param {{text: string, authored: boolean}|null} [restore] — a saved expression
   *   to show instead of generating one
   */
  _linkToDoc(docId, restore = null) {
    if (docId && docId === this.linkedDocId && this.syncController) return;
    const prev = this.textarea ? this.textarea.value.trim() : '';
    const wasAuthored = !!(this.syncController && this.syncController.diracAuthored);
    this.linkedDocId = docId;
    if (this.syncController) { this.syncController.destroy(); this.syncController = null; }
    const doc = docId ? DocumentStore.get(docId) : null;
    if (doc) {
      this.syncController = new SyncController(doc);
      this.syncController.onStateChange(() => this._updateSyncBar());
      if (wasAuthored && prev && !this.formulas.includes(prev)) {
        this.formulas.push(prev);
        this._renderList();
      }
      this._updateSyncBar();
      if (restore) this._restoreInto(restore);
      else this._generateInto();   // its verify refreshes the bar
      return;
    }
    this._updateSyncBar();
  }

  /** Show a saved expression (from a workbook) and verify it now. */
  _restoreInto({ text, authored }) {
    const sc = this.syncController;
    this.textarea.value = text;
    this._render();
    if (text) { sc.onDiracChanged(text.trim(), false); sc.diracAuthored = authored; sc.verifyNow(); }
  }

  /** Put the linked document's generated expression in the textarea and verify it now. */
  _generateInto() {
    const sc = this.syncController;
    const result = sc.generateDirac();
    const latex = this._chosen(result);
    this._showInfoPanel(this._chosenInfo(result));
    this._showComparison(result);
    this.textarea.value = latex || '';
    sc.diracAuthored = false;
    sc.diracGenerated = !!latex;
    if (this._genPreviewEl) this._genPreviewEl.innerHTML = '';
    this._render();
    if (latex) { sc.onDiracChanged(latex, false); sc.verifyNow(); }
    else {
      // Nothing parseable to show (e.g. too large): say why
      this.syncTextEl.textContent = result.reason || 'No expression generated';
    }
  }

  /** The generated expression in the chosen notation (processes have two). */
  _chosen(result) {
    if (!result.familiar) return result.latex;
    return result[this.notation].latex || result.familiar.latex || result.pqp.latex || '';
  }
  _chosenInfo(result) {
    if (!result.familiar) return result.info || '';
    return (result[this.notation].latex ? result[this.notation] : result.familiar).info || result.info || '';
  }

  /**
   * Side by side: a quantum process in familiar and in PQP notation, each with
   * "Use" (puts it in the editor). Hidden for ordinary linear maps.
   */
  _showComparison(result) {
    const isProcess = !!(result && result.familiar);
    this.notationWrapEl.hidden = !isProcess;
    if (!this._compareEl) {
      this._compareEl = document.createElement('div');
      this._compareEl.className = 'dirac-compare';
      this.previewEl.after(this._compareEl);
    }
    this._compareEl.innerHTML = '';
    this._compareEl.hidden = !isProcess;
    if (!isProcess) return;
    for (const [key, title] of [['familiar', 'Familiar'], ['pqp', 'PQP (doubled)']]) {
      const col = document.createElement('div');
      col.className = 'dirac-compare-col' + (key === this.notation ? ' chosen' : '');
      const head = document.createElement('div');
      head.className = 'dirac-compare-head';
      head.textContent = title;
      const f = result[key];
      if (f.latex) {
        const use = document.createElement('button');
        use.className = 'dirac-snippet-btn';
        use.textContent = 'Use';
        use.title = `Put the ${title.toLowerCase()} form in the editor`;
        use.addEventListener('click', () => {
          this.textarea.value = f.latex;
          this.syncController.diracAuthored = false;
          this.syncController.diracGenerated = true;
          this.syncController.onDiracChanged(f.latex, false);
          this._render();
          this.syncController.verifyNow();
        });
        head.appendChild(use);
      }
      const body = document.createElement('div');
      body.className = 'dirac-compare-math';
      try {
        if (f.latex && typeof katex !== 'undefined') katex.render(f.latex, body, { displayMode: true, throwOnError: false });
        else body.textContent = f.latex || '';
      } catch { body.textContent = f.latex; }
      const note = document.createElement('div');
      note.className = 'dirac-compare-note';
      note.textContent = f.info || '';
      col.append(head, body, note);
      this._compareEl.appendChild(col);
    }
  }

  /* ---- Sync status bar ---- */

  _buildSyncBar() {
    this.syncBarEl = document.createElement('div');
    this.syncBarEl.className = 'dirac-sync-bar';

    this.syncIconEl = document.createElement('span');
    this.syncIconEl.className = 'sync-icon verify-unknown';
    this.syncIconEl.textContent = '—';
    this.syncBarEl.appendChild(this.syncIconEl);

    this.syncTextEl = document.createElement('span');
    this.syncTextEl.className = 'sync-text';
    this.syncTextEl.textContent = 'No diagram linked';
    this.syncBarEl.appendChild(this.syncTextEl);

    const verifyBtn = document.createElement('button');
    verifyBtn.textContent = 'Verify';
    verifyBtn.title = 'Check equivalence with diagram';
    verifyBtn.addEventListener('click', () => {
      if (this.syncController) this.syncController.verifyNow();
    });
    this.syncBarEl.appendChild(verifyBtn);

    const genBtn = document.createElement('button');
    genBtn.textContent = 'Generate';
    genBtn.title = 'Generate Dirac expression from diagram';
    genBtn.addEventListener('click', () => this._onGenerate());
    this.syncBarEl.appendChild(genBtn);

    this.el.appendChild(this.syncBarEl);
  }

  _onGenerate() {
    if (!this.syncController) return;
    const result = this.syncController.generateDirac();
    if (!result) return;

    // Show category + reason in sync bar
    this.syncTextEl.textContent = result.reason;
    this.syncIconEl.textContent = result.category === 'error' ? '✗' : '📝';
    this.syncIconEl.className = `sync-icon ${result.category === 'error' ? 'verify-fail' : 'verify-ok'}`;

    // Show info (non-parseable summaries) in a separate panel, never in textarea
    this._showInfoPanel(this._chosenInfo(result));
    this._showComparison(result);

    // Only put parseable LaTeX in the textarea
    const latex = this._chosen(result);
    if (latex) {
      if (!this.syncController.diracAuthored || !this.textarea.value.trim()) {
        this.textarea.value = latex;
        this.syncController.diracAuthored = false;
        this.syncController.diracGenerated = true;
        this.syncController.onDiracChanged(latex, false);
        this._render();
      } else {
        this._showGeneratedPreview({ ...result, latex });
      }
    }
  }

  _showInfoPanel(text) {
    if (!this._infoPanelEl) {
      this._infoPanelEl = document.createElement('div');
      this._infoPanelEl.style.cssText = 'padding:4px 8px;font-size:11px;color:var(--text-secondary);border-bottom:1px solid var(--border-color);';
      // Insert after sync bar
      this.syncBarEl.after(this._infoPanelEl);
    }
    this._infoPanelEl.textContent = text;
    this._infoPanelEl.style.display = text ? '' : 'none';
  }

  _showGeneratedPreview(result) {
    // Create or update a generated-preview div below the main preview
    if (!this._genPreviewEl) {
      this._genPreviewEl = document.createElement('div');
      this._genPreviewEl.style.padding = '8px';
      this._genPreviewEl.style.borderTop = '1px solid var(--border-color)';
      this._genPreviewEl.style.fontSize = '11px';
      this.bodyEl.insertBefore(this._genPreviewEl, this.listEl);
    }
    this._genPreviewEl.innerHTML = '';

    const header = document.createElement('div');
    header.style.color = 'var(--text-secondary)';
    header.style.marginBottom = '4px';
    header.textContent = `Generated: ${result.reason}`;
    this._genPreviewEl.appendChild(header);

    const preview = document.createElement('div');
    preview.className = 'render-output';
    preview.style.fontSize = '16px';
    try {
      if (typeof katex !== 'undefined') {
        katex.render(result.latex || result.info || '', preview, { displayMode: true, throwOnError: false });
      } else {
        preview.textContent = result.display;
      }
    } catch { preview.textContent = result.latex || result.info || ''; }
    this._genPreviewEl.appendChild(preview);

    const useBtn = document.createElement('button');
    useBtn.className = 'dirac-snippet-btn';
    useBtn.textContent = 'Replace with generated';
    useBtn.addEventListener('click', () => {
      this.textarea.value = result.latex;
      this.syncController.diracAuthored = false;
      this.syncController.diracGenerated = true;
      this.syncController.onDiracChanged(result.latex, false);
      this._render();
      this._genPreviewEl.innerHTML = '';
    });
    this._genPreviewEl.appendChild(useBtn);
  }

  _updateSyncBar() {
    const doc = this.syncController ? this.syncController.doc : null;
    this.orderNoteEl.textContent = doc
      ? (doc.tensorOrder === 'little-endian' ? '⊗ order: first wire last (Qiskit)' : '⊗ order: first wire first (N&C)')
      : '';
    if (!this.syncController) {
      this.syncIconEl.textContent = '—';
      this.syncIconEl.className = 'sync-icon verify-unknown';
      this.syncTextEl.textContent = 'No diagram linked';
      return;
    }
    const display = this.syncController.getStatusDisplay();
    this.syncIconEl.textContent = display.icon;
    this.syncIconEl.className = `sync-icon ${display.cls}`;
    this.syncTextEl.textContent = display.text;
  }

  _buildToolbar() {
    this.toolbarEl = document.createElement('div');
    this.toolbarEl.className = 'dirac-toolbar';

    const snippets = [
      { label: '|ψ⟩', latex: '|\\psi\\rangle' },
      { label: '⟨ψ|', latex: '\\langle\\psi|' },
      { label: '⟨φ|ψ⟩', latex: '\\langle\\phi|\\psi\\rangle' },
      { label: '|0⟩', latex: '|0\\rangle' },
      { label: '|1⟩', latex: '|1\\rangle' },
      { label: '|+⟩', latex: '|+\\rangle' },
      { label: '|−⟩', latex: '|-\\rangle' },
      { label: '⊗', latex: '\\otimes' },
      { label: '⊕', latex: '\\oplus' },
      { label: '†', latex: '^\\dagger' },
      { label: 'Σ', latex: '\\sum_{i}' },
      { label: '√', latex: '\\frac{1}{\\sqrt{2}}' },
      { label: 'H', latex: 'H' },
      { label: 'ρ ↦', latex: '\\rho \\mapsto ' },
      { label: 'f̂', latex: '\\widehat{f}' },
      { label: 'tr', latex: '\\mathrm{tr}' },
      { label: 'CNOT', latex: '\\text{CNOT}' },
      { label: 'I', latex: '\\mathbb{I}' },
      { label: 'α|0⟩+β|1⟩', latex: '\\alpha|0\\rangle + \\beta|1\\rangle' },
    ];

    for (const s of snippets) {
      const btn = document.createElement('button');
      btn.className = 'dirac-snippet-btn';
      btn.textContent = s.label;
      btn.title = s.latex;
      btn.addEventListener('click', () => this._insertSnippet(s.latex));
      this.toolbarEl.appendChild(btn);
    }

    this.el.appendChild(this.toolbarEl);
  }

  _buildBody() {
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'dirac-body';

    // Input area
    this.inputArea = document.createElement('div');
    this.inputArea.className = 'dirac-input-area';
    this.textarea = document.createElement('textarea');
    this.textarea.placeholder = 'Enter LaTeX (Dirac notation)…';
    this.textarea.spellcheck = false;
    this.textarea.value = '\\alpha|0\\rangle + \\beta|1\\rangle';
    this.textarea.addEventListener('input', () => this._onTextChanged());
    this.inputArea.appendChild(this.textarea);
    this.bodyEl.appendChild(this.inputArea);

    // Save button
    const saveRow = document.createElement('div');
    saveRow.style.padding = '4px 8px';
    saveRow.style.display = 'flex';
    saveRow.style.gap = '6px';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'dirac-snippet-btn';
    saveBtn.textContent = '＋ Save Formula';
    saveBtn.addEventListener('click', () => this._saveFormula());
    saveRow.appendChild(saveBtn);
    this.bodyEl.appendChild(saveRow);

    // Preview
    this.previewEl = document.createElement('div');
    this.previewEl.className = 'dirac-preview';
    this.renderEl = document.createElement('div');
    this.renderEl.className = 'render-output';
    this.previewEl.appendChild(this.renderEl);
    this.bodyEl.appendChild(this.previewEl);

    // Saved formulas list
    this.listEl = document.createElement('div');
    this.listEl.className = 'dirac-formula-list';
    this.bodyEl.appendChild(this.listEl);

    this.el.appendChild(this.bodyEl);
  }

  _insertSnippet(latex) {
    const ta = this.textarea;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value;
    ta.value = val.substring(0, start) + latex + val.substring(end);
    ta.selectionStart = ta.selectionEnd = start + latex.length;
    ta.focus();
    this._onTextChanged();
  }

  /** The student changed the expression (typing, snippet, or loading a saved formula). */
  _onTextChanged() {
    this._render();
    if (this.syncController) this.syncController.onDiracChanged(this.textarea.value.trim(), true);
  }

  _render() {
    const latex = this.textarea.value.trim();
    if (!latex) {
      this.renderEl.innerHTML = '<span style="color:#969696;">Preview</span>';
      return;
    }
    try {
      if (typeof katex !== 'undefined') {
        katex.render(latex, this.renderEl, {
          displayMode: true,
          throwOnError: true,
        });
      } else {
        this.renderEl.textContent = latex;
      }
    } catch (err) {
      this.renderEl.innerHTML = '';
      const errEl = document.createElement('div');
      errEl.className = 'render-error';
      errEl.textContent = err.message;
      this.renderEl.appendChild(errEl);
    }
  }

  _saveFormula() {
    const latex = this.textarea.value.trim();
    if (!latex) return;
    this.formulas.push(latex);
    this._renderList();
  }

  _renderList() {
    this.listEl.innerHTML = '';
    this.formulas.forEach((f, i) => {
      const item = document.createElement('div');
      item.className = 'dirac-formula-item';

      const preview = document.createElement('div');
      preview.className = 'formula-preview';
      try {
        if (typeof katex !== 'undefined') {
          katex.render(f, preview, { displayMode: false, throwOnError: false });
        } else {
          preview.textContent = f;
        }
      } catch { preview.textContent = f; }

      item.appendChild(preview);

      // Load into editor on click
      preview.style.cursor = 'pointer';
      preview.addEventListener('click', () => {
        this.textarea.value = f;
        this._onTextChanged();
      });

      const del = document.createElement('span');
      del.className = 'formula-delete';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        this.formulas.splice(i, 1);
        this._renderList();
      });
      item.appendChild(del);

      this.listEl.appendChild(item);
    });
  }

  onResize() { /* no-op */ }

  destroy() {
    DocumentStore.offListChange(this._onStoreChange);
    window.removeEventListener('qpp:show-circuit', this._onShowCircuit);
    if (this.syncController) this.syncController.destroy();
    this.el.remove();
  }
}
