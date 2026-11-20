/**
 * MiniMarkup — the small, safe text format of exercise statements stored in
 * workbooks (a workbook may come from anyone, so no raw HTML is allowed).
 *
 *   A blank line starts a new paragraph.
 *   Lines starting "- " make a bulleted list.
 *   **bold**   *italic*   `code`   $\langle \pi | \psi \rangle$ (KaTeX, if loaded)
 *
 * Everything else is escaped, so the result can be put into innerHTML.
 */
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(text) {
  // Split out $…$ first so that * and ` inside formulas are left alone
  return text.split(/(\$[^$]+\$)/g).map(part => {
    if (/^\$[^$]+\$$/.test(part)) {
      const tex = part.slice(1, -1);
      const katex = globalThis.katex;
      if (katex) {
        try { return katex.renderToString(tex, { throwOnError: false, output: 'html' }); } catch { /* fall through */ }
      }
      return `<code>${esc(tex)}</code>`;
    }
    return esc(part)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }).join('');
}

/** @param {string} text  @returns {string} safe HTML */
export function renderMiniMarkup(text) {
  if (typeof text !== 'string' || !text.trim()) return '';
  return text.trim().split(/\n\s*\n/).map(block => {
    const lines = block.split('\n');
    if (lines.every(l => /^\s*- /.test(l))) {
      return '<ul>' + lines.map(l => `<li>${inline(l.replace(/^\s*- /, ''))}</li>`).join('') + '</ul>';
    }
    return `<p>${inline(lines.join(' '))}</p>`;
  }).join('');
}
