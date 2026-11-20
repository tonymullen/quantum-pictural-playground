/**
 * Highlight — a tiny shared channel for "this part corresponds to that part".
 *
 * Hovering a term of a Dirac expression highlights the diagram nodes (or
 * circuit steps) it comes from, and hovering a node or a step highlights the
 * term. Each view emits what is under the pointer and listens for the rest.
 *
 *   { source, docId?, circuitId?, nodeIds?: string[], columns?: (number|'in'|'out')[] }
 *   emit(h) — h = null clears what `source` showed
 */
const listeners = new Set();

const Highlight = {
  emit(h, source) { const e = h ? { ...h, source } : { clear: true, source }; for (const fn of listeners) fn(e); },
  clear(source) { this.emit(null, source); },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

export default Highlight;
