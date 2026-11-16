/**
 * SplitHandle — Draggable divider between two panels in a split.
 */
export default class SplitHandle {
  /**
   * @param {'horizontal'|'vertical'} direction
   * @param {Function} onDrag - callback(delta) during drag
   */
  constructor(direction, onDrag) {
    this.direction = direction;
    this.onDragCallback = onDrag;

    this.el = document.createElement('div');
    this.el.className = `split-handle ${direction}`;

    this._onMouseDown = this._onMouseDown.bind(this);
    this.el.addEventListener('mousedown', this._onMouseDown);
  }

  _onMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const isH = this.direction === 'horizontal';
    const startPos = isH ? e.clientX : e.clientY;

    document.body.classList.add(isH ? 'resizing' : 'resizing-v');
    this.el.classList.add('active');

    const onMove = (ev) => {
      const currentPos = isH ? ev.clientX : ev.clientY;
      const delta = currentPos - startPos;
      this.onDragCallback(delta, ev);
    };

    const onUp = () => {
      document.body.classList.remove('resizing', 'resizing-v');
      this.el.classList.remove('active');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  destroy() {
    this.el.removeEventListener('mousedown', this._onMouseDown);
    this.el.remove();
  }
}
