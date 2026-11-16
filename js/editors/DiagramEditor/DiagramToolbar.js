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

    // Node group — quick-add buttons
    const nodeGroup = this._group();
    for (const t of Object.values(NODE_TYPES)) {
      const btn = document.createElement('button');
      btn.className = 'diagram-tool-btn';
      btn.title = `Add ${t.label}`;
      btn.innerHTML = `<span style="display:inline-block;width:14px;height:14px;border-radius:${
        t.shape === 'box' ? '3px' : t.shape === 'diamond' ? '2px' : '50%'
      };background:${t.color};${t.shape === 'diamond' ? 'transform:rotate(45deg);width:10px;height:10px;' : ''}"></span>`;
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

    const clearBtn = document.createElement('button');
    clearBtn.className = 'diagram-tool-btn';
    clearBtn.title = 'Clear All';
    clearBtn.textContent = '🗑';
    clearBtn.addEventListener('click', () => callbacks.clearAll());
    utilGroup.appendChild(clearBtn);

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
}
