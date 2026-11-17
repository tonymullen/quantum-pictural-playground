/**
 * KnownGates — Library of standard quantum gates, states, and channels.
 * Each entry has a name, a Tensor, and metadata for recognition (Category B).
 */
import C from './Complex.js';
import Tensor from './Tensor.js';

const s2 = 1 / Math.sqrt(2);

/** Standard kets */
export const KET0 = Tensor.ket(0, 1);  // |0⟩
export const KET1 = Tensor.ket(1, 1);  // |1⟩
export const KET_PLUS  = Tensor.fromRows([[C.real(s2)], [C.real(s2)]]);
export const KET_MINUS = Tensor.fromRows([[C.real(s2)], [C.real(-s2)]]);

/** Bell states (unnormalized as produced by cups) */
export const BELL_PHI_PLUS = Tensor.fromRows([
  [C.real(1)], [C.ZERO], [C.ZERO], [C.real(1)]
]); // |00⟩ + |11⟩

/** Bell effect (unnormalized as produced by caps): ⟨00| + ⟨11| */
export const BELL_BRA_PHI_PLUS = Tensor.fromRows([
  [C.real(1), C.ZERO, C.ZERO, C.real(1)]
]);

/** Normalized Bell state/effect for scalar folding */
export const BELL_PHI_PLUS_NORM = Tensor.scale(C.real(s2), BELL_PHI_PLUS);
export const BELL_BRA_PHI_PLUS_NORM = Tensor.scale(C.real(s2), BELL_BRA_PHI_PLUS);

/** Standard 1-qubit gates */
export const I2 = Tensor.identity(2);
export const X  = Tensor.fromRows([[0, 1], [1, 0]]);
export const Y  = Tensor.fromRows([[C.ZERO, C.neg(C.I)], [C.I, C.ZERO]]);
export const Z  = Tensor.fromRows([[1, 0], [0, -1]]);
export const H  = Tensor.fromRows([[C.real(s2), C.real(s2)],
                                    [C.real(s2), C.real(-s2)]]);
export const S  = Tensor.fromRows([[C.ONE, C.ZERO], [C.ZERO, C.I]]);
export const T  = Tensor.fromRows([[C.ONE, C.ZERO],
                                    [C.ZERO, C.phase(Math.PI / 4)]]);

/** Standard 2-qubit gates */
export const CNOT = Tensor.fromRows([
  [1,0,0,0], [0,1,0,0], [0,0,0,1], [0,0,1,0]
]);
export const CZ = Tensor.fromRows([
  [1,0,0,0], [0,1,0,0], [0,0,1,0], [0,0,0,-1]
]);
export const SWAP = Tensor.fromRows([
  [1,0,0,0], [0,0,1,0], [0,1,0,0], [0,0,0,1]
]);

/**
 * Recognition library. Each entry: { name, latex, tensor, nQubits, category }.
 * Used by the pedagogical classifier to identify known objects (Category B).
 */
export const KNOWN_LIBRARY = [
  // 1-qubit gates
  { name: 'Identity',  latex: '\\mathbb{I}',   tensor: I2,   nQubits: 1 },
  { name: 'Pauli X',   latex: 'X',              tensor: X,    nQubits: 1 },
  { name: 'Pauli Y',   latex: 'Y',              tensor: Y,    nQubits: 1 },
  { name: 'Pauli Z',   latex: 'Z',              tensor: Z,    nQubits: 1 },
  { name: 'Hadamard',  latex: 'H',              tensor: H,    nQubits: 1 },
  { name: 'S gate',    latex: 'S',              tensor: S,    nQubits: 1 },
  { name: 'T gate',    latex: 'T',              tensor: T,    nQubits: 1 },
  // 2-qubit gates
  { name: 'CNOT',      latex: '\\operatorname{CNOT}',   tensor: CNOT, nQubits: 2 },
  { name: 'CZ',        latex: '\\operatorname{CZ}',     tensor: CZ,   nQubits: 2 },
  { name: 'SWAP',      latex: '\\operatorname{SWAP}',   tensor: SWAP, nQubits: 2 },
  // States
  { name: '|0⟩', latex: '|0\\rangle', tensor: KET0, nQubits: 1 },
  { name: '|1⟩', latex: '|1\\rangle', tensor: KET1, nQubits: 1 },
  { name: '|+⟩', latex: '|+\\rangle', tensor: KET_PLUS, nQubits: 1 },
  { name: '|−⟩', latex: '|-\\rangle', tensor: KET_MINUS, nQubits: 1 },
  // Normalized Bell (matched first for scalar folding)
  { name: '|Φ⁺⟩', latex: '|\\Phi^+\\rangle', tensor: BELL_PHI_PLUS_NORM, nQubits: 2 },
  { name: '⟨Φ⁺|', latex: '\\langle\\Phi^+|', tensor: BELL_BRA_PHI_PLUS_NORM, nQubits: 2 },
  // Unnormalized Bell (fallback)
  { name: '√2|Φ⁺⟩', latex: '(|00\\rangle + |11\\rangle)',
    tensor: BELL_PHI_PLUS, nQubits: 2 },
  { name: '√2⟨Φ⁺|', latex: '(\\langle 00| + \\langle 11|)',
    tensor: BELL_BRA_PHI_PLUS, nQubits: 2 },
];

/**
 * Try to recognise a tensor in the known library.
 * Returns { match, name, latex, phase } or null.
 */
export function recognise(tensor) {
  for (const entry of KNOWN_LIBRARY) {
    const result = Tensor.equalUpToPhase(entry.tensor, tensor);
    if (result.equal) {
      return { name: entry.name, latex: entry.latex, phase: result.phase };
    }
  }
  return null;
}
