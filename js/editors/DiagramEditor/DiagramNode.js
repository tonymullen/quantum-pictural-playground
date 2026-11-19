/**
 * DiagramNode — A node in a quantum pictorial diagram.
 *
 * Components follow the "Quantum Picturalism" paper (Coecke, 0908.1787):
 *   - Z Spider (green)   — observable / copying / phase spider
 *   - X Spider (red)     — complementary observable spider
 *   - Hadamard (yellow)  — colour-change gate (box)
 *   - Morphism Box       — generic labeled process f : A⊗n → A⊗m
 *   - Cup (∪ / η)        — Bell-state, U-turn wire (0 inputs, 2 outputs)
 *   - Cap (∩ / ε)        — Bell-effect, inverted U-turn (2 inputs, 0 outputs)
 *   - Swap (σ)           — wire crossing (2 inputs, 2 outputs)
 *   - State (triangle)   — named state ψ : I → A (0 inputs, 1 output)
 *   - Effect (triangle)  — named effect : A → I (1 input, 0 outputs)
 *   - Scalar             — I → I (0 inputs, 0 outputs, labeled)
 *   - Wire               — a plain wire segment (identity), 1 → 1
 */

import { portOffsets } from '../../core/FlowDirection.js';

/**
 * Draw text at world point (x, y) so it reads upright on screen, whatever
 * view orientation the canvas applies (DiagramCanvas sets ctx.__orient).
 */
export function uprightText(ctx, text, x, y) {
  const o = ctx.__orient;
  if (!o || (o.a === 1 && o.d === 1)) { ctx.fillText(text, x, y); return; }
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(o.a, o.c, o.b, o.d, 0, 0);   // undo the orientation (inverse = transpose)
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

let _nodeId = 0;

/** Node types with an orientation (see DiagramNode.flip). */
export const ORIENTABLE = new Set(['morphism', 'state', 'effect']);
/** Node types that can be doubled (drawn thick: PQP's double(f) = f̄ ⊗ f). */
export const DOUBLEABLE = new Set(['z-spider', 'x-spider', 'hadamard', 'morphism', 'state', 'effect',
  'cup', 'cap', 'swap', 'identity', 'scalar']);

export const NODE_TYPES = {
  Z_SPIDER:  { key: 'z-spider',  label: 'Z Spider',  color: '#6a9955', shape: 'circle',   defIn: 1, defOut: 1, variableArity: true },
  X_SPIDER:  { key: 'x-spider',  label: 'X Spider',  color: '#ce4a4a', shape: 'circle',   defIn: 1, defOut: 1, variableArity: true },
  HADAMARD:  { key: 'hadamard',  label: 'Hadamard',  color: '#cca700', shape: 'box',      defIn: 1, defOut: 1 },
  MORPHISM:  { key: 'morphism',  label: 'Morphism',  color: '#5b7eaa', shape: 'morphbox', defIn: 1, defOut: 1, variableArity: true, defLabel: 'f' },
  CUP:       { key: 'cup',       label: 'Cup (η)',    color: '#b0b0b0', shape: 'cup',      defIn: 0, defOut: 2 },
  CAP:       { key: 'cap',       label: 'Cap (ε)',    color: '#b0b0b0', shape: 'cap',      defIn: 2, defOut: 0 },
  SWAP:      { key: 'swap',      label: 'Swap (σ)',   color: '#b0b0b0', shape: 'swap',     defIn: 2, defOut: 2 },
  STATE:     { key: 'state',     label: 'State (ψ)',  color: '#4fc1ff', shape: 'triangle-down', defIn: 0, defOut: 1, defLabel: 'ψ' },
  EFFECT:    { key: 'effect',    label: 'Effect',     color: '#c586c0', shape: 'triangle-up',   defIn: 1, defOut: 0, defLabel: 'φ' },
  SCALAR:    { key: 'scalar',    label: 'Scalar',     color: '#c586c0', shape: 'scalar',   defIn: 0, defOut: 0, defLabel: 's' },
  IDENTITY:  { key: 'identity',  label: 'Wire',       color: '#b0b0b0', shape: 'wire',     defIn: 1, defOut: 1 },
  // The doubled (CPM / cq) picture of PQP: a white dot is the classical spider
  // (copy, delete, compare) — its legs may be thin (classical) or thick (quantum),
  // which also gives measure (thick in, thin out) and encode (thin in, thick out).
  DOT:       { key: 'dot',       label: 'White dot (classical spider)', color: '#f4f4f4', shape: 'dot', defIn: 1, defOut: 1, variableArity: true },
  DISCARD:   { key: 'discard',   label: 'Discard (⏚)', color: '#e0e0e0', shape: 'ground', defIn: 1, defOut: 0 },
};

export default class DiagramNode {
  constructor(type, x, y) {
    this.id = `node-${_nodeId++}`;
    this.type = type;
    this.x = x;
    this.y = y;
    this.label = type.defLabel || '';  // text label (phase for spiders, name for morphisms/states)
    this.inputs = type.defIn;
    this.outputs = type.defOut;
    this.selected = false;
    this.radius = this._defaultRadius();
    // Sync-system fields (optional, null by default)
    this.phase = null;         // Phase instance: { num, den } rational π-multiple
    this.tensor = null;        // Tensor instance: concrete complex matrix
    this.symbolicForm = null;  // string: symbolic expression for the IR
    this.provenance = null;    // string: opaque cross-highlighting tag
    // Orientation (PQP's asymmetric shapes): v = reflected top↔bottom (adjoint †),
    // h = reflected left↔right (conjugate); both = rotated 180° (transpose ᵀ).
    this.flip = { v: false, h: false };
    // The doubled picture: thick = doubled (quantum, f̂ = f̄ ⊗ f). A thick box,
    // state or effect may instead be a general process (process = true), whose
    // legs (like a white dot's) can each be thin or thick: legThick.in/out[i].
    this.thick = false;
    this.process = false;
    this.legThick = { in: [], out: [] };
    this.portXOffsets = null;  // number[] | null: explicit x offset of port k (in & out),
                               // e.g. a circuit box whose ports sit on their qubits' wires
  }

  _defaultRadius() {
    const s = this.type.shape;
    if (s === 'box' || s === 'morphbox') return 20;
    if (s === 'cup' || s === 'cap') return 24;
    if (s === 'swap') return 20;
    if (s === 'triangle-down' || s === 'triangle-up') return 18;
    if (s === 'scalar') return 14;
    if (s === 'dot') return 8;
    if (s === 'ground') return 12;
    if (s === 'wire') return 14;
    return 20; // spiders
  }

  containsPoint(px, py) {
    const r = this.radius + 4; // small tolerance
    const dx = Math.abs(px - this.x), dy = Math.abs(py - this.y);
    const s = this.type.shape;
    if (s === 'box') return dx <= r && dy <= r;
    if (s === 'morphbox') return dx <= this._boxWidth() / 2 + 4 && dy <= r;
    if (s === 'wire') return dx <= 7 && dy <= r;
    if (s === 'cup' || s === 'cap') return dx <= r + 6 && dy <= r;
    if (s === 'swap') return dx <= r && dy <= r;
    if (s === 'triangle-down' || s === 'triangle-up') return dx <= r && dy <= r;
    return dx * dx + dy * dy <= r * r; // circles & scalar
  }

  /** Boxes, states and effects have an orientation (f, fᵀ, f†, f̄); spiders etc. are symmetric. */
  isOrientable() { return ORIENTABLE.has(this.type.key); }

  /**
   * The node's symbol is "label + canonical shape": an adjoint or transpose
   * swaps inputs and outputs, so a state drawn as the adjoint of an effect φ
   * is the same symbol as the effect φ.
   */
  canonicalArity() {
    return this.flip && this.flip.v ? { inputs: this.outputs, outputs: this.inputs } : { inputs: this.inputs, outputs: this.outputs };
  }

  /** Width of a morphism box: wide enough for all its ports. */
  _boxWidth() {
    if (this.portXOffsets && this.portXOffsets.length) {
      const o = this.portXOffsets;
      return Math.max(36, 2 * Math.max(...o.map(Math.abs)) + 30);
    }
    // PQP boxes are wider than tall
    return Math.max(this.radius * 2.6, (Math.max(this.inputs, this.outputs) - 1) * 24 + 30);
  }

  /** Spiders (Z, X, and the white classical dot): their legs are interchangeable. */
  isSpider() { return this.type.key === 'z-spider' || this.type.key === 'x-spider' || this.type.key === 'dot'; }

  /** Is this port thick (a quantum system in the doubled picture)? */
  portIsThick(dir, i) {
    const k = this.type.key;
    if (k === 'discard') return dir === 'in';
    if (k === 'dot' || this.isMixed()) {
      const v = this.legThick && this.legThick[dir] ? this.legThick[dir][i] : undefined;
      return v === undefined || v === null ? k !== 'dot' : !!v;   // dots default thin, processes thick
    }
    return !!this.thick;
  }

  /** A general process (thick box/state/effect) — its legs can be thin or thick. */
  isMixed() { return !!(this.thick && this.process && ORIENTABLE.has(this.type.key)); }

  /** Can each leg be chosen thin or thick? (white dots, general processes) */
  hasLegTypes() { return this.type.key === 'dot' || this.isMixed(); }

  isDoubleable() { return DOUBLEABLE.has(this.type.key); }

  /** Does any port carry a thick wire? */
  hasThick() {
    for (let i = 0; i < this.inputs; i++) if (this.portIsThick('in', i)) return true;
    for (let i = 0; i < this.outputs; i++) if (this.portIsThick('out', i)) return true;
    return false;
  }

  /** Drawn with side legs when wired to another flexible node: spiders, and
   *  Hadamard boxes (H is symmetric, so e.g. the H on a CZ's leg sits in line). */
  isFlexible() { return this.isSpider() || this.type.key === 'hadamard'; }

  /**
   * Port positions. Ports carrying a wire to another spider are "side legs":
   * they sit on the node's edge facing the other spider (angles set by
   * DiagramDocument.refreshLegs()). All other ports follow FlowDirection:
   * inputs spread along the bottom, outputs along the top.
   */
  getInputPort(index) { return this._portPos('in', index); }
  getOutputPort(index) { return this._portPos('out', index); }

  _portPos(dir, index) {
    const side = this._side ? this._side[dir] : null;
    if (side && side.has(index)) {
      const a = side.get(index), r = this.radius + 2;
      return { x: this.x + r * Math.cos(a), y: this.y + r * Math.sin(a) };
    }
    const count = dir === 'in' ? this.inputs : this.outputs;
    const { inputYOffset: iy, outputYOffset: oy } = portOffsets(this.radius);
    if (this.portXOffsets && this.portXOffsets.length === count) {
      return { x: this.x + this.portXOffsets[index], y: this.y + (dir === 'in' ? iy : oy) };
    }
    let rank = index, n = count;
    if (side && side.size) {
      rank = 0;
      for (let i = 0; i < index; i++) if (!side.has(i)) rank++;
      n = count - side.size;
    }
    const spacing = 24;
    const startX = this.x - ((n - 1) * spacing) / 2;
    const { inputYOffset, outputYOffset } = portOffsets(this.radius);
    return { x: startX + rank * spacing, y: this.y + (dir === 'in' ? inputYOffset : outputYOffset) };
  }

  draw(ctx) {
    ctx.save();
    const r = this.radius, s = this.type.shape;
    if (this.selected) {
      ctx.strokeStyle = '#4fc1ff'; ctx.lineWidth = 3; ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(this.x, this.y, r + 6, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = this.type.color; ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = this.thick ? 4 : 2; ctx.setLineDash([]);   // PQP: doubled things are drawn thick

    if (s === 'circle') {
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    } else if (s === 'box') {
      ctx.beginPath(); ctx.rect(this.x-r, this.y-r, r*2, r*2); ctx.fill(); ctx.stroke();
      if (!this.label) { ctx.fillStyle='#fff'; ctx.font='bold 14px sans-serif';
        ctx.textAlign='center'; ctx.textBaseline='middle'; uprightText(ctx,'H',this.x,this.y); }
    } else if (s === 'morphbox') {
      // PQP box: slanted right side, wider at the top (outputs); reflected per orientation
      const w = this._boxWidth(), h = r * 2, sl = Math.min(h * 0.6, w * 0.4);
      this._polygon(ctx, [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2 - sl, h / 2], [-w / 2, h / 2]]);
    } else if (s==='cup') { this._drawCup(ctx,r);
    } else if (s==='cap') { this._drawCap(ctx,r);
    } else if (s==='swap') { this._drawSwap(ctx,r);
    } else if (s === 'triangle-down' || s === 'triangle-up') {
      // PQP state/effect: a triangle with one corner clipped. Canonical state: flat
      // top, clipped top-left; its canonical effect is that reflected top↔bottom.
      // (An effect that is a flipped state uses the state's canonical shape.)
      const canonicalState = (s === 'triangle-down') !== !!(this.flip && this.flip.v);
      const st = [[-r, -r], [r, -r], [0, r], [-r, -r + 0.7 * r]];
      this._polygon(ctx, canonicalState ? st : st.map(([x, y]) => [x, -y]));
    } else if (s==='wire') {
      const a = this.getInputPort(0), b = this.getOutputPort(0);
      ctx.strokeStyle = this.type.color; ctx.lineWidth = this.thick ? 5 : 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    } else if (s === 'dot') {
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#f4f4f4'; ctx.fill();
      ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(this.x, this.y, r + 1.2, 0, Math.PI * 2); ctx.stroke();
    } else if (s === 'ground') {
      // PQP discard: a thick stub from the input, capped by three shrinking bars
      const a = this.getInputPort(0);
      ctx.strokeStyle = '#e0e0e0'; ctx.lineWidth = 5; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(this.x, this.y + 2); ctx.stroke();
      ctx.lineWidth = 2.5;
      [[r, 2], [r * 0.62, -3.5], [r * 0.28, -9]].forEach(([hw, dy]) => {
        ctx.beginPath(); ctx.moveTo(this.x - hw, this.y + dy); ctx.lineTo(this.x + hw, this.y + dy); ctx.stroke();
      });
    } else if (s==='scalar') {
      ctx.beginPath(); ctx.arc(this.x,this.y,r,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(this.x,this.y,r-4,0,Math.PI*2);
      ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.stroke();
    }
    // Label
    if (this.label) {
      ctx.fillStyle='#fff'; ctx.font='12px sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      const ly = s==='triangle-down'?this.y-4 : s==='triangle-up'?this.y+4 : this.y;
      uprightText(ctx, this.label, this.x, ly);
    }
    // Port dots (cups/caps/swaps draw their own)
    if (s!=='cup'&&s!=='cap'&&s!=='swap') {
      ctx.fillStyle='#e0e0e0';
      for(let i=0;i<this.inputs;i++){const p=this.getInputPort(i);
        ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();}
      for(let i=0;i<this.outputs;i++){const p=this.getOutputPort(i);
        ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();}
    }
    ctx.restore();
  }

  /** Fill and stroke a polygon given in node-local coordinates, applying the orientation. */
  _polygon(ctx, pts) {
    const fv = this.flip && this.flip.v ? -1 : 1, fh = this.flip && this.flip.h ? -1 : 1;
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const px = this.x + fh * x, py = this.y + fv * y;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  _roundRect(ctx, x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x+rad,y); ctx.lineTo(x+w-rad,y);
    ctx.quadraticCurveTo(x+w,y,x+w,y+rad); ctx.lineTo(x+w,y+h-rad);
    ctx.quadraticCurveTo(x+w,y+h,x+w-rad,y+h); ctx.lineTo(x+rad,y+h);
    ctx.quadraticCurveTo(x,y+h,x,y+h-rad); ctx.lineTo(x,y+rad);
    ctx.quadraticCurveTo(x,y,x+rad,y); ctx.closePath();
  }

  _drawCup(ctx, r) {
    // Cup (∪): outputs at top in bottom-to-top flow
    const sp=24, lx=this.x-sp/2, rx=this.x+sp/2;
    const outP0 = this.getOutputPort(0), outP1 = this.getOutputPort(1);
    const curveY = this.y + r; // curve bows downward
    ctx.strokeStyle='#b0b0b0'; ctx.lineWidth=this.thick?5:2;
    ctx.beginPath(); ctx.moveTo(outP0.x, outP0.y);
    ctx.bezierCurveTo(outP0.x, curveY, outP1.x, curveY, outP1.x, outP1.y);
    ctx.stroke();
    ctx.fillStyle='#e0e0e0';
    ctx.beginPath(); ctx.arc(outP0.x,outP0.y,3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(outP1.x,outP1.y,3,0,Math.PI*2); ctx.fill();
  }

  _drawCap(ctx, r) {
    // Cap (∩): inputs at bottom in bottom-to-top flow
    const sp=24, lx=this.x-sp/2, rx=this.x+sp/2;
    const inP0 = this.getInputPort(0), inP1 = this.getInputPort(1);
    const curveY = this.y - r; // curve bows upward
    ctx.strokeStyle='#b0b0b0'; ctx.lineWidth=this.thick?5:2;
    ctx.beginPath(); ctx.moveTo(inP0.x, inP0.y);
    ctx.bezierCurveTo(inP0.x, curveY, inP1.x, curveY, inP1.x, inP1.y);
    ctx.stroke();
    ctx.fillStyle='#e0e0e0';
    ctx.beginPath(); ctx.arc(inP0.x,inP0.y,3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(inP1.x,inP1.y,3,0,Math.PI*2); ctx.fill();
  }

  _drawSwap(ctx, r) {
    const sp=24, lx=this.x-sp/2, rx=this.x+sp/2;
    const outP0 = this.getOutputPort(0), inP0 = this.getInputPort(0);
    const top = Math.min(outP0.y, inP0.y), bot = Math.max(outP0.y, inP0.y);
    ctx.strokeStyle='#b0b0b0'; ctx.lineWidth=this.thick?5:2;
    ctx.beginPath(); ctx.moveTo(lx,top); ctx.lineTo(rx,bot); ctx.stroke();
    ctx.strokeStyle='#1e1e1e'; ctx.lineWidth=this.thick?10:6;
    ctx.beginPath(); ctx.moveTo(rx,top); ctx.lineTo(this.x,this.y); ctx.stroke();
    ctx.strokeStyle='#b0b0b0'; ctx.lineWidth=this.thick?5:2;
    ctx.beginPath(); ctx.moveTo(rx,top); ctx.lineTo(lx,bot); ctx.stroke();
    ctx.fillStyle='#e0e0e0';
    ctx.beginPath(); ctx.arc(lx,top,3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(rx,top,3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(lx,bot,3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(rx,bot,3,0,Math.PI*2); ctx.fill();
  }
}
