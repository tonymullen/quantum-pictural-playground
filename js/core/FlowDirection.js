/**
 * FlowDirection — Single source of truth for diagram flow convention.
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
