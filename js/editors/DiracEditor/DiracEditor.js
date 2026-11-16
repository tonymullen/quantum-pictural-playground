/**
 * DiracEditor — LaTeX-based Dirac notation formula editor.
 * Features a snippet toolbar, LaTeX textarea, live KaTeX preview,
 * and a saved formula list.
 */
export default class DiracEditor {
  static get typeName() { return 'Dirac Formula Editor'; }

  constructor(containerEl) {
    this.container = containerEl;
    this.formulas = [];  // saved formulas
    this.el = document.createElement('div');
    this.el.className = 'dirac-editor';
    this.container.appendChild(this.el);

    this._buildToolbar();
    this._buildBody();
    this._render();
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
    this.textarea.addEventListener('input', () => this._render());
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
    this._render();
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
          trust: true,
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
        this._render();
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
    this.el.remove();
  }
}
