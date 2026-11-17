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
 */

import { portOffsets } from '../../core/FlowDirection.js';

let _nodeId = 0;

export const NODE_TYPES = {
  Z_SPIDER:  { key: 'z-spider',  label: 'Z Spider',  color: '#6a9955', shape: 'circle',   defIn: 1, defOut: 1 },
  X_SPIDER:  { key: 'x-spider',  label: 'X Spider',  color: '#ce4a4a', shape: 'circle',   defIn: 1, defOut: 1 },
  HADAMARD:  { key: 'hadamard',  label: 'Hadamard',  color: '#cca700', shape: 'box',      defIn: 1, defOut: 1 },
  MORPHISM:  { key: 'morphism',  label: 'Morphism',  color: '#5b7eaa', shape: 'morphbox', defIn: 1, defOut: 1 },
  CUP:       { key: 'cup',       label: 'Cup (η)',    color: '#b0b0b0', shape: 'cup',      defIn: 0, defOut: 2 },
  CAP:       { key: 'cap',       label: 'Cap (ε)',    color: '#b0b0b0', shape: 'cap',      defIn: 2, defOut: 0 },
  SWAP:      { key: 'swap',      label: 'Swap (σ)',   color: '#b0b0b0', shape: 'swap',     defIn: 2, defOut: 2 },
  STATE:     { key: 'state',     label: 'State (ψ)',  color: '#4fc1ff', shape: 'triangle-down', defIn: 0, defOut: 1 },
  EFFECT:    { key: 'effect',    label: 'Effect',     color: '#c586c0', shape: 'triangle-up',   defIn: 1, defOut: 0 },
  SCALAR:    { key: 'scalar',    label: 'Scalar',     color: '#c586c0', shape: 'scalar',   defIn: 0, defOut: 0 },
};

export default class DiagramNode {
  constructor(type, x, y) {
    this.id = `node-${_nodeId++}`;
    this.type = type;
    this.x = x;
    this.y = y;
    this.label = '';           // text label (phase for spiders, name for morphisms/states)
    this.inputs = type.defIn;
    this.outputs = type.defOut;
    this.selected = false;
    this.radius = this._defaultRadius();
    // Sync-system fields (optional, null by default)
    this.phase = null;         // Phase instance: { num, den } rational π-multiple
    this.tensor = null;        // Tensor instance: concrete complex matrix
    this.symbolicForm = null;  // string: symbolic expression for the IR
    this.provenance = null;    // string: opaque cross-highlighting tag
  }

  _defaultRadius() {
    const s = this.type.shape;
    if (s === 'box' || s === 'morphbox') return 20;
    if (s === 'cup' || s === 'cap') return 24;
    if (s === 'swap') return 20;
    if (s === 'triangle-down' || s === 'triangle-up') return 18;
    if (s === 'scalar') return 14;
    return 20; // spiders
  }

  containsPoint(px, py) {
    const r = this.radius + 4; // small tolerance
    const dx = Math.abs(px - this.x), dy = Math.abs(py - this.y);
    const s = this.type.shape;
    if (s === 'box' || s === 'morphbox') return dx <= r && dy <= r;
    if (s === 'cup' || s === 'cap') return dx <= r + 6 && dy <= r;
    if (s === 'swap') return dx <= r && dy <= r;
    if (s === 'triangle-down' || s === 'triangle-up') return dx <= r && dy <= r;
    return dx * dx + dy * dy <= r * r; // circles & scalar
  }

  /** Port positions follow FlowDirection convention. */
  getInputPort(index) {
    const spacing = 24;
    const totalW = (this.inputs - 1) * spacing;
    const startX = this.x - totalW / 2;
    const { inputYOffset } = portOffsets(this.radius);
    return { x: startX + index * spacing, y: this.y + inputYOffset };
  }

  getOutputPort(index) {
    const spacing = 24;
    const totalW = (this.outputs - 1) * spacing;
    const startX = this.x - totalW / 2;
    const { outputYOffset } = portOffsets(this.radius);
    return { x: startX + index * spacing, y: this.y + outputYOffset };
  }

  draw(ctx) {
    ctx.save();
    const r = this.radius, s = this.type.shape;
    if (this.selected) {
      ctx.strokeStyle = '#4fc1ff'; ctx.lineWidth = 3; ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(this.x, this.y, r + 6, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = this.type.color; ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 2; ctx.setLineDash([]);

    if (s === 'circle') {
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    } else if (s === 'box') {
      ctx.beginPath(); ctx.rect(this.x-r, this.y-r, r*2, r*2); ctx.fill(); ctx.stroke();
      if (!this.label) { ctx.fillStyle='#fff'; ctx.font='bold 14px sans-serif';
        ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('H',this.x,this.y); }
    } else if (s === 'morphbox') {
      const w=Math.max(r*2,36), h=r*2;
      this._roundRect(ctx,this.x-w/2,this.y-h/2,w,h,5); ctx.fill(); ctx.stroke();
    } else if (s==='cup') { this._drawCup(ctx,r);
    } else if (s==='cap') { this._drawCap(ctx,r);
    } else if (s==='swap') { this._drawSwap(ctx,r);
    } else if (s==='triangle-down') {
      ctx.beginPath(); ctx.moveTo(this.x-r,this.y-r); ctx.lineTo(this.x+r,this.y-r);
      ctx.lineTo(this.x,this.y+r); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (s==='triangle-up') {
      ctx.beginPath(); ctx.moveTo(this.x-r,this.y+r); ctx.lineTo(this.x+r,this.y+r);
      ctx.lineTo(this.x,this.y-r); ctx.closePath(); ctx.fill(); ctx.stroke();
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
      ctx.fillText(this.label, this.x, ly);
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
    ctx.strokeStyle='#b0b0b0'; ctx.lineWidth=2;
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
    ctx.strokeStyle='#b0b0b0'; ctx.lineWidth=2;
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
    ctx.strokeStyle='#b0b0b0'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(lx,top); ctx.lineTo(rx,bot); ctx.stroke();
    ctx.strokeStyle='#1e1e1e'; ctx.lineWidth=6;
    ctx.beginPath(); ctx.moveTo(rx,top); ctx.lineTo(this.x,this.y); ctx.stroke();
    ctx.strokeStyle='#b0b0b0'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(rx,top); ctx.lineTo(lx,bot); ctx.stroke();
    ctx.fillStyle='#e0e0e0';
    ctx.beginPath(); ctx.arc(lx,top,3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(rx,top,3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(lx,bot,3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(rx,bot,3,0,Math.PI*2); ctx.fill();
  }
}
