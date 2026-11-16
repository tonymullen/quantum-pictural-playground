/**
 * DiagramEditor — Full editor component for quantum pictorial diagrams.
 * Composes DiagramToolbar + DiagramCanvas + palette sidebar.
 */
import DiagramCanvas from './DiagramCanvas.js';
import DiagramToolbar, { TOOLS } from './DiagramToolbar.js';
import { NODE_TYPES } from './DiagramNode.js';

export default class DiagramEditor {
  static get typeName() { return 'Diagram Editor'; }

  constructor(containerEl) {
    this.container = containerEl;
    this.el = document.createElement('div');
    this.el.className = 'diagram-editor';
    this.container.appendChild(this.el);

    // Toolbar
    this.toolbar = new DiagramToolbar(this.el, {
      setTool: (t) => this.canvas.setTool(t),
      addNode: (t) => this.canvas.addNode(t),
      togglePalette: () => this._togglePalette(),
      clearAll: () => this.canvas.clearAll(),
    });

    // Canvas area wrapper
    this.canvasWrap = document.createElement('div');
    this.canvasWrap.style.flex = '1';
    this.canvasWrap.style.minHeight = '0';
    this.canvasWrap.style.position = 'relative';
    this.canvasWrap.style.overflow = 'hidden';
    this.el.appendChild(this.canvasWrap);

    // Palette sidebar
    this._buildPalette();

    // Canvas
    this.canvas = new DiagramCanvas(this.canvasWrap);
  }

  _buildPalette() {
    this.paletteEl = document.createElement('div');
    this.paletteEl.className = 'diagram-palette';

    const h4 = document.createElement('h4');
    h4.textContent = 'Components';
    this.paletteEl.appendChild(h4);

    for (const t of Object.values(NODE_TYPES)) {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.draggable = true;

      const swatch = document.createElement('div');
      swatch.className = 'swatch' + (t.shape === 'box' ? ' box' : t.shape === 'diamond' ? ' diamond' : '');
      swatch.style.borderColor = t.color;
      swatch.style.background = t.color;
      item.appendChild(swatch);

      const label = document.createElement('span');
      label.textContent = t.label;
      item.appendChild(label);

      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', t.key);
      });
      item.addEventListener('click', () => {
        this.canvas.addNode(t);
      });

      this.paletteEl.appendChild(item);
    }

    // Handle drops onto canvas
    this.canvasWrap.addEventListener('dragover', e => { e.preventDefault(); });
    this.canvasWrap.addEventListener('drop', e => {
      e.preventDefault();
      const key = e.dataTransfer.getData('text/plain');
      const type = Object.values(NODE_TYPES).find(t => t.key === key);
      if (!type) return;
      const rect = this.canvas.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const wc = this.canvas._screenToWorld(sx, sy);
      this.canvas.addNode(type, wc.x, wc.y);
    });

    this.canvasWrap.appendChild(this.paletteEl);
  }

  _togglePalette() {
    this.paletteEl.classList.toggle('open');
  }

  onResize() {
    if (this.canvas) this.canvas.resize();
  }

  destroy() {
    this.el.remove();
  }
}
