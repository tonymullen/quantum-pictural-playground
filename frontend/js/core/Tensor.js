/**
 * Tensor — Dense complex matrix type for quantum computations.
 * Representation: { rows, cols, d: Complex[] } — row-major flat array.
 * All entries are [re, im] pairs (see Complex.js).
 *
 * Covers: matMul, kron, trace, dagger, partialTrace, outer/inner,
 * equality up to global phase, Frobenius norm.
 */
import C from './Complex.js';

export default class Tensor {
  /** @param {number} rows @param {number} cols @param {C[]} d */
  constructor(rows, cols, d) {
    this.rows = rows;
    this.cols = cols;
    this.d = d; // length = rows * cols
  }

  get(r, c) { return this.d[r * this.cols + c]; }
  set(r, c, v) { this.d[r * this.cols + c] = v; }

  // --- Factories ---
  static zeros(r, c) { return new Tensor(r, c, Array.from({length: r*c}, () => C.ZERO)); }
  static identity(n) {
    const t = Tensor.zeros(n, n);
    for (let i = 0; i < n; i++) t.set(i, i, C.ONE);
    return t;
  }
  static ket(bits, nQubits) {
    const dim = 1 << nQubits;
    const t = Tensor.zeros(dim, 1);
    t.set(bits, 0, C.ONE);
    return t;
  }
  static fromRows(rows) {
    const r = rows.length, c = rows[0].length;
    const d = [];
    for (let i = 0; i < r; i++) for (let j = 0; j < c; j++)
      d.push(typeof rows[i][j] === 'number' ? C.real(rows[i][j]) : rows[i][j]);
    return new Tensor(r, c, d);
  }

  // --- Operations ---
  static mul(A, B) {
    if (A.cols !== B.rows) throw new Error(`mul: ${A.cols} ≠ ${B.rows}`);
    const t = Tensor.zeros(A.rows, B.cols);
    for (let i = 0; i < A.rows; i++)
      for (let j = 0; j < B.cols; j++) {
        let s = C.ZERO;
        for (let k = 0; k < A.cols; k++)
          s = C.add(s, C.mul(A.get(i, k), B.get(k, j)));
        t.set(i, j, s);
      }
    return t;
  }

  static kron(A, B) {
    const rows = A.rows * B.rows, cols = A.cols * B.cols;
    const d = new Array(rows * cols);
    for (let i = 0; i < A.rows; i++)
      for (let j = 0; j < A.cols; j++)
        for (let k = 0; k < B.rows; k++)
          for (let l = 0; l < B.cols; l++)
            d[(i*B.rows+k)*cols + (j*B.cols+l)] = C.mul(A.get(i,j), B.get(k,l));
    return new Tensor(rows, cols, d);
  }

  static add(A, B) {
    if (A.rows!==B.rows || A.cols!==B.cols) throw new Error('add: size mismatch');
    return new Tensor(A.rows, A.cols, A.d.map((v,i) => C.add(v, B.d[i])));
  }

  static scale(s, A) {
    const sc = typeof s === 'number' ? C.real(s) : s;
    return new Tensor(A.rows, A.cols, A.d.map(v => C.mul(sc, v)));
  }

  static dagger(M) {
    const d = new Array(M.cols * M.rows);
    for (let i = 0; i < M.rows; i++)
      for (let j = 0; j < M.cols; j++)
        d[j * M.rows + i] = C.conj(M.get(i, j));
    return new Tensor(M.cols, M.rows, d);
  }

  static trace(M) {
    let s = C.ZERO;
    const n = Math.min(M.rows, M.cols);
    for (let i = 0; i < n; i++) s = C.add(s, M.get(i, i));
    return s;
  }

  /** Partial trace over subsystem.
   *  M is (nA*nB)×(nA*nB). traceOver='A'|'B'. */
  static partialTrace(M, nA, nB, traceOver) {
    if (traceOver === 'B') {
      const t = Tensor.zeros(nA, nA);
      for (let i = 0; i < nA; i++)
        for (let j = 0; j < nA; j++) {
          let s = C.ZERO;
          for (let k = 0; k < nB; k++)
            s = C.add(s, M.get(i*nB+k, j*nB+k));
          t.set(i, j, s);
        }
      return t;
    } else {
      const t = Tensor.zeros(nB, nB);
      for (let i = 0; i < nB; i++)
        for (let j = 0; j < nB; j++) {
          let s = C.ZERO;
          for (let k = 0; k < nA; k++)
            s = C.add(s, M.get(k*nB+i, k*nB+j));
          t.set(i, j, s);
        }
      return t;
    }
  }

  /** Check equality up to global phase. Returns {equal, phase} or {equal:false}. */
  static equalUpToPhase(A, B, tol = 1e-9) {
    if (A.rows!==B.rows || A.cols!==B.cols) return { equal: false };
    let phase = null;
    for (let k = 0; k < A.d.length; k++) {
      if (!C.isZero(A.d[k], tol) && !C.isZero(B.d[k], tol)) {
        phase = C.div(B.d[k], A.d[k]);
        break;
      }
      if (C.isZero(A.d[k], tol) !== C.isZero(B.d[k], tol))
        return { equal: false };
    }
    if (!phase) return { equal: true, phase: C.ONE }; // both zero
    for (let k = 0; k < A.d.length; k++) {
      const scaled = C.mul(phase, A.d[k]);
      if (!C.eq(scaled, B.d[k], tol)) return { equal: false };
    }
    return { equal: true, phase };
  }

  /** Exact equality. */
  static equal(A, B, tol = 1e-9) {
    if (A.rows!==B.rows || A.cols!==B.cols) return false;
    return A.d.every((v, i) => C.eq(v, B.d[i], tol));
  }

  /** Frobenius norm squared. */
  normSq() { return this.d.reduce((s, v) => s + C.abs2(v), 0); }

  /** Pretty print. */
  toString(prec = 4) {
    const rows = [];
    for (let i = 0; i < this.rows; i++) {
      const cells = [];
      for (let j = 0; j < this.cols; j++) cells.push(C.str(this.get(i,j), prec));
      rows.push('  [' + cells.join(', ') + ']');
    }
    return '[\n' + rows.join('\n') + '\n]';
  }
}
