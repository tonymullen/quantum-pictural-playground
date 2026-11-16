/**
 * DiagramCanvas — Interactive HTML5 Canvas for quantum diagrams.
 */
import DiagramNode, { NODE_TYPES } from './DiagramNode.js';
import DiagramWire from './DiagramWire.js';
import { TOOLS } from './DiagramToolbar.js';

export default class DiagramCanvas {
  /**
   * @param {HTMLElement} containerEl
   * @param {import('./DiagramDocument.js').default} doc — shared document
   */
  constructor(containerEl, doc) {
    this.container = containerEl;
    this.doc = doc;
    this.activeTool = TOOLS.SELECT;
    this.panX = 0; this.panY = 0; this.zoom = 1;
    this.dragging = null;
    this.wiring = null;
    this.selectionRect = null;
    // Convenience aliases (always point at the doc's data)
    this._onDocChange = () => this.draw();
    this.doc.onChange(this._onDocChange);
    this.wrapEl = document.createElement('div');
    this.wrapEl.className = 'diagram-canvas-wrap';
    this.canvas = document.createElement('canvas');
    this.wrapEl.appendChild(this.canvas);
    this.container.appendChild(this.wrapEl);
    this.ctx = this.canvas.getContext('2d');
    this._bindEvents();
    // Robust deferred resize: retry until the container has real dimensions
    this._retryResize(0);
  }

  _retryResize(attempt) {
    requestAnimationFrame(() => {
      const r = this.wrapEl.getBoundingClientRect();
      if ((r.width === 0 || r.height === 0) && attempt < 10) {
        // Container not laid out yet — retry
        this._retryResize(attempt + 1);
        return;
      }
      console.log(`[DiagramCanvas] resize attempt ${attempt}: ${r.width}x${r.height}`);
      this.resize();
    });
  }

  /** Proxy getters — all data lives on the shared document. */
  get nodes() { return this.doc.nodes; }
  get wires() { return this.doc.wires; }
  set wires(v) { this.doc.wires = v; }

  /** Switch to a different document (called by the editor selector). */
  setDocument(doc) {
    this.doc.offChange(this._onDocChange);
    this.doc = doc;
    this.doc.onChange(this._onDocChange);
    this.draw();
  }

  setTool(tool) { this.activeTool = tool; }

  addNode(type, x, y) {
    if (x === undefined) {
      const r = this.canvas.getBoundingClientRect();
      x = (r.width / 2 - this.panX) / this.zoom;
      y = (r.height / 2 - this.panY) / this.zoom;
    }
    this.pushUndo();
    const node = new DiagramNode(type, x, y);
    this.nodes.set(node.id, node);
    this._commit();
    return node;
  }

  clearAll() { this.pushUndo(); this.nodes.clear(); this.wires = []; this._commit(); }

  deleteSelected() {
    const ids = new Set();
    for (const [id, n] of this.nodes) { if (n.selected) ids.add(id); }
    const hasSelectedWires = this.wires.some(w => w.selected);
    if (ids.size === 0 && !hasSelectedWires) return; // nothing to delete
    this.pushUndo();
    for (const id of ids) this.nodes.delete(id);
    this.wires = this.wires.filter(w => !ids.has(w.fromNodeId) && !ids.has(w.toNodeId) && !w.selected);
    this._commit();
  }

  /* ---- Undo / Redo (delegated to document) ---- */
  pushUndo() { this.doc.pushUndo(); }
  undo() { if (!this.doc.undo()) this._showToast('Nothing to undo', 'warn'); }
  redo() { if (!this.doc.redo()) this._showToast('Nothing to redo', 'warn'); }

  /** Notify other viewers that data changed. */
  _commit() { this.doc.commit(); }

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
    ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.lineWidth=1/this.zoom;
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

  /**
   * Find the nearest output port on a node, or any output port hit globally.
   * Falls back to output port 0 of the clicked node if no port dot is near.
   */
  _findOutputPort(wx, wy) {
    // First try exact port hit across all nodes
    const exact = this._portAt(wx, wy, 'output');
    if (exact) return exact;
    // Fall back: if cursor is on a node body, pick nearest output port
    const node = this._nodeAt(wx, wy);
    if (node && node.outputs > 0) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < node.outputs; i++) {
        const p = node.getOutputPort(i);
        const d = (wx-p.x)**2 + (wy-p.y)**2;
        if (d < bestD) { bestD = d; best = i; }
      }
      return { nodeId: node.id, port: best };
    }
    return null;
  }

  /**
   * Find the nearest input port on a node, or any input port hit globally.
   * Falls back to nearest input port of the clicked node if no port dot is near.
   */
  _findInputPort(wx, wy) {
    const exact = this._portAt(wx, wy, 'input');
    if (exact) return exact;
    const node = this._nodeAt(wx, wy);
    if (node && node.inputs > 0) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < node.inputs; i++) {
        const p = node.getInputPort(i);
        const d = (wx-p.x)**2 + (wy-p.y)**2;
        if (d < bestD) { bestD = d; best = i; }
      }
      return { nodeId: node.id, port: best };
    }
    return null;
  }

  /** Show a brief toast message overlaid on the canvas */
  _showToast(msg, type = 'error') {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `
      position:absolute; bottom:12px; left:50%; transform:translateX(-50%);
      padding:6px 14px; border-radius:4px; font-size:12px; z-index:100;
      pointer-events:none; opacity:0; transition:opacity 0.2s;
      color:#fff; font-family:var(--font-sans);
      background:${type === 'error' ? '#c33' : type === 'warn' ? '#886600' : '#2a7ab5'};
    `;
    this.wrapEl.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 1800);
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
      const port = this._findOutputPort(w.x, w.y);
      if (port) {
        this.wiring = { fromNodeId: port.nodeId, fromPort: port.port, mx: sx, my: sy };
      } else {
        // Clicked on a node with no outputs, or empty space
        const node = this._nodeAt(w.x, w.y);
        if (node && node.outputs === 0) {
          this._showToast(`${node.type.label} has no output ports`, 'warn');
        } else if (!node) {
          this._showToast('Click on a node to start a wire', 'warn');
        }
      }
      return;
    }

    if (this.activeTool === TOOLS.DELETE) {
      const node = this._nodeAt(w.x, w.y);
      if (node) { this.pushUndo(); this.nodes.delete(node.id); this.wires = this.wires.filter(wr => wr.fromNodeId!==node.id && wr.toNodeId!==node.id); this._commit(); }
      else { for(const wr of this.wires){ if(wr.hitTest(sx,sy,this.nodes)){this.pushUndo();this.wires=this.wires.filter(x=>x!==wr);this._commit();break;} } }
      this.draw(); return;
    }

    // SELECT tool
    const node = this._nodeAt(w.x, w.y);
    if (node) {
      if (!e.shiftKey) { if(!node.selected) this._deselectAll(); }
      node.selected = true;
      this.pushUndo(); // snapshot before drag-move
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
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const w = this._screenToWorld(sx, sy);
      const port = this._findInputPort(w.x, w.y);

      if (!port) {
        // Released over empty space or a node with no inputs
        const node = this._nodeAt(w.x, w.y);
        if (node && node.inputs === 0) {
          this._showToast(`${node.type.label} has no input ports`, 'warn');
        } else {
          this._showToast('Drop on a node to complete wire', 'warn');
        }
      } else if (port.nodeId === this.wiring.fromNodeId) {
        this._showToast('Cannot wire a node to itself', 'error');
      } else {
        // Check for duplicate wire
        const dup = this.wires.some(wr =>
          wr.fromNodeId === this.wiring.fromNodeId &&
          wr.fromPort === this.wiring.fromPort &&
          wr.toNodeId === port.nodeId &&
          wr.toPort === port.port
        );
        if (dup) {
          this._showToast('Wire already exists', 'warn');
        } else {
          this.pushUndo();
          this.wires.push(new DiagramWire(
            this.wiring.fromNodeId, this.wiring.fromPort,
            port.nodeId, port.port
          ));
          this._commit();
        }
      }
      this.wiring = null;
      this.draw();
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
    if (this.dragging) this._commit(); // node was moved — notify viewers
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
      const val=prompt('Enter label (phase, name, etc.):',node.label);
      if(val!==null){this.pushUndo(); node.label=val; this._commit();}
    }
  }

  _onKeyDown(e) {
    if(e.key==='Delete'||e.key==='Backspace'){this.deleteSelected();}
    if(e.key==='a'&&(e.ctrlKey||e.metaKey)){e.preventDefault();for(const n of this.nodes.values())n.selected=true;this.draw();}
    if(e.key==='z'&&(e.ctrlKey||e.metaKey)&&!e.shiftKey){e.preventDefault();this.undo();}
    if((e.key==='z'&&(e.ctrlKey||e.metaKey)&&e.shiftKey)||(e.key==='y'&&(e.ctrlKey||e.metaKey))){e.preventDefault();this.redo();}
  }

  destroy() {
    this.doc.offChange(this._onDocChange);
    this.wrapEl.remove();
  }
}
