/**
 * DocumentStore — Singleton registry of all documents (diagrams and circuits).
 *
 * Every document has { id, kind: 'diagram'|'circuit'|'proof', name }.
 * Diagrams and circuits share the interface onChange/offChange, toIR(),
 * generateDirac(); a proof owns diagram documents (its steps). Editors list
 * the kinds they can show; the Dirac editor links to diagrams and circuits.
 */
import DiagramDocument from './DiagramEditor/DiagramDocument.js';

/** @type {Map<string, object>} */
const _docs = new Map();

/** @type {Set<Function>} */
const _storeListeners = new Set();
/** Listeners for "any document's contents changed" (unsaved-changes tracking). */
const _anyListeners = new Set();
const _onAnyDocChange = () => { for (const fn of _anyListeners) fn(); };

const DocumentStore = {
  /** All documents, optionally only one kind. */
  list(kind = null) {
    const all = Array.from(_docs.values());
    return kind ? all.filter(d => d.kind === kind) : all;
  },

  /** Get a document by id. */
  get(id) { return _docs.get(id); },

  /** Register an existing document; returns it. */
  add(doc) {
    _docs.set(doc.id, doc);
    if (doc.onChange) doc.onChange(_onAnyDocChange);
    _notifyStore();
    return doc;
  },

  /** Create and register a new diagram. */
  createDiagram(name) { return DocumentStore.add(new DiagramDocument(name)); },

  /**
   * How a document is labelled in menus. A diagram generated from a circuit
   * says so: "Bell — PQP diagram (generated)".
   */
  displayName(doc) {
    if (doc.kind === 'diagram' && doc.ownerProof) {
      const p = _docs.get(doc.ownerProof);
      const i = p ? p.steps.findIndex(s => s.diagram === doc) : -1;
      if (p && i >= 0) return `${p.name} — step D${i + 1}`;
    }
    if (doc.kind === 'diagram' && doc.derivedFrom) {
      const src = _docs.get(doc.derivedFrom);
      return `${src ? src.name : doc.name} — PQP diagram (generated)`;
    }
    return doc.name;
  },

  /** Delete a document by id. */
  remove(id) {
    const doc = _docs.get(id);
    if (doc && doc.offChange) doc.offChange(_onAnyDocChange);
    _docs.delete(id);
    _notifyStore();
  },

  /** Remove every document (opening a workbook replaces the whole session). */
  clear() {
    for (const doc of _docs.values()) if (doc.offChange) doc.offChange(_onAnyDocChange);
    _docs.clear();
    _notifyStore();
  },

  /** Called when any document's contents change (not when the list changes). */
  onAnyChange(fn) { _anyListeners.add(fn); },
  offAnyChange(fn) { _anyListeners.delete(fn); },

  /** Register a callback fired when the list of documents changes (add/remove/rename). */
  onListChange(fn) { _storeListeners.add(fn); },
  offListChange(fn) { _storeListeners.delete(fn); },
  notifyListChange() { _notifyStore(); },
};

function _notifyStore() {
  for (const fn of _storeListeners) fn();
}

export default DocumentStore;
