/**
 * SyncController — Manages the sync state between a diagram document
 * and a Dirac expression.
 *
 * States: 'synced' | 'stale-diagram' | 'stale-dirac' | 'not-equivalent' | 'unavailable'
 *
 * Sync semantics (from spec):
 *   - Explicit or debounced, never per-keystroke rewriting.
 *   - Never silently overwrite student-authored content.
 *   - Generated content is marked as generated.
 *   - A sync action is a single undoable step.
 */
import Config from './Config.js';
import diagramToIR from './DiagramToIR.js';
import contractIR from './ContractIR.js';
import diagramToDirac from './DiagramToDirac.js';
import { verify, verifyStatusDisplay } from './Verify.js';
import parseDirac, { ParseError } from './DiracParser.js';
import evalDirac, { DiracEvalError } from './DiracEval.js';

/**
 * @typedef {'synced'|'stale-diagram'|'stale-dirac'|'not-equivalent'|'unavailable'} SyncState
 */

export default class SyncController {
  /**
   * @param {import('../editors/DiagramEditor/DiagramDocument.js').default} doc
   */
  constructor(doc) {
    this.doc = doc;
    this.diracLatex = '';         // current Dirac-side LaTeX
    this.diracAuthored = false;   // true if student has edited the Dirac text
    this.diracGenerated = false;  // true if current text was auto-generated
    this.state = 'unavailable';
    this.lastVerifyResult = null;
    this.lastIR = null;

    /** @type {Set<Function>} */
    this._listeners = new Set();
    this._debounceTimer = null;

    // Subscribe to diagram changes
    this._onDocChange = () => this._onDiagramChanged();
    this.doc.onChange(this._onDocChange);
  }

  /** Subscribe to sync-state changes. */
  onStateChange(fn) { this._listeners.add(fn); }
  offStateChange(fn) { this._listeners.delete(fn); }
  _notify() { for (const fn of this._listeners) fn(this); }

  /** Switch to a different diagram document. */
  setDocument(doc) {
    this.doc.offChange(this._onDocChange);
    this.doc = doc;
    this.doc.onChange(this._onDocChange);
    this.state = 'unavailable';
    this.lastVerifyResult = null;
    this._notify();
  }

  /** Called when the diagram side changes. */
  _onDiagramChanged() {
    // Any previous result is now outdated (including "unavailable" ones)
    if (this.lastVerifyResult || this.state === 'synced' || this.state === 'not-equivalent') {
      this.state = 'stale-diagram';
      this._notify();
    }
    // Debounced auto-verify
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.verifyNow(), Config.debounceMs);
  }

  /** Called when the Dirac side changes (from the editor). */
  onDiracChanged(latex, authored = true) {
    this.diracLatex = latex;
    if (authored) {
      this.diracAuthored = true;
      this.diracGenerated = false;
    }
    // Any previous result is now outdated (including "unavailable" ones)
    if (this.lastVerifyResult || this.state === 'synced' || this.state === 'not-equivalent') {
      this.state = 'stale-dirac';
      this._notify();
    }
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this.verifyNow(), Config.debounceMs);
  }

  /**
   * Run verification now.
   * Builds IR from diagram, evaluates tensor (if possible),
   * compares against the Dirac tensor (when available).
   */
  verifyNow() {
    clearTimeout(this._debounceTimer);

    // Build IR from diagram
    const ir = diagramToIR(this.doc);
    this.lastIR = ir;

    if (!ir.isValid) {
      this.state = 'unavailable';
      this.lastVerifyResult = {
        status: 'unavailable',
        hint: 'Diagram has errors: ' + ir.diagnostics.map(d => d.message).join('; ')
      };
      this._notify();
      return;
    }

    // Contract diagram to tensor
    const { tensor: diagTensor, symbolic, reason } = contractIR(ir);

    if (!diagTensor) {
      this.state = 'unavailable';
      this.lastVerifyResult = {
        status: 'unavailable',
        hint: symbolic ? 'Diagram contains symbolic generators — cannot verify numerically'
                       : (reason || 'Could not evaluate diagram')
      };
      this._notify();
      return;
    }

    this.lastDiagramTensor = diagTensor;

    if (!this.diracLatex) {
      this.state = 'unavailable';
      this.lastVerifyResult = {
        status: 'unavailable',
        hint: 'Enter a Dirac expression to verify against the diagram, or click Generate'
      };
      this._notify();
      return;
    }

    // Parse and evaluate the Dirac expression
    let diracTensor = null;
    try {
      const ast = parseDirac(this.diracLatex);
      diracTensor = evalDirac(ast);
    } catch (e) {
      if (e instanceof ParseError) {
        this.state = 'unavailable';
        this.lastVerifyResult = {
          status: 'unavailable',
          hint: `Parse error at position ${e.pos}: ${e.message}`
        };
        this._notify();
        return;
      }
      // Concrete but ill-typed expression (e.g. dimension mismatch)
      this.state = e instanceof DiracEvalError ? 'not-equivalent' : 'unavailable';
      this.lastVerifyResult = e instanceof DiracEvalError
        ? { status: 'not-equivalent', hint: e.message }
        : { status: 'unavailable', hint: `Error: ${e.message}` };
      this._notify();
      return;
    }

    if (!diracTensor) {
      this.state = 'unavailable';
      this.lastVerifyResult = {
        status: 'unavailable',
        hint: 'Expression contains symbolic operators that cannot be evaluated numerically'
      };
      this._notify();
      return;
    }

    // Compare diagram tensor vs Dirac tensor
    this.lastVerifyResult = verify(diagTensor, diracTensor);
    this.state = this.lastVerifyResult.status === 'equivalent' ? 'synced' : 'not-equivalent';
    this._notify();
  }

  /**
   * Generate a Dirac expression from the current diagram.
   * Returns the generation result and updates the sync state.
   */
  generateDirac() {
    const result = diagramToDirac(this.doc);
    this.lastGenerateResult = result;
    if (result.tensor) this.lastDiagramTensor = result.tensor;
    this.lastIR = result.ir;
    return result;
  }

  /** Get display info for the current state. */
  getStatusDisplay() {
    // Stale states take precedence over the (now outdated) last result
    if (this.state === 'stale-diagram')
      return { icon: '⟳', cls: 'verify-stale', text: 'Diagram changed — re-checking…' };
    if (this.state === 'stale-dirac')
      return { icon: '⟳', cls: 'verify-stale', text: 'Expression changed — re-checking…' };
    if (this.lastVerifyResult) {
      return verifyStatusDisplay(this.lastVerifyResult);
    }
    switch (this.state) {
      case 'synced':
        return { icon: '✓', cls: 'verify-ok', text: 'Synced' };
      case 'not-equivalent':
        return { icon: '✗', cls: 'verify-fail', text: 'Not equivalent' };
      default:
        return { icon: '—', cls: 'verify-unknown', text: 'No expression to verify' };
    }
  }

  destroy() {
    this.doc.offChange(this._onDocChange);
    clearTimeout(this._debounceTimer);
  }
}
