# Quantum Pictural Playground — server

The backend: users and their workbooks, in MongoDB. In development it also
serves the app, so the app and the API share one origin (no CORS, and login
cookies will just work).

```bash
cd server
npm install
npm start            # http://localhost:8080  (npm run dev restarts on changes)
npm test             # API tests, in a throwaway database that is dropped afterwards
```

Without the server (e.g. `python3 serve.py`), the app still works: My
Workbooks falls back to the browser's own storage and says so.

| Setting | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | |
| `DB_NAME` | `qpp` | |
| `AUTH_MODE` | `dev` | no login yet (see below); refused when `NODE_ENV=production` |
| `MAX_WORKBOOK_BYTES` | 2 MB | the demos are ~25 KB |

## API

Every route acts as the current user (`req.user`) and only touches that
user's data. Someone else's workbook is a 404, never a 403, so ids reveal nothing.

| | | |
|---|---|---|
| `GET /api/health` | | `{ ok: true }` (no user needed) |
| `GET /api/me` | | `{ user: { id, displayName, providers }, authMode }` |
| `GET /api/workbooks` | | the user's workbooks, newest first, without content: `[{ id, name, description, summary, savedAt, revision }]` |
| `GET /api/workbooks/:id` | | `{ id, revision, workbook }` |
| `POST /api/workbooks` | `{ workbook }` | `201 { id, revision: 1 }` |
| `PUT /api/workbooks/:id` | `{ workbook, revision }` | `{ id, revision }`. `revision` is the one you loaded: if it was saved elsewhere since, **409** (and the current revision), so a stale tab never overwrites newer work |
| `DELETE /api/workbooks/:id` | | `204`. Soft: the workbook is kept, marked deleted |

A `workbook` is exactly what the app saves (`js/workbooks/Workbook.js`,
`format: "qpp-workbook"`). The server checks its shape and recomputes its
summary with the app's own `summarize`. It imports the app's modules
directly; the core runs unchanged in Node, which is also how class progress
can later be checked with the same proof checker students see.

## Data model

**users**

```js
{ _id, displayName, email, identities: [{ provider, subject }], createdAt, lastSeenAt }
```

A person is a user; a way of signing in is an *identity*. One user can link
several identities (Google and GitHub alike), and an identity belongs to one
user (unique index). There is no global role: being an instructor is a
membership in a class, so the same person can teach one class and take another.

**workbooks**

```js
{ _id, ownerId, name, description, summary: { circuits, diagrams, proofs },
  format, version, content /* the workbook, as a JSON string */,
  revision, createdAt, updatedAt, deletedAt }
```

`content` is a JSON string because workbooks have user-chosen keys (proof
assumptions are keyed by symbol), which MongoDB field names can't always
hold. Whatever needs querying gets its own field.

**Planned, for classes and instructors**

```js
classes      { _id, name, joinCode, createdAt }
memberships  { classId, userId, role: 'instructor' | 'student', joinedAt }   // unique (classId, userId)
assignments  { _id, classId, title, starter /* a workbook */, dueAt }
workbooks    + { classId, assignmentId, progress }    // progress computed on save
```

`progress` will be computed on save with the app's own checker, e.g. for each
proof how many steps check and the first that doesn't. Then the instructor
view is a query, not a recomputation. Public users simply have no memberships.

## Login (not yet)

`AUTH_MODE=dev` is the stand-in: every request is a development user,
`{ provider: 'dev', subject: 'local' }`, created on first use. The
`X-QPP-Dev-User` header picks another (the tests use it to act as several people).

Signing in with Google or GitHub will replace only `src/auth.js`: an OAuth
login ends in a session cookie, and the session resolves to
`{ provider, subject }`, which the existing `findOrCreateUser` turns into
`req.user`. The routes don't change.
