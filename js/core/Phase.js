/**
 * Phase — Rational multiples of π.
 * Representation: { num, den } where phase = (num/den) · π.
 * Always kept in lowest terms with den > 0.
 */

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }

export default class Phase {
  constructor(num, den = 1) {
    if (den < 0) { num = -num; den = -den; }
    const g = gcd(Math.abs(num), den);
    this.num = num / g;
    this.den = den / g;
  }

  static ZERO = new Phase(0);
  static PI   = new Phase(1);
  static HALF = new Phase(1, 2);
  static QUARTER = new Phase(1, 4);

  /** Parse a label string into a Phase, or return null. */
  static parse(s) {
    if (!s || !s.trim()) return Phase.ZERO;
    s = s.trim().replace(/\s/g, '');
    // "0" → 0
    if (s === '0') return Phase.ZERO;
    // "π" or "pi"
    if (s === 'π' || s === 'pi') return Phase.PI;
    if (s === '-π' || s === '-pi') return new Phase(-1);
    // "π/N" or "pi/N"
    let m = s.match(/^(-?)(?:(\d+))?[πpi]+(?:\/(\d+))?$/);
    if (m) {
      const sign = m[1] === '-' ? -1 : 1;
      const num = m[2] ? parseInt(m[2]) : 1;
      const den = m[3] ? parseInt(m[3]) : 1;
      return new Phase(sign * num, den);
    }
    // "N*π/M" or "Nπ/M"
    m = s.match(/^(-?\d+)\*?[πpi]+(?:\/(\d+))?$/);
    if (m) return new Phase(parseInt(m[1]), m[2] ? parseInt(m[2]) : 1);
    // "N/M" (implicit π)
    m = s.match(/^(-?\d+)\/(\d+)$/);
    if (m) return new Phase(parseInt(m[1]), parseInt(m[2]));
    return null; // unparseable
  }

  /** Convert to radians. */
  toRadians() { return (this.num / this.den) * Math.PI; }

  /** Convert to [re, im] unit complex number e^{iφ}. */
  toComplex() {
    const r = this.toRadians();
    return [Math.cos(r), Math.sin(r)];
  }

  add(other) { return new Phase(this.num * other.den + other.num * this.den, this.den * other.den); }
  neg() { return new Phase(-this.num, this.den); }
  sub(other) { return this.add(other.neg()); }
  mul(n) { return new Phase(this.num * n, this.den); }
  isZero() { return this.num === 0; }
  isPI() { return this.num === 1 && this.den === 1; }
  equals(other) { return this.num === other.num && this.den === other.den; }

  /** Canonical mod 2 (phase mod 2π). */
  mod2() {
    let n = ((this.num % (2 * this.den)) + 2 * this.den) % (2 * this.den);
    return new Phase(n, this.den);
  }

  /** Display as LaTeX. */
  toLatex() {
    if (this.num === 0) return '0';
    const absNum = Math.abs(this.num);
    const sign = this.num < 0 ? '-' : '';
    const numStr = absNum === 1 ? '' : String(absNum);
    if (this.den === 1) return `${sign}${numStr}\\pi`;
    return `${sign}\\frac{${numStr || ''}\\pi}{${this.den}}`;
  }

  /** Display as plain text. */
  toString() {
    if (this.num === 0) return '0';
    const sign = this.num < 0 ? '-' : '';
    const absNum = Math.abs(this.num);
    const numStr = absNum === 1 ? '' : String(absNum);
    if (this.den === 1) return `${sign}${numStr}π`;
    return `${sign}${numStr}π/${this.den}`;
  }
}
