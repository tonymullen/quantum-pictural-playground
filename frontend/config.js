/*
 * Deployment settings for the Quantum Pictural Playground (edit for your site).
 *
 * apiBase — where the backend's API is, e.g. "https://qpp.example.edu/api".
 *   null:  on localhost, try http://localhost:8080/api (the backend's default);
 *          anywhere else, no backend.
 *   false: never use a backend.
 * Without a backend, My Workbooks is kept in the visitor's browser.
 * (The backend must list this site's origin in its ALLOWED_ORIGINS.)
 */
window.QPP_CONFIG = {
  apiBase: null,
};
