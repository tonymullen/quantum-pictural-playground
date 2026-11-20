/**
 * /api/workbooks — a user's saved workbooks ("My Workbooks").
 *
 *   GET    /api/workbooks          → [{ id, name, description, summary, savedAt, revision }]  (newest first, no content)
 *   GET    /api/workbooks/:id      → { id, revision, workbook }
 *   POST   /api/workbooks          { workbook }            → 201 { id, revision }
 *   PUT    /api/workbooks/:id      { workbook, revision }  → { id, revision }
 *                                   409 if `revision` is not the stored one (saved elsewhere since)
 *   DELETE /api/workbooks/:id      → 204   (soft: the workbook is kept, marked deleted)
 *
 * Only the owner can see or change a workbook; anyone else gets 404 (not 403),
 * so ids reveal nothing. The stored `summary` is recomputed here with the
 * app's own Workbook.summarize, so listings can't disagree with the content.
 *
 * The workbook itself is stored as a JSON string (`content`): it has
 * user-chosen keys (e.g. proof assumptions keyed by symbol), which MongoDB
 * field names can't always hold. Anything worth querying (name, summary, and
 * later class progress) is kept in fields of its own.
 */
import express from 'express';
import { ObjectId } from 'mongodb';
import { FORMAT, VERSION, summarize } from '../../js/workbooks/Workbook.js';

const KINDS = new Set(['circuit', 'diagram', 'proof']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Check a workbook's shape (the app checks the meaning when it opens one). */
export function validateWorkbook(wb) {
  const bad = why => { throw new HttpError(400, `Not a workbook: ${why}`); };
  if (!wb || typeof wb !== 'object' || Array.isArray(wb)) bad('expected an object');
  if (wb.format !== FORMAT) bad(`format must be "${FORMAT}"`);
  if (!Number.isInteger(wb.version) || wb.version < 1 || wb.version > VERSION) bad(`unsupported version ${wb.version}`);
  if (typeof wb.name !== 'string' || !wb.name.trim() || wb.name.length > 200) bad('it needs a name (up to 200 characters)');
  if (wb.description !== undefined && (typeof wb.description !== 'string' || wb.description.length > 5000)) bad('description too long');
  if (!Array.isArray(wb.documents)) bad('documents must be a list');
  for (const d of wb.documents) {
    if (!d || !KINDS.has(d.kind) || typeof d.id !== 'string' || !d.data || typeof d.data !== 'object') bad('a document is malformed');
  }
  if (!wb.layout || typeof wb.layout !== 'object') bad('layout missing');
}

const oid = id => {
  if (!ObjectId.isValid(id) || String(new ObjectId(id)) !== id) throw new HttpError(404, 'No such workbook');
  return new ObjectId(id);
};

const listing = w => ({ id: String(w._id), name: w.name, description: w.description, summary: w.summary,
  savedAt: w.updatedAt.toISOString(), revision: w.revision });

export function workbooksRouter({ db }) {
  const col = db.collection('workbooks');
  const r = express.Router();
  const mine = (req, id) => ({ _id: oid(id), ownerId: req.user._id, deletedAt: null });
  const wrap = fn => (req, res, next) => fn(req, res).catch(next);

  r.get('/', wrap(async (req, res) => {
    const rows = await col.find({ ownerId: req.user._id, deletedAt: null },
      { projection: { content: 0 }, sort: { updatedAt: -1 }, limit: 500 }).toArray();
    res.json(rows.map(listing));
  }));

  r.get('/:id', wrap(async (req, res) => {
    const w = await col.findOne(mine(req, req.params.id));
    if (!w) throw new HttpError(404, 'No such workbook');
    res.json({ id: String(w._id), revision: w.revision, workbook: JSON.parse(w.content) });
  }));

  const fields = wb => ({ name: wb.name.trim(), description: wb.description || '', summary: summarize(wb.documents),
    format: wb.format, version: wb.version, content: JSON.stringify(wb) });

  r.post('/', wrap(async (req, res) => {
    const wb = req.body && req.body.workbook;
    validateWorkbook(wb);
    const now = new Date();
    const doc = { ownerId: req.user._id, ...fields(wb), revision: 1, createdAt: now, updatedAt: now, deletedAt: null };
    const { insertedId } = await col.insertOne(doc);
    res.status(201).json({ id: String(insertedId), revision: 1 });
  }));

  r.put('/:id', wrap(async (req, res) => {
    const { workbook: wb, revision } = req.body || {};
    validateWorkbook(wb);
    if (!Number.isInteger(revision)) throw new HttpError(400, 'revision (the one you loaded) is required');
    const updated = await col.findOneAndUpdate(
      { ...mine(req, req.params.id), revision },
      { $set: { ...fields(wb), updatedAt: new Date() }, $inc: { revision: 1 } },
      { returnDocument: 'after', projection: { revision: 1 } },
    );
    if (updated) return res.json({ id: req.params.id, revision: updated.revision });
    const current = await col.findOne(mine(req, req.params.id), { projection: { revision: 1 } });
    if (!current) throw new HttpError(404, 'No such workbook');
    res.status(409).json({ error: 'This workbook was saved somewhere else since you opened it', revision: current.revision });
  }));

  r.delete('/:id', wrap(async (req, res) => {
    const { matchedCount } = await col.updateOne(mine(req, req.params.id), { $set: { deletedAt: new Date() } });
    if (!matchedCount) throw new HttpError(404, 'No such workbook');
    res.status(204).end();
  }));

  return r;
}

export { HttpError };
