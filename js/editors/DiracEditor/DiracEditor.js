/**
 * DiracEditor — LaTeX-based Dirac notation formula editor.
 * Features a snippet toolbar, LaTeX textarea, live KaTeX preview,
 * saved formula list, and sync with diagram documents.
 */
import DiagramDocumentStore from '../DiagramEditor/DiagramDocumentStore.js';
import SyncController from '../../core/SyncController.js';

export default class DiracEditor {
  static get typeName() { return 'Dirac Formula Editor'; }

  constructor(containerEl) {
    this.container = containerEl;
    this.formulas = [];  // saved formulas
    this.syncController = null;
    this.linkedDocId = null;
    this.el = document.createElement('div');
    this.el.className = 'dirac-editor';
    this.container.appendChild(this.el);

    this._buildDocSelector();
    this._buildSyncBar();
    this._buildToolbar();
    this._buildBody();
    this._linkToFirstDoc();
    this._render();
  }

  /* ---- Document selector ---- */

  _buildDocSelector() {
    this.docBarEl = document.createElement('div');
    this.docBarEl.className = 'dirac-toolbar';
    this.docBarEl.style.height = '26px';
    this.docBarEl.style.minHeight = '26px';
    this.docBarEl.style.gap = '6px';

    const label = document.createElement('span');
    label.textContent = 'Linked diagram:';
    label.style.color = 'var(--text-secondary)';
    label.style.fontSize = '11px';
    this.docBarEl.appendChild(label);

    this.docSelectEl = document.createElement('select');
    this.docSelectEl.className = 'editor-type-select';
    this.docSelectEl.style.maxWidth = '160px';
    this.docSelectEl.addEventListener('change', () => this._onDocSelectChange());
    this.docBarEl.appendChild(this.docSelectEl);

    this.el.appendChild(this.docBarEl);

    this._onStoreChange = () => this._refreshDocSelect();
    DiagramDocumentStore.onListChange(this._onStoreChange);
  }

  _refreshDocSelect() {
    const docs = DiagramDocumentStore.list();
    const prev = this.docSelectEl.value;
    this.docSelectEl.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = ''; noneOpt.textContent = '(none)';
    this.docSelectEl.appendChild(noneOpt);
    for (const d of docs) {
      const opt = document.createElement('option');
      opt.value = d.id; opt.textContent = d.name;
      this.docSelectEl.appendChild(opt);
    }
    this.docSelectEl.value = this.linkedDocId || prev || '';
  }

  _onDocSelectChange() {
    const id = this.docSelectEl.value;
    this._linkToDoc(id || null);
  }

  _linkToFirstDoc() {
    const docs = DiagramDocumentStore.list();
    if (docs.length > 0) this._linkToDoc(docs[0].id);
    this._refreshDocSelect();
  }

  _linkToDoc(docId) {
    this.linkedDocId = docId;
    if (this.syncController) { this.syncController.destroy(); this.syncController = null; }
    if (docId) {
      const doc = DiagramDocumentStore.get(docId);
      if (doc) {
        this.syncController = new SyncController(doc);
        this.syncController.onStateChange(() => this._updateSyncBar());
        // Start from whatever is already in the textarea (not student-authored)
        const current = this.textarea ? this.textarea.value.trim() : '';
        if (current) this.syncController.onDiracChanged(current, false);
      }
    }
    this._updateSyncBar();
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
    this._showInfoPanel(result.info || '');

    // Only put parseable LaTeX in the textarea
    if (result.latex) {
      if (!this.syncController.diracAuthored || !this.textarea.value.trim()) {
        this.textarea.value = result.latex;
        this.syncController.diracAuthored = false;
        this.syncController.diracGenerated = true;
        this.syncController.onDiracChanged(result.latex, false);
        this._render();
      } else {
        this._showGeneratedPreview(result);
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
      { label: 'H', latex: '\\hat{H}' },
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
    DiagramDocumentStore.offListChange(this._onStoreChange);
    if (this.syncController) this.syncController.destroy();
    this.el.remove();
  }
}
