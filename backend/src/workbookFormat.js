/**
 * The workbook format, as far as the API needs it: what it accepts, and the
 * summary it lists. This is the API's contract with any client; the app's
 * own copy is frontend/js/workbooks/Workbook.js — keep FORMAT, VERSION and
 * summarize() in step with it when the format changes.
 */
export const FORMAT = 'qpp-workbook';
export const VERSION = 1;

/** Counts shown in listings: circuits, the user's own diagrams (not generated, not proof steps), proofs. */
export function summarize(docs) {
  return {
    circuits: docs.filter(d => d.kind === 'circuit').length,
    diagrams: docs.filter(d => d.kind === 'diagram' && !d.data.derivedFrom && !d.data.ownerProof).length,
    proofs: docs.filter(d => d.kind === 'proof').length,
  };
}
