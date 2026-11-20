/**
 * Activity — a record of what a student does with the textbook and its
 * exercises: opening a hint, solving an exercise's proof, and so on.
 *
 *   Activity.log('hint-opened', { exercise: 'pqp03-ex04', hint: 2 })
 *
 * Today every event is kept in this tab (sessionStorage, the last 500) and
 * announced as a window event ('qpp:activity', detail = the event), so it can
 * be inspected. When the backend records student activity, a sender is added
 * here (Activity.setSender) and nothing that logs events has to change.
 *
 * Event: { type, at: ISO time, page: 'app'|'textbook', ...data }
 */
const KEY = 'qpp.activity.v1';
const MAX = 500;
let sender = null;

const Activity = {
  /** Record an event. Never throws: logging must not break the page. */
  log(type, data = {}) {
    const event = { type, at: new Date().toISOString(), page: globalThis.QPP_PAGE || 'app', ...data };
    try {
      const all = JSON.parse(sessionStorage.getItem(KEY) || '[]');
      all.push(event);
      sessionStorage.setItem(KEY, JSON.stringify(all.slice(-MAX)));
    } catch { /* storage unavailable: keep going */ }
    try { globalThis.dispatchEvent && globalThis.dispatchEvent(new CustomEvent('qpp:activity', { detail: event })); } catch { /* no DOM */ }
    if (sender) Promise.resolve().then(() => sender(event)).catch(() => {});
    return event;
  },

  /** The events recorded in this tab, oldest first. */
  recent() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; }
  },

  /** Where events go besides this tab (e.g. the backend), or null. */
  setSender(fn) { sender = typeof fn === 'function' ? fn : null; },
};

export default Activity;
