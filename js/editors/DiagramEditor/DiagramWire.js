/**
 * DiagramWire — A wire connecting an output port of one node to
 * an input port of another node.
 */

let _wireId = 0;

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
  }

  /**
   * Draw the wire as a smooth Bézier curve between ports.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Map} nodesMap — id → DiagramNode
   */
  draw(ctx, nodesMap) {
    const fromNode = nodesMap.get(this.fromNodeId);
    const toNode = nodesMap.get(this.toNodeId);
    if (!fromNode || !toNode) return;

    const p1 = fromNode.getOutputPort(this.fromPort);
    const p2 = toNode.getInputPort(this.toPort);

    ctx.save();
    ctx.strokeStyle = this.selected ? '#4fc1ff' : '#b0b0b0';
    ctx.lineWidth = this.selected ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);

    // Vertical Bézier control points
    const dy = Math.abs(p2.y - p1.y) * 0.5;
    ctx.bezierCurveTo(p1.x, p1.y + dy, p2.x, p2.y - dy, p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Hit-test: is point (px, py) near this wire?
   */
  hitTest(px, py, nodesMap, threshold = 6) {
    const fromNode = nodesMap.get(this.fromNodeId);
    const toNode = nodesMap.get(this.toNodeId);
    if (!fromNode || !toNode) return false;

    const p1 = fromNode.getOutputPort(this.fromPort);
    const p2 = toNode.getInputPort(this.toPort);

    // Sample the Bézier and check distance
    const dy = Math.abs(p2.y - p1.y) * 0.5;
    for (let t = 0; t <= 1; t += 0.05) {
      const it = 1 - t;
      const x = it**3*p1.x + 3*it**2*t*p1.x + 3*it*t**2*p2.x + t**3*p2.x;
      const y = it**3*p1.y + 3*it**2*t*(p1.y+dy) + 3*it*t**2*(p2.y-dy) + t**3*p2.y;
      if ((px-x)**2 + (py-y)**2 < threshold**2) return true;
    }
    return false;
  }
}
