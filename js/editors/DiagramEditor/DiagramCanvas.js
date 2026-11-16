/**
 * DiagramCanvas — Interactive HTML5 Canvas for quantum diagrams.
 */
import DiagramNode, { NODE_TYPES } from './DiagramNode.js';
import DiagramWire from './DiagramWire.js';
import { TOOLS } from './DiagramToolbar.js';

export default class DiagramCanvas {
  constructor(containerEl) {
    this.container = containerEl;
    this.nodes = new Map();
    this.wires = [];
    this.activeTool = TOOLS.SELECT;
    this.panX = 0; this.panY = 0; this.zoom = 1;
    this.dragging = null;
    this.wiring = null;
    this.selectionRect = null;
    this.wrapEl = document.createElement('div');
    this.wrapEl.className = 'diagram-canvas-wrap';
    this.canvas = document.createElement('canvas');
    this.wrapEl.appendChild(this.canvas);
    this.container.appendChild(this.wrapEl);
    this.ctx = this.canvas.getContext('2d');
    this._bindEvents();
    // Defer initial resize so DOM has settled and dimensions are non-zero
    requestAnimationFrame(() => this.resize());
  }

  setTool(tool) { this.activeTool = tool; }

  addNode(type, x, y) {
    if (x === undefined) {
      const r = this.canvas.getBoundingClientRect();
      x = (r.width / 2 - this.panX) / this.zoom;
      y = (r.height / 2 - this.panY) / this.zoom;
    }
    const node = new DiagramNode(type, x, y);
    this.nodes.set(node.id, node);
    this.draw();
    return node;
  }

  clearAll() { this.nodes.clear(); this.wires = []; this.draw(); }

  deleteSelected() {
    const ids = new Set();
    for (const [id, n] of this.nodes) { if (n.selected) ids.add(id); }
    for (const id of ids) this.nodes.delete(id);
    this.wires = this.wires.filter(w => !ids.has(w.fromNodeId) && !ids.has(w.toNodeId) && !w.selected);
    this.draw();
  }

  resize() {
    const r = this.wrapEl.getBoundingClientRect();
    // Guard: skip if container has no dimensions yet (not in DOM)
    if (r.width === 0 || r.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    // Guard: skip drawing on zero-size canvas
    if (w === 0 || h === 0) return;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);
    this._drawGrid(ctx, w, h);
    for (const wire of this.wires) wire.draw(ctx, this.nodes);
    if (this.wiring) this._drawWiringPreview(ctx);
    for (const node of this.nodes.values()) node.draw(ctx);
    ctx.restore();
    if (this.selectionRect) this._drawSelRect();
  }

  _drawWiringPreview(ctx) {
    const fn = this.nodes.get(this.wiring.fromNodeId);
    if (!fn) return;
    const p = fn.getOutputPort(this.wiring.fromPort);
    const mx = (this.wiring.mx - this.panX) / this.zoom;
    const my = (this.wiring.my - this.panY) / this.zoom;
    ctx.save(); ctx.strokeStyle='#4fc1ff'; ctx.lineWidth=2; ctx.setLineDash([5,4]);
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    const dy = Math.abs(my - p.y) * 0.5;
    ctx.bezierCurveTo(p.x, p.y+dy, mx, my-dy, mx, my);
    ctx.stroke(); ctx.restore();
  }

  _drawSelRect() {
    const sr = this.selectionRect, ctx = this.ctx;
    ctx.save(); ctx.strokeStyle='#4fc1ff'; ctx.lineWidth=1; ctx.setLineDash([4,3]);
    ctx.fillStyle='rgba(79,193,255,0.08)';
    const rx=Math.min(sr.x1,sr.x2), ry=Math.min(sr.y1,sr.y2);
    const rw=Math.abs(sr.x2-sr.x1), rh=Math.abs(sr.y2-sr.y1);
    ctx.fillRect(rx,ry,rw,rh); ctx.strokeRect(rx,ry,rw,rh); ctx.restore();
  }

  _drawGrid(ctx, sw, sh) {
    const step=30; ctx.save();
    ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=1/this.zoom;
    const l=-this.panX/this.zoom, t=-this.panY/this.zoom;
    const r=l+sw/this.zoom, b=t+sh/this.zoom;
    const sx=Math.floor(l/step)*step, sy=Math.floor(t/step)*step;
    for(let x=sx;x<r;x+=step){ctx.beginPath();ctx.moveTo(x,t);ctx.lineTo(x,b);ctx.stroke();}
    for(let y=sy;y<b;y+=step){ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(r,y);ctx.stroke();}
    ctx.restore();
  }

  _screenToWorld(sx,sy){return{x:(sx-this.panX)/this.zoom,y:(sy-this.panY)/this.zoom};}

  _nodeAt(wx,wy) {
    const arr=Array.from(this.nodes.values()).reverse();
    for(const n of arr) if(n.containsPoint(wx,wy)) return n;
    return null;
  }

  _portAt(wx,wy,type) {
    for(const node of this.nodes.values()){
      const cnt=type==='output'?node.outputs:node.inputs;
      for(let i=0;i<cnt;i++){
        const p=type==='output'?node.getOutputPort(i):node.getInputPort(i);
        if((wx-p.x)**2+(wy-p.y)**2<64) return{nodeId:node.id,port:i};
      }
    }
    return null;
  }

  _deselectAll(){
    for(const n of this.nodes.values()) n.selected=false;
    for(const w of this.wires) w.selected=false;
  }

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('mousedown', e => this._onMouseDown(e));
    c.addEventListener('mousemove', e => this._onMouseMove(e));
    c.addEventListener('mouseup', e => this._onMouseUp(e));
    c.addEventListener('wheel', e => this._onWheel(e), {passive:false});
    c.addEventListener('dblclick', e => this._onDblClick(e));
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.tabIndex = 0;
    c.addEventListener('keydown', e => this._onKeyDown(e));
  }

  _rect() { return this.canvas.getBoundingClientRect(); }

  _onMouseDown(e) {
    const rect = this._rect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const w = this._screenToWorld(sx, sy);

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle-click or Alt+click = pan
      this._startPan(e); return;
    }

    if (this.activeTool === TOOLS.WIRE) {
      const port = this._portAt(w.x, w.y, 'output');
      if (port) { this.wiring = { ...port, fromNodeId:port.nodeId, fromPort:port.port, mx:sx, my:sy }; }
      return;
    }

    if (this.activeTool === TOOLS.DELETE) {
      const node = this._nodeAt(w.x, w.y);
      if (node) { this.nodes.delete(node.id); this.wires = this.wires.filter(wr => wr.fromNodeId!==node.id && wr.toNodeId!==node.id); }
      else { for(const wr of this.wires){ if(wr.hitTest(sx,sy,this.nodes)){this.wires=this.wires.filter(x=>x!==wr);break;} } }
      this.draw(); return;
    }

    // SELECT tool
    const node = this._nodeAt(w.x, w.y);
    if (node) {
      if (!e.shiftKey) { if(!node.selected) this._deselectAll(); }
      node.selected = true;
      this.dragging = { node, offX: w.x-node.x, offY: w.y-node.y };
      this.draw(); return;
    }
    // Wire hit?
    for(const wr of this.wires){if(wr.hitTest(w.x,w.y,this.nodes)){if(!e.shiftKey)this._deselectAll();wr.selected=true;this.draw();return;}}
    if (!e.shiftKey) this._deselectAll();
    this.selectionRect = {x1:sx,y1:sy,x2:sx,y2:sy};
    this.draw();
  }

  _onMouseMove(e) {
    const rect = this._rect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (this.dragging) {
      const w = this._screenToWorld(sx, sy);
      this.dragging.node.x = w.x - this.dragging.offX;
      this.dragging.node.y = w.y - this.dragging.offY;
      this.draw();
    } else if (this.wiring) {
      this.wiring.mx = sx; this.wiring.my = sy; this.draw();
    } else if (this.selectionRect) {
      this.selectionRect.x2 = sx; this.selectionRect.y2 = sy; this.draw();
    }
  }

  _onMouseUp(e) {
    if (this.wiring) {
      const rect = this._rect();
      const sx=e.clientX-rect.left, sy=e.clientY-rect.top;
      const w = this._screenToWorld(sx,sy);
      const port = this._portAt(w.x,w.y,'input');
      if (port && port.nodeId !== this.wiring.fromNodeId) {
        this.wires.push(new DiagramWire(this.wiring.fromNodeId,this.wiring.fromPort,port.nodeId,port.port));
      }
      this.wiring = null; this.draw();
    }
    if (this.selectionRect) {
      const sr = this.selectionRect;
      const x1=Math.min(sr.x1,sr.x2),y1=Math.min(sr.y1,sr.y2);
      const x2=Math.max(sr.x1,sr.x2),y2=Math.max(sr.y1,sr.y2);
      for (const n of this.nodes.values()){
        const sp = {x:n.x*this.zoom+this.panX, y:n.y*this.zoom+this.panY};
        if(sp.x>=x1&&sp.x<=x2&&sp.y>=y1&&sp.y<=y2) n.selected=true;
      }
      this.selectionRect=null; this.draw();
    }
    this.dragging = null;
  }

  _onWheel(e) {
    e.preventDefault();
    const rect=this._rect();
    const sx=e.clientX-rect.left, sy=e.clientY-rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const nz = Math.max(0.1, Math.min(5, this.zoom*factor));
    this.panX = sx - (sx-this.panX)*(nz/this.zoom);
    this.panY = sy - (sy-this.panY)*(nz/this.zoom);
    this.zoom = nz;
    this.draw();
  }

  _startPan(e) {
    const sx=e.clientX, sy=e.clientY;
    const opx=this.panX, opy=this.panY;
    const mv = ev => { this.panX=opx+(ev.clientX-sx); this.panY=opy+(ev.clientY-sy); this.draw(); };
    const up = () => { document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); };
    document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
  }

  _onDblClick(e) {
    const rect=this._rect();
    const w=this._screenToWorld(e.clientX-rect.left, e.clientY-rect.top);
    const node=this._nodeAt(w.x,w.y);
    if(node){
      const phase=prompt('Enter phase (e.g. π/2):',node.phase);
      if(phase!==null){node.phase=phase; this.draw();}
    }
  }

  _onKeyDown(e) {
    if(e.key==='Delete'||e.key==='Backspace'){this.deleteSelected();}
    if(e.key==='a'&&(e.ctrlKey||e.metaKey)){e.preventDefault();for(const n of this.nodes.values())n.selected=true;this.draw();}
  }

  destroy() {
    this.wrapEl.remove();
  }
}
