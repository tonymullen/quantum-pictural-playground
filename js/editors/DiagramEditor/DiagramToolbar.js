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
    if (s === 'morphbox')
      return `<span style="${base}width:18px;height:12px;border-radius:3px;background:${c};"></span>`;
    if (s === 'cup')
      return `<span style="${base}width:16px;height:10px;border-bottom:2px solid ${c};border-left:2px solid ${c};border-right:2px solid ${c};border-radius:0 0 8px 8px;"></span>`;
    if (s === 'cap')
      return `<span style="${base}width:16px;height:10px;border-top:2px solid ${c};border-left:2px solid ${c};border-right:2px solid ${c};border-radius:8px 8px 0 0;"></span>`;
    if (s === 'swap')
      return `<span style="${base}font-size:16px;line-height:1;color:${c};">╳</span>`;
    if (s === 'triangle-down')
      return `<span style="${base}width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:12px solid ${c};"></span>`;
    if (s === 'triangle-up')
      return `<span style="${base}width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:12px solid ${c};"></span>`;
    if (s === 'wire')
      return `<span style="${base}width:2px;height:16px;background:${c};"></span>`;
    if (s === 'scalar')
      return `<span style="${base}width:10px;height:10px;border-radius:50%;background:${c};border:2px solid #fff;"></span>`;
    return `<span style="${base}width:14px;height:14px;background:${c};"></span>`;
  }
}
