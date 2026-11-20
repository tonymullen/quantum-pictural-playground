/**
 * MongoDB connection and indexes.
 *
 * Collections (see server/README.md for the full model):
 *   users       one per person; logins are `identities` (provider + subject), so
 *               one person can sign in with Google and GitHub alike
 *   workbooks   one per saved workbook, owned by a user; `content` is the
 *               workbook JSON exactly as the app saves it (Workbook.js)
 * Planned, for instructors: classes, memberships (user × class, role), assignments.
 */
import { MongoClient } from 'mongodb';

export async function connect(config) {
  const client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(config.dbName);
  await ensureIndexes(db);
  return { client, db };
}

export async function ensureIndexes(db) {
  await db.collection('users').createIndexes([
    // a login (e.g. GitHub user 1234) belongs to exactly one user
    { key: { 'identities.provider': 1, 'identities.subject': 1 }, name: 'identity', unique: true },
  ]);
  await db.collection('workbooks').createIndexes([
    // "My Workbooks": a user's live workbooks, newest first
    { key: { ownerId: 1, deletedAt: 1, updatedAt: -1 }, name: 'owner_recent' },
  ]);
}
