/**
 * DiagramWire — A wire connecting an output port of one node to
 * an input port of another node.
 */
import { portOffsets } from '../../core/FlowDirection.js';

let _wireId = 0;

/**
 * Cubic Bézier control points for a wire from an output-port position p1
 * to an input-port position p2. The curve leaves outputs and enters inputs
 * along the flow direction (FlowDirection.js), so wires never curl back
 * through their own nodes.
 * @returns {{x:number,y:number}[]} [p1, c1, c2, p2]
 */
export function wireCurve(p1, p2) {
  const { inputYOffset, outputYOffset } = portOffsets(1);
  const so = Math.sign(outputYOffset), si = Math.sign(inputYOffset);
  const dy = Math.max(Math.abs(p2.y - p1.y) * 0.5, 30);
  return [p1, { x: p1.x, y: p1.y + so * dy }, { x: p2.x, y: p2.y + si * dy }, p2];
}

/** A straight segment expressed as a cubic (so drawing and hit-testing are shared). */
export function straightCurve(p1, p2) {
  const at = t => ({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t });
  return [p1, at(1 / 3), at(2 / 3), p2];
}

/** Stroke a wire curve on a canvas context (path only; caller sets style). */
export function strokeCurve(ctx, [p1, c1, c2, p2]) {
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p2.x, p2.y);
  ctx.stroke();
}

export default class DiagramWire {
  /**
   * @param {string} fromNodeId
   * @param {number} fromPort — output port index
   * @param {string} toNodeId
   * @param {number} toPort — input port index
   */
  constructor(fromNodeId, fromPort, toNodeId, toPort) {
    this.id = `wire-${_wireId++}`;
    this.fromNodeId = fromNodeId;
    this.fromPort = fromPort;
    this.toNodeId = toNodeId;
    this.toPort = toPort;
    this.selected = false;
    this.wireType = 'qubit';   // 'qubit' | 'qubit-thick' | 'classical'
  }

  /** Control points in world space, or null if an endpoint node is missing. */
  curve(nodesMap) {
    const fromNode = nodesMap.get(this.fromNodeId);
    const toNode = nodesMap.get(this.toNodeId);
    if (!fromNode || !toNode) return null;
    const p1 = fromNode.getOutputPort(this.fromPort), p2 = toNode.getInputPort(this.toPort);
    // Spider-to-spider (and spider–H) wires are legs: a straight line between the edges
    if (fromNode.isFlexible() && toNode.isFlexible()) return straightCurve(p1, p2);
    return wireCurve(p1, p2);
  }

  /**
   * Draw the wire as a smooth Bézier curve between ports.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Map} nodesMap — id → DiagramNode
   */
  draw(ctx, nodesMap) {
    const pts = this.curve(nodesMap);
    if (!pts) return;
    // PQP: quantum wires in the doubled picture are thick
    const thick = nodesMap.get(this.fromNodeId).portIsThick('out', this.fromPort);
    ctx.save();
    ctx.strokeStyle = this.selected ? '#4fc1ff' : '#b0b0b0';
    ctx.lineWidth = (thick ? 5 : 2) + (this.selected ? 1 : 0);
    strokeCurve(ctx, pts);
    ctx.restore();
  }

  /** Hit-test in world coordinates: is (px, py) near this wire? */
  hitTest(px, py, nodesMap, threshold = 6) {
    const pts = this.curve(nodesMap);
    if (!pts) return false;
    const [p1, c1, c2, p2] = pts;
    for (let t = 0; t <= 1.0001; t += 0.025) {
      const it = 1 - t;
      const x = it**3*p1.x + 3*it**2*t*c1.x + 3*it*t**2*c2.x + t**3*p2.x;
      const y = it**3*p1.y + 3*it**2*t*c1.y + 3*it*t**2*c2.y + t**3*p2.y;
      if ((px - x)**2 + (py - y)**2 < threshold**2) return true;
    }
    return false;
  }
}
