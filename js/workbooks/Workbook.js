/**
 * Workbook — the saved unit: a bundle of related documents (circuits,
 * diagrams, proofs) plus the panel layout that shows them.
 *
 * Format (plain JSON, the same for Demos and My Workbooks):
 *   {
 *     format: 'qpp-workbook', version: 1,
 *     name, description, savedAt,
 *     summary: { circuits, diagrams, proofs },          // for listings
 *     documents: [
 *       { kind: 'circuit', id, data: CircuitDocument.toJSON() },
 *       { kind: 'diagram', id, data: DiagramDocument.toJSON() },   // incl. generated diagrams & proof steps
 *       { kind: 'proof',   id, data: ProofDocument.toJSON() },
 *     ],
 *     layout: <layout spec>      // LayoutManager.serialize(): splits + { editorType, state }
 *   }
 *
 * Ids inside a workbook are only labels: opening a workbook creates fresh
 * documents and remaps every reference (generated diagrams → their circuit,
 * proof steps → their proof, step sources, and panel states such as the
 * document a panel shows).
 */
import DocumentStore from '../editors/DocumentStore.js';
import DiagramDocument from '../editors/DiagramEditor/DiagramDocument.js';
import CircuitDocument from '../editors/CircuitEditor/CircuitDocument.js';
import ProofDocument from '../editors/EquationEditor/ProofDocument.js';
import { derivedDiagram } from '../editors/CircuitEditor/CircuitDiagramLink.js';

export const FORMAT = 'qpp-workbook';
export const VERSION = 1;

/** Counts shown in listings: "1 circuit · 2 diagrams · 1 proof". */
export function summarize(docs) {
  return {
    circuits: docs.filter(d => d.kind === 'circuit').length,
    // the diagrams a user thinks of as theirs: not generated, not proof steps
    diagrams: docs.filter(d => d.kind === 'diagram' && !d.data.derivedFrom && !d.data.ownerProof).length,
    proofs: docs.filter(d => d.kind === 'proof').length,
  };
}

export function summaryText(s) {
  if (!s) return '';
  const part = (n, one) => (n ? `${n} ${one}${n === 1 ? '' : 's'}` : null);
  return [part(s.circuits, 'circuit'), part(s.diagrams, 'diagram'), part(s.proofs, 'proof')]
    .filter(Boolean).join(' · ') || 'empty';
}

/**
 * Capture every document in the DocumentStore, plus a layout spec.
 * @returns {object} workbook JSON
 */
export function captureWorkbook({ name, description = '' }, layout) {
  const docs = [];
  for (const d of DocumentStore.list('circuit')) docs.push({ kind: 'circuit', id: d.id, data: d.toJSON() });
  for (const d of DocumentStore.list('diagram')) docs.push({ kind: 'diagram', id: d.id, data: d.toJSON() });
  for (const d of DocumentStore.list('proof')) docs.push({ kind: 'proof', id: d.id, data: d.toJSON() });
  return {
    format: FORMAT, version: VERSION, name, description,
    savedAt: new Date().toISOString(),
    summary: summarize(docs),
    documents: docs,
    layout: JSON.parse(JSON.stringify(layout || null)),
  };
}

/**
 * Replace the DocumentStore's contents with a workbook's documents.
 * @returns {{ layout: object|null, idMap: Map<string,string> }} the layout
 *          spec with its document references remapped
 */
export function openWorkbookDocuments(wb) {
  if (!wb || wb.format !== FORMAT) throw new Error('Not a workbook');
  if (wb.version > VERSION) throw new Error(`This workbook needs a newer version of the app (format ${wb.version})`);
  DocumentStore.clear();
  const idMap = new Map();
  const map = id => (id && idMap.has(id) ? idMap.get(id) : id);
  const byKind = k => wb.documents.filter(d => d.kind === k);

  // 1. Circuits (ids first, so generated diagrams can refer to them)
  const circuits = [];
  for (const d of byKind('circuit')) {
    const c = CircuitDocument.fromJSON(d.data);
    idMap.set(d.id, c.id);
    circuits.push(c);
    DocumentStore.add(c);
  }
  // 2. Diagrams (ownerProof is set when the proofs are rebuilt)
  const diagramBySavedId = new Map();
  for (const d of byKind('diagram')) {
    const doc = DiagramDocument.fromJSON({ ...d.data, derivedFrom: map(d.data.derivedFrom), ownerProof: null });
    idMap.set(d.id, doc.id);
    diagramBySavedId.set(d.id, doc);
    DocumentStore.add(doc);
  }
  // 3. Proofs (they adopt their step diagrams)
  for (const d of byKind('proof')) {
    const p = ProofDocument.fromJSON(d.data, diagramBySavedId, map);
    idMap.set(d.id, p.id);
    DocumentStore.add(p);
  }
  // 4. Generated diagrams follow their circuits again
  for (const c of circuits) derivedDiagram(c);

  return { layout: _remapLayout(wb.layout, map), idMap };
}

/** Remap document ids in panel states (any state key ending in "Id"). */
function _remapLayout(spec, map) {
  if (!spec) return null;
  if (spec.type === 'split') return { ...spec, children: spec.children.map(c => _remapLayout(c, map)) };
  const state = spec.state ? { ...spec.state } : null;
  if (state) for (const k of Object.keys(state)) if (/Id$/.test(k)) state[k] = map(state[k]);
  return { ...spec, state };
}
