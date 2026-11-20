/**
 * ScalarLabel — read a number node's label as a complex number, if it is one.
 *
 *   "2", "0", "-1", "0.5", "1/2", "1/√2", "√2/2", "i", "-i", "2i", "1+i",
 *   "e^(iπ/4)", "e^{iπ/4}", "(1+i)/2", "π"   → a number
 *   "λ", "s", "μ", "2λ"                       → null (a symbol)
 *
 * PQP §3.4.1: numbers are processes with no inputs or outputs; in the
 * Playground's process theory (linear maps on qubits) they are complex
 * numbers. A label that reads as one is that number; any other label is a
 * symbol, checked by random substitution like any symbolic box.
 *
 * Grammar (whitespace ignored; · × * and juxtaposition multiply):
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/' | implicit) unary)*
 *   unary  := '-' unary | '+' unary | power
 *   power  := atom ('^' unary)?
 *   atom   := number | 'i' | 'π' | 'e' | '√' atom | '(' expr ')' | '{' expr '}'
 * Powers are complex: z^w = exp(w log z) (principal branch), so e^(iθ) is a phase.
 */
import C from './Complex.js';

/** @returns {[number, number]|null} the complex number, or null if the label is not a number */
export function parseScalarLabel(label) {
  if (typeof label !== 'string') return null;
  const src = label.replace(/\s+/g, '').replace(/−/g, '-').replace(/[·×]/g, '*').replace(/\\sqrt/g, '√').replace(/\\pi/g, 'π');
  if (!src || src.length > 60) return null;
  let i = 0;
  const peek = () => src[i];
  const fail = () => { throw new SyntaxError(); };

  const expr = () => {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = src[i++]; const w = term(); v = op === '+' ? C.add(v, w) : C.sub(v, w); }
    return v;
  };
  const startsAtom = ch => ch !== undefined && /[0-9.iπe√({]/.test(ch);
  const term = () => {
    let v = unary();
    for (;;) {
      const ch = peek();
      if (ch === '*') { i++; v = C.mul(v, unary()); }
      else if (ch === '/') { i++; const w = unary(); if (C.isZero(w)) fail(); v = C.div(v, w); }
      else if (startsAtom(ch)) v = C.mul(v, power());          // 2i, 2π, 2√2, (…)(…)
      else return v;
    }
  };
  const unary = () => {
    if (peek() === '-') { i++; return C.neg(unary()); }
    if (peek() === '+') { i++; return unary(); }
    return power();
  };
  const power = () => {
    const b = atom();
    if (peek() !== '^') return b;
    i++;
    return cpow(b, unary());
  };
  const atom = () => {
    const ch = peek();
    if (ch === undefined) fail();
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      if (!m) fail();
      i += m[0].length;
      return C.real(parseFloat(m[0]));
    }
    if (ch === 'i') { i++; return C.I; }
    if (ch === 'π') { i++; return C.real(Math.PI); }
    if (ch === 'e') { i++; return C.real(Math.E); }
    if (ch === '√') { i++; return csqrt(atom()); }
    if (ch === '(' || ch === '{') {
      const close = ch === '(' ? ')' : '}';
      i++;
      const v = expr();
      if (src[i] !== close) fail();
      i++;
      return v;
    }
    return fail();
  };

  try {
    const v = expr();
    if (i !== src.length) return null;
    if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) return null;
    return [clean(v[0]), clean(v[1])];
  } catch {
    return null;
  }
}

/** Round off floating-point dust (so e^(iπ) is −1, not −1 + 1.2e−16 i). */
const clean = x => (Math.abs(x) < 1e-12 ? 0 : Math.abs(x - Math.round(x)) < 1e-12 ? Math.round(x) : x);

function csqrt(z) {
  const r = C.abs(z), t = C.arg(z) / 2;
  return [Math.sqrt(r) * Math.cos(t), Math.sqrt(r) * Math.sin(t)];
}

function cpow(z, w) {
  if (C.isZero(z)) return C.isZero(w) ? C.ONE : C.ZERO;
  // exp(w · log z)
  const lr = Math.log(C.abs(z)), th = C.arg(z);
  const re = w[0] * lr - w[1] * th, im = w[0] * th + w[1] * lr;
  const m = Math.exp(re);
  return [m * Math.cos(im), m * Math.sin(im)];
}
