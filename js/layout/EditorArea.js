/**
 * EditorArea — A single panel that hosts an editor instance.
 * Has a header with editor-type selector and split/close actions.
 */
import EditorRegistry from '../editors/EditorRegistry.js';

let _areaIdCounter = 0;

export default class EditorArea {
  /**
   * @param {string} editorType  — initial editor type name
   * @param {object} layoutManager — reference to LayoutManager
   */
  /**
   * @param {string} editorType
   * @param {object} layoutManager
   * @param {object|null} [state] — saved panel state for the editor (workbooks)
   */
  constructor(editorType, layoutManager, state = null) {
    this.id = `area-${_areaIdCounter++}`;
    this._initialState = state;
    this.layoutManager = layoutManager;
    this.editorType = editorType;
    this.editorInstance = null;

    // Build DOM
    this.el = document.createElement('div');
    this.el.className = 'editor-area';
    this.el.dataset.areaId = this.id;

    // Header
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'editor-area-header';

    // Editor type dropdown
    this.selectEl = document.createElement('select');
    this.selectEl.className = 'editor-type-select';
    this._populateSelect();
    this.selectEl.value = editorType;
    this.selectEl.addEventListener('change', () => this._onTypeChange());
    this.headerEl.appendChild(this.selectEl);

    // Title
    this.titleEl = document.createElement('span');
    this.titleEl.className = 'editor-area-title';
    this.headerEl.appendChild(this.titleEl);

    // Action buttons
    this.actionsEl = document.createElement('div');
    this.actionsEl.className = 'editor-area-actions';

    // Split horizontal
    const splitHBtn = this._makeBtn('⬌', 'Split Horizontal');
    splitHBtn.addEventListener('click', () => this.layoutManager.splitArea(this.id, 'horizontal'));
    this.actionsEl.appendChild(splitHBtn);

    // Split vertical
    const splitVBtn = this._makeBtn('⬍', 'Split Vertical');
    splitVBtn.addEventListener('click', () => this.layoutManager.splitArea(this.id, 'vertical'));
    this.actionsEl.appendChild(splitVBtn);

    // Close / merge
    const closeBtn = this._makeBtn('✕', 'Close Panel');
    closeBtn.addEventListener('click', () => this.layoutManager.closeArea(this.id));
    this.actionsEl.appendChild(closeBtn);

    this.headerEl.appendChild(this.actionsEl);
    this.el.appendChild(this.headerEl);

    // Split grip (top-right corner for drag-to-split)
    this.gripEl = document.createElement('div');
    this.gripEl.className = 'split-grip top-right';
    this.gripEl.addEventListener('mousedown', (e) => this._onGripDrag(e));
    this.el.appendChild(this.gripEl);

    // Body
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'editor-area-body';
    this.el.appendChild(this.bodyEl);

    // Focus handling
    this.el.addEventListener('mousedown', () => this.layoutManager.setFocus(this.id));

    // Create editor
    this._mountEditor();
  }

  _makeBtn(text, title) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.title = title;
    return btn;
  }

  _populateSelect() {
    this.selectEl.innerHTML = '';
    for (const name of EditorRegistry.list()) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      this.selectEl.appendChild(opt);
    }
  }

  _onTypeChange() {
    const newType = this.selectEl.value;
    if (newType === this.editorType) return;
    this.setEditorType(newType);
  }

  /** Editor types that only visit a panel (e.g. the Workbook Browser). */
  _isTransient(type) {
    const cls = EditorRegistry.get(type);
    return !!(cls && cls.transient);
  }

  /** Switch this panel to another editor type (e.g. the app bar's Workbooks button). */
  /**
   * Switch this panel to another editor type. A transient editor (the
   * Workbook Browser) only visits: the panel remembers the editor it covered,
   * saves that one in workbooks, and showing or closing the visitor is not
   * an edit.
   */
  setEditorType(type, state = null) {
    if (type === this.editorType) return;
    const visiting = this._isTransient(type) || this._isTransient(this.editorType);
    if (this._isTransient(type) && !this._isTransient(this.editorType)) {
      this._underlying = { editorType: this.editorType, state: this.getState() };
    } else if (!this._isTransient(type)) {
      this._underlying = null;
    }
    this._destroyEditor();
    this.editorType = type;
    this.selectEl.value = type;
    this._initialState = state;
    this._mountEditor();
    if (!visiting) this.layoutManager._changed();
  }

  /** Put back the editor a visiting editor covered. Returns false if there is none. */
  closeTransient() {
    if (!this._isTransient(this.editorType) || !this._underlying) return false;
    const { editorType, state } = this._underlying;
    this.setEditorType(editorType, state);
    return true;
  }

  /** What this panel should be saved as in a workbook. */
  specForSave() {
    if (this._isTransient(this.editorType) && this._underlying) return { ...this._underlying };
    return { editorType: this.editorType, state: this.getState() };
  }

  /** The editor's state, for saving in a workbook. */
  getState() {
    const ed = this.editorInstance;
    try { return ed && typeof ed.getState === 'function' ? ed.getState() : null; }
    catch { return null; }
  }

  _mountEditor() {
    this.bodyEl.innerHTML = '';
    try {
      this.editorInstance = EditorRegistry.create(this.editorType, this.bodyEl,
        { state: this._initialState || undefined });
      this._initialState = null;
    } catch (err) {
      this.bodyEl.textContent = `Error: ${err.message}`;
    }
  }

  _destroyEditor() {
    if (this.editorInstance && typeof this.editorInstance.destroy === 'function') {
      this.editorInstance.destroy();
    }
    this.editorInstance = null;
  }

  _onGripDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = this.el.getBoundingClientRect();

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      // Determine split direction based on dominant drag direction
      if (Math.abs(dx) > 20 || Math.abs(dy) > 20) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (Math.abs(dx) > Math.abs(dy)) {
          this.layoutManager.splitArea(this.id, 'horizontal');
        } else {
          this.layoutManager.splitArea(this.id, 'vertical');
        }
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  setFocused(focused) {
    this.el.classList.toggle('focused', focused);
  }

  onResize() {
    if (this.editorInstance && typeof this.editorInstance.onResize === 'function') {
      this.editorInstance.onResize();
    }
  }

  destroy() {
    this._destroyEditor();
    this.el.remove();
  }
}
