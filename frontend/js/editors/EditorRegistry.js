/**
 * EditorRegistry — Global registry of available editor types.
 * Each editor type must implement:
 *   - static get typeName()   → string
 *   - constructor(containerEl, options) — mount into DOM element;
 *       options.state: a saved panel state (from getState()), or undefined
 *   - getState()              — (optional) plain data to restore the panel
 *   - destroy()               — cleanup
 *   - onResize()              — handle container size changes
 */

const _editors = new Map();

const EditorRegistry = {
  /**
   * Register an editor class.
   * @param {Function} EditorClass - class with static typeName getter
   */
  register(EditorClass) {
    const name = EditorClass.typeName;
    if (!name) throw new Error('Editor class must have a static typeName getter');
    _editors.set(name, EditorClass);
  },

  /**
   * Get an editor class by name.
   * @param {string} name
   * @returns {Function|undefined}
   */
  get(name) {
    return _editors.get(name);
  },

  /**
   * List all registered editor type names.
   * @returns {string[]}
   */
  list() {
    return Array.from(_editors.keys());
  },

  /**
   * Instantiate an editor into a container element.
   * @param {string} typeName
   * @param {HTMLElement} container
   * @returns {object} editor instance
   */
  create(typeName, container, options = {}) {
    const EditorClass = _editors.get(typeName);
    if (!EditorClass) throw new Error(`Unknown editor type: ${typeName}`);
    return new EditorClass(container, options);
  }
};

export default EditorRegistry;
