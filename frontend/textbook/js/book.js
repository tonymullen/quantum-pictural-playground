/**
 * book.js — what every textbook page shares.
 *
 *   Navigation    the chapter list (js/chapters.js) in a sidebar, this chapter's
 *                 sections under it, and previous / next at the bottom
 *   Citations     <a class="cite" data-key="nc2010" data-loc="§2.1.7"></a>
 *                 → [Nielsen & Chuang 2010, §2.1.7], linked to references.html;
 *                 <ol data-refs></ol> lists the works this page cites
 *   Figures       <figure class="qpp-figure" data-demo="pqp03-tour" data-diagram="ψ, f and π">
 *                 or data-proof="…" (every step, with its relation and rule) — drawn
 *                 from the demo workbook itself by the app's own drawing code, so
 *                 the book shows exactly what the Playground shows
 *   Workbooks     <a class="starter" data-demo="pqp03-ex04"></a>, <a class="demo-link" data-demo="…">
 *                 open the Playground on that workbook (in a new tab)
 *   Exercises     <section class="exercise" data-exercise="pqp03-ex04"> … hints … </section>:
 *                 the heading, statement and "done when" come from the starter workbook
 *                 itself (one source for the book and the Exercise panel); the page
 *                 adds only the hints
 *   Hints         <details class="hint" data-exercise="pqp03-ex04" data-n="1">; opening one is
 *                 logged (js/core/Activity.js), as is opening a starter
 *   Formulas      $…$ and \[…\] are typeset by KaTeX
 *
 * Everything is relative to this folder, so the book works wherever the
 * frontend is deployed.
 */
import { CHAPTERS } from './chapters.js';
import { BIB, formatEntry } from './bib.js';
import Activity from '../../js/core/Activity.js';
import DiagramDocument from '../../js/editors/DiagramEditor/DiagramDocument.js';
import { drawThumbnail } from '../../js/editors/EquationEditor/EquationEditor.js';
import { ORIENTATIONS } from '../../js/core/FlowDirection.js';
import { DemoStore } from '../../js/workbooks/WorkbookStores.js';
import { renderMiniMarkup } from '../../js/core/MiniMarkup.js';

globalThis.QPP_PAGE = 'textbook';
const APP = '../index.html';
const page = location.pathname.split('/').pop() || 'index.html';
const demos = new DemoStore({ base: '../demos/' });

/* ---------------- Navigation ---------------- */

function buildNav() {
  const nav = document.getElementById('book-nav');
  if (!nav) return;
  const sections = [...document.querySelectorAll('main h2[id]')];
  const items = [
    `<a class="nav-home${page === 'index.html' ? ' current' : ''}" href="index.html">Learning Quantum Picturalism</a>`,
    '<ol class="nav-chapters">',
  ];
  for (const ch of CHAPTERS) {
    const here = ch.page === page;
    if (!ch.page) { items.push(`<li class="nav-soon" title="Not written yet">${ch.n} · ${ch.title}</li>`); continue; }
    items.push(`<li class="${here ? 'current' : ''}"><a href="${ch.page}">${ch.n} · ${ch.title}</a>`);
    if (here && sections.length) {
      items.push('<ol class="nav-sections">' + sections.map(h => `<li><a href="#${h.id}">${h.dataset.nav || h.textContent}</a></li>`).join('') + '</ol>');
    }
    items.push('</li>');
  }
  items.push('</ol>');
  items.push(`<a class="nav-extra${page === 'references.html' ? ' current' : ''}" href="references.html">References</a>`);
  items.push(`<a class="nav-extra" href="${APP}" target="_blank" rel="noopener">Open the Playground ↗</a>`);
  nav.innerHTML = items.join('');

  const pager = document.getElementById('book-pager');
  if (pager) {
    const order = [{ page: 'index.html', label: 'Introduction' }, ...CHAPTERS.filter(c => c.page).map(c => ({ page: c.page, label: `Chapter ${c.n} · ${c.title}` }))];
    const i = order.findIndex(o => o.page === page);
    const prev = order[i - 1], next = order[i + 1];
    pager.innerHTML = (prev ? `<a class="prev" href="${prev.page}">← ${prev.label}</a>` : '<span></span>')
      + (next ? `<a class="next" href="${next.page}">${next.label} →</a>` : '<span></span>');
  }
}

/* ---------------- Citations ---------------- */

function buildCitations() {
  const cited = [];
  for (const a of document.querySelectorAll('a.cite')) {
    const e = BIB[a.dataset.key];
    if (!e) { a.textContent = `[? ${a.dataset.key}]`; a.classList.add('cite-missing'); continue; }
    if (!cited.includes(a.dataset.key)) cited.push(a.dataset.key);
    a.href = `references.html#${a.dataset.key}`;
    a.textContent = `[${e.short}${a.dataset.loc ? ', ' + a.dataset.loc : ''}]`;
    a.title = `${e.authors}, ${e.title} (${e.year})`;
  }
  for (const ol of document.querySelectorAll('ol[data-refs]')) {
    const keys = ol.dataset.refs === 'all' ? Object.keys(BIB) : cited;
    ol.innerHTML = keys.map(k => `<li id="${ol.dataset.refs === 'all' ? k : 'ref-' + k}">${formatEntry(BIB[k])}`
      + (ol.dataset.refs === 'all' ? `<div class="ref-note">${BIB[k].note || ''}</div><div class="ref-checked">Checked against: ${BIB[k].checked}</div>` : '')
      + '</li>').join('');
  }
}

/* ---------------- Workbook links, hints ---------------- */

function buildLinks() {
  for (const a of document.querySelectorAll('a.starter, a.demo-link')) {
    const id = a.dataset.demo;
    a.href = `${APP}?demo=${encodeURIComponent(id)}`;
    a.target = '_blank'; a.rel = 'noopener';
    if (!a.textContent.trim()) a.textContent = a.classList.contains('starter') ? 'Open the starter workbook ↗' : 'Open this workbook in the Playground ↗';
    a.addEventListener('click', () => Activity.log(a.classList.contains('starter') ? 'starter-opened' : 'demo-opened', { workbook: id }));
  }
  for (const d of document.querySelectorAll('details.hint')) {
    d.addEventListener('toggle', () => {
      if (d.open) Activity.log('hint-opened', { exercise: d.dataset.exercise, hint: Number(d.dataset.n) || 1 });
    });
  }
}

/* ---------------- Figures ---------------- */

const workbookCache = new Map();
const loadWorkbook = id => {
  if (!workbookCache.has(id)) workbookCache.set(id, demos.load(id));
  return workbookCache.get(id);
};

function diagramFrom(wb, docId) {
  const d = wb.documents.find(x => x.kind === 'diagram' && x.id === docId);
  return d ? DiagramDocument.fromJSON(d.data) : null;
}

async function buildFigure(fig) {
  const id = fig.dataset.demo;
  const holder = document.createElement('div');
  holder.className = 'fig-body';
  fig.insertBefore(holder, fig.querySelector('figcaption'));
  const small = fig.classList.contains('small');
  const size = small ? { width: 150, height: 120, maxZoom: 1.1 }
    : fig.dataset.diagram ? { width: 260, height: 240, maxZoom: 1.6 } : { width: 240, height: 190, maxZoom: 1.4 };
  try {
    const wb = await loadWorkbook(id);
    if (fig.dataset.diagram) {
      const entry = wb.documents.find(x => x.kind === 'diagram' && x.data.name === fig.dataset.diagram);
      if (!entry) throw new Error(`no diagram “${fig.dataset.diagram}”`);
      holder.appendChild(canvasFor(DiagramDocument.fromJSON(entry.data), size));
    } else if (fig.dataset.proof) {
      const entry = wb.documents.find(x => x.kind === 'proof' && x.data.name === fig.dataset.proof);
      if (!entry) throw new Error(`no proof “${fig.dataset.proof}”`);
      const steps = entry.data.steps;
      const only = fig.dataset.steps ? fig.dataset.steps.split(',').map(Number) : null;
      steps.forEach((st, k) => {
        if (only && !only.includes(k + 1)) return;
        if (k > 0 && (!only || only.includes(k))) {
          const rel = document.createElement('div');
          rel.className = 'fig-rel';
          rel.innerHTML = `<span class="fig-rel-sym">${st.relation}</span>` + (st.note && !small ? `<span class="fig-rel-note">${escapeHTML(st.note)}</span>` : '');
          holder.appendChild(rel);
        }
        const d = diagramFrom(wb, st.diagram);
        if (d) holder.appendChild(canvasFor(d, size));
      });
    }
    if (!fig.classList.contains('no-link')) {
      const a = document.createElement('a');
      a.className = 'demo-link fig-open'; a.dataset.demo = id;
      a.textContent = 'Open in the Playground ↗';
      a.href = `${APP}?demo=${encodeURIComponent(id)}`; a.target = '_blank'; a.rel = 'noopener';
      a.addEventListener('click', () => Activity.log('demo-opened', { workbook: id, from: 'figure' }));
      fig.appendChild(a);
    }
  } catch (e) {
    holder.textContent = `(Figure unavailable: ${e.message})`;
    holder.classList.add('fig-error');
  }
}

function canvasFor(doc, size) {
  const cv = document.createElement('canvas');
  cv.className = 'fig-canvas';
  drawThumbnail(cv, doc, ORIENTATIONS.pqp, size);
  return cv;
}

const escapeHTML = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- Exercises ---------------- */

const LEVELS = { 1: '★ Warm-up', 2: '★★ Practice', 3: '★★★ Challenge' };

async function buildExercise(sec) {
  const id = sec.dataset.exercise;
  const head = document.createElement('div');
  try {
    const ex = (await loadWorkbook(id)).exercise;
    if (!ex) throw new Error('not an exercise');
    sec.id = `ex-${ex.number.replace('.', '-')}`;
    head.innerHTML = `<div class="exercise-head"><h3>Exercise ${ex.number} · ${escapeHTML(ex.title)}</h3>`
      + `<span class="exercise-level l${ex.level}">${LEVELS[ex.level] || ''}</span></div>`
      + renderMiniMarkup(ex.statement)
      + `<p><a class="starter" data-demo="${id}"></a></p>`
      + (ex.done ? `<p class="done"><strong>You’re done when:</strong> ${renderMiniMarkup(ex.done).replace(/^<p>|<\/p>$/g, '')}</p>` : '');
  } catch (e) {
    head.innerHTML = `<p class="fig-error">(Exercise ${escapeHTML(id)} unavailable: ${escapeHTML(e.message)})</p>`;
  }
  sec.prepend(head);
  for (const d of sec.querySelectorAll('details.hint')) if (!d.dataset.exercise) d.dataset.exercise = id;
}

/* ---------------- Formulas ---------------- */

function typeset() {
  if (typeof renderMathInElement !== 'function') return;
  renderMathInElement(document.querySelector('main') || document.body, {
    delimiters: [
      { left: '\\[', right: '\\]', display: true },
      { left: '$', right: '$', display: false },
    ],
    throwOnError: false,
  });
}

/* ---------------- Start ---------------- */

buildNav();
buildCitations();
typeset();
await Promise.all([...document.querySelectorAll('section.exercise[data-exercise]')].map(buildExercise));
buildLinks();
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
await Promise.all([...document.querySelectorAll('figure.qpp-figure')].map(buildFigure));
document.documentElement.classList.add('figures-ready');
