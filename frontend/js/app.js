/**
 * App Entry Point — Quantum Pictural Playground
 *
 * Registers editor types, builds the app bar and the Blender-style layout,
 * and opens the "Getting started" demo workbook.
 */
import EditorRegistry from './editors/EditorRegistry.js';
import DiagramEditor from './editors/DiagramEditor/DiagramEditor.js';
import DiracEditor from './editors/DiracEditor/DiracEditor.js';
import CircuitEditor from './editors/CircuitEditor/CircuitEditor.js';
import EquationEditor from './editors/EquationEditor/EquationEditor.js';
import NumbersView from './editors/NumbersView/NumbersView.js';
import WorkbookBrowser from './editors/WorkbookBrowser/WorkbookBrowser.js';
import ExercisePanel from './editors/ExercisePanel/ExercisePanel.js';
import LayoutManager from './layout/LayoutManager.js';
import DocumentStore from './editors/DocumentStore.js';
import CircuitDocument from './editors/CircuitEditor/CircuitDocument.js';
import { derivedDiagram } from './editors/CircuitEditor/CircuitDiagramLink.js';
import Session from './workbooks/WorkbookSession.js';

// Register available editor types
EditorRegistry.register(CircuitEditor);
EditorRegistry.register(DiagramEditor);
EditorRegistry.register(DiracEditor);
EditorRegistry.register(EquationEditor);
EditorRegistry.register(NumbersView);
EditorRegistry.register(WorkbookBrowser);
EditorRegistry.register(ExercisePanel);

// ---- App bar: the open workbook, Save, Workbooks ----
const bar = document.getElementById('app-bar');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const title = el('span', 'app-title', 'Quantum Pictural Playground');
const workbookEl = el('span', 'app-workbook');
const saveBtn = el('button', 'wb-btn', 'Save');
const browseBtn = el('button', 'wb-btn', '▤ Workbooks');
browseBtn.title = 'Open the Workbook Browser in the focused panel';
const bookLink = el('a', 'wb-btn app-book', '📖 Textbook');
bookLink.href = 'textbook/index.html'; bookLink.target = '_blank'; bookLink.rel = 'noopener';
bookLink.title = 'Learning quantum picturalism with the Playground: the textbook (opens in a new tab)';
bar.append(title, el('span', 'app-sep', '·'), workbookEl, el('span', 'app-spacer'), bookLink, saveBtn, browseBtn);

/** Show the Workbook Browser (in its panel if one is open, otherwise in the focused panel). */
function showBrowser() {
  const areas = [...layout.areas.values()];
  if (areas.some(a => a.editorType === WorkbookBrowser.typeName)) return;
  const area = layout.focusedArea();
  if (area) area.setEditorType(WorkbookBrowser.typeName);
}
browseBtn.addEventListener('click', showBrowser);
window.addEventListener('qpp:close-browser', () => layout.closeTransients());

/** Save in place, or — for a demo or a new workbook — ask for a name in the browser. */
function save() {
  if (Session.canSave) { Session.save().catch(e => console.error(e)); return; }
  showBrowser();
  setTimeout(() => window.dispatchEvent(new Event('qpp:save-copy')), 0);
}
saveBtn.addEventListener('click', save);

function renderBar() {
  const c = Session.current;
  const where = { demo: 'Demo', mine: 'My Workbooks', new: 'not saved' }[c.origin];
  workbookEl.textContent = `${c.exercise ? `Exercise ${c.exercise.number} · ` : ''}${c.name} (${where})${Session.dirty ? ' ●' : ''}`;
  workbookEl.title = Session.dirty ? 'Unsaved changes' : '';
  saveBtn.textContent = Session.canSave ? 'Save' : 'Save a copy…';
  saveBtn.disabled = Session.canSave && !Session.dirty;
  document.title = `${c.name}${Session.dirty ? ' ●' : ''} — Quantum Pictural Playground`;
}
Session.onChange(renderBar);

window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
});
window.addEventListener('beforeunload', e => {
  if (Session.dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ---- Layout + the first workbook ----
const appRoot = document.getElementById('app');
const layout = new LayoutManager(appRoot, { spec: false });
Session.attach(layout);
// Which workbook to start with:
//   ?demo=<id>          a demo, e.g. ?demo=spider-rules (shareable link)
//   ?open=<path>.json   a workbook file served with the app (e.g. a test fixture)
//   otherwise           the Getting started demo
const params = new URLSearchParams(location.search);
/** The backend's API (config.js), or null for none. */
function apiBase() {
  const c = (window.QPP_CONFIG || {}).apiBase;
  if (c === false) return null;
  if (typeof c === 'string' && c) return c;
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? 'http://localhost:8080/api' : null;
}
await Session.connectServer({ baseUrl: apiBase() });   // My Workbooks on the backend, if there is one
try {
  const file = params.get('open');
  if (file && /^[\w./-]+\.json$/.test(file) && !file.startsWith('/') && !file.includes('..')) {
    const r = await fetch(file, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Could not load ${file}`);
    Session.openJSON(await r.json(), { origin: 'new' });
  } else {
    await Session.open('demo', params.get('demo') || 'getting-started');
  }
} catch (e) {
  console.warn('Could not open the starting workbook:', e.message);
  try { await Session.open('demo', 'getting-started'); } catch { Session.newWorkbook(); }
}
renderBar();

// Expose for debugging (and building circuits from the console)
window.__QPP = { layout, EditorRegistry, DocumentStore, CircuitDocument, derivedDiagram, Session };
