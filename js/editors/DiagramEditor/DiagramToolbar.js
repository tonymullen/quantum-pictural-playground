/**
 * DiagramToolbar — Toolbar with tool selection and palette toggle.
 */
import { NODE_TYPES } from './DiagramNode.js';

export const TOOLS = {
  SELECT: 'select',
  WIRE:   'wire',
  DELETE: 'delete',
};

export default class DiagramToolbar {
  constructor(containerEl, callbacks) {
    this.el = document.createElement('div');
    this.el.className = 'diagram-toolbar';
    this.callbacks = callbacks;
    this.activeTool = TOOLS.SELECT;

    // Tool group
    const toolGroup = this._group();
    this._addToolBtn(toolGroup, '⇱', 'Select', TOOLS.SELECT);
    this._addToolBtn(toolGroup, '⟶', 'Wire', TOOLS.WIRE);
    this._addToolBtn(toolGroup, '✕', 'Delete', TOOLS.DELETE);
    this.el.appendChild(toolGroup);

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
    deleteBtn.title = 'Delete Selected';
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

  _addToolBtn(group, icon, label, tool) {
    const btn = document.createElement('button');
    btn.className = 'diagram-tool-btn' + (tool === this.activeTool ? ' active' : '');
    btn.title = label;
    btn.textContent = icon;
    btn.addEventListener('click', () => {
      this.setActiveTool(tool);
      this.callbacks.setTool(tool);
    });
    btn.dataset.tool = tool;
    group.appendChild(btn);
  }

  setActiveTool(tool) {
    this.activeTool = tool;
    for (const btn of this.el.querySelectorAll('[data-tool]')) {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    }
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
    if (s === 'scalar')
      return `<span style="${base}width:10px;height:10px;border-radius:50%;background:${c};border:2px solid #fff;"></span>`;
    return `<span style="${base}width:14px;height:14px;background:${c};"></span>`;
  }
}
