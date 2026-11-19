/**
 * DiagramToolbar — Node quick-add buttons, palette toggle, delete-selected.
 * There are no tool modes: wiring is done by dragging port handles.
 */
import { NODE_TYPES } from './DiagramNode.js';

export default class DiagramToolbar {
  constructor(containerEl, callbacks) {
    this.el = document.createElement('div');
    this.el.className = 'diagram-toolbar';
    this.callbacks = callbacks;

    // Node group — quick-add buttons with shape-specific icons
    const nodeGroup = this._group();
    for (const t of Object.values(NODE_TYPES)) {
      const btn = document.createElement('button');
      btn.className = 'diagram-tool-btn';
      btn.title = `Add ${t.label}`;
      btn.innerHTML = this._swatchHTML(t);
      btn.addEventListener('click', () => callbacks.addNode(t));
      nodeGroup.appendChild(btn);
    }
    this.el.appendChild(nodeGroup);

    // Utility group
    const utilGroup = this._group();
    const paletteBtn = document.createElement('button');
    paletteBtn.className = 'diagram-tool-btn';
    paletteBtn.title = 'Toggle Palette';
    paletteBtn.textContent = '☰';
    paletteBtn.addEventListener('click', () => callbacks.togglePalette());
    utilGroup.appendChild(paletteBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'diagram-tool-btn';
    deleteBtn.title = 'Delete selected (Del)';
    deleteBtn.textContent = '🗑';
    deleteBtn.addEventListener('click', () => callbacks.deleteSelected());
    utilGroup.appendChild(deleteBtn);

    this.el.appendChild(utilGroup);
    containerEl.appendChild(this.el);
  }

  _group() {
    const g = document.createElement('div');
    g.className = 'tool-group';
    return g;
  }

  _swatchHTML(t) {
    const c = t.color, s = t.shape;
    const base = 'display:inline-block;';
    if (s === 'circle')
      return `<span style="${base}width:14px;height:14px;border-radius:50%;background:${c};"></span>`;
    if (s === 'box')
      return `<span style="${base}width:14px;height:14px;border-radius:2px;background:${c};"></span>`;
    if (s === 'morphbox')   // PQP box: slanted right side
      return `<span style="${base}width:20px;height:12px;background:${c};clip-path:polygon(0 0,100% 0,68% 100%,0 100%);"></span>`;
    if (s === 'cup')
      return `<span style="${base}width:16px;height:10px;border-bottom:2px solid ${c};border-left:2px solid ${c};border-right:2px solid ${c};border-radius:0 0 8px 8px;"></span>`;
    if (s === 'cap')
      return `<span style="${base}width:16px;height:10px;border-top:2px solid ${c};border-left:2px solid ${c};border-right:2px solid ${c};border-radius:8px 8px 0 0;"></span>`;
    if (s === 'swap')
      return `<span style="${base}font-size:16px;line-height:1;color:${c};">╳</span>`;
    if (s === 'triangle-down')   // PQP state: clipped top-left corner
      return `<span style="${base}width:14px;height:13px;background:${c};clip-path:polygon(0 0,100% 0,50% 100%,0 35%);"></span>`;
    if (s === 'triangle-up')     // PQP effect: clipped bottom-left corner
      return `<span style="${base}width:14px;height:13px;background:${c};clip-path:polygon(0 100%,100% 100%,50% 0,0 65%);"></span>`;
    if (s === 'dot')
      return `<span style="${base}width:10px;height:10px;border-radius:50%;background:#f4f4f4;border:1.5px solid #1e1e1e;box-shadow:0 0 0 1px #e0e0e0;"></span>`;
    if (s === 'ground')
      return `<span style="${base}font-size:15px;line-height:1;color:${c};">⏚</span>`;
    if (s === 'wire')
      return `<span style="${base}width:2px;height:16px;background:${c};"></span>`;
    if (s === 'scalar')
      return `<span style="${base}width:10px;height:10px;border-radius:50%;background:${c};border:2px solid #fff;"></span>`;
    return `<span style="${base}width:14px;height:14px;background:${c};"></span>`;
  }
}
