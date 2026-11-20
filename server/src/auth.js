/**
 * Who is making the request.
 *
 * Every route reads req.user (set here) and only ever touches that user's
 * data, so adding real login later changes this file, not the routes.
 *
 * AUTH_MODE=dev (now): no login. The user is a development identity
 *   { provider: 'dev', subject: <X-QPP-Dev-User header, or "local"> },
 *   created on first use. The header lets tests act as several people.
 * AUTH_MODE=oauth (later): a session cookie from signing in with Google or
 *   GitHub resolves to { provider: 'google'|'github', subject: <their user id> };
 *   the same findOrCreateUser links it to a user.
 */
const DEV_SUBJECT = /^[a-zA-Z0-9_.@-]{1,64}$/;

/** Find the user with this login, or create one (with a display name). */
export async function findOrCreateUser(db, { provider, subject, displayName, email = null }) {
  const now = new Date();
  const users = db.collection('users');
  const res = await users.findOneAndUpdate(
    { identities: { $elemMatch: { provider, subject } } },
    {
      $setOnInsert: { displayName: displayName || subject, email, identities: [{ provider, subject }], createdAt: now },
      $set: { lastSeenAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return res;
}

export function authMiddleware({ db, config }) {
  if (config.authMode !== 'dev') throw new Error(`AUTH_MODE "${config.authMode}" is not implemented yet`);
  return async (req, res, next) => {
    try {
      const subject = req.get('X-QPP-Dev-User') || 'local';
      if (!DEV_SUBJECT.test(subject)) return res.status(400).json({ error: 'Bad X-QPP-Dev-User' });
      req.user = await findOrCreateUser(db, {
        provider: 'dev', subject, displayName: subject === 'local' ? 'Local user (no login yet)' : subject,
      });
      next();
    } catch (e) { next(e); }
  };
}

/** The user as the client sees it. */
export function publicUser(u) {
  return { id: String(u._id), displayName: u.displayName, providers: u.identities.map(i => i.provider) };
}
