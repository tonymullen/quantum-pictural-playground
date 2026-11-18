/**
 * DocumentStore — Singleton registry of all documents (diagrams and circuits).
 *
 * Every document has { id, kind: 'diagram'|'circuit', name } and the common
 * interface onChange/offChange, toIR(), generateDirac(). Editors list the
 * kinds they can show; the Dirac editor can link to any kind.
 */
import DiagramDocument from './DiagramEditor/DiagramDocument.js';

/** @type {Map<string, object>} */
const _docs = new Map();

/** @type {Set<Function>} */
const _storeListeners = new Set();

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
    _notifyStore();
    return doc;
  },

  /** Create and register a new diagram. */
  createDiagram(name) { return DocumentStore.add(new DiagramDocument(name)); },

  /** Delete a document by id. */
  remove(id) {
    _docs.delete(id);
    _notifyStore();
  },

  /** Register a callback fired when the list of documents changes (add/remove/rename). */
  onListChange(fn) { _storeListeners.add(fn); },
  offListChange(fn) { _storeListeners.delete(fn); },
  notifyListChange() { _notifyStore(); },
};

function _notifyStore() {
  for (const fn of _storeListeners) fn();
}

export default DocumentStore;
