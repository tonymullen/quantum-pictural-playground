# Fix: Disconnected-component translation

## Problem origins traced through the pipeline

### 1. No component decomposition — `DiagramToDirac.js:21-32`
`diagramToDirac()` calls `contractIR(ir)` on the entire graph as one piece.
For disconnected components {CNOT, cap, H}, this Kronecker-products all five
generators into a 32×8 tensor (2^5 outputs × 2^3 inputs), which is 32
non-zero entries — exceeding the 8-term budget → Category D → size summary.
**Root cause.** Fix: decompose IR into connected components, translate each
independently, combine with ⊗.

### 2. Whole-diagram fallback — `Classify.js:74-83`
The readability budget (`maxAdditiveTerms=8`) is applied to the monolithic
tensor. With component decomposition, each sub-tensor (CNOT=4×4, cap=1×4,
H=2×2) is well within budget and individually recognisable.

### 3. Summary text in formula editor — `DiagramToDirac.js:56-58`
Category D sets `latex = display = _structuralSummary(...)` — a `\text{...}`
string. This gets placed in the textarea. When the textarea content is
re-parsed by the Dirac parser, `\text{...}` parses as an operator, and
`evalDirac` returns null (no known gate named "5-qubit..."), producing the
"symbolic operators" warning. **Fix:** `diagramToDirac` must separate
parseable `latex` from informational `display`. Category D/F set `latex=''`
and put the summary in `info` only. The editor must not put non-parseable
text in the textarea.

### 4. Boundary ordering — `DiagramToIR.js:105-117`
Currently sorts open ports by x-position of the diagram node. For the CNOT
(Z-spider at x=200 with 1 open input at the top and 1 open output at the
bottom, X-spider at x=200 with 1 open input at the top and 1 open output at
the bottom), both nodes have the same x, so port-index tiebreak determines
order. The Z-spider is typically created first (lower node id), so its ports
come first. Whether this produces CNOT or CNOT·SWAP depends on which port
is control vs target — the x-tiebreak is fragile. **Fix:** within a
component, trace through-wires and pair input/output on the same wire.

### 5. "Symbolic operators" warning — `SyncController.js:158-165`
This message fires when `evalDirac(ast)` returns null. It happens because the
structural summary text from Category D was placed in the textarea and then
re-parsed. With fix #3, this path won't be reached for concrete diagrams.
