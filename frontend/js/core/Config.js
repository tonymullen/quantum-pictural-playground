/**
 * Config — Centralised thresholds and settings.
 * Exposed in an instructor settings panel (future).
 */
const Config = {
  // Pedagogical budgets
  maxAdditiveTerms: 8,         // Category A threshold
  maxMatrixDisplay: 16,        // Largest matrix to show as heatmap (16×16)
  maxQubits: 6,                // Target qubit limit for full contraction
  maxGenerators: 30,           // Target generator budget
  maxContractionRank: 22,      // Max open wires on any intermediate tensor (2^22 entries ≈ 64 MB)

  // Sync
  debounceMs: 500,             // Debounce delay before auto-sync

  // Verification
  numericTolerance: 1e-9,      // Tolerance for matrix comparison

  // Display
  complexPrecision: 4,         // Decimal places for complex number display

  // Pyodide
  pyodideCdnUrl: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js',
};

export default Config;
