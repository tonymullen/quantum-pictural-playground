/**
 * Complex number arithmetic.
 * Representation: [re, im] — a two-element array.
 * Chosen for compactness and zero object overhead in tensor arrays.
 */

/** @typedef {[number, number]} C */

const Complex = {
  // Construction
  of:   (re, im = 0) => [re, im],
  real: r => [r, 0],
  imag: i => [0, i],
  phase: theta => [Math.cos(theta), Math.sin(theta)],

  // Constants
  ZERO: [0, 0],
  ONE:  [1, 0],
  I:    [0, 1],
  NEG1: [-1, 0],

  // Arithmetic
  add:  ([a, b], [c, d]) => [a + c, b + d],
  sub:  ([a, b], [c, d]) => [a - c, b - d],
  mul:  ([a, b], [c, d]) => [a * c - b * d, a * d + b * c],
  scale: (s, [a, b]) => [s * a, s * b],
  div:  (z, w) => {
    const d = w[0] * w[0] + w[1] * w[1];
    return [(z[0] * w[0] + z[1] * w[1]) / d,
            (z[1] * w[0] - z[0] * w[1]) / d];
  },

  // Unary
  conj: ([a, b]) => [a, -b],
  neg:  ([a, b]) => [-a, -b],
  abs2: ([a, b]) => a * a + b * b,
  abs:  z => Math.sqrt(Complex.abs2(z)),
  arg:  ([a, b]) => Math.atan2(b, a),

  // Comparison
  eq: (a, b, tol = 1e-10) => Math.abs(a[0] - b[0]) < tol &&
                              Math.abs(a[1] - b[1]) < tol,
  isZero: (z, tol = 1e-10) => Complex.abs2(z) < tol * tol,

  // Display
  str: ([a, b], prec = 4) => {
    if (Math.abs(b) < 1e-14) return a.toFixed(prec);
    if (Math.abs(a) < 1e-14) return b.toFixed(prec) + 'i';
    const sign = b >= 0 ? '+' : '';
    return `${a.toFixed(prec)}${sign}${b.toFixed(prec)}i`;
  },
};

export default Complex;
