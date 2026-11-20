/**
 * The HTTP app: the JSON API under /api, and (in development) the app's own
 * static files, so the frontend and the API share one origin — no CORS, and
 * login cookies will just work.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authMiddleware, publicUser } from './auth.js';
import { workbooksRouter } from './workbooks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** What the browser may load: the app, never server/ or node_modules. */
const STATIC_DIRS = ['css', 'js', 'demos', 'tests'];

export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');

  // --- API ---
  const api = express.Router();
  api.use(express.json({ limit: config.maxWorkbookBytes }));
  api.get('/health', (req, res) => res.json({ ok: true }));
  api.use(authMiddleware({ db, config }));
  api.get('/me', (req, res) => res.json({ user: publicUser(req.user), authMode: config.authMode }));
  api.use('/workbooks', workbooksRouter({ db }));
  api.use((req, res) => res.status(404).json({ error: 'No such API route' }));
  api.use((err, req, res, next) => {          // eslint-disable-line no-unused-vars
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That workbook is too large to save' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request was not valid JSON' });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  });
  app.use('/api', api);

  // --- The app (development: like serve.py, never cached) ---
  if (!config.production) {
    const noCache = res => res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    for (const dir of STATIC_DIRS)
      app.use(`/${dir}`, express.static(path.join(ROOT, dir), { setHeaders: noCache, dotfiles: 'ignore' }));
    app.get('/', (req, res) => { noCache(res); res.sendFile(path.join(ROOT, 'index.html')); });
  }
  return app;
}
