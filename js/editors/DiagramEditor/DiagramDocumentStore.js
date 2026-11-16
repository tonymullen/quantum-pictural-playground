/**
 * DiagramDocumentStore — Singleton registry of all diagram documents.
 * Editor instances use this to list, create, and look up shared documents.
 */
import DiagramDocument from './DiagramDocument.js';

/** @type {Map<string, DiagramDocument>} */
const _docs = new Map();

/** @type {Set<Function>} */
const _storeListeners = new Set();

const DiagramDocumentStore = {
  /** Get all documents. @returns {DiagramDocument[]} */
  list() { return Array.from(_docs.values()); },

  /** Get a document by id. */
  get(id) { return _docs.get(id); },

  /** Create a new document with an optional name, return it. */
  create(name) {
    const doc = new DiagramDocument(name);
    _docs.set(doc.id, doc);
    _notifyStore();
    return doc;
  },

  /** Delete a document by id. */
  remove(id) {
    _docs.delete(id);
    _notifyStore();
  },

  /** Register a callback fired when the list of documents changes. */
  onListChange(fn) { _storeListeners.add(fn); },
  offListChange(fn) { _storeListeners.delete(fn); },
};

function _notifyStore() {
  for (const fn of _storeListeners) fn();
}

export default DiagramDocumentStore;
