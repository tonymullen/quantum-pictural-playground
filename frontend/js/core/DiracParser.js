/**
 * DiracParser — Parse Dirac-notation LaTeX into an AST.
 *
 * Grammar (loosest binding first):
 *   expr    := [ '\rho' '\mapsto' ] sum                      (a quantum process ρ ↦ …)
 *   sum     := tensor (('+' | '-') tensor)*
 *   tensor  := product ('\otimes' product)*
 *   product := postfix (['\cdot'] postfix | '/' postfix)*       (juxtaposition = composition)
 *   postfix := atom ('^\dagger' | '^{\dagger}' | '^{\otimes N}')*
 *   atom    := '(' sum ')' | '\left(' sum '\right)' | ket | bra | braket
 *            | \ket{…} | \bra{…} | \braket{a|b}
 *            | \frac{sum}{sum} | \sqrt{sum} | e^{sum} | number | i | \pi
 *            | \sum_{i,j} tensor        (a sum over the basis: |i⟩, ⟨i| take 0 and 1)
 *            | \hat{sum} | \widehat{sum}   (PQP's doubling: f̂ = f̄ ⊗ f, wire by wire)
 *            | \mathrm{tr} postfix     (trace)
 *            | '-' atom | named symbol | letter | \text{…} | \operatorname{…} | …
 *
 * So `|0⟩⟨0| ⊗ I + |1⟩⟨1| ⊗ X` reads as (|0⟩⟨0|)⊗I + (|1⟩⟨1|)⊗X, and
 * `H|0⟩ ⊗ |0⟩` as (H|0⟩)⊗|0⟩. Write (H ⊗ I)|00⟩ for a tensor of operators
 * applied to a state.
 *
 * AST node types:
 *   { type:'ket', label }               { type:'bra', label }
 *   { type:'braket', braLabel, ketLabel }
 *   { type:'scalar', value:[re,im] }
 *   { type:'sum', terms:[{sign,node}] }
 *   { type:'product', factors:[] }      { type:'tensor', factors:[] }
 *   { type:'dagger', operand }          { type:'tensorpow', operand, n }
 *   { type:'frac', num, den }           { type:'recip', operand }
 *   { type:'sqrt', operand }            { type:'exp', operand }
 *   { type:'transpose', operand }       { type:'conjugate', operand }   (^T, \overline{…})
 *   { type:'operator', name }
 *   { type:'map', variable, body }      { type:'indexsum', indices:[], body }
 *   { type:'double', operand }          { type:'trace', operand }
 */

export class ParseError {
  constructor(message, pos) { this.message = message; this.pos = pos; }
}

export default function parseDirac(latex) {
  const p = new Parser(latex);
  const ast = p.parseTop();
  p.skipWS();
  if (p.pos < p.src.length)
    throw new ParseError(`Unexpected '${p.src[p.pos]}' at position ${p.pos}`, p.pos);
  return ast;
}

const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ',
  phi: 'φ', varphi: 'φ', psi: 'ψ', lambda: 'λ', mu: 'μ', omega: 'ω', rho: 'ρ' };
const SPACING = ['\\quad', '\\qquad', '\\,', '\\;', '\\:', '\\!', '\\ '];

class Parser {
  constructor(src) { this.src = src.trim(); this.pos = 0; }

  skipWS() {
    for (;;) {
      while (this.pos < this.src.length && ' \t\n\r'.includes(this.src[this.pos])) this.pos++;
      const sp = SPACING.find(s => this.src.startsWith(s, this.pos)
        && !(s === '\\quad' && this.src.startsWith('\\qquad', this.pos)));
      if (!sp) return;
      this.pos += sp.length;
    }
  }
  peek() { this.skipWS(); return this.pos < this.src.length ? this.src[this.pos] : ''; }
  advance(n = 1) { this.pos += n; }
  at(s) { this.skipWS(); return this.src.startsWith(s, this.pos); }
  /** At a LaTeX command `\name` exactly (not a longer command with the same prefix). */
  atCmd(name) { return this.at(name) && !this._isAlpha(this.src[this.pos + name.length]); }
  eat(s) {
    this.skipWS();
    if (!this.src.startsWith(s, this.pos))
      throw new ParseError(`Expected '${s}' at position ${this.pos}`, this.pos);
    this.pos += s.length;
  }
  tryEat(s) { if (this.at(s)) { this.pos += s.length; return true; } return false; }

  parseExpr() { return this.parseSum(); }

  /** Top level: a sum, or a process  ρ ↦ sum. */
  parseTop() {
    const start = this.pos;
    if (this.atCmd('\\rho') || this.at('ρ')) {
      if (this.at('ρ')) this.advance(); else this.eat('\\rho');
      if (this.atCmd('\\mapsto') || this.at('↦')) {
        if (this.at('↦')) this.advance(); else this.eat('\\mapsto');
        return { type: 'map', variable: 'ρ', body: this.parseSum() };
      }
      this.pos = start;
    }
    return this.parseSum();
  }

  parseSum() {
    const terms = [{ sign: 1, node: this.parseTensor() }];
    for (;;) {
      if (this.tryEat('+')) terms.push({ sign: 1, node: this.parseTensor() });
      else if (this.tryEat('-')) terms.push({ sign: -1, node: this.parseTensor() });
      else break;
    }
    if (terms.length === 1) return terms[0].node;
    return { type: 'sum', terms };
  }

  parseTensor() {
    const factors = [this.parseProduct()];
    while (this.tryEat('\\otimes')) factors.push(this.parseProduct());
    return factors.length === 1 ? factors[0] : { type: 'tensor', factors };
  }

  parseProduct() {
    const factors = [this.parsePostfix()];
    for (;;) {
      if (this.atCmd('\\cdot')) { this.eat('\\cdot'); factors.push(this.parsePostfix()); continue; }
      if (this.atCmd('\\times')) { this.eat('\\times'); factors.push(this.parsePostfix()); continue; }
      if (this.tryEat('/')) { factors.push({ type: 'recip', operand: this.parsePostfix() }); continue; }
      if (!this._canStartFactor()) break;
      factors.push(this.parsePostfix());
    }
    return factors.length === 1 ? factors[0] : { type: 'product', factors };
  }

  parsePostfix() {
    let node = this.parseAtom();
    for (;;) {
      if (this.tryEat('^{\\dagger}') || this.tryEat('^\\dagger')) {
        node = { type: 'dagger', operand: node }; continue;
      }
      const m = this.src.slice(this.pos).match(/^\s*\^\{\s*\\otimes\s*(\d+)\s*\}/);
      if (m) { this.pos += m[0].length; node = { type: 'tensorpow', operand: node, n: parseInt(m[1], 10) }; continue; }
      if (this.tryEat('^{T}') || this.tryEat('^T')) { node = { type: 'transpose', operand: node }; continue; }
      if (this.at('^')) throw new ParseError(`Unsupported superscript at position ${this.pos}`, this.pos);
      return node;
    }
  }

  parseAtom() {
    this.skipWS();
    if (this.pos >= this.src.length) throw new ParseError('Unexpected end of expression', this.pos);
    if (this.tryEat('(')) { const e = this.parseExpr(); this.eat(')'); return e; }
    if (this.atCmd('\\left')) {
      this.eat('\\left'); this.eat('('); const e = this.parseExpr();
      this.eat('\\right'); this.eat(')'); return e;
    }
    if (this.atCmd('\\langle')) return this.parseBraOrBraket();
    if (this.peek() === '|') return this.parseKet();
    if (this.atCmd('\\ket')) { this.eat('\\ket'); return { type: 'ket', label: this._braced().trim() }; }
    if (this.atCmd('\\bra')) { this.eat('\\bra'); return { type: 'bra', label: this._braced().trim() }; }
    if (this.atCmd('\\braket')) {
      this.eat('\\braket'); const [a, b] = this._braced().split('|');
      if (b === undefined) throw new ParseError('\\braket needs the form {a|b}', this.pos);
      return { type: 'braket', braLabel: a.trim(), ketLabel: b.trim() };
    }
    if (this.atCmd('\\frac') || this.atCmd('\\dfrac') || this.atCmd('\\tfrac')) return this.parseFrac();
    if (this.atCmd('\\sqrt')) return this.parseSqrt();
    if (this.atCmd('\\exp')) {
      this.eat('\\exp'); this.eat('('); const e = this.parseExpr(); this.eat(')');
      return { type: 'exp', operand: e };
    }
    if (this.atCmd('\\pi')) { this.eat('\\pi'); return { type: 'scalar', value: [Math.PI, 0] }; }
    for (const cmd of ['\\overline', '\\bar'])
      if (this.atCmd(cmd)) { this.eat(cmd); return { type: 'conjugate', operand: this._parseBracedExpr() }; }
    for (const cmd of ['\\widehat', '\\hat'])
      if (this.atCmd(cmd)) { this.eat(cmd); return { type: 'double', operand: this._parseBracedExpr() }; }
    if (this.atCmd('\\sum')) return this.parseIndexSum();
    if (this.atCmd('\\mapsto')) throw new ParseError(`'\\mapsto' must follow \\rho at the start (ρ ↦ …)`, this.pos);
    for (const cmd of ['\\text', '\\mathrm', '\\mathbb', '\\operatorname', '\\mathbf'])
      if (this.atCmd(cmd)) {
        this.eat(cmd);
        const name = this._braced().trim();
        if (/^(tr|Tr|trace)$/.test(name)) return { type: 'trace', operand: this.parsePostfix() };
        return { type: 'operator', name };
      }
    if (this.peek() === 'e' && this.src[this.pos + 1] === '^') {
      this.advance(2);
      const operand = this.peek() === '{' ? this._parseBracedExpr() : this.parseAtom();
      return { type: 'exp', operand };
    }
    if (this.peek() === 'i' && !this._isAlpha(this.src[this.pos + 1])) {
      this.advance(); return { type: 'scalar', value: [0, 1] };
    }
    if (this.peek() === '-') {
      this.advance();
      const inner = this.parseAtom();
      if (inner.type === 'scalar') return { type: 'scalar', value: [-inner.value[0], -inner.value[1]] };
      return { type: 'product', factors: [{ type: 'scalar', value: [-1, 0] }, inner] };
    }
    if (this._isDigit() || (this.peek() === '.' && /\d/.test(this.src[this.pos + 1] || '')))
      return this.parseNumber();
    if (this.peek() === '\\' && this._isAlpha(this.src[this.pos + 1])) return this.parseNamedSymbol();
    const ch = this.peek();
    if (this._isAlpha(ch)) { this.advance(); return { type: 'operator', name: ch }; }
    throw new ParseError(`Unexpected '${ch}' at position ${this.pos}`, this.pos);
  }

  parseKet() {
    this.eat('|');
    const label = this._readUntil('\\rangle');
    if (this.pos >= this.src.length) throw new ParseError("Ket is missing '\\rangle'", this.pos);
    this.eat('\\rangle');
    return { type: 'ket', label: label.trim() };
  }

  parseBraOrBraket() {
    this.eat('\\langle');
    const label1 = this._readUntil('|');
    if (this.pos >= this.src.length) throw new ParseError("Bra is missing '|'", this.pos);
    this.eat('|');
    // ⟨a|b⟩ when what follows up to \rangle is a single plain label
    const saved = this.pos;
    const label2 = this._readUntil('\\rangle');
    if (this.pos < this.src.length && /^[^|\s\\]+$|^\\[a-zA-Z]+(\^\{?[+-]\}?)?$/.test(label2.trim())
        && !label2.includes('\\langle')) {
      this.eat('\\rangle');
      return { type: 'braket', braLabel: label1.trim(), ketLabel: label2.trim() };
    }
    this.pos = saved;
    return { type: 'bra', label: label1.trim() };
  }

  /** \sum_{i,j} body  or  \sum_i body — the body is the following ⊗-term. */
  parseIndexSum() {
    this.eat('\\sum');
    let indices = [];
    if (this.tryEat('_')) {
      const raw = this.peek() === '{' ? this._braced() : (this.advance(), this.src[this.pos - 1]);
      indices = raw.split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
    }
    if (!indices.length || !indices.every(x => /^[a-zA-Z]$/.test(x)))
      throw new ParseError('Write a sum over the basis as \\sum_{i} or \\sum_{i,j} (single-letter indices)', this.pos);
    return { type: 'indexsum', indices, body: this.parseTensor() };
  }

  parseFrac() {
    this.advance(this.src.startsWith('\\frac', this.pos) ? 5 : 6);
    const num = this._parseBracedExpr();
    const den = this._parseBracedExpr();
    return { type: 'frac', num, den };
  }

  parseSqrt() {
    this.eat('\\sqrt');
    if (this.peek() === '{') return { type: 'sqrt', operand: this._parseBracedExpr() };
    if (this._isDigit()) {  // \sqrt2
      const v = parseInt(this.src[this.pos], 10); this.advance();
      return { type: 'sqrt', operand: { type: 'scalar', value: [v, 0] } };
    }
    throw new ParseError(`Expected '{' after \\sqrt at position ${this.pos}`, this.pos);
  }

  parseNamedSymbol() {
    const start = this.pos;
    this.eat('\\'); let name = '';
    while (this.pos < this.src.length && this._isAlpha(this.src[this.pos]))
      { name += this.src[this.pos]; this.advance(); }
    if (['otimes', 'rangle', 'right', 'cdot', 'times', 'mapsto'].includes(name))
      throw new ParseError(`Unexpected '\\${name}' at position ${start}`, start);
    return { type: 'operator', name: GREEK[name] || name };
  }

  parseNumber() {
    let s = '';
    while (this.pos < this.src.length && '0123456789.'.includes(this.src[this.pos]))
      { s += this.src[this.pos]; this.advance(); }
    const v = parseFloat(s);
    if (isNaN(v)) throw new ParseError(`Bad number '${s}'`, this.pos);
    return { type: 'scalar', value: [v, 0] };
  }

  _parseBracedExpr() {
    this.eat('{'); const e = this.parseExpr(); this.eat('}'); return e;
  }

  _canStartFactor() {
    this.skipWS();
    if (this.pos >= this.src.length) return false;
    const ch = this.src[this.pos];
    if ('+-)}/^'.includes(ch)) return false;
    for (const stop of ['\\otimes', '\\right', '\\rangle', '\\cdot', '\\times', '\\mapsto'])
      if (this.atCmd(stop)) return false;
    return true;
  }
  _isAlpha(ch) { return !!ch && /[a-zA-Z]/.test(ch); }
  _isDigit() { const ch = this.peek(); return ch >= '0' && ch <= '9'; }
  _readUntil(stop) {
    let s = '';
    while (this.pos < this.src.length && !this.src.startsWith(stop, this.pos))
      { s += this.src[this.pos]; this.advance(); }
    return s;
  }
  /** Read the raw text of a {...} group (balanced braces). */
  _braced() {
    this.eat('{');
    let depth = 0, s = '';
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === '{') depth++;
      else if (ch === '}') { if (depth === 0) break; depth--; }
      s += ch; this.advance();
    }
    this.eat('}');
    return s;
  }
}
