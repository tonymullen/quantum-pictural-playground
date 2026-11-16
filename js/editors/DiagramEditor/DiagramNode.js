/**
 * DiagramNode — A node in a quantum pictorial diagram.
 * Node types follow "Picturing Quantum Processes" conventions:
 *   z-spider (green), x-spider (red), hadamard (yellow box),
 *   diamond (state/effect), identity wire, cup, cap
 */

let _nodeId = 0;

export const NODE_TYPES = {
  Z_SPIDER:  { key: 'z-spider',  label: 'Z Spider',  color: '#6a9955', shape: 'circle' },
  X_SPIDER:  { key: 'x-spider',  label: 'X Spider',  color: '#ce4a4a', shape: 'circle' },
  HADAMARD:  { key: 'hadamard',  label: 'Hadamard',  color: '#cca700', shape: 'box' },
  DIAMOND:   { key: 'diamond',   label: 'State/Effect', color: '#4fc1ff', shape: 'diamond' },
  SCALAR:    { key: 'scalar',    label: 'Scalar',    color: '#c586c0', shape: 'circle' },
};

export default class DiagramNode {
  constructor(type, x, y) {
    this.id = `node-${_nodeId++}`;
    this.type = type;           // one of NODE_TYPES values
    this.x = x;
    this.y = y;
    this.phase = '';            // phase label (e.g. "π/2")
    this.inputs = 1;            // number of input wires
    this.outputs = 1;           // number of output wires
    this.selected = false;
    this.radius = type.shape === 'box' ? 20 : 22;
  }

  containsPoint(px, py) {
    const r = this.radius;
    if (this.type.shape === 'box') {
      return px >= this.x - r && px <= this.x + r && py >= this.y - r && py <= this.y + r;
    }
    if (this.type.shape === 'diamond') {
      const dx = Math.abs(px - this.x), dy = Math.abs(py - this.y);
      return (dx / r + dy / r) <= 1;
    }
    // circle
    return (px - this.x) ** 2 + (py - this.y) ** 2 <= r * r;
  }

  /** Get port positions (input ports on top, output ports on bottom) */
  getInputPort(index) {
    const spacing = 20;
    const totalW = (this.inputs - 1) * spacing;
    const startX = this.x - totalW / 2;
    return { x: startX + index * spacing, y: this.y - this.radius - 2 };
  }

  getOutputPort(index) {
    const spacing = 20;
    const totalW = (this.outputs - 1) * spacing;
    const startX = this.x - totalW / 2;
    return { x: startX + index * spacing, y: this.y + this.radius + 2 };
  }

  draw(ctx) {
    ctx.save();
    const r = this.radius;

    // Selection highlight
    if (this.selected) {
      ctx.strokeStyle = '#4fc1ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = this.type.color;
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 2;

    if (this.type.shape === 'box') {
      ctx.beginPath();
      ctx.rect(this.x - r, this.y - r, r * 2, r * 2);
      ctx.fill(); ctx.stroke();
    } else if (this.type.shape === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(this.x, this.y - r);
      ctx.lineTo(this.x + r, this.y);
      ctx.lineTo(this.x, this.y + r);
      ctx.lineTo(this.x - r, this.y);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    // Phase label
    if (this.phase) {
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.phase, this.x, this.y);
    }

    // Port dots
    ctx.fillStyle = '#e0e0e0';
    for (let i = 0; i < this.inputs; i++) {
      const p = this.getInputPort(i);
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < this.outputs; i++) {
      const p = this.getOutputPort(i);
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  }
}
