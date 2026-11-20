/**
 * Server configuration, from the environment (with development defaults).
 *
 *   PORT          8080
 *   MONGODB_URI   mongodb://127.0.0.1:27017
 *   DB_NAME       qpp
 *   AUTH_MODE     'dev'  — no login yet: every request is a development user
 *                          (the X-QPP-Dev-User header picks which; default "local").
 *                 Later: 'oauth' (Google / GitHub sessions). 'dev' is refused when
 *                 NODE_ENV=production.
 *   MAX_WORKBOOK_BYTES  2 MB
 *   ALLOWED_ORIGINS     comma-separated origins whose pages may call the API
 *                       (CORS), e.g. "https://example.edu,http://localhost:8000".
 *                       Development default: any origin ("*"); in production
 *                       it must be set.
 */
export function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT || 8080),
    mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
    dbName: env.DB_NAME || 'qpp',
    authMode: env.AUTH_MODE || 'dev',
    production: env.NODE_ENV === 'production',
    maxWorkbookBytes: Number(env.MAX_WORKBOOK_BYTES || 2 * 1024 * 1024),
    allowedOrigins: (env.ALLOWED_ORIGINS || (env.NODE_ENV === 'production' ? '' : '*'))
      .split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean),
  };
  if (config.production && (!config.allowedOrigins.length || config.allowedOrigins.includes('*'))) {
    throw new Error('Set ALLOWED_ORIGINS to the frontend’s origin(s) in production');
  }
  if (config.authMode === 'dev' && config.production) {
    throw new Error('AUTH_MODE=dev (no login) must not run in production');
  }
  return config;
}
