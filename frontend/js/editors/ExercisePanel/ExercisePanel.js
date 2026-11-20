/**
 * ExercisePanel — the textbook exercise this workbook is a starter for.
 *
 *   ┌ Exercise 3.4 · ★★ Practice ─────────────────────────────┐
 *   │ Up to a number                                           │
 *   │ statement …                                              │
 *   │ You're done when: …                                      │
 *   │ Proof “…”: ✓ Solved / what is still missing              │
 *   │ 📖 Read it in the textbook — the hints are there          │
 *   └──────────────────────────────────────────────────────────┘
 *
 * The exercise comes with the workbook (Session.current.exercise) and stays
 * with any copy saved from it. Proofs with a goal (ProofDocument.goal) show
 * their progress live; solving one is logged (Activity).
 */
import Session from '../../workbooks/WorkbookSession.js';
import DocumentStore from '../DocumentStore.js';
import Activity from '../../core/Activity.js';
import { renderMiniMarkup } from '../../core/MiniMarkup.js';

export const LEVELS = { 1: '★ Warm-up', 2: '★★ Practice', 3: '★★★ Challenge' };

export default class ExercisePanel {
  static get typeName() { return 'Exercise'; }

  constructor(containerEl) {
    this.container = containerEl;
    this.el = document.createElement('div');
    this.el.className = 'exercise-panel';
    this.container.appendChild(this.el);
    this._onChange = () => this._schedule();
    Session.onChange(this._onChange);
    DocumentStore.onAnyChange(this._onChange);
    DocumentStore.onListChange(this._onChange);
    this.render();
  }

  getState() { return {}; }

  _schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this.render(); });
  }

  render() {
    const ex = Session.current.exercise;
    const el = this.el;
    el.innerHTML = '';
    if (!ex) {
      el.appendChild(this._p('This workbook is not a textbook exercise. The exercises are in ▤ Workbooks ▸ Demos ▸ Textbook, one folder per chapter.', 'exercise-dim'));
      return;
    }
    const head = document.createElement('div');
    head.className = 'exercise-head';
    head.append(this._span(`Exercise ${ex.number}`, 'exercise-number'), this._span(LEVELS[ex.level] || '', `exercise-level level-${ex.level}`));
    el.appendChild(head);
    if (ex.title) { const h = document.createElement('h3'); h.textContent = ex.title; el.appendChild(h); }
    const body = document.createElement('div');
    body.className = 'exercise-statement';
    body.innerHTML = renderMiniMarkup(ex.statement || '');
    el.appendChild(body);
    if (ex.done) {
      const done = document.createElement('div');
      done.className = 'exercise-done';
      done.innerHTML = `<span class="exercise-done-label">You're done when:</span> ${renderMiniMarkup(ex.done).replace(/^<p>|<\/p>$/g, '')}`;
      el.appendChild(done);
    }
    // Live progress of the proofs that are this exercise's goals
    for (const p of DocumentStore.list('proof')) {
      const st = p.goalStatus && p.goalStatus();
      if (!st) continue;
      const row = this._p(`${p.name}: ${st.message}`, 'exercise-status ' + (st.solved ? 'solved' : 'open'));
      el.appendChild(row);
      const key = `${ex.id}\u0000${p.id}`;
      if (st.solved && !ExercisePanel._solved.has(key)) {
        ExercisePanel._solved.add(key);
        Activity.log('exercise-solved', { exercise: ex.id, proof: p.name });
      } else if (!st.solved) ExercisePanel._solved.delete(key);
    }
    if (ex.book && /^textbook\/[\w./#-]+$/.test(ex.book)) {
      const a = document.createElement('a');
      a.className = 'exercise-book'; a.href = ex.book; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = '📖 Read it in the textbook — the hints are there';
      a.addEventListener('click', () => Activity.log('exercise-book-opened', { exercise: ex.id }));
      el.appendChild(a);
    }
  }

  _p(text, cls) { const p = document.createElement('p'); p.className = cls; p.textContent = text; return p; }
  _span(text, cls) { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; }

  onResize() {}

  destroy() {
    Session.offChange(this._onChange);
    DocumentStore.offAnyChange(this._onChange);
    DocumentStore.offListChange(this._onChange);
    if (this._raf) cancelAnimationFrame(this._raf);
    this.el.remove();
  }
}

/** Exercises already logged as solved in this tab (so re-renders don't log twice). */
ExercisePanel._solved = new Set();
