/**
 * FlowDirection — Canonical diagram frame and view orientations.
 *
 * PQP (Coecke & Kissinger) convention: bottom-to-top.
 * - Inputs enter from below (bottom ports on nodes).
 * - Outputs leave from above (top ports on nodes).
 * - States have output wires leaving upward.
 * - Effects have input wires entering from below.
 * - Cup (∪) is a state: two outputs at top.
 * - Cap (∩) is an effect: two inputs at bottom.
 * - Composition: generators higher up are applied later.
 */

/** Flow direction constant. 'up' = bottom-to-top (PQP). */
export const FLOW = 'up';

/**
 * Given the flow direction, return the y-offsets for input and output ports
 * relative to the node center.
 *
 * @param {number} radius — node radius
 * @returns {{ inputYOffset: number, outputYOffset: number }}
 *
 * For FLOW='up': inputs at bottom (y + radius + 2), outputs at top (y - radius - 2).
 */
export function portOffsets(radius) {
  if (FLOW === 'up') {
    return { inputYOffset: radius + 2, outputYOffset: -(radius + 2) };
  }
  // 'down' (legacy top-to-bottom): inputs at top, outputs at bottom
  return { inputYOffset: -(radius + 2), outputYOffset: radius + 2 };
}

/**
 * Labels for boundary markers.
 * @returns {{ inputLabel: string, outputLabel: string,
 *             inputSide: string, outputSide: string }}
 */
export function boundaryLabels() {
  if (FLOW === 'up') {
    return { inputLabel: 'in', outputLabel: 'out',
             inputSide: 'bottom', outputSide: 'top' };
  }
  return { inputLabel: 'in', outputLabel: 'out',
           inputSide: 'top', outputSide: 'bottom' };
}

/* ------------------------------------------------------------------ */
/* View orientations.
 *
 * Documents are stored in the canonical PQP frame above (time up, first wire
 * on the left). A view orientation is an orthogonal map M from that frame to
 * the screen: screen = pan + zoom · M · world. It changes only the drawing:
 * port positions, wire order and every computed tensor use the canonical
 * frame, so no orientation can change what a diagram means.
 *
 * M is { a, b, c, d } in canvas-transform form: x' = a·x + c·y, y' = b·x + d·y.
 */
export const ORIENTATIONS = {
  pqp:       { id: 'pqp',       label: 'PQP (time ↑)',            arrow: '↑ time', a: 1, b: 0, c: 0,  d: 1 },
  topdown:   { id: 'topdown',   label: 'Top-down (time ↓)',       arrow: '↓ time', a: 1, b: 0, c: 0,  d: -1 },
  // time → (canonical up ↦ right), first wire on top (canonical right ↦ down)
  circuit:   { id: 'circuit',   label: 'Circuit (time →)',        arrow: 'time →', a: 0, b: 1, c: -1, d: 0 },
  // time ← (canonical up ↦ left), first wire on top — reads like the formula
  // (Wood, Biamonte & Cory: kets' wires point left, bras' right)
  algebraic: { id: 'algebraic', label: 'Algebraic (time ←)',      arrow: '← time', a: 0, b: 1, c: 1,  d: 0 },
};

/** Apply an orientation's linear part to a vector. */
export function orient(o, x, y) { return { x: o.a * x + o.c * y, y: o.b * x + o.d * y }; }

/** Inverse (M is orthogonal, so the inverse is the transpose). */
export function unorient(o, x, y) { return { x: o.a * x + o.b * y, y: o.c * x + o.d * y }; }
