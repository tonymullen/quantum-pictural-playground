/**
 * ProofDocument — A diagrammatic proof: D₁ R₂ D₂ R₃ D₃ …, where each Dᵢ is a
 * diagram owned by the proof (a copy, never a live link) and each Rᵢ is '='
 * (exactly equal) or '≈' (equal up to a nonzero scalar) between Dᵢ₋₁ and Dᵢ.
 *
 *   steps[i] = { diagram: DiagramDocument, relation: '='|'≈' (unused for i=0),
 *                note: string (e.g. "spider fusion"), source: {id, name}|null }
 *
 * Step diagrams are registered in the DocumentStore (so they can also be
 * opened in a Diagram Editor panel) and carry ownerProof = this proof's id.
 * A proof can be an exercise's goal: goal = { minSteps, relation } locks the first and
 * last steps (the given equation, D₁ … Dₙ) and the student fills in the steps
 * between. It is solved when every step checks, there are at least minSteps
 * steps in between, the chain proves the goal's relation (a goal of = is not
 * met by ≈), and each step is labelled with the rule it uses.
 *
 * The proof notifies its listeners when its structure changes or when any
 * step diagram changes. Structural edits are undoable; edits inside a step
 * diagram use that diagram's own undo.
 */
import DocumentStore from '../DocumentStore.js';
import DiagramDocument from '../DiagramEditor/DiagramDocument.js';
import { checkStep } from '../../core/ProofCheck.js';

let _proofId = 0;

/** Properties a proof may assume about a symbol (see ProofCheck). */
export const ASSUMPTIONS = {
  unitary: 'unitary',
  isometry: 'an isometry (normalised, for a state)',
  causal: 'causal (discarding the outputs = discarding the inputs)',
};

export default class ProofDocument {
  constructor(name) {
    this.id = `proof-${_proofId++}`;
    this.kind = 'proof';
    this.name = name || `Proof ${_proofId}`;
    this.steps = [];
    /** What the proof assumes about its symbols, e.g. { Φ: 'causal', U: 'unitary' } (PQP: "for causal Φ"). */
    this.assumptions = {};
    /** An exercise goal: { minSteps } — the first and last steps are given and locked. */
    this.goal = null;
    this._listeners = new Set();
    this._undoStack = [];
    this._redoStack = [];
    this._onStepChange = () => this._notify();
  }

  onChange(fn) { this._listeners.add(fn); }
  offChange(fn) { this._listeners.delete(fn); }
  _notify() { for (const fn of this._listeners) fn(this); }

  /* ---- Serialization (workbooks) ---- */

  /** Plain data: steps refer to their diagrams by id (saved alongside). */
  toJSON() {
    const out = { name: this.name, assumptions: { ...this.assumptions }, steps: this.steps.map(s => ({
      diagram: s.diagram.id, relation: s.relation, note: s.note, source: s.source })) };
    if (this.goal) out.goal = { ...this.goal };
    return out;
  }

  /** Rebuild a proof whose step diagrams are already restored (diagramById: saved id → document). */
  static fromJSON(data, diagramById, mapId = id => id) {
    const p = new ProofDocument(data.name);
    p.assumptions = { ...(data.assumptions || {}) };
    if (data.goal) p.goal = { minSteps: 1, ...data.goal };
    p.steps = data.steps.map(st => {
      const diagram = diagramById.get(st.diagram);
      if (!diagram) throw new Error(`Proof "${data.name}" refers to a missing diagram`);
      diagram.ownerProof = p.id;
      diagram.onChange(p._onStepChange);
      const source = st.source ? { id: mapId(st.source.id), name: st.source.name } : null;
      return { diagram, relation: st.relation || '≈', note: st.note || '', source };
    });
    return p;
  }

  /* ---- Steps ---- */

  /** Is step i given by the exercise (so it cannot be changed, moved or deleted)? */
  isLocked(i) { return !!this.goal && (i === 0 || i === this.steps.length - 1); }

  /** Where a new step may go: in an exercise, strictly between the given first and last steps. */
  _clampNew(at) {
    if (!this.goal || this.steps.length < 2) return at;
    return Math.max(1, Math.min(at, this.steps.length - 1));
  }

  /** Add an empty step at index `at` (default: end). Returns its index. */
  addEmptyStep(at = this.steps.length) {
    return this._addStep(new DiagramDocument('step'), at, null);
  }

  /** Copy step i as a new step right after it (the usual way to make the next step). */
  duplicateStep(i) {
    const src = this.steps[i];
    return this._addStep(DiagramDocument.copyOf(src.diagram), i + 1, null);
  }

  /** Copy any diagram document in as a new step (remembering where it came from). */
  insertDiagram(doc, at = this.steps.length) {
    return this._addStep(DiagramDocument.copyOf(doc), at, { id: doc.id, name: doc.name });
  }

  /* ---- Deliberate transfers (steps are copies; nothing is ever shared) ---- */

  /** The diagram step i was copied from, if it still exists. */
  sourceOf(i) {
    const st = this.steps[i];
    return (st && st.source && DocumentStore.get(st.source.id)) || null;
  }

  /** Can step i be written back to its source? (Not if the source is generated from a circuit.) */
  canApplyToSource(i) {
    const src = this.sourceOf(i);
    return !!src && !src.derivedFrom;
  }

  /** source → step: replace step i with a fresh copy of its source (undoable in the step). */
  updateFromSource(i) {
    const src = this.sourceOf(i);
    if (!src || this.isLocked(i)) return false;
    this.steps[i].diagram.replaceWithCopyOf(src);
    return true;
  }

  /** step → source: overwrite the source diagram with step i (undoable in the source). */
  applyToSource(i) {
    if (!this.canApplyToSource(i)) return false;
    this.sourceOf(i).replaceWithCopyOf(this.steps[i].diagram);
    return true;
  }

  /** step → new diagram: a standalone copy of step i (becomes the step's new source). */
  saveAsNewDiagram(i, name) {
    const st = this.steps[i];
    const d = DiagramDocument.copyOf(st.diagram, name || `${this.name} D${i + 1}`);
    DocumentStore.add(d);
    this._edit(() => { st.source = { id: d.id, name: d.name }; });
    return d;
  }

  removeStep(i) {
    if (this.isLocked(i)) return false;
    this._edit(() => {
      const [st] = this.steps.splice(i, 1);
      this._release(st);
    });
  }

  moveStep(from, to) {
    if (this.isLocked(from) || (this.goal && (to <= 0 || to >= this.steps.length - 1))) return false;
    this._edit(() => {
      const [st] = this.steps.splice(from, 1);
      this.steps.splice(Math.max(0, Math.min(to, this.steps.length)), 0, st);
    });
  }

  setRelation(i, relation) {
    if (relation !== '=' && relation !== '≈') throw new Error(`Relation must be = or ≈`);
    this._edit(() => { this.steps[i].relation = relation; });
  }

  setNote(i, note) { this._edit(() => { this.steps[i].note = note; }); }

  /** Assume something about a symbol ('unitary', 'isometry', 'causal'), or null to drop it. */
  setAssumption(label, prop) {
    if (prop && !ASSUMPTIONS[prop]) throw new Error(`Unknown assumption ${prop}`);
    this._edit(() => {
      const a = { ...this.assumptions };
      if (prop) a[label] = prop; else delete a[label];
      this.assumptions = a;
    });
  }

  /** The symbols that appear in the proof's diagrams (boxes, states, effects, processes). */
  symbols() {
    const out = new Set();
    for (const st of this.steps)
      for (const n of st.diagram.nodes.values())
        if (n.isOrientable() && n.label && !/^[01+\-−]$/.test(n.label) && !(st.diagram.sumIndices || []).includes(n.label)) out.add(n.label);
    return [...out].sort();
  }

  rename(name) { this._edit(() => { this.name = name; DocumentStore.notifyListChange(); }); }

  /* ---- Checking ---- */

  /** Check step i against step i−1 (i ≥ 1). */
  checkStep(i) {
    const a = this.steps[i - 1].diagram, b = this.steps[i].diagram;
    if (a.tensorOrder !== b.tensorOrder) {
      return { status: 'fail', symbols: [], hint: 'The two diagrams use different ⊗ orders' };
    }
    return checkStep(a.toIR(), b.toIR(), this.steps[i].relation, { assumptions: this.assumptions });
  }

  /**
   * The whole proof: D₁ = Dₙ if every step is '=', D₁ ≈ Dₙ if any is '≈'.
   * @returns {{ status: 'ok'|'fail'|'unavailable'|'empty', relation, results: object[], firstBad: number }}
   */
  checkAll() {
    const results = [null];
    for (let i = 1; i < this.steps.length; i++) results.push(this.checkStep(i));
    const relation = this.steps.slice(1).some(s => s.relation === '≈') ? '≈' : '=';
    if (this.steps.length < 2) return { status: 'empty', relation, results, firstBad: -1 };
    const firstBad = results.findIndex((r, i) => i > 0 && r.status !== 'ok');
    const status = firstBad < 0 ? 'ok' : results[firstBad].status === 'fail' ? 'fail' : 'unavailable';
    return { status, relation, results, firstBad };
  }

  /**
   * An exercise's progress: solved once every step checks, there are enough
   * steps between the given ones, and every step names its rule.
   * @returns {{ solved: boolean, message: string, check: object }|null} null if the proof has no goal
   */
  goalStatus(check = this.checkAll()) {
    if (!this.goal) return null;
    const n = this.steps.length, between = n - 2, need = this.goal.minSteps || 1;
    const SUB = k => String(k).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[d]).join('');
    const claim = `D${SUB(1)} ${check.relation} D${SUB(n)}`;
    if (check.status !== 'ok') {
      const i = check.firstBad;
      return { solved: false, check, message: i > 0
        ? `Not yet: step D${SUB(i)} → D${SUB(i + 1)} does not check — ${check.results[i].hint}`
        : 'Not yet: add steps between the given first and last diagrams' };
    }
    if (between < need) {
      return { solved: false, check, message: `The claim ${claim} is true — now prove it: add ${need === 1 ? 'at least one step' : `at least ${need} steps`} between D${SUB(1)} and D${SUB(n)} (＋ Step), each made by one rule` };
    }
    if (this.goal.relation === '=' && check.relation !== '=') {
      const loose = this.steps.slice(1).map((st, k) => (st.relation === '≈' ? k + 2 : null)).filter(Boolean);
      return { solved: false, check, message: `Every step checks, but the claim is D${SUB(1)} = D${SUB(n)} and ${loose.map(k => `D${SUB(k - 1)} → D${SUB(k)}`).join(', ')} only claims ≈. Can you show = there?` };
    }
    const unlabelled = this.steps.slice(1).map((st, k) => (st.note.trim() ? null : k + 2)).filter(Boolean);
    if (unlabelled.length) {
      return { solved: false, check, message: `Every step checks. Last thing: say which rule each step uses (the “rule…” box before ${unlabelled.map(k => `D${SUB(k)}`).join(', ')})` };
    }
    return { solved: true, check, message: `✓ Solved — ${claim}, every step checks and names its rule` };
  }

  /* ---- Undo / redo of the structure ---- */

  undo() {
    if (!this._undoStack.length) return false;
    this._redoStack.push(this._snapshot());
    this._restore(this._undoStack.pop());
    return true;
  }

  redo() {
    if (!this._redoStack.length) return false;
    this._undoStack.push(this._snapshot());
    this._restore(this._redoStack.pop());
    return true;
  }

  /* ---- Internals ---- */

  _addStep(diagram, at, source) {
    at = this._clampNew(Math.max(0, Math.min(at, this.steps.length)));
    this._edit(() => {
      diagram.ownerProof = this.id;
      diagram.name = `${this.name} step`;
      DocumentStore.add(diagram);
      diagram.onChange(this._onStepChange);
      this.steps.splice(at, 0, { diagram, relation: '≈', note: '', source });
    });
    return at;
  }

  _release(st) {
    st.diagram.offChange(this._onStepChange);
    DocumentStore.remove(st.diagram.id);
  }

  _snapshot() {
    return { name: this.name, assumptions: { ...this.assumptions }, steps: this.steps.map(s => ({ ...s })) };
  }

  _restore(snap) {
    const keep = new Set(snap.steps.map(s => s.diagram));
    for (const st of this.steps) if (!keep.has(st.diagram)) this._release(st);
    const had = new Set(this.steps.map(s => s.diagram));
    for (const st of snap.steps) {
      if (!had.has(st.diagram)) { DocumentStore.add(st.diagram); st.diagram.onChange(this._onStepChange); }
    }
    this.name = snap.name;
    this.assumptions = { ...(snap.assumptions || {}) };
    this.steps = snap.steps.map(s => ({ ...s }));
    DocumentStore.notifyListChange();
    this._notify();
  }

  _edit(fn) {
    this._undoStack.push(this._snapshot());
    if (this._undoStack.length > 100) this._undoStack.shift();
    this._redoStack = [];
    fn();
    this._notify();
  }
}
