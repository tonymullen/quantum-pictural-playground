/**
 * DiracParser — Parse Dirac-notation LaTeX into an AST.
 *
 * AST node types:
 *   { type:'ket', label }
 *   { type:'bra', label }
 *   { type:'braket', braLabel, ketLabel }
 *   { type:'scalar', value:[re,im] }
 *   { type:'sum', terms:[{sign,node}] }
 *   { type:'product', factors:[] }
 *   { type:'tensor', factors:[] }     // ⊗
 *   { type:'dagger', operand }
 *   { type:'operator', name }
 */

import C from './Complex.js';

export class ParseError {
  constructor(message, pos) { this.message = message; this.pos = pos; }
}

export default function parseDirac(latex) {
  const p = new Parser(latex);
  const ast = p.parseExpr();
  p.skipWS();
  if (p.pos < p.src.length)
    throw new ParseError(`Unexpected '${p.src[p.pos]}' at position ${p.pos}`, p.pos);
  return ast;
}

class Parser {
  constructor(src) { this.src = src.trim(); this.pos = 0; }

  peek() { this.skipWS(); return this.pos < this.src.length ? this.src[this.pos] : ''; }
  advance(n=1) { this.pos += n; }
  at(s) { this.skipWS(); return this.src.startsWith(s, this.pos); }
  eat(s) {
    this.skipWS();
    if (!this.src.startsWith(s, this.pos))
      throw new ParseError(`Expected '${s}' at position ${this.pos}`, this.pos);
    this.pos += s.length;
  }
  tryEat(s) { this.skipWS(); if (this.src.startsWith(s, this.pos)) { this.pos += s.length; return true; } return false; }
  skipWS() { while (this.pos < this.src.length && ' \t\n\r'.includes(this.src[this.pos])) this.pos++; }

  parseExpr() { return this.parseSum(); }

  parseSum() {
    const first = this.parseProduct();
    const terms = [{ sign: 1, node: first }];
    while (true) {
      if (this.tryEat('+')) { terms.push({ sign: 1, node: this.parseProduct() }); }
      else if (this.at('-') && !this.at('-\\rangle')) {
        this.eat('-'); terms.push({ sign: -1, node: this.parseProduct() });
      } else break;
    }
    if (terms.length === 1 && terms[0].sign === 1) return terms[0].node;
    return { type: 'sum', terms };
  }

  parseProduct() {
    const factors = [this.parseTensorProduct()];
    while (true) {
      this._skipCdot(); // consume optional \cdot between factors
      if (!this._canStartFactor()) break;
      factors.push(this.parseTensorProduct());
    }
    if (factors.length === 1) return factors[0];
    return { type: 'product', factors };
  }

  parseTensorProduct() {
    const first = this.parseFactor();
    if (this.tryEat('\\otimes')) {
      const factors = [first, this.parseFactor()];
      while (this.tryEat('\\otimes')) factors.push(this.parseFactor());
      return { type: 'tensor', factors };
    }
    return first;
  }

  /** Skip \cdot — treated as implicit multiplication (already handled by juxtaposition). */
  _skipCdot() { this.tryEat('\\cdot'); }

  parseFactor() {
    let node = this.parseAtom();
    if (this.tryEat('^{\\dagger}') || this.tryEat('^\\dagger'))
      node = { type: 'dagger', operand: node };
    return node;
  }

  parseAtom() {
    this.skipWS();
    if (this.pos >= this.src.length) throw new ParseError('Unexpected end', this.pos);
    if (this.tryEat('(')) { const e = this.parseExpr(); this.eat(')'); return e; }
    if (this.tryEat('\\left(')) { const e = this.parseExpr(); this.eat('\\right)'); return e; }
    if (this.at('\\langle')) return this.parseBraOrBraket();
    if (this.peek() === '|') return this.parseKet();
    if (this.at('\\frac')) return this.parseFrac();
    if (this.at('\\sqrt')) return this.parseSqrt();
    if (this.at('\\hat{')) return this._parseCmd('\\hat{');
    if (this.at('\\text{')) return this._parseCmd('\\text{');
    if (this.at('\\mathbb{')) return this._parseCmd('\\mathbb{');
    if (this.at('\\operatorname{')) return this._parseCmd('\\operatorname{');
    if (this.peek() === 'i' && !this._isAlpha(this.src[this.pos+1])) { this.advance(); return { type:'scalar', value:[0,1] }; }
    // Negative number or negative prefix
    if (this.peek() === '-') {
      this.advance();
      const inner = this.parseAtom();
      if (inner.type === 'scalar') return { type: 'scalar', value: C.neg(inner.value) };
      return { type: 'product', factors: [{ type: 'scalar', value: C.NEG1 }, inner] };
    }
    if (this._isDigit()) return this.parseNumber();
    if (this.peek() === '\\' && this._isAlpha(this.src[this.pos+1])) return this.parseNamedSymbol();
    const ch = this.peek();
    if (ch >= 'A' && ch <= 'Z') { this.advance(); return { type:'operator', name:ch }; }
    if (ch >= 'a' && ch <= 'z') { this.advance(); return { type:'operator', name:ch }; }
    throw new ParseError(`Unexpected '${ch}' at position ${this.pos}`, this.pos);
  }

  parseKet() {
    this.eat('|');
    const label = this._readUntil('\\rangle');
    this.eat('\\rangle');
    return { type:'ket', label: label.trim() };
  }

  parseBraOrBraket() {
    this.eat('\\langle');
    const label1 = this._readUntil('|');
    this.eat('|');
    const saved = this.pos;
    try {
      const label2 = this._readUntil('\\rangle');
      if (label2.trim() && !/[|+]/.test(label2)) {
        this.eat('\\rangle');
        return { type:'braket', braLabel: label1.trim(), ketLabel: label2.trim() };
      }
    } catch { /* not a braket */ }
    this.pos = saved;
    return { type:'bra', label: label1.trim() };
  }

  parseFrac() {
    this.eat('\\frac'); this.eat('{');
    const num = this._readBalanced(); this.eat('}'); this.eat('{');
    const den = this._readBalanced(); this.eat('}');
    if (num.trim() === '1' && den.trim() === '\\sqrt{2}')
      return { type:'scalar', value:[1/Math.sqrt(2), 0] };
    const nv = parseFloat(num), dv = parseFloat(den);
    if (!isNaN(nv) && !isNaN(dv) && dv !== 0) return { type:'scalar', value:[nv/dv, 0] };
    return { type:'scalar', value:[1,0] };
  }

  parseSqrt() {
    this.eat('\\sqrt'); this.eat('{');
    const c = this._readBalanced(); this.eat('}');
    const v = parseFloat(c);
    return { type:'scalar', value: isNaN(v) ? [1,0] : [Math.sqrt(v), 0] };
  }

  _parseCmd(cmd) {
    this.eat(cmd); const n = this._readBalanced(); this.eat('}');
    return { type:'operator', name: n.trim() };
  }

  parseNamedSymbol() {
    this.eat('\\'); let name = '';
    while (this.pos < this.src.length && this._isAlpha(this.src[this.pos]))
      { name += this.src[this.pos]; this.advance(); }
    const g = {alpha:'α',beta:'β',gamma:'γ',pi:'π',phi:'φ',psi:'ψ',theta:'θ'};
    return { type:'operator', name: g[name] || name };
  }

  parseNumber() {
    let s = '';
    while (this.pos < this.src.length && '0123456789.'.includes(this.src[this.pos]))
      { s += this.src[this.pos]; this.advance(); }
    return { type:'scalar', value:[parseFloat(s), 0] };
  }

  _canStartFactor() {
    this.skipWS();
    if (this.pos >= this.src.length) return false;
    const ch = this.src[this.pos];
    if ('+ ) }'.includes(ch)) return false;
    if (this.at('\\right)') || this.at('\\rangle')) return false;
    return true;
  }
  _isAlpha(ch) { return ch && /[a-zA-Z]/.test(ch); }
  _isDigit() { const ch = this.peek(); return ch >= '0' && ch <= '9'; }
  _readUntil(stop) {
    let s = '';
    while (this.pos < this.src.length && !this.src.startsWith(stop, this.pos))
      { s += this.src[this.pos]; this.advance(); }
    return s;
  }
  _readBalanced() {
    let depth = 0, s = '';
    while (this.pos < this.src.length) {
      if (this.src[this.pos] === '{') depth++;
      else if (this.src[this.pos] === '}') { if (depth === 0) break; depth--; }
      s += this.src[this.pos]; this.advance();
    }
    return s;
  }
}
