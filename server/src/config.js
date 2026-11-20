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
 */
export function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT || 8080),
    mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
    dbName: env.DB_NAME || 'qpp',
    authMode: env.AUTH_MODE || 'dev',
    production: env.NODE_ENV === 'production',
    maxWorkbookBytes: Number(env.MAX_WORKBOOK_BYTES || 2 * 1024 * 1024),
  };
  if (config.authMode === 'dev' && config.production) {
    throw new Error('AUTH_MODE=dev (no login) must not run in production');
  }
  return config;
}
