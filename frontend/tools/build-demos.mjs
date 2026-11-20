#!/usr/bin/env node
/**
 * build-demos — regenerate the Demo workbooks in demos/ from code.
 *
 *   node tools/build-demos.mjs
 *
 * Two collections, one Demos tree (demos/index.json lists both):
 *   Textbook ▸ Chapter N · … ▸ Demos | Exercises    tools/textbook/chNN.mjs → demos/textbook/chNN/
 *   Software tour                                   tools/demos/software.mjs → demos/software/
 *
 * Each workbook is built with the app's own document model and written as
 * workbook JSON (js/workbooks/Workbook.js). The build fails if a demo proof
 * does not check, or if an exercise's goal is not true (every goal set must
 * be provable). The JSON files are the data the app ships; edit these
 * scripts, not them.
 */
import { writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { DocumentStore } from './demo-kit.mjs';
import { captureWorkbook, openWorkbookDocuments } from '../js/workbooks/Workbook.js';
import { DEMOS as SOFTWARE } from './demos/software.mjs';
import CH03 from './textbook/ch03.mjs';

const CHAPTERS = [CH03];
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demos');
const pad = n => String(n).padStart(2, '0');

/** Build one workbook, check it, write it, and return its index entry. */
function build(item, { file, folder, exercise = null, book = null, mayFail = [] }) {
  DocumentStore.clear();
  const layout = item.build();
  const check = where => {
    for (const p of DocumentStore.list('proof')) {
      if (mayFail.includes(p.name)) continue;
      const r = p.checkAll();
      if (r.status === 'ok' || (r.status === 'empty' && exercise)) continue;
      throw new Error(`${where} "${item.name}": proof "${p.name}" does not check`
        + (r.firstBad > 0 ? ` at D${r.firstBad + 1}: ${r.results[r.firstBad].hint}` : ''));
    }
  };
  check('Building');
  const wb = captureWorkbook({ name: item.name, description: item.description || '', exercise }, layout);
  delete wb.savedAt;   // demos are versioned with the app, not timestamped
  // Round trip: the written workbook must open, and its proofs must still check
  openWorkbookDocuments(JSON.parse(JSON.stringify(wb)));
  check('Reopening');
  const dest = path.join(OUT, file);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(wb, null, 1) + '\n');
  const entry = { id: item.id, name: wb.name, description: wb.description, summary: wb.summary, folder, file };
  if (book) entry.book = book;
  if (exercise) entry.exercise = { number: exercise.number, level: exercise.level };
  console.log(`✓ ${file}`);
  return entry;
}

// Generated folders are rebuilt from scratch (so a removed demo disappears)
for (const dir of ['textbook', 'software']) rmSync(path.join(OUT, dir), { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.json') && f !== 'index.json') rmSync(path.join(OUT, f));

const index = [];
const ids = new Set();
const add = entry => {
  if (ids.has(entry.id)) throw new Error(`Two demos have the id "${entry.id}"`);
  ids.add(entry.id);
  index.push(entry);
};

for (const ch of CHAPTERS) {
  const n = ch.number, dir = `textbook/ch${pad(n)}`, chapterFolder = `Chapter ${n} · ${ch.title}`;
  for (const demo of ch.demos) {
    add(build(demo, { file: `${dir}/${demo.id}.json`, folder: ['Textbook', chapterFolder, 'Demos'],
      book: `textbook/${ch.page}${demo.anchor ? '#' + demo.anchor : ''}` }));
  }
  ch.exercises.forEach((ex, k) => {
    const number = `${n}.${k + 1}`, id = `pqp${pad(n)}-ex${pad(k + 1)}`;
    const book = `textbook/${ch.page}#ex-${n}-${k + 1}`;
    const exercise = { id, chapter: n, number, title: ex.title, level: ex.level, statement: ex.statement, done: ex.done, book };
    add(build({ ...ex, id, name: `${number} ${ex.title}`, description: ex.summary }, {
      file: `${dir}/${id}.json`, folder: ['Textbook', chapterFolder, 'Exercises'], exercise, book, mayFail: ex.mayFail || [] }));
  });
}
for (const demo of SOFTWARE) add(build(demo, { file: `software/${demo.id}.json`, folder: ['Software tour'] }));

writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ demos: index }, null, 1) + '\n');
console.log(`✓ index.json  (${index.length} workbooks)`);
