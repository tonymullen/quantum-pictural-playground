/**
 * demo-kit — helpers for building Demo workbooks from code (used by
 * build-demos.mjs and the textbook chapters in textbook/).
 *
 * Everything here uses the app's own document model, so a workbook built
 * with it is exactly what the app would save.
 */
import DocumentStore from '../js/editors/DocumentStore.js';
import DiagramDocument from '../js/editors/DiagramEditor/DiagramDocument.js';
import DiagramNode, { NODE_TYPES as NT } from '../js/editors/DiagramEditor/DiagramNode.js';
import DiagramWire from '../js/editors/DiagramEditor/DiagramWire.js';
import CircuitDocument from '../js/editors/CircuitEditor/CircuitDocument.js';
import ProofDocument from '../js/editors/EquationEditor/ProofDocument.js';
import { derivedDiagram } from '../js/editors/CircuitEditor/CircuitDiagramLink.js';
import Tensor from '../js/core/Tensor.js';
import { pullTautChecked } from '../js/editors/DiagramEditor/PullTaut.js';

/* ---------------- Helpers ---------------- */

export const add = (doc, type, x, y, { i, o, label, tensor } = {}) => {
  const n = new DiagramNode(type, x, y);
  if (i !== undefined) n.inputs = i;
  if (o !== undefined) n.outputs = o;
  if (label !== undefined) n.label = label;
  if (tensor) n.tensor = tensor;
  doc.nodes.set(n.id, n);
  return n;
};
export const wire = (doc, a, ap, b, bp) => doc.wires.push(new DiagramWire(a.id, ap, b.id, bp));
export const scalar = (doc, value, label, x = 340, y = 520) =>
  add(doc, NT.SCALAR, x, y, { label, tensor: new Tensor(1, 1, [[value, 0]]) });
export const R2 = Math.SQRT1_2;

export function circuit(name, n, cells, inputs) {
  const c = DocumentStore.add(new CircuitDocument(name, n));
  for (const [t, q, gate, param] of cells) c.setCell(t, q, param ? { gate, param } : { gate });
  (inputs || []).forEach((s, q) => c.setInput(q, s));
  derivedDiagram(c);
  return c;
}

/**
 * A proof from a list of steps: { build(doc) | from: diagram, relation, note }.
 * It must check, unless mayFail (an exercise's deliberately wrong claim).
 */
export function proof(name, steps, assumptions = {}, { mayFail = false } = {}) {
  const p = DocumentStore.add(new ProofDocument(name));
  p.assumptions = { ...assumptions };
  steps.forEach((st, k) => {
    if (st.from) p.insertDiagram(st.from);
    else { p.addEmptyStep(); st.build(p.steps[k].diagram); }
    if (k > 0) { p.steps[k].relation = st.relation || '='; p.steps[k].note = st.note || ''; }
  });
  p._undoStack = [];
  const r = p.checkAll();
  if (r.status !== 'ok' && r.status !== 'empty' && !mayFail) {
    throw new Error(`Demo proof "${name}" does not check at step ${r.firstBad}: ${r.results[r.firstBad].hint}`);
  }
  return p;
}

export const leaf = (editorType, state) => ({ type: 'leaf', editorType, state });
export const split = (direction, ratio, a, b) => ({ type: 'split', direction, ratio, children: [a, b] });


/**
 * An exercise's goal proof: the given first step and the goal (last step),
 * locked; the student fills in the steps between (ProofDocument.goal).
 * The claim itself must check, so every goal set is one that can be proved.
 */
export function goalProof(name, given, goal, { relation = '=', minSteps = 1, assumptions = {} } = {}) {
  const p = proof(name, [given, { ...goal, relation, note: '' }], assumptions);
  p.goal = { minSteps, relation };
  p.steps[1].note = '';
  return p;
}

/** A copy of a diagram's contents into a step being built (d.nodes/wires replaced). */
export const copyInto = src => d => { const c = DiagramDocument.copyOf(src); d.nodes = c.nodes; d.wires = c.wires; };

/** A standalone diagram in the workbook (shown in Diagram Editor panels, insertable in proofs). */
export function diagram(name, build) {
  const d = DocumentStore.createDiagram(name);
  build(d);
  d._undoStack = [];
  return d;
}

/** The usual exercise layout: the Exercise panel on the left, the work on the right. */
export const withExercise = (work, ratio = 0.27) => split('horizontal', ratio, leaf('Exercise', {}), work);

export { DocumentStore, DiagramDocument, DiagramNode, NT, DiagramWire, CircuitDocument, ProofDocument, derivedDiagram, Tensor, pullTautChecked };
