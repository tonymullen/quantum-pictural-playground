/**
 * The HTTP app: a JSON API under /api, and nothing else. The frontend is
 * deployed separately (any static host) and calls this API across origins,
 * so CORS is answered here for the origins in ALLOWED_ORIGINS.
 */
import express from 'express';
import { authMiddleware, publicUser } from './auth.js';
import { workbooksRouter } from './workbooks.js';

/**
 * CORS: a browser page from an allowed origin may call the API, with
 * credentials (for login cookies later). The origin is echoed back, never
 * "*", which credentials don't allow.
 */
function cors(config) {
  const allowed = origin => config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin);
  return (req, res, next) => {
    const origin = req.get('Origin');
    if (origin && allowed(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.set('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        res.set('Access-Control-Allow-Headers', 'Content-Type, X-QPP-Dev-User');
        res.set('Access-Control-Max-Age', '600');
        return res.status(204).end();
      }
    } else if (req.method === 'OPTIONS') {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    next();
  };
}

export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors(config));

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
  app.use((req, res) => res.status(404).json({ error: 'Not found — the API is under /api' }));
  return app;
}
