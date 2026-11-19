/**
 * Test fixtures for the diagram→Dirac translation pipeline.
 * Run by opening tests/test-fixtures.html in a browser.
 */
import DiagramDocument from '../js/editors/DiagramEditor/DiagramDocument.js';
import DiagramNode, { NODE_TYPES as NT } from '../js/editors/DiagramEditor/DiagramNode.js';
import DiagramWire from '../js/editors/DiagramEditor/DiagramWire.js';
import diagramToDirac from '../js/core/DiagramToDirac.js';
import contractIR from '../js/core/ContractIR.js';
import diagramToIR from '../js/core/DiagramToIR.js';
import parseDirac from '../js/core/DiracParser.js';
import evalDirac from '../js/core/DiracEval.js';
import Tensor from '../js/core/Tensor.js';
import Phase from '../js/core/Phase.js';
import C from '../js/core/Complex.js';
import { verify } from '../js/core/Verify.js';
import circuitToIR from '../js/core/CircuitToIR.js';
import circuitToDirac from '../js/core/CircuitToDirac.js';
import { circuitTensor, circuitChannel } from '../js/core/CircuitGates.js';
import { evalProcess } from '../js/core/DiracEval.js';
import { evaluateDiagram } from '../js/core/ProcessDirac.js';
import CircuitDocument from '../js/editors/CircuitEditor/CircuitDocument.js';
import { derivedDiagram } from '../js/editors/CircuitEditor/CircuitDiagramLink.js';
import SyncController from '../js/core/SyncController.js';
import { checkStep, parsePhaseExpr } from '../js/core/ProofCheck.js';
import { orientTensor } from '../js/core/Interpret.js';
import ProofDocument from '../js/editors/EquationEditor/ProofDocument.js';
import DocumentStore from '../js/editors/DocumentStore.js';
import { captureWorkbook, openWorkbookDocuments, summaryText } from '../js/workbooks/Workbook.js';
import { DemoStore, LocalWorkbookStore } from '../js/workbooks/WorkbookStores.js';
import { copyFragment, pasteFragment, fits, replaceRegion, regionBoundary, plugCandidates } from '../js/editors/DiagramEditor/Fragment.js';

const out = document.getElementById('out');
let passed = 0, failed = 0;
function log(s, cls='') { out.innerHTML += `<span class="${cls}">${s}</span>\n`; }
function assert(cond, msg) {
  if (cond) { passed++; log(`  ✓ ${msg}`, 'pass'); }
  else { failed++; log(`  ✗ ${msg}`, 'fail'); }
}
function addN(doc, type, x, y, opts={}) {
  const n = new DiagramNode(type, x, y);
  if (opts.inputs !== undefined) n.inputs = opts.inputs;
  if (opts.outputs !== undefined) n.outputs = opts.outputs;
  if (opts.label) n.label = opts.label;
  doc.nodes.set(n.id, n); return n;
}
function w(doc, from, fp, to, tp) {
  doc.wires.push(new DiagramWire(from.id, fp, to.id, tp));
}

/** Round-trip helper: generate → parse → eval → verify exactly. */
function roundTrip(doc, name) {
  const r = diagramToDirac(doc);
  if (!r.latex) { assert(false, `${name}: Generate produced empty latex`); return; }
  let ast;
  try { ast = parseDirac(r.latex); }
  catch(e) { assert(false, `${name}: Parse error: ${e.message} in "${r.latex}"`); return; }
  const et = evalDirac(ast);
  if (!et) { assert(false, `${name}: Eval returned null for "${r.latex}"`); return; }
  const ir = diagramToIR(doc);
  const { tensor: dt } = contractIR(ir);
  if (!dt) { assert(false, `${name}: Diagram contraction returned null`); return; }
  const v = verify(dt, et);
  assert(v.status === 'equivalent' && C.eq(v.scalar, C.ONE),
    `${name}: Round-trip exact (status=${v.status}, scalar=${v.scalar ? C.str(v.scalar) : 'none'})`);
}

/** Standard ZX CNOT: Z spider (control) left, X spider (target) right,
 *  joined by a leg. Wire order follows port positions, so this is CNOT. */
function addCNOT(doc, x = 100, y = 100) {
  const z = addN(doc, NT.Z_SPIDER, x, y, {inputs:1, outputs:2});
  const xs = addN(doc, NT.X_SPIDER, x + 70, y, {inputs:2, outputs:1});
  w(doc, z, 1, xs, 0);
  return { z, x: xs };
}

// ===== NEW FIXTURE SET =====

// Helper: build the example diagram (Z-X CNOT + cap + H)
function makeExample() {
  const doc = new DiagramDocument('example');
  const { z, x } = addCNOT(doc);
  const cap = addN(doc, NT.CAP, 300, 100);
  const h = addN(doc, NT.HADAMARD, 500, 100);
  return { doc, z, x, cap, h };
}

// --- F1: Cap printed as bra, not ket ---
log('\n=== F1: Cap direction (bra, not ket) ===');
{
  const doc = new DiagramDocument('f1');
  addN(doc, NT.CAP, 100, 100);
  const r = diagramToDirac(doc);
  log(`  latex: ${r.latex}`, 'info');
  log(`  info: ${r.info}`, 'info');
  assert(r.latex.includes('langle'), 'Cap latex contains ⟨ (langle)');
  assert(!r.latex.includes('rangle'), 'Cap latex does NOT contain ⟩ (rangle)');
  assert(r.info.includes('⟨') || r.info.includes('bra') || r.info.includes('effect'),
    'Info mentions bra/effect direction');
}

// --- F2: Cup printed as ket, not bra ---
log('\n=== F2: Cup direction (ket, not bra) ===');
{
  const doc = new DiagramDocument('f2');
  addN(doc, NT.CUP, 100, 100);
  const r = diagramToDirac(doc);
  log(`  latex: ${r.latex}`, 'info');
  assert(r.latex.includes('rangle'), 'Cup latex contains ⟩ (rangle)');
  assert(!r.latex.includes('langle'), 'Cup latex does NOT contain ⟨ (langle)');
}

// --- F3: Shape mismatch rejected ---
log('\n=== F3: Shape mismatch (cup formula vs cap diagram) ===');
{
  // Cap diagram (1×4 effect), cup formula (4×1 state)
  const doc = new DiagramDocument('f3');
  addN(doc, NT.CAP, 100, 100);
  const ir = diagramToIR(doc);
  const { tensor: diagT } = contractIR(ir);
  // Evaluate a ket expression (state = 4×1)
  const ast = parseDirac('|00\\rangle + |11\\rangle');
  const exprT = evalDirac(ast);
  if (diagT && exprT) {
    const v = verify(diagT, exprT);
    assert(v.status === 'not-equivalent', 'Shape mismatch → not equivalent');
    assert(v.hint.includes('Shape') || v.hint.includes('mismatch'),
      'Hint mentions shape mismatch');
    log(`  hint: ${v.hint}`, 'info');
  }
}

// --- F4: Example generates exactly, no scalar ---
log('\n=== F4: Example → CNOT ⊗ ⟨Φ⁺| ⊗ H, no prefactor ===');
{
  const { doc } = makeExample();
  const r = diagramToDirac(doc);
  log(`  latex: ${r.latex}`, 'info');
  log(`  info: ${r.info}`, 'info');
  assert(r.latex !== '', 'Parseable latex produced');
  assert(r.latex.includes('otimes'), 'Components joined with ⊗');
  assert(r.latex.includes('langle'), 'Cap component uses bra (langle)');
  assert(!r.latex.includes('cdot'), 'No scalar prefactor (no \\cdot)');
}

// --- F5: Round-trip on every concrete fixture ---
log('\n=== F5: Round-trip (generate → parse → eval → verify exact) ===');
{
  // CNOT
  const d1 = new DiagramDocument('rt1');
  const { z, x } = addCNOT(d1);
  roundTrip(d1, 'CNOT');
  // Cap alone
  const d2 = new DiagramDocument('rt2'); addN(d2,NT.CAP,100,100);
  roundTrip(d2, 'Cap');
  // Cup alone
  const d3 = new DiagramDocument('rt3'); addN(d3,NT.CUP,100,100);
  roundTrip(d3, 'Cup');
  // H alone
  const d4 = new DiagramDocument('rt4'); addN(d4,NT.HADAMARD,100,100);
  roundTrip(d4, 'H');
  // Three-component
  const { doc: d5 } = makeExample();
  roundTrip(d5, 'Example (3 components)');
}

// ===== LEGACY TESTS (kept) =====
log('\n=== 1: Z-X pair + cap + H ===');
{
  const doc = new DiagramDocument('t1');
  const { z, x } = addCNOT(doc);
  addN(doc, NT.CAP, 300, 100);
  addN(doc, NT.HADAMARD, 500, 100);
  const r = diagramToDirac(doc);
  log(`  latex: ${r.latex}`, 'info');
  log(`  info: ${r.info}`, 'info');
  assert(r.category !== 'D', 'Not Category D');
  assert(r.category !== 'error', 'No errors');
  assert(r.latex !== '', 'Parseable latex produced');
  assert(!r.latex.includes('\\text{'), 'No summaries in latex');
}

// === 2: CNOT alone ===
log('\n=== 2: CNOT alone ===');
{
  const doc = new DiagramDocument('t2');
  const { z, x } = addCNOT(doc);
  const ir = diagramToIR(doc);
  const { tensor } = contractIR(ir);
  const CNOT = Tensor.fromRows([[1,0,0,0],[0,1,0,0],[0,0,0,1],[0,0,1,0]]);
  if (tensor) {
    const eq = Tensor.equalUpToPhase(tensor, CNOT);
    assert(eq.equal, `Tensor equals CNOT up to phase (${C.str(eq.phase)})`);
  } else { assert(false, 'Tensor is null'); }
}

// === 3: Cap alone ===
log('\n=== 3: Cap alone → ⟨Φ⁺| ===');
{
  const doc = new DiagramDocument('t3');
  addN(doc, NT.CAP, 100, 100);
  const ir = diagramToIR(doc);
  const { tensor } = contractIR(ir);
  const bellBra = Tensor.fromRows([[C.ONE, C.ZERO, C.ZERO, C.ONE]]);
  if (tensor) {
    assert(Tensor.equalUpToPhase(tensor, bellBra).equal, 'Cap = ⟨00|+⟨11|');
  }
  const r = diagramToDirac(doc);
  assert(r.latex !== '', 'Produces parseable output');
}

// === 3b: Cup alone ===
log('\n=== 3b: Cup alone → |Φ⁺⟩ ===');
{
  const doc = new DiagramDocument('t3b');
  addN(doc, NT.CUP, 100, 100);
  const ir = diagramToIR(doc);
  const { tensor } = contractIR(ir);
  const bellKet = Tensor.fromRows([[C.ONE],[C.ZERO],[C.ZERO],[C.ONE]]);
  if (tensor) {
    assert(Tensor.equalUpToPhase(tensor, bellKet).equal, 'Cup = |00⟩+|11⟩');
  }
}

// === 4: Closed loop → scalar 2 ===
log('\n=== 4: Cup+cap loop → scalar 2 ===');
{
  const doc = new DiagramDocument('t4');
  const cup = addN(doc, NT.CUP, 100, 50);
  const cap = addN(doc, NT.CAP, 100, 150);
  w(doc, cup, 0, cap, 0); w(doc, cup, 1, cap, 1);
  const ir = diagramToIR(doc);
  const { tensor } = contractIR(ir);
  if (tensor) {
    assert(tensor.rows === 1 && tensor.cols === 1, 'Result is scalar');
    const v = tensor.get(0, 0);
    assert(Math.abs(v[0] - 2) < 0.01, `Value is 2 (got ${C.str(v)})`);
  }
}

// === 5: Hadamard recognised ===
log('\n=== 5: Hadamard alone ===');
{
  const doc = new DiagramDocument('t5');
  addN(doc, NT.HADAMARD, 100, 100);
  const r = diagramToDirac(doc);
  assert(r.reason.includes('Hadamard'), 'Recognised as Hadamard');
}

// === 6: Round-trip parse invariant ===
log('\n=== 6: Generated latex parses without error ===');
{
  const doc = new DiagramDocument('t6');
  const { z, x } = addCNOT(doc);
  addN(doc, NT.CAP, 300, 100);
  addN(doc, NT.HADAMARD, 500, 100);
  const r = diagramToDirac(doc);
  if (r.latex) {
    let ok = true;
    try { parseDirac(r.latex); } catch(e) { ok = false; log(`  Error: ${e.message}`, 'fail'); }
    assert(ok, 'Parses without error');
  } else { assert(true, 'Empty latex — trivially valid'); }
}

// === 7: Numerical verification ===
log('\n=== 7: Verify H diagram against generated Dirac ===');
{
  const doc = new DiagramDocument('t7');
  addN(doc, NT.HADAMARD, 100, 100);
  const ir = diagramToIR(doc);
  const { tensor: dt } = contractIR(ir);
  const r = diagramToDirac(doc);
  if (r.latex && dt) {
    try {
      const ast = parseDirac(r.latex);
      const et = evalDirac(ast);
      if (et) {
        const v = verify(dt, et);
        assert(v.status === 'equivalent', `Tensors match (${v.status})`);
      } else { log('  Eval returned null', 'info'); }
    } catch(e) { failed++; log(`  Error: ${e.message}`, 'fail'); }
  }
}

// === 8: No false symbolic warning ===
log('\n=== 8: No false symbolic warning on concrete diagram ===');
{
  const doc = new DiagramDocument('t8');
  const { z, x } = addCNOT(doc);
  addN(doc, NT.CUP, 300, 100);
  const r = diagramToDirac(doc);
  assert(!r.reason.includes('symbolic'), 'No symbolic warning');
  assert(r.category !== 'F', 'Not Category F');
}

// === 9: Mixed symbolic + concrete components ===
log('\n=== 9: Morphism f (symbolic) + H (concrete) ===');
{
  const doc = new DiagramDocument('t9');
  addN(doc, NT.MORPHISM, 100, 100, { label: 'f' });
  addN(doc, NT.HADAMARD, 300, 100);
  const r = diagramToDirac(doc);
  log(`  latex: "${r.latex}"`, 'info');
  log(`  info: ${r.info}`, 'info');
  log(`  category: ${r.category}`, 'info');
  // The f box is symbolic (Category F), H is recognised (Category B).
  // Overall should report the symbolic part but not crash.
  assert(r.category !== 'error', 'No error');
  // Info should mention symbolic
  assert(r.info.includes('Symbolic') || r.info.includes('symbolic')
    || r.reason.includes('symbolic') || r.category === 'F',
    'Reports symbolic component');
  // The concrete H component should still appear in the latex
  assert(r.latex.includes('H') || r.info.includes('Hadamard'),
    'Concrete H component still appears');
  // Symbolic f should also appear in latex
  assert(r.latex.includes('f'), 'Symbolic f appears in latex');
}

// === 10: One large component next to small ones ===
log('\n=== 10: Large component + small component ===');
{
  const doc = new DiagramDocument('t10');
  // Build a 3-qubit circuit: 3 Hadamards feeding into a Z-spider (3→3)
  // This produces a 8×8 tensor with many non-zero terms → large
  const z3 = addN(doc, NT.Z_SPIDER, 100, 100, { inputs: 3, outputs: 3 });
  const h1 = addN(doc, NT.HADAMARD, 50, 50);
  const h2 = addN(doc, NT.HADAMARD, 100, 50);
  const h3 = addN(doc, NT.HADAMARD, 150, 50);
  w(doc, h1, 0, z3, 0);
  w(doc, h2, 0, z3, 1);
  w(doc, h3, 0, z3, 2);
  // Small component alongside: a standalone cap
  addN(doc, NT.CAP, 400, 100);

  const r = diagramToDirac(doc);
  log(`  latex: "${r.latex}"`, 'info');
  log(`  info: ${r.info}`, 'info');
  log(`  category: ${r.category}`, 'info');
  // The cap component should be recognised even if the large one falls back
  assert(r.info.includes('cap') || r.info.includes('Φ')
    || r.reason.includes('cap') || r.reason.includes('Φ')
    || (r.latex && r.latex.includes('langle')),
    'Cap component still recognised');
  assert(r.category !== 'error', 'No error');
}

// === 11: Snake through H → Tr(H) = 0 ===
log('\n=== 11: Snake through H → Tr(H) = 0 ===');
{
  // cap · (H⊗I) · cup = Tr(H) = H₀₀+H₁₁ = 1/√2 − 1/√2 = 0
  const doc = new DiagramDocument('t11');
  const cup = addN(doc, NT.CUP, 100, 50);
  const h = addN(doc, NT.HADAMARD, 100, 120);
  const cap = addN(doc, NT.CAP, 100, 190);
  w(doc, cup, 0, h, 0);
  w(doc, h, 0, cap, 0);
  w(doc, cup, 1, cap, 1);
  const ir = diagramToIR(doc);
  const { tensor } = contractIR(ir);
  if (tensor) {
    assert(tensor.rows === 1 && tensor.cols === 1, 'Fully contracted to scalar');
    const v = tensor.get(0,0);
    assert(C.isZero(v), `Tr(H) = 0 (got ${C.str(v)})`);
  } else { assert(false, 'Tensor should not be null'); }
}

// === 12: Pure snake (cup+cap, no gate) → Tr(I) = 2 ===
log('\n=== 12: Pure snake → Tr(I) = 2 ===');
{
  // This is the same as test 4 but described as a "snake equation"
  // cap · (I⊗I) · cup = Tr(I) = 2
  const doc = new DiagramDocument('t12');
  const cup = addN(doc, NT.CUP, 100, 50);
  const cap = addN(doc, NT.CAP, 100, 150);
  w(doc, cup, 0, cap, 0);
  w(doc, cup, 1, cap, 1);
  const ir = diagramToIR(doc);
  const { tensor } = contractIR(ir);
  if (tensor) {
    const v = tensor.get(0,0);
    assert(Math.abs(v[0] - 2) < 0.01, `Tr(I) = 2 (got ${C.str(v)})`);
  }
}

// ===== SYMBOLIC GENERATOR TESTS =====

// --- S1: Lone state → |φ⟩ ---
log('\n=== S1: Lone state φ → |φ⟩ ===');
{
  const doc = new DiagramDocument('s1');
  addN(doc, NT.STATE, 100, 100, { label: 'φ' });
  const r = diagramToDirac(doc);
  log(`  latex: ${r.latex}`, 'info');
  assert(r.latex.includes('rangle'), 'Contains ket (rangle)');
  assert(r.latex.includes('φ') || r.latex.includes('phi'), 'Contains label φ');
  assert(r.latex !== '', 'Non-empty output');
}

// --- S2: Lone effect φ → ⟨φ| ---
log('\n=== S2: Lone effect φ → ⟨φ| ===');
{
  const doc = new DiagramDocument('s2');
  addN(doc, NT.EFFECT, 100, 100, { label: 'φ' });
  const r = diagramToDirac(doc);
  log(`  latex: ${r.latex}`, 'info');
  assert(r.latex.includes('langle'), 'Contains bra (langle)');
  assert(r.latex.includes('φ') || r.latex.includes('phi'), 'Contains label φ');
}

// --- S3: State ψ below effect φ → ⟨φ|ψ⟩ ---
log('\n=== S3: State ψ + effect φ wired → ⟨φ|ψ⟩ ===');
{
  const doc = new DiagramDocument('s3');
  const st = addN(doc, NT.STATE, 100, 150, { label: 'ψ' });
  const ef = addN(doc, NT.EFFECT, 100, 50, { label: 'φ' });
  w(doc, st, 0, ef, 0);
  const r = diagramToDirac(doc);
  log(`  latex: ${r.latex}`, 'info');
  assert(r.latex.includes('langle'), 'Contains bra');
  assert(r.latex.includes('rangle') || r.latex.includes('ψ'), 'Contains state ref');
  assert(r.latex !== '', 'Non-empty');
}

// --- S4: State ψ below box f → f|ψ⟩ ---
log('\n=== S4: State ψ + box f → f|ψ⟩ ===');
{
  const doc = new DiagramDocument('s4');
  const st = addN(doc, NT.STATE, 100, 150, { label: 'ψ' });
  const f = addN(doc, NT.MORPHISM, 100, 50, { label: 'f' });
  w(doc, st, 0, f, 0);
  const r = diagramToDirac(doc);
  log(`  latex: ${r.latex}`, 'info');
  assert(r.latex.includes('f'), 'Contains f');
  assert(r.latex.includes('rangle') || r.latex.includes('ψ'), 'Contains ket/state');
  assert(r.latex !== '', 'Non-empty');
}

// --- S5: Mixed symbolic ψ ⊗ concrete H → |ψ⟩ ⊗ H ---
log('\n=== S5: Symbolic state ⊗ concrete H ===');
{
  const doc = new DiagramDocument('s5');
  addN(doc, NT.STATE, 100, 100, { label: 'ψ' });
  addN(doc, NT.HADAMARD, 300, 100);
  const r = diagramToDirac(doc);
  log(`  latex: ${r.latex}`, 'info');
  assert(r.latex !== '', 'Non-empty');
  assert(r.latex.includes('otimes'), 'Contains ⊗');
  assert(r.latex.includes('rangle') || r.latex.includes('ψ'), 'Contains state');
  assert(r.latex.includes('H'), 'Contains H');
}

// --- S6: No "[Category F]" in user-facing text ---
log('\n=== S6: No internal codes in user text ===');
{
  const doc = new DiagramDocument('s6');
  addN(doc, NT.MORPHISM, 100, 100, { label: 'f' });
  const r = diagramToDirac(doc);
  assert(!r.reason.includes('[Category'), 'No [Category] in reason');
  assert(!r.info.includes('[Category'), 'No [Category] in info');
  assert(!r.reason.includes('generic boxes'), 'No "generic boxes" for a morphism');
}


// ===== REGRESSION: WIRE ORDER, CONTRACTION, PHASES, PARSER =====

const CNOT_T = Tensor.fromRows([[1,0,0,0],[0,1,0,0],[0,0,0,1],[0,0,1,0]]);
const diagTensor = doc => contractIR(diagramToIR(doc)).tensor;
const evalStr = s => evalDirac(parseDirac(s));

// --- R1: Result does not depend on node creation order ---
log('\n=== R1: CNOT independent of creation order ===');
{
  const d = new DiagramDocument('r1');
  const x = addN(d, NT.X_SPIDER, 170, 100, {inputs:2, outputs:1});  // target created first
  const z = addN(d, NT.Z_SPIDER, 100, 100, {inputs:1, outputs:2});
  w(d, z, 1, x, 0);
  const t = diagTensor(d);
  assert(t && Tensor.equalUpToPhase(CNOT_T, t).equal, 'X-first CNOT is still CNOT up to scalar (control on the left)');
}

// --- R2: Generate verifies against its own diagram with interleaved creation ---
log('\n=== R2: Interleaved components round-trip ===');
{
  const d = new DiagramDocument('r2');
  const z = addN(d, NT.Z_SPIDER, 100, 100, {inputs:1, outputs:2});
  addN(d, NT.HADAMARD, 400, 100);
  const x = addN(d, NT.X_SPIDER, 170, 100, {inputs:2, outputs:1});
  w(d, z, 1, x, 0);
  roundTrip(d, 'CNOT, H, interleaved creation');
}

// --- R3: Tensor order follows left-to-right position ---
log('\n=== R3: Z(π) left, H right → Z ⊗ H ===');
{
  const d = new DiagramDocument('r3');
  addN(d, NT.HADAMARD, 300, 100);                 // created first, but on the right
  addN(d, NT.Z_SPIDER, 100, 100, {label: 'π'});
  const r = diagramToDirac(d);
  log(`  latex: ${r.latex}`, 'info');
  assert(r.latex === 'Z \\otimes H', 'Prints Z ⊗ H');
  roundTrip(d, 'Z ⊗ H');
}

// --- R4: Boundary markers agree with tensor order ---
log('\n=== R4: Boundary markers follow tensor order ===');
{
  const d = new DiagramDocument('r4');
  const h = addN(d, NT.HADAMARD, 300, 100);
  const zs = addN(d, NT.Z_SPIDER, 100, 100, {label: 'π'});
  diagramToIR(d);
  assert(d.inputBoundary[0].nodeId === zs.id && d.inputBoundary[1].nodeId === h.id,
    'in0 is the left wire, in1 the right wire');
}

// --- R5: Symbolic spider phase is not treated as 0 ---
log('\n=== R5: Z spider with phase α is symbolic ===');
{
  const d = new DiagramDocument('r5');
  addN(d, NT.Z_SPIDER, 100, 100, {label: 'α'});
  assert(diagTensor(d) === null, 'No concrete tensor');
  const r = diagramToDirac(d);
  log(`  latex: ${r.latex}`, 'info');
  assert(r.category === 'F', 'Category F (symbolic)');
  assert(r.latex.includes('alpha'), 'Phase α appears in latex');
  assert(r.info.includes('α'), 'Info names the symbolic phase');
}

// --- R6: Phase parsing ---
log('\n=== R6: Phase labels ===');
{
  const ok = (lbl, deg) => {
    const d = new DiagramDocument('r6');
    addN(d, NT.Z_SPIDER, 100, 100, {label: lbl});
    const t = diagTensor(d);
    return t && C.eq(t.get(1, 1), C.phase(deg * Math.PI / 180));
  };
  assert(ok('π/2', 90) && ok('pi/4', 45) && ok('-3π/4', -135) && ok('1/2', 90) && ok('', 0),
    'π/2, pi/4, -3π/4, 1/2, empty');
  const sym = lbl => { const d = new DiagramDocument('r6'); addN(d, NT.Z_SPIDER, 100, 100, {label: lbl}); return diagTensor(d) === null; };
  assert(sym('i') && sym('2p') && sym('θ'), '"i", "2p", "θ" are symbolic, not multiples of π');
}

// --- R7: Spider with no legs is 1 + e^{iα} ---
log('\n=== R7: 0-leg spiders ===');
{
  const d = new DiagramDocument('r7');
  addN(d, NT.Z_SPIDER, 100, 100, {inputs:0, outputs:0, label: 'π'});
  const t = diagTensor(d);
  assert(t && C.isZero(t.get(0, 0)), 'Z(π) with no legs = 0');
  const d2 = new DiagramDocument('r7b');
  addN(d2, NT.X_SPIDER, 100, 100, {inputs:0, outputs:0});
  assert(C.eq(diagTensor(d2).get(0, 0), [2, 0]), 'X(0) with no legs = 2');
}

// --- R8: Long circuits contract quickly ---
log('\n=== R8: Contraction scales with circuit length ===');
{
  const d = new DiagramDocument('r8');
  let cPrev = null, tPrev = null;
  for (let k = 0; k < 12; k++) {
    const { z, x } = addCNOT(d, 100, 400 - k * 60);
    if (cPrev) { w(d, cPrev, 0, z, 0); w(d, tPrev, 0, x, 1); }
    cPrev = z; tPrev = x;
  }
  const t0 = performance.now();
  const t = diagTensor(d);
  const ms = performance.now() - t0;
  log(`  12 chained CNOTs: ${ms.toFixed(1)} ms`, 'info');
  assert(t && Tensor.equalUpToPhase(Tensor.identity(4), t).equal, 'CNOT^12 = identity up to scalar');
  assert(ms < 200, 'Under 200 ms (old brute force ran out of memory at 5)');
}

// --- R9: Sums are parenthesised before ⊗ ---
log('\n=== R9: Multi-term component ⊗ H ===');
{
  const d = new DiagramDocument('r9');
  const a = addN(d, NT.Z_SPIDER, 100, 100, {inputs:2, outputs:2});
  const b = addN(d, NT.X_SPIDER, 100, 40, {inputs:2, outputs:2});
  w(d, a, 0, b, 0); w(d, a, 1, b, 1);
  addN(d, NT.HADAMARD, 300, 100);
  const r = diagramToDirac(d);
  log(`  latex: ${r.latex}`, 'info');
  assert(r.latex.startsWith('('), 'Sum wrapped in parentheses');
  roundTrip(d, 'Sum ⊗ H');
}

// --- R10: Unprintable component blanks the output ---
log('\n=== R10: Category D component → no partial latex ===');
{
  const d = new DiagramDocument('r10');
  const z3 = addN(d, NT.Z_SPIDER, 100, 100, {inputs:3, outputs:3});
  [50, 100, 150].forEach((x, i) => w(d, addN(d, NT.HADAMARD, x, 160), 0, z3, i));
  addN(d, NT.HADAMARD, 400, 100);
  const r = diagramToDirac(d);
  log(`  category: ${r.category}, info: ${r.info}`, 'info');
  if (r.category === 'D') assert(r.latex === '', 'No latex that silently drops the big component');
  else assert(true, `(component was category ${r.category}; nothing to check)`);
}

// --- R11: Zero component keeps its shape ---
log('\n=== R11: Zero operator keeps shape ===');
{
  const d = new DiagramDocument('r11');
  const s = addN(d, NT.Z_SPIDER, 100, 140, {inputs:1, outputs:1, label: 'π'});
  const a = addN(d, NT.X_SPIDER, 100, 80, {inputs:1, outputs:0});
  const b = addN(d, NT.X_SPIDER, 100, 200, {inputs:0, outputs:1, label: 'π'});
  // ⟨+| Z |−⟩... wired as effect ∘ Z ∘ state → scalar; then H beside it
  w(d, b, 0, s, 0); w(d, s, 0, a, 0);
  addN(d, NT.HADAMARD, 300, 100);
  roundTrip(d, 'scalar · H');
}

// --- R12: Parser precedence and new syntax ---
log('\n=== R12: Parser ===');
{
  const same = (a, b) => { const A = evalStr(a), B = evalStr(b); return A && B && Tensor.equal(A, B); };
  let ok;
  try { ok = Tensor.equal(evalStr('|0\\rangle\\langle 0| \\otimes I + |1\\rangle\\langle 1| \\otimes X'), CNOT_T); }
  catch (e) { ok = false; log('  ' + e.message, 'fail'); }
  assert(ok, '|0⟩⟨0| ⊗ I + |1⟩⟨1| ⊗ X = CNOT');
  assert(same('H|0\\rangle \\otimes |0\\rangle', '|+\\rangle \\otimes |0\\rangle'), 'H|0⟩ ⊗ |0⟩ = |+⟩⊗|0⟩');
  assert(same('(H \\otimes I)|00\\rangle', '|+0\\rangle'), '(H⊗I)|00⟩ = |+0⟩');
  assert(same('|0\\rangle - |1\\rangle', '\\sqrt{2}|-\\rangle'), '|0⟩ − |1⟩ = √2|−⟩');
  const t3 = evalStr('\\frac{1}{\\sqrt{3}}|0\\rangle');
  assert(t3 && Math.abs(t3.get(0, 0)[0] - 1 / Math.sqrt(3)) < 1e-12, '\\frac{1}{\\sqrt{3}} is 1/√3 (was 1)');
  const ti = evalStr('\\frac{i}{2}|0\\rangle');
  assert(ti && C.eq(ti.get(0, 0), [0, 0.5]), '\\frac{i}{2} is i/2 (was 1)');
  assert(same('e^{i\\pi/4}|1\\rangle', 'T|1\\rangle'), 'e^{iπ/4}|1⟩ = T|1⟩');
  assert(same('\\frac{|0\\rangle + |1\\rangle}{\\sqrt{2}}', '|+\\rangle'), '\\frac{|0⟩+|1⟩}{√2} = |+⟩');
  assert(same('|0\\rangle^{\\otimes 2}', '|00\\rangle') && same('H^{\\otimes 2}', 'H \\otimes H'), 'Tensor powers');
  assert(same('\\langle 0|+\\rangle', '\\frac{1}{\\sqrt{2}}'), '⟨0|+⟩ braket');
  assert(evalStr('\\frac{1}{\\sqrt{n}}|0\\rangle') === null, 'Symbolic \\frac → null, not a wrong number');
  assert(same('|\\Phi^-\\rangle', '\\frac{1}{\\sqrt{2}}(|00\\rangle - |11\\rangle)'), 'Bell state Φ⁻');
  let threw = false;
  try { evalStr('|0\\rangle |1\\rangle'); } catch (e) { threw = e.message.includes("don't match"); }
  assert(threw, 'Dimension mismatch gives a readable error');
}


// ===== SPIDER LEGS =====

// --- L1: Spider–spider wires are side legs; open ports re-centre ---
log('\n=== L1: CNOT leg drawn from the side ===');
{
  const d = new DiagramDocument('l1');
  const { z, x } = addCNOT(d, 100, 100);
  d.refreshLegs();
  const legZ = z.getOutputPort(1), legX = x.getInputPort(0);
  assert(Math.abs(legZ.y - z.y) < 1 && legZ.x > z.x, 'Z leg leaves from its right side');
  assert(Math.abs(legX.y - x.y) < 1 && legX.x < x.x, 'X leg enters on its left side');
  assert(z.getOutputPort(0).x === z.x && x.getInputPort(1).x === x.x, 'Open ports centred above/below');
  const t = diagTensor(d);
  assert(t && Tensor.equalUpToPhase(CNOT_T, t).equal, 'Still CNOT');
}

// --- L2: Stacked layout now also reads as CNOT ---
log('\n=== L2: Stacked Z-over-X with a leg ===');
{
  const d = new DiagramDocument('l2');
  const z = addN(d, NT.Z_SPIDER, 100, 50, {inputs:1, outputs:2});
  const x = addN(d, NT.X_SPIDER, 100, 150, {inputs:2, outputs:1});
  w(d, z, 0, x, 0);
  const t = diagTensor(d);
  assert(t && Tensor.equalUpToPhase(CNOT_T, t).equal, 'Z above X, joined by a leg = CNOT');
}

// --- L3: Removing a spider–spider wire removes both legs ---
log('\n=== L3: Removing a leg wire prunes the legs ===');
{
  const d = new DiagramDocument('l3');
  const { z, x } = addCNOT(d, 100, 100);
  const h = addN(d, NT.HADAMARD, 100, 30);
  w(d, z, 0, h, 0);                                   // Z.out0 → H (non-spider, kept)
  d.removeWires(d.wires.filter(wr => wr.toNodeId === x.id));
  assert(z.outputs === 1 && x.inputs === 1, 'Z back to 1→1, X back to 1→1');
  assert(d.wires.length === 1 && d.wires[0].fromPort === 0, 'Z→H wire kept, index intact');
}

// --- L4: Port renumbering after removing an earlier leg ---
log('\n=== L4: Later ports renumber ===');
{
  const d = new DiagramDocument('l4');
  const a = addN(d, NT.Z_SPIDER, 100, 100, {inputs:0, outputs:3});
  const b = addN(d, NT.X_SPIDER, 200, 100, {inputs:1, outputs:0});
  const h = addN(d, NT.HADAMARD, 100, 30);
  w(d, a, 0, b, 0); w(d, a, 2, h, 0);
  d.removeWires([d.wires[0]]);
  assert(a.outputs === 2 && d.wires[0].fromPort === 1, 'Wire on out2 moved to out1');
}

// --- L5: Non-spider wires do not prune ports ---
log('\n=== L5: Box wires keep their ports ===');
{
  const d = new DiagramDocument('l5');
  const z = addN(d, NT.Z_SPIDER, 100, 100);
  const h = addN(d, NT.HADAMARD, 100, 30);
  w(d, z, 0, h, 0);
  d.removeWires([d.wires[0]]);
  assert(z.outputs === 1 && h.inputs === 1, 'Ports unchanged');
}


// --- L6: dropLeg prefers an unconnected port ---
log('\n=== L6: Inspector − removes an open leg first ===');
{
  const d = new DiagramDocument('l6');
  const { z, x } = addCNOT(d, 100, 100);         // Z.out1 is the leg to X; Z.out0 is open
  d.dropLeg(z, 'out');
  assert(z.outputs === 1 && d.wires.length === 1 && d.wires[0].fromPort === 0,
    'Open output removed; the leg survives and is renumbered to out0');
  assert(x.inputs === 2, 'X unchanged');
}

// --- L7: dropLeg on a connected spider leg removes the partner leg too ---
log('\n=== L7: Removing a connected leg also removes the partner leg ===');
{
  const d = new DiagramDocument('l7');
  const { z, x } = addCNOT(d, 100, 100);
  d.dropLeg(z, 'out');                            // removes open out0
  d.dropLeg(z, 'out');                            // now only the leg is left
  assert(z.outputs === 0 && x.inputs === 1 && d.wires.length === 0, 'Leg and partner leg removed');
}

// --- L8: removeLeg on a specific open port ---
log('\n=== L8: Remove a specific leg ===');
{
  const d = new DiagramDocument('l8');
  const a = addN(d, NT.Z_SPIDER, 100, 100, {inputs:3, outputs:0});
  const h = addN(d, NT.HADAMARD, 100, 160);
  w(d, h, 0, a, 2);
  d.removeLeg(a, 'in', 0);
  assert(a.inputs === 2 && d.wires[0].toPort === 1, 'in0 removed; wire on in2 now on in1');
  d.removeLeg(a, 'in', 1);
  assert(a.inputs === 1 && d.wires.length === 0 && h.outputs === 1, 'Connected leg to a box: wire removed, box port kept');
}


// ===== CIRCUITS =====

const circ = (n, cols, inputs, outputs) => ({ nQubits: n, columns: cols,
  inputs: inputs || Array(n).fill('open'), outputs: outputs || Array(n).fill('open') });
const col = (...cells) => cells.map(g => (g ? (typeof g === 'string' ? { gate: g } : g) : null));
const CIRCUITS = {
  'H':              circ(1, [col('H')]),
  'Y':              circ(1, [col('Y')]),
  'Z(π/8)':         circ(1, [col({ gate: 'P', param: 'π/8' })]),
  'X(π/3)':         circ(1, [col({ gate: 'XP', param: 'π/3' })]),
  'S† T†':          circ(1, [col('Sdg'), col('Tdg')]),
  'CNOT':           circ(2, [col('ctrl', 'X')]),
  'reverse CNOT':   circ(2, [col('X', 'ctrl')]),
  'fan-out CNOT':   circ(3, [col('ctrl', 'X', 'X')]),
  'CZ':             circ(2, [col('ctrl', 'Z')]),
  'CZ fan-out':     circ(3, [col('Z', 'ctrl', 'Z')]),
  'CNOT 0→2, CH 1': circ(3, [col('ctrl', 'H', 'X')]),
  'CNOT 0→2 only':  circ(3, [col('ctrl', null, 'X')]),
  'Toffoli':        circ(3, [col('ctrl', 'ctrl', 'X')]),
  'anti-control':   circ(2, [col('actrl', 'X')]),
  'CH':             circ(2, [col('ctrl', 'H')]),
  'Fredkin':        circ(3, [col('ctrl', 'swap', 'swap')]),
  'swap':           circ(2, [col('swap', 'swap')]),
  'H then swap':    circ(2, [col('H', null), col('swap', 'swap')]),
  'swap 0,2 + T':   circ(3, [col('swap', 'T', 'swap')]),
  'Bell state':     circ(2, [col('H', null), col('ctrl', 'X')], ['0', '0']),
  'Bell effect':    circ(2, [col('ctrl', 'X'), col('H', null)], undefined, ['0', '0']),
  'mixed in/out':   circ(3, [col('H', 'ctrl', 'X')], ['open', '1', '+'], ['-', 'open', '0']),
  'empty':          circ(2, []),
  'GHZ':            circ(3, [col('H', null, null), col('ctrl', 'X', null), col(null, 'ctrl', 'X')], ['0', '0', '0']),
};

log('\n=== C1: Circuit → IR equals the reference simulator exactly ===');
for (const [name, c] of Object.entries(CIRCUITS)) {
  const ref = circuitTensor(c), t = contractIR(circuitToIR(c)).tensor;
  assert(ref && t && Tensor.equal(ref, t), `${name}`);
}

log('\n=== C2: Circuit → Dirac parses and evaluates to the circuit exactly ===');
for (const [name, c] of Object.entries(CIRCUITS)) {
  const { latex } = circuitToDirac(c);
  let ok = false;
  try { const e = evalStr(latex); ok = !!e && Tensor.equal(circuitTensor(c), e); }
  catch (e) { log(`  ${e.message} in ${latex}`, 'fail'); }
  assert(ok, `${name}: ${latex}`);
}

log('\n=== C3: Generated diagram reads back as the same map ===');
for (const [name, c] of Object.entries(CIRCUITS)) {
  const doc = new CircuitDocument(name, c.nQubits);
  doc._restore({ ...c, name });
  const d = derivedDiagram(doc);
  const t = contractIR(diagramToIR(d)).tensor;
  assert(t && Tensor.equal(circuitTensor(c), t), `${name} (${d.nodes.size} nodes)`);
}

log('\n=== C4: Textbook forms ===');
{
  assert(circuitToDirac(CIRCUITS['Bell state']).latex === '\\operatorname{CNOT} (H \\otimes I) |00\\rangle',
    'Bell state = CNOT (H ⊗ I)|00⟩');
  const ir = circuitToIR(CIRCUITS['CNOT']);
  const kinds = [...ir.nodes.values()].map(n => n.kind).sort().join(',');
  assert(kinds === 'scalar,x-spider,z-spider', 'CNOT is a Z spider + X spider (+ scalar √2)');
  const sc = [...ir.nodes.values()].find(n => n.kind === 'scalar');
  assert(sc.label === '√2', 'Scalar labelled √2');
  const d = derivedDiagram(Object.assign(new CircuitDocument('cnot', 2), { columns: [col('ctrl', 'X')] }));
  const z = [...d.nodes.values()].find(n => n.type.key === 'z-spider');
  const x = [...d.nodes.values()].find(n => n.type.key === 'x-spider');
  assert(z.y === x.y && z.x < x.x, 'Control and target drawn side by side, control on the left');
}

log('\n=== C5: CircuitDocument editing and undo ===');
{
  const doc = new CircuitDocument('edit', 2);
  let notes = 0; doc.onChange(() => notes++);
  doc.setCell(0, 0, { gate: 'H' });
  doc.setCell(1, 0, { gate: 'ctrl' });
  doc.setCell(1, 1, { gate: 'X' });
  assert(doc.columns.length === 2 && notes === 3, 'Three edits, two steps, three notifications');
  doc.setCell(0, 0, null);
  assert(doc.columns.length === 1 && doc.cell(0, 0).gate === 'ctrl', 'Emptied step is removed');
  doc.undo();
  assert(doc.columns.length === 2 && doc.cell(0, 0).gate === 'H', 'Undo restores it');
  doc.redo();
  assert(doc.columns.length === 1, 'Redo removes it again');
  doc.addQubit(1);
  assert(doc.nQubits === 3 && doc.cell(0, 2).gate === 'X' && doc.cell(0, 1) === null, 'Insert a qubit between control and target');
  doc.setInput(0, '0');
  assert(doc.inputs.join() === '0,open,open', 'Set input state');
  doc.removeQubit(1);
  assert(doc.nQubits === 2 && doc.cell(0, 1).gate === 'X', 'Remove it again');
  let threw = false; try { doc.setCell(0, 0, { gate: 'nope' }); } catch { threw = true; }
  assert(threw, 'Unknown gate rejected');
}

log('\n=== C6: Dirac editor can sync with a circuit ===');
{
  const doc = new CircuitDocument('sync', 2);
  doc.setCell(0, 0, { gate: 'H' }); doc.setCell(1, 0, { gate: 'ctrl' }); doc.setCell(1, 1, { gate: 'X' });
  doc.setInput(0, '0'); doc.setInput(1, '0');
  const sc = new SyncController(doc);
  const g = sc.generateDirac();
  sc.onDiracChanged(g.latex, false); sc.verifyNow();
  assert(sc.lastVerifyResult.status === 'equivalent' && C.eq(sc.lastVerifyResult.scalar, C.ONE), 'Generated Dirac verifies exactly');
  sc.onDiracChanged('\\frac{1}{\\sqrt{2}}(|00\\rangle + |11\\rangle)', true); sc.verifyNow();
  assert(sc.lastVerifyResult.status === 'equivalent', 'Student writes the Bell state → equivalent');
  sc.onDiracChanged('|00\\rangle', true); sc.verifyNow();
  assert(sc.lastVerifyResult.status === 'not-equivalent', '|00⟩ → not equivalent');
  sc.destroy();
}

log('\n=== C7: Derived diagram follows circuit edits ===');
{
  const doc = new CircuitDocument('follow', 2);
  const d = derivedDiagram(doc);
  doc.setCell(0, 0, { gate: 'ctrl' }); doc.setCell(0, 1, { gate: 'X' });
  const t = contractIR(diagramToIR(d)).tensor;
  assert(t && Tensor.equal(circuitTensor(doc), t), 'Diagram regenerated after edit');
  assert(derivedDiagram(doc) === d, 'Same diagram document reused');
}

log('\n=== C8: Interleaved components in a hand-drawn diagram ===');
{
  // CNOT from wire 0 to wire 2, with a state on wire 1 drawn between them:
  // not expressible as A ⊗ B in wire order, so Generate merges them
  const d = new DiagramDocument('c8');
  const z = addN(d, NT.Z_SPIDER, 100, 100, {inputs:1, outputs:2});
  addN(d, NT.X_SPIDER, 190, 100, {inputs:0, outputs:1});
  const x = addN(d, NT.X_SPIDER, 280, 100, {inputs:2, outputs:1});
  w(d, z, 1, x, 0);
  roundTrip(d, 'CNOT(0,2) beside a state on wire 1');
  const r = diagramToDirac(d);
  assert(!r.latex.includes('otimes'), 'Interleaved pieces merged into one factor (no wrong ⊗)');
}



log('\n=== C9: insertCell / moveCell are single undo steps ===');
{
  const doc = new CircuitDocument('ops', 2);
  doc.setCell(0, 0, { gate: 'H' });
  doc.setCell(1, 1, { gate: 'X' });
  let pos = doc.insertCell(1, 0, { gate: 'T' });
  assert(pos.t === 1 && pos.q === 0 && doc.columns.length === 3 && doc.cell(2, 1).gate === 'X', 'Insert T between the steps');
  doc.undo();
  assert(doc.columns.length === 2 && doc.cell(1, 1).gate === 'X', 'One undo removes it');
  pos = doc.moveCell({ t: 0, q: 0 }, { t: 1, q: 0, insert: false });
  assert(pos.t === 0 && pos.q === 0 && doc.columns.length === 1 && doc.cell(0, 1).gate === 'X',
    'Move H into the X step; the emptied step disappears and H lands at step 1→0');
  doc.undo();
  assert(doc.columns.length === 2 && doc.cell(0, 0).gate === 'H', 'One undo restores it');
  pos = doc.moveCell({ t: 1, q: 1 }, { t: 0, q: 1, insert: true });
  assert(pos.t === 0 && doc.cell(0, 1).gate === 'X' && doc.cell(1, 0).gate === 'H', 'Move X into a new step before H');
}

// ===== TENSOR ORDER (big- vs little-endian) =====

/** Reverse the bit order of a tensor's row and column indices (independent reference). */
function reverseBits(T) {
  const m = Math.round(Math.log2(T.rows)), n = Math.round(Math.log2(T.cols));
  const rev = (x, k) => { let r = 0; for (let i = 0; i < k; i++) r = (r << 1) | ((x >> i) & 1); return r; };
  const R = Tensor.zeros(T.rows, T.cols);
  for (let i = 0; i < T.rows; i++) for (let j = 0; j < T.cols; j++) R.set(rev(i, m), rev(j, n), T.get(i, j));
  return R;
}

log('\n=== E1: Little-endian diagram: CNOT reads as control on the last factor ===');
{
  const d = new DiagramDocument('e1');
  addCNOT(d);
  const big = diagTensor(d);
  d.setTensorOrder('little-endian');
  const little = diagTensor(d);
  assert(Tensor.equal(little, reverseBits(big)), 'Same picture, factors reversed');
  assert(!Tensor.equalUpToPhase(CNOT_T, little).equal, 'No longer the textbook CNOT matrix');
  diagramToIR(d);
  assert(d.inputBoundary[0].nodeId === [...d.nodes.values()].find(n => n.type.key === 'x-spider').id,
    'Marker in0 is now on the rightmost wire');
  roundTrip(d, 'Little-endian CNOT');
}

log('\n=== E2: Little-endian circuits — IR, Dirac and diagram agree with the reference ===');
for (const [name, c0] of Object.entries(CIRCUITS)) {
  const c = { ...c0, tensorOrder: 'little-endian' };
  const want = reverseBits(circuitTensor(c0));
  const ir = contractIR(circuitToIR(c)).tensor;
  let dirac = null;
  try { dirac = evalStr(circuitToDirac(c).latex); } catch (e) { log('  ' + e.message, 'fail'); }
  const doc = new CircuitDocument(name, c.nQubits);
  doc._restore({ ...c, name });
  const dg = contractIR(diagramToIR(derivedDiagram(doc))).tensor;
  assert(ir && dirac && dg && Tensor.equal(want, ir) && Tensor.equal(want, dirac) && Tensor.equal(want, dg), name);
}

log('\n=== E3: Little-endian textbook forms ===');
{
  const bell = { ...CIRCUITS['Bell state'], tensorOrder: 'little-endian' };
  const latex = circuitToDirac(bell).latex;
  log(`  Bell (little-endian): ${latex}`, 'info');
  assert(latex === '(I \\otimes |0\\rangle\\langle 0| + X \\otimes |1\\rangle\\langle 1|) (I \\otimes H) |00\\rangle',
    'H on qubit 0 appears as the last factor');
  const doc = new CircuitDocument('order', 1);
  doc.setTensorOrder('little-endian');
  doc.undo();
  assert(doc.tensorOrder === 'big-endian', 'Changing the order is undoable');
}

log('\n=== E4: Sync follows the document\'s order ===');
{
  const doc = new CircuitDocument('e4', 2);
  doc.setCell(0, 0, { gate: 'X' }); doc.setInput(0, '0'); doc.setInput(1, '0');
  const sc = new SyncController(doc);
  sc.onDiracChanged('|10\\rangle', true); sc.verifyNow();
  assert(sc.lastVerifyResult.status === 'equivalent', 'Big-endian: X on qubit 0 gives |10⟩');
  doc.setTensorOrder('little-endian');
  sc.verifyNow();
  assert(sc.lastVerifyResult.status === 'not-equivalent', 'Little-endian: |10⟩ is now wrong');
  sc.onDiracChanged('|01\\rangle', true); sc.verifyNow();
  assert(sc.lastVerifyResult.status === 'equivalent', 'Little-endian: |01⟩ is right');
  sc.destroy();
}


// ===== PROOFS =====

const fuseDocs = (la, lb, lc) => {
  const a = new DiagramDocument('pa');
  const z1 = addN(a, NT.Z_SPIDER, 100, 150, { label: la }), z2 = addN(a, NT.Z_SPIDER, 100, 60, { label: lb });
  w(a, z1, 0, z2, 0);
  const b = new DiagramDocument('pb'); addN(b, NT.Z_SPIDER, 100, 100, { label: lc });
  return [a, b];
};
const step = (a, b, rel) => checkStep(a.toIR(), b.toIR(), rel);

log('\n=== P1: Phase expressions ===');
{
  const e = parsePhaseExpr('2α-π/2+β/3');
  assert(e && e.constant.equals(new Phase(-1, 2)) && e.symbols['α'].num === 2 && e.symbols['β'].den === 3, '2α − π/2 + β/3');
  assert(parsePhaseExpr('\\alpha+\\beta') && Object.keys(parsePhaseExpr('\\alpha+\\beta').symbols).join() === 'α,β', 'LaTeX names');
  assert(parsePhaseExpr('α-α').symbols['α'] === undefined, 'α − α cancels');
  assert(parsePhaseExpr('2') === null && parsePhaseExpr('f(x)') === null, 'Non-expressions are opaque symbols');
}

log('\n=== P2: Spider fusion with symbolic phases ===');
{
  assert(step(...fuseDocs('α', 'β', 'α+β'), '=').status === 'ok', 'Z(α);Z(β) = Z(α+β)');
  assert(step(...fuseDocs('α', 'β', 'β+α'), '=').status === 'ok', '… = Z(β+α)');
  assert(step(...fuseDocs('α', '-α', ''), '=').status === 'ok', 'Z(α);Z(−α) = identity spider');
  assert(step(...fuseDocs('α', 'β', 'α'), '=').status === 'fail', 'Z(α);Z(β) ≠ Z(α)');
  assert(step(...fuseDocs('π/4', 'π/4', 'π/2'), '=').status === 'ok', 'Concrete: π/4 + π/4 = π/2');
}

log('\n=== P3: Boxes: same label = same symbol ===');
{
  const a = new DiagramDocument('box-a');
  const f = addN(a, NT.MORPHISM, 100, 150, { label: 'f' }), g = addN(a, NT.MORPHISM, 100, 60, { label: 'g' });
  w(a, f, 0, g, 0);
  const b = new DiagramDocument('box-b');
  const g2 = addN(b, NT.MORPHISM, 100, 150, { label: 'g' }), f2 = addN(b, NT.MORPHISM, 100, 60, { label: 'f' });
  w(b, g2, 0, f2, 0);
  const r = step(a, b, '≈');
  assert(r.status === 'fail' && /f, g/.test(r.hint), 'g∘f ≠ f∘g for generic f, g');
  const c = DiagramDocument.copyOf(a);
  assert(step(a, c, '=').status === 'ok', 'A copy equals the original');
  const ids = new Set([...a.nodes.keys()]);
  assert([...c.nodes.keys()].every(id => !ids.has(id)), 'Copies get fresh node ids');
}

log('\n=== P4: = versus ≈ ===');
{
  // A plain wire vs the same wire beside a scalar 2: equal only up to the scalar
  const a = new DiagramDocument('wire'); addN(a, NT.IDENTITY, 100, 100);
  const b = new DiagramDocument('wire2'); addN(b, NT.IDENTITY, 100, 100);
  const sc = addN(b, NT.SCALAR, 200, 100, { label: '2' }); sc.tensor = new Tensor(1, 1, [[2, 0]]);
  const eq = step(a, b, '='), ap = step(a, b, '≈');
  log(`  = : ${eq.hint} | ≈ : ${ap.hint}`, 'info');
  assert(eq.status === 'fail' && /up to a scalar \(2\)/.test(eq.hint), "Wire vs wire ⊗ 2: not '='");
  assert(ap.status === 'ok' && /up to 2/.test(ap.hint), "… but '≈' (up to 2)");
  const s = step(a, new DiagramDocument('empty'), '≈');
  assert(s.status === 'fail' && /Different shapes/.test(s.hint), 'Shape mismatch is explained');
}

log('\n=== P5: ProofDocument ===');
{
  const p = DocumentStore.add(new ProofDocument('T'));
  const [a, b] = fuseDocs('α', 'β', 'α+β');
  DocumentStore.add(a);
  p.insertDiagram(a);
  p.insertDiagram(b);
  p.setRelation(1, '=');
  let r = p.checkAll();
  assert(r.status === 'ok' && r.relation === '=', 'Two-step proof checks (=)');
  assert(p.steps[0].diagram !== a && p.steps[0].source.id === a.id, 'Steps are copies that remember their source');
  a.nodes.values().next().value.label = 'γ'; a.commit();
  assert(p.checkAll().status === 'ok', 'Editing the source does not change the proof');
  const i = p.duplicateStep(1);
  assert(i === 2 && p.steps.length === 3 && p.checkAll().status === 'ok', 'Duplicate a step: D₂ ≈ D₃ trivially');
  const d3 = p.steps[2].diagram;
  d3.nodes.values().next().value.label = 'α'; d3.commit();
  r = p.checkAll();
  assert(r.status === 'fail' && r.firstBad === 2, 'A wrong step is reported at its position');
  p.removeStep(2);
  assert(p.steps.length === 2 && !DocumentStore.get(d3.id), 'Removing a step removes its diagram');
  p.undo();
  assert(p.steps.length === 3 && DocumentStore.get(d3.id) === d3, 'Undo brings the step (and its diagram) back');
  assert(DocumentStore.displayName(d3) === 'T — step D3', 'Steps are named after their proof');
  p.updateFromSource(0);
  assert(p.steps[0].diagram.nodes.values().next().value.label === 'γ', 'Update from source re-copies the source');
}


log('\n=== P6: Deliberate transfers between a step and its source ===');
{
  const src = DocumentStore.add(new DiagramDocument('Src'));
  addN(src, NT.HADAMARD, 100, 100);
  const p = DocumentStore.add(new ProofDocument('Transfers'));
  p.insertDiagram(src);
  const step = p.steps[0].diagram;
  addN(step, NT.Z_SPIDER, 200, 100); step.commit();
  assert(src.nodes.size === 1 && step.nodes.size === 2, 'Editing the step leaves the source alone');
  assert(p.applyToSource(0) && src.nodes.size === 2, 'Apply to source copies the step into the source');
  assert(src.undo() && src.nodes.size === 1, '… as one undoable edit of the source');
  const d = p.saveAsNewDiagram(0);
  assert(d && DocumentStore.get(d.id) === d && d.nodes.size === 2 && !d.ownerProof, 'Save as new diagram makes a standalone copy');
  assert(p.sourceOf(0) === d, '… which becomes the step\'s source');
  addN(d, NT.X_SPIDER, 300, 100); d.commit();
  assert(step.nodes.size === 2, 'The new diagram is independent of the step');
  const c = DocumentStore.add(new CircuitDocument('Gen', 1));
  c.setCell(0, 0, { gate: 'H' });
  p.insertDiagram(derivedDiagram(c));
  assert(!p.canApplyToSource(1), 'A circuit\'s generated diagram cannot be overwritten');
}


// ===== WORKBOOKS =====

log('\n=== W1: Workbook round trip keeps every document and link ===');
{
  DocumentStore.clear();
  const ex = DocumentStore.add(new DiagramDocument('Ex'));
  addCNOT(ex); ex.setTensorOrder('little-endian');
  const c = DocumentStore.add(new CircuitDocument('Bell', 2));
  c.setCell(0, 0, { gate: 'H' }); c.setCell(1, 0, { gate: 'ctrl' }); c.setCell(1, 1, { gate: 'X' });
  c.setInput(0, '0'); c.setInput(1, '0');
  const gen = derivedDiagram(c);
  const p = DocumentStore.add(new ProofDocument('Pf'));
  p.insertDiagram(gen);
  p.duplicateStep(0); p.setNote(1, 'same'); p.setRelation(1, '=');
  const layout = { type: 'split', direction: 'vertical', ratio: 0.5, children: [
    { type: 'leaf', editorType: 'Diagram Editor', state: { docId: ex.id, orientation: 'algebraic' } },
    { type: 'leaf', editorType: 'Diagram Equation Editor', state: { proofId: p.id, selected: 1 } }] };
  const before = { ex: diagTensor(ex), c: circuitTensor(c), check: p.checkAll().status };
  const wb = JSON.parse(JSON.stringify(captureWorkbook({ name: 'RT', description: 'd' }, layout)));
  assert(summaryText(wb.summary) === '1 circuit · 1 diagram · 1 proof', `Summary: ${summaryText(wb.summary)}`);

  const { layout: lay2, idMap } = openWorkbookDocuments(wb);
  const ex2 = DocumentStore.list('diagram').find(d => d.name === 'Ex');
  const c2 = DocumentStore.list('circuit')[0], p2 = DocumentStore.list('proof')[0];
  assert(ex2 && ex2 !== ex && ex2.id !== ex.id && ex2.tensorOrder === 'little-endian', 'Diagram restored as a new document, order kept');
  assert(Tensor.equal(diagTensor(ex2), before.ex), 'Same diagram tensor');
  assert(Tensor.equal(circuitTensor(c2), before.c) && c2.inputs.join() === '0,0', 'Same circuit');
  const gen2 = DocumentStore.list('diagram').find(d => d.derivedFrom === c2.id);
  assert(gen2 && derivedDiagram(c2) === gen2, 'Generated diagram re-linked to its circuit');
  c2.setCell(2, 1, { gate: 'Z' });
  assert(Tensor.equal(contractIR(diagramToIR(gen2)).tensor, circuitTensor(c2)), '… and still follows it');
  assert(p2.steps.length === 2 && p2.steps[1].note === 'same' && p2.steps[1].relation === '=', 'Proof steps, notes, relations');
  assert(p2.steps.every(s => s.diagram.ownerProof === p2.id), 'Steps owned by the restored proof');
  assert(p2.steps[0].source.id === gen2.id, 'Step source remapped to the restored generated diagram');
  assert(lay2.children[0].state.docId === ex2.id && lay2.children[1].state.proofId === p2.id, 'Panel states point at the restored documents');
  assert(lay2.children[0].state.orientation === 'algebraic', 'Other panel state kept');
  assert(idMap.get(ex.id) === ex2.id, 'Id map exposed');
}

log('\n=== W2: Bad input is rejected clearly ===');
{
  let msg = '';
  try { openWorkbookDocuments({ format: 'other' }); } catch (e) { msg = e.message; }
  assert(msg === 'Not a workbook', 'Not a workbook');
  try { openWorkbookDocuments({ format: 'qpp-workbook', version: 99, documents: [] }); } catch (e) { msg = e.message; }
  assert(/newer version/.test(msg), 'Newer format version');
}

log('\n=== W3: My Workbooks store (browser storage stand-in) ===');
{
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const store = new LocalWorkbookStore({ storage });
  const wb = { format: 'qpp-workbook', version: 1, name: 'A', summary: { circuits: 1, diagrams: 0, proofs: 0 }, savedAt: '2026-01-01', documents: [] };
  const id = await store.save(wb);
  await store.save({ ...wb, name: 'B', savedAt: '2026-02-01' });
  let list = await store.list();
  assert(list.length === 2 && list[0].name === 'B', 'Two saved, newest first');
  await store.save({ ...wb, name: 'A2', savedAt: '2026-03-01' }, id);
  list = await store.list();
  assert(list.length === 2 && list[0].name === 'A2' && (await store.load(id)).name === 'A2', 'Save with an id overwrites');
  await store.remove(id);
  assert((await store.list()).length === 1, 'Remove');
  let threw = false; try { await store.load(id); } catch { threw = true; }
  assert(threw, 'Loading a removed workbook fails clearly');
}

log('\n=== W4: Every demo opens, and its proofs check ===');
{
  // In Node read the files directly; in the browser test page, fetch them
  const inNode = typeof process !== 'undefined' && process.versions && process.versions.node;
  const demos = inNode
    ? new DemoStore({ base: new URL('../demos/', import.meta.url).pathname,
        fetchJSON: async p => JSON.parse(await (await import('node:fs/promises')).readFile(p, 'utf8')) })
    : new DemoStore({ base: new URL('../demos/', import.meta.url).href });
  const list = await demos.list();
  assert(list.length >= 4 && list[0].id === 'getting-started', `${list.length} demos listed, Getting started first`);
  for (const item of list) {
    const wb = await demos.load(item.id);
    const { layout } = openWorkbookDocuments(wb);
    const proofs = DocumentStore.list('proof');
    const ok = proofs.every(p => p.checkAll().status === 'ok');
    assert(ok && layout && wb.name === item.name, `${item.name}: opens; ${proofs.length} proof(s) check`);
  }
  // Getting started: every panel is about the same state, and its saved formulas all check
  openWorkbookDocuments(await demos.load('getting-started'));
  const bell = DocumentStore.list('circuit')[0];
  const dirac = (function find(n) { return n.type === 'leaf' ? (n.editorType === 'Dirac Formula Editor' ? n : null) : find(n.children[0]) || find(n.children[1]); })((await demos.load('getting-started')).layout);
  const want = circuitTensor(bell);
  assert(dirac.state.formulas.length >= 2 && dirac.state.formulas.every(f => Tensor.equal(evalStr(f), want)),
    `Getting started: all ${dirac.state.formulas.length} saved formulas are the circuit's state`);
  const pf = DocumentStore.list('proof')[0];
  assert(pf.sourceOf(0) && pf.sourceOf(0).derivedFrom === bell.id, 'Its proof starts from the circuit\'s own diagram');

  let threw = false; try { await demos.save({}); } catch { threw = true; }
  assert(threw, 'Demos are read-only');
  threw = false; try { await demos.load('../secret'); } catch { threw = true; }
  assert(threw, 'Demo ids cannot escape the demos folder');
}


// ===== ORIENTATION AND SLIDING (PQP §4.3) =====

const M3 = Tensor.fromRows([[C.of(1, 2), C.of(3, -1)], [C.of(0, 1), C.of(-2, 0)]]);
const same = (A, B) => Tensor.equal(A, B);

log('\n=== O1: Orientation transforms a concrete matrix ===');
{
  const T = orientTensor(M3, { v: true, h: true }), A = orientTensor(M3, { v: true, h: false }), B = orientTensor(M3, { v: false, h: true });
  assert(C.eq(T.get(0, 1), M3.get(1, 0)) && C.eq(T.get(1, 0), M3.get(0, 1)), 'Both flips = transpose');
  assert(C.eq(A.get(0, 1), C.conj(M3.get(1, 0))), 'Top↔bottom = adjoint');
  assert(C.eq(B.get(0, 0), C.conj(M3.get(0, 0))) && C.eq(B.get(0, 1), C.conj(M3.get(0, 1))), 'Left↔right = conjugate');
  const d = new DiagramDocument('o1');
  const box = addN(d, NT.MORPHISM, 100, 100); box.tensor = M3;
  d.flipNode(box, 'T');
  assert(same(diagTensor(d), T), 'A flipped box evaluates to the transformed matrix');
  d.flipNode(box, 'adj'); d.flipNode(box, 'adj'); d.flipNode(box, 'T');
  assert(same(diagTensor(d), M3) && !box.flip.v && !box.flip.h, 'Flips compose (and undo themselves)');
}

// f on the left leg of a cup (cup.out0 → f), right leg open; and the mirror image
const cupWithBox = (onLeft, flip) => {
  const d = new DiagramDocument('cupbox');
  const cup = addN(d, NT.CUP, 150, 200);
  const f = addN(d, NT.MORPHISM, onLeft ? 138 : 162, 120, { label: 'f' });
  if (flip) f.flip = { ...flip };
  w(d, cup, onLeft ? 0 : 1, f, 0);
  return { d, cup, f };
};

log('\n=== O2: Proposition 4.30 (boxes slide round bends as transposes) ===');
{
  const L = cupWithBox(true), R = cupWithBox(false, { v: true, h: true });
  assert(step(L.d, R.d, '=').status === 'ok', 'f on the left leg of a cup = fᵀ on the right leg (random f)');
  const Rwrong = cupWithBox(false);
  assert(step(L.d, Rwrong.d, '≈').status === 'fail', '… but plain f on the right leg is different');
  const Radj = cupWithBox(false, { v: true, h: false });
  assert(step(L.d, Radj.d, '≈').status === 'fail', '… and so is f† (it is the transpose, not the adjoint)');
}

log('\n=== O3: Sliding is a rewrite that keeps the map ===');
{
  const { d, cup, f } = cupWithBox(true);
  const top = addN(d, NT.MORPHISM, 138, 40, { label: 'g' }); w(d, f, 0, top, 0);
  const before = DiagramDocument.copyOf(d);
  const opts = d.slideOptions(f);
  assert(opts.length === 1 && opts[0].via === cup && opts[0].side === 'in', 'A box on a cup leg can slide');
  const g2 = d.slide(f, opts[0]);
  assert(g2.flip.v && g2.flip.h, 'It arrives transposed');
  assert(g2.x === cup.getOutputPort(1).x, '… on the other leg');
  assert(d.wireOnPort(cup.id, 'out', 0).toNodeId === top.id, 'What was above it is now joined straight to the cup');
  assert(step(before, d, '=').status === 'ok', 'Same map before and after (random f, g)');
  const back = d.slide(g2, d.slideOptions(g2)[0]);
  assert(!back.flip.v && !back.flip.h && step(before, d, '=').status === 'ok', 'Sliding back restores f');

  // through a cap: f's output goes into cap.in1
  const c = new DiagramDocument('capbox');
  const cap = addN(c, NT.CAP, 150, 60);
  const h = addN(c, NT.MORPHISM, 162, 140, { label: 'h' });
  w(c, h, 0, cap, 1);
  const c0 = DiagramDocument.copyOf(c);
  const o = c.slideOptions(h);
  assert(o.length === 1 && o[0].side === 'out', 'A box under a cap can slide');
  c.slide(h, o[0]);
  assert(step(c0, c, '=').status === 'ok', 'Same map after sliding through the cap');
}

log('\n=== O4: The necklace (PQP: beads on a snake) ===');
{
  // f1 → cap → f2 … : a box chain bent by caps and cups; sliding every bead onto one strand keeps the map
  const d = new DiagramDocument('necklace');
  const f1 = addN(d, NT.MORPHISM, 100, 200, { label: 'a' });
  const cap1 = addN(d, NT.CAP, 112, 120);
  const f2 = addN(d, NT.MORPHISM, 124, 200, { label: 'b' });
  const cup1 = addN(d, NT.CUP, 136, 280);
  const f3 = addN(d, NT.MORPHISM, 148, 200, { label: 'c' });
  w(d, f1, 0, cap1, 0);           // a's output into the cap
  w(d, cup1, 0, f2, 0); w(d, f2, 0, cap1, 1);   // b: from the cup, up into the cap
  w(d, cup1, 1, f3, 0);           // c on the cup's other leg, output open
  const before = DiagramDocument.copyOf(d);
  let n = 0;
  for (let k = 0; k < 6; k++) {
    const node = [...d.nodes.values()].find(x => x.type.key === 'morphism' && d.slideOptions(x).length);
    if (!node) break;
    d.slide(node, d.slideOptions(node)[0]); n++;
    assert(step(before, d, '=').status === 'ok', `After slide ${n}: same map`);
  }
}

log('\n=== O5: States and effects ===');
{
  const a = new DiagramDocument('s'); const st = addN(a, NT.STATE, 100, 200, { label: 'ψ' });
  const ef = addN(a, NT.STATE, 100, 100, { label: 'ψ' }); a.flipNode(ef, 'adj');
  assert(ef.type === NT.EFFECT && ef.inputs === 1 && ef.outputs === 0, 'The adjoint of a state is an effect');
  w(a, st, 0, ef, 0);
  const lat = diagramToDirac(a).latex;
  log(`  latex: ${lat}`, 'info');
  assert(/\\langle\s*\\psi\s*\|\s*\\psi\\rangle|\\langle \\psi\|\\psi\\rangle/.test(lat) || lat.includes('\\langle \\psi|'), 'Prints ⟨ψ|ψ⟩');
  // ⟨ψ|ψ⟩ is a positive number for random ψ: compare with |ψ⟩ then ⟨ψ̄| transposed (= ⟨ψ|ψ⟩* = same)
  const b = new DiagramDocument('s2'); const st2 = addN(b, NT.STATE, 100, 200, { label: 'ψ' });
  const ef2 = addN(b, NT.STATE, 100, 100, { label: 'ψ' }); b.flipNode(ef2, 'adj'); b.flipNode(ef2, 'conj');
  w(b, st2, 0, ef2, 0);
  assert(step(a, b, '=').status === 'fail', '⟨ψ|ψ⟩ ≠ ⟨ψ̄|ψ⟩ in general');
}

log('\n=== O6: Orientation survives copies and workbooks ===');
{
  const { d, f } = cupWithBox(false, { v: true, h: true });
  const c = DiagramDocument.copyOf(d);
  assert([...c.nodes.values()].some(n => n.flip.v && n.flip.h), 'copyOf keeps the flip');
  assert(step(d, c, '=').status === 'ok', 'and the map');
  d.pushUndo(); d.flipNode(f, 'conj'); d.undo();
  assert([...d.nodes.values()].find(n => n.type.key === 'morphism').flip.h === true, 'Undo restores the orientation');
}


// ===== THE DOUBLED PICTURE (PQP ch. 6–8) =====

const thickN = (d, type, x, y, o = {}) => { const n = addN(d, type, x, y, o); n.thick = true; return n; };
const dot = (d, x, y, ins, outs) => {   // ins/outs: arrays of 'thin' | 'thick'
  const n = addN(d, NT.DOT, x, y, { inputs: ins.length, outputs: outs.length });
  n.legThick = { in: ins.map(t => t === 'thick'), out: outs.map(t => t === 'thick') };
  return n;
};

log('\n=== Q1: Discarding a doubled pure state gives ⟨ψ|ψ⟩ (Born rule) ===');
{
  const a = new DiagramDocument('q1a');
  const st = thickN(a, NT.STATE, 100, 200, { label: 'ψ' }), ds = addN(a, NT.DISCARD, 100, 110);
  w(a, st, 0, ds, 0);
  const b = new DiagramDocument('q1b');
  const s2 = addN(b, NT.STATE, 100, 200, { label: 'ψ' }), e2 = addN(b, NT.STATE, 100, 110, { label: 'ψ' });
  b.flipNode(e2, 'adj'); w(b, s2, 0, e2, 0);
  assert(step(a, b, '=').status === 'ok', 'ψ̂ then ⏚  =  ⟨ψ|ψ⟩ (random ψ)');
}

log('\n=== Q2: Measurement and encoding (white dots with thin and thick legs) ===');
{
  // measure (thick in, thin out) then delete (thin in, no out)  =  discard
  const a = new DiagramDocument('q2a');
  const m = dot(a, 100, 200, ['thick'], ['thin']), del = dot(a, 100, 120, ['thin'], []);
  w(a, m, 0, del, 0);
  const b = new DiagramDocument('q2b'); addN(b, NT.DISCARD, 100, 160);
  assert(step(a, b, '=').status === 'ok', 'measure, then delete  =  discard');
  // encode (thin in, thick out) then discard  =  delete
  const c = new DiagramDocument('q2c');
  const enc = dot(c, 100, 200, ['thin'], ['thick']), dis = addN(c, NT.DISCARD, 100, 120);
  w(c, enc, 0, dis, 0);
  const dd = new DiagramDocument('q2d'); dot(dd, 100, 160, ['thin'], []);
  assert(step(c, dd, '=').status === 'ok', 'encode, then discard  =  delete');
  // measure then encode  =  decoherence (a white dot, thick to thick)
  const e = new DiagramDocument('q2e');
  const m2 = dot(e, 100, 200, ['thick'], ['thin']), en2 = dot(e, 100, 120, ['thin'], ['thick']);
  w(e, m2, 0, en2, 0);
  const f = new DiagramDocument('q2f'); dot(f, 100, 160, ['thick'], ['thick']);
  assert(step(e, f, '=').status === 'ok', 'measure, then encode  =  decoherence');
  // decoherence is not the identity on a quantum wire
  const g = new DiagramDocument('q2g'); thickN(g, NT.IDENTITY, 100, 160);
  assert(step(f, g, '≈').status === 'fail', '… which is not a plain thick wire');
}

log('\n=== Q3: Doubling ===');
{
  const fuse = (la, lb, lc) => {
    const a = new DiagramDocument('q3a');
    const z1 = thickN(a, NT.Z_SPIDER, 100, 200, { label: la }), z2 = thickN(a, NT.Z_SPIDER, 100, 110, { label: lb });
    w(a, z1, 0, z2, 0);
    const b = new DiagramDocument('q3b'); thickN(b, NT.Z_SPIDER, 100, 150, { label: lc });
    return [a, b];
  };
  assert(step(...fuse('α', 'β', 'α+β'), '=').status === 'ok', 'Doubled spiders fuse: Ẑ(α);Ẑ(β) = Ẑ(α+β)');
  assert(step(...fuse('α', 'β', 'α-β'), '≈').status === 'fail', '… and not to Ẑ(α−β)');
  // a doubled unitary is causal; a general process is not
  const a = new DiagramDocument('q3c');
  const h = thickN(a, NT.HADAMARD, 100, 200), ds = addN(a, NT.DISCARD, 100, 120); w(a, h, 0, ds, 0);
  const b = new DiagramDocument('q3d'); addN(b, NT.DISCARD, 100, 160);
  assert(step(a, b, '=').status === 'ok', 'Ĥ then ⏚  =  ⏚ (a doubled unitary is causal)');
  const c = new DiagramDocument('q3e');
  const phi = thickN(c, NT.MORPHISM, 100, 200, { label: 'Φ' }); phi.process = true;
  const ds2 = addN(c, NT.DISCARD, 100, 120); w(c, phi, 0, ds2, 0);
  assert(step(c, b, '≈').status === 'fail', 'A general process Φ is not causal without assuming it');
  // a pure (doubled) box is f̄ ⊗ f: discarding after it gives Tr(f†f · ) — equal to discard only for isometries
  const d = new DiagramDocument('q3f');
  const fb = thickN(d, NT.MORPHISM, 100, 200, { label: 'f' }), ds3 = addN(d, NT.DISCARD, 100, 120); w(d, fb, 0, ds3, 0);
  assert(step(d, b, '≈').status === 'fail', 'f̂ then ⏚ ≠ ⏚ for a generic f');
}

log('\n=== Q4: Sliding a doubled box round a doubled cup ===');
{
  const d = new DiagramDocument('q4');
  const cup = thickN(d, NT.CUP, 150, 200);
  const f = thickN(d, NT.MORPHISM, 138, 120, { label: 'f' });
  w(d, cup, 0, f, 0);
  const before = DiagramDocument.copyOf(d);
  d.slide(f, d.slideOptions(f)[0]);
  assert(step(before, d, '=').status === 'ok', 'f̂ slides round the thick cup as f̂ᵀ');
}

log('\n=== Q5: Strict typing ===');
{
  const a = new DiagramDocument('q5a');
  const st = thickN(a, NT.STATE, 100, 200, { label: 'ρ' }); st.process = true;
  addN(a, NT.Z_SPIDER, 200, 150);
  const ir = diagramToIR(a);
  assert(!ir.isValid && /thin wires are classical/.test(ir.diagnostics[0].message), 'A thin Z spider in a doubled diagram is an error');
  const b = new DiagramDocument('q5b');
  const ts = thickN(b, NT.STATE, 100, 200, { label: 'ψ' }), thin = addN(b, NT.MORPHISM, 100, 110, { label: 'g' });
  w(b, ts, 0, thin, 0);
  const ir2 = diagramToIR(b);
  assert(!ir2.isValid && /cannot be joined/.test(ir2.diagnostics.map(x => x.message).join()), 'A thick wire into a thin port is an error');
  const c = new DiagramDocument('q5c');
  const ts2 = thickN(c, NT.STATE, 100, 200, { label: 'ψ' }); addN(c, NT.MORPHISM, 200, 110, { label: 'g' });
  assert(diagramToIR(c).isValid, 'A thin box (a classical process) is allowed');
  assert(!!c.generateDirac().familiar && !!c.generateDirac().pqp, 'Dirac generation for a doubled diagram offers both notations');
}

log('\n=== Q6: Thick and leg types survive saving ===');
{
  const d = DocumentStore.add(new DiagramDocument('q6'));
  const m = dot(d, 100, 200, ['thick'], ['thin']); const p2 = thickN(d, NT.MORPHISM, 200, 200, { label: 'Ψ' });
  p2.process = true; p2.inputs = 2; p2.legThick = { in: [true, false], out: [true] };
  const c = DiagramDocument.fromJSON(JSON.parse(JSON.stringify(d.toJSON())));
  const [m2, q2] = [...c.nodes.values()];
  assert(m2.portIsThick('in', 0) && !m2.portIsThick('out', 0), 'White dot leg types restored');
  assert(q2.isMixed() && q2.portIsThick('in', 0) && !q2.portIsThick('in', 1) && q2.portIsThick('out', 0), 'Process leg types restored');
  d.removePort(p2, 'in', 0);
  assert(p2.inputs === 1 && !p2.portIsThick('in', 0), 'Removing a leg keeps the others\' types');
}


// ===== ASSUMPTIONS AND SUMS (phase 3) =====

const stepA = (a, b, rel, assumptions) => checkStep(a.toIR(), b.toIR(), rel, { assumptions });
const proc = (d, x, y, label, ins, outs) => {      // a general process with leg types ('q' thick / 'c' thin)
  const n = addN(d, NT.MORPHISM, x, y, { label, inputs: ins.length, outputs: outs.length });
  n.thick = true; n.process = true;
  n.legThick = { in: ins.map(t => t === 'q'), out: outs.map(t => t === 'q') };
  return n;
};

log('\n=== A1: Sequential composition of causal cq-maps is causal (PQP 8.16) ===');
{
  // D1: Φ (q in → q, c out), Ψ on Φ's quantum output, then ⏚ and delete
  const d1 = new DiagramDocument('a1');
  const phi = proc(d1, 100, 300, 'Φ', ['q'], ['q', 'c']);
  const psi = proc(d1, 88, 200, 'Ψ', ['q'], ['q']);
  const ds = addN(d1, NT.DISCARD, 88, 120), del = dot(d1, 140, 200, ['c'], []);
  w(d1, phi, 0, psi, 0); w(d1, psi, 0, ds, 0); w(d1, phi, 1, del, 0);
  // D2: Ψ discarded away (Ψ causal)
  const d2 = new DiagramDocument('a2');
  const phi2 = proc(d2, 100, 300, 'Φ', ['q'], ['q', 'c']);
  const ds2 = addN(d2, NT.DISCARD, 88, 200), del2 = dot(d2, 140, 200, ['c'], []);
  w(d2, phi2, 0, ds2, 0); w(d2, phi2, 1, del2, 0);
  // D3: Φ discarded away (Φ causal)
  const d3 = new DiagramDocument('a3'); addN(d3, NT.DISCARD, 100, 250);
  const A = { 'Φ': 'causal', 'Ψ': 'causal' };
  assert(stepA(d1, d2, '=', A).status === 'ok', 'D₁ = D₂ assuming Ψ causal');
  assert(stepA(d2, d3, '=', A).status === 'ok', 'D₂ = D₃ assuming Φ causal');
  assert(/assuming Φ causal, Ψ causal|assuming Ψ causal/.test(stepA(d1, d2, '=', A).hint), 'The hint says what was assumed');
  assert(stepA(d1, d2, '=', {}).status === 'fail', 'Without the assumption the step fails');
  assert(stepA(d2, d3, '=', { 'Ψ': 'causal' }).status === 'fail', 'Assuming only Ψ causal is not enough for D₂ = D₃');
}

log('\n=== A2: Unitaries, isometries, normalised states ===');
{
  const chain = (label, ins, outs) => {    // V then V†
    const d = new DiagramDocument('ch');
    const v = addN(d, NT.MORPHISM, 100, 220, { label, inputs: ins, outputs: outs });
    const vd = addN(d, NT.MORPHISM, 100, 120, { label, inputs: ins, outputs: outs }); d.flipNode(vd, 'adj');   // V, flipped: V†
    for (let k = 0; k < outs; k++) w(d, v, k, vd, k);
    return d;
  };
  const wire1 = new DiagramDocument('w'); addN(wire1, NT.IDENTITY, 100, 170);
  assert(stepA(chain('U', 1, 1), wire1, '=', { U: 'unitary' }).status === 'ok', 'U then U† = wire, assuming U unitary');
  assert(stepA(chain('U', 1, 1), wire1, '=', {}).status === 'fail', '… false without the assumption');
  assert(stepA(chain('V', 1, 2), wire1, '=', { V: 'isometry' }).status === 'ok', 'V then V† = wire for an isometry V (1 → 2 wires)');
  const r = stepA(chain('V', 1, 2), wire1, '=', { V: 'unitary' });
  assert(r.status === 'unavailable' && /assumed unitary/.test(r.hint), 'Assuming a non-square box unitary is reported');
  const a = new DiagramDocument('n');
  const st = addN(a, NT.STATE, 100, 200, { label: 'ψ' }), ef = addN(a, NT.STATE, 100, 100, { label: 'ψ' });
  a.flipNode(ef, 'adj'); w(a, st, 0, ef, 0);
  assert(stepA(a, new DiagramDocument('empty'), '=', { 'ψ': 'isometry' }).status === 'ok', '⟨ψ|ψ⟩ = 1 for a normalised ψ');
  // a doubled pure f is causal exactly when f is an isometry
  const b = new DiagramDocument('fh');
  const fb = thickN(b, NT.MORPHISM, 100, 200, { label: 'f' }), d0 = addN(b, NT.DISCARD, 100, 120); w(b, fb, 0, d0, 0);
  const disc = new DiagramDocument('disc'); addN(disc, NT.DISCARD, 100, 160);
  assert(stepA(b, disc, '=', { f: 'causal' }).status === 'ok', 'f̂ then ⏚ = ⏚ assuming f causal (an isometry)');
}

log('\n=== A3: Basis labels and Σ over a basis (PQP 8.14 → 8.6 → 5.37) ===');
{
  const z = new DiagramDocument('b');
  const s0 = addN(z, NT.STATE, 100, 200, { label: '0' }), e1 = addN(z, NT.EFFECT, 100, 100, { label: '1' }); w(z, s0, 0, e1, 0);
  assert(Tensor.equal(diagTensor(z), Tensor.fromRows([[0]])), '⟨1|0⟩ = 0 (basis labels are basis vectors)');
  // D1: measure, then delete
  const d1 = new DiagramDocument('m1');
  const m = dot(d1, 100, 220, ['thick'], ['thin']), del = dot(d1, 100, 140, ['thin'], []); w(d1, m, 0, del, 0);
  // D2: Σ_i measure, then the classical effect i
  const d2 = new DiagramDocument('m2'); d2.sumIndices = ['i'];
  const m2 = dot(d2, 100, 220, ['thick'], ['thin']), ei = addN(d2, NT.EFFECT, 100, 140, { label: 'i' }); w(d2, m2, 0, ei, 0);
  // D3: Σ_i the doubled effect i
  const d3 = new DiagramDocument('m3'); d3.sumIndices = ['i']; thickN(d3, NT.EFFECT, 100, 180, { label: 'i' });
  // D4: discard
  const d4 = new DiagramDocument('m4'); addN(d4, NT.DISCARD, 100, 180);
  assert(stepA(d1, d2, '=').status === 'ok', 'delete = Σᵢ ⟨i|  (8.14)');
  assert(stepA(d2, d3, '=').status === 'ok', 'Σᵢ ⟨i| after measuring = Σᵢ doubled ⟨i|  (8.6)');
  assert(stepA(d3, d4, '=').status === 'ok', 'Σᵢ doubled ⟨i| = ⏚  (5.37)');
  const d3wrong = DiagramDocument.copyOf(d3); d3wrong.sumIndices = [];
  assert(stepA(d3wrong, d4, '≈').status === 'fail', 'Without the Σ, a single doubled ⟨i| is not the discard');
  // Σ_i |i⟩⟨i| = identity
  const r = new DiagramDocument('res'); r.sumIndices = ['i'];
  addN(r, NT.EFFECT, 100, 220, { label: 'i' }); addN(r, NT.STATE, 100, 120, { label: 'i' });
  const id = new DiagramDocument('id'); addN(id, NT.IDENTITY, 100, 170);
  assert(stepA(r, id, '=').status === 'ok', 'Σᵢ |i⟩⟨i| = the identity (resolution of the identity)');
  const c = DiagramDocument.copyOf(r);
  assert(c.sumIndices.join() === 'i', 'Σ survives copying (and so saving)');
}

log('\n=== A4: Proofs carry their assumptions ===');
{
  const p = DocumentStore.add(new ProofDocument('Causal'));
  const d1 = new DiagramDocument('p1');
  const f = proc(d1, 100, 200, 'Φ', ['q'], ['q']), ds = addN(d1, NT.DISCARD, 100, 120); w(d1, f, 0, ds, 0);
  const d2 = new DiagramDocument('p2'); addN(d2, NT.DISCARD, 100, 160);
  p.insertDiagram(d1); p.insertDiagram(d2); p.setRelation(1, '=');
  assert(p.checkAll().status === 'fail', 'Unassumed: fails');
  assert(p.symbols().join() === 'Φ', 'The proof knows its symbols: Φ');
  p.setAssumption('Φ', 'causal');
  assert(p.checkAll().status === 'ok', 'Assume Φ causal: checks');
  p.undo();
  assert(!p.assumptions['Φ'] && p.checkAll().status === 'fail', 'Undo drops the assumption');
  p.redo();
  const q = ProofDocument.fromJSON(JSON.parse(JSON.stringify(p.toJSON())), new Map(p.steps.map(s => [s.diagram.id, s.diagram])));
  assert(q.assumptions['Φ'] === 'causal', 'Assumptions are saved with the proof');
}


log('\n=== G1: Copying a fragment ===');
{
  const d = new DiagramDocument('chain');
  const psi = addN(d, NT.STATE, 100, 300, { label: 'ψ' });
  const g = addN(d, NT.MORPHISM, 100, 200, { label: 'g' });
  const f = addN(d, NT.MORPHISM, 100, 100, { label: 'f' });
  w(d, psi, 0, g, 0); w(d, g, 0, f, 0);
  const fr = copyFragment(d, [g.id, f.id]);
  assert(fr.nodes.length === 2 && fr.wires.length === 1, 'f∘g: two nodes and the wire between them');
  assert(fr.inputs.length === 1 && fr.outputs.length === 1, 'Its legs: the wire from ψ and the open output → 1 input, 1 output');
  assert(Math.abs(fr.nodes[0].y + fr.nodes[1].y) < 1e-9, 'Positions are relative to the fragment’s centre');
  const e = new DiagramDocument('target');
  const added = pasteFragment(e, fr, 500, 500);
  assert(e.nodes.size === 2 && e.wires.length === 1, 'Paste: nodes and internal wire arrive');
  assert(added.every(n => !d.nodes.has(n.id)), 'Pasted nodes get fresh ids');
  assert(added.some(n => n.label === 'g' && n.y === 550) && added.some(n => n.label === 'f' && n.y === 450), 'Pasted centred on the given point');
  const again = pasteFragment(e, fr, 0, 0);
  assert(e.nodes.size === 4 && again.every(n => !added.includes(n)), 'Pasting twice gives two independent copies');
  assert(copyFragment(d, []) === null, 'Copying nothing gives nothing');
}

log('\n=== G2: Replacing a region (the rewrite gesture) ===');
{
  // ψ → f → g → (open)   ;   replace {f, g} by h
  const d = new DiagramDocument('r');
  const psi = addN(d, NT.STATE, 100, 300, { label: 'ψ' });
  const f = addN(d, NT.MORPHISM, 100, 200, { label: 'f' });
  const g = addN(d, NT.MORPHISM, 100, 100, { label: 'g' });
  w(d, psi, 0, f, 0); w(d, f, 0, g, 0);
  const src = new DiagramDocument('h'); const h = addN(src, NT.MORPHISM, 0, 0, { label: 'h' });
  const fr = copyFragment(src, [h.id]);
  assert(fits(d, [f.id, g.id], fr).ok, 'h (1 in, 1 out) fits the region g∘f (1 in, 1 out)');
  replaceRegion(d, [f.id, g.id], fr);
  const labels = [...d.nodes.values()].map(n => n.label).sort().join();
  assert(labels === 'h,ψ', 'The region is gone, h is in its place');
  const nh = [...d.nodes.values()].find(n => n.label === 'h');
  assert(d.wires.length === 1 && d.wires[0].fromNodeId === psi.id && d.wires[0].toNodeId === nh.id, 'ψ is wired into h');
  assert(Math.abs(nh.y - 150) < 1e-9, 'h sits where the region was');
  // A 2-output piece doesn't fit a 1-output region
  const two = new DiagramDocument('two'); const t = addN(two, NT.MORPHISM, 0, 0, { label: 't', inputs: 1, outputs: 2 });
  const ft = fits(d, [nh.id], copyFragment(two, [t.id]));
  assert(!ft.ok && /1 output/.test(ft.why) && /2 outputs/.test(ft.why), `Mismatch explained: "${ft.why}"`);
}

log('\n=== G3: Spider fusion by replacement ===');
{
  const d = new DiagramDocument('fuse');
  const a = addN(d, NT.Z_SPIDER, 100, 200, { label: 'α', inputs: 1, outputs: 1 });
  const b = addN(d, NT.Z_SPIDER, 100, 100, { label: 'β', inputs: 1, outputs: 2 });
  w(d, a, 0, b, 0);
  const before = DiagramDocument.copyOf(d);
  const src = new DiagramDocument('s'); const s = addN(src, NT.Z_SPIDER, 0, 0, { label: 'α+β', inputs: 0, outputs: 0 });
  const fr = copyFragment(src, [s.id]);
  assert(fits(d, [a.id, b.id], fr).ok, 'A lone spider fits any region (its legs are interchangeable)');
  replaceRegion(d, [a.id, b.id], fr);
  const z = [...d.nodes.values()][0];
  assert(d.nodes.size === 1 && z.inputs === 1 && z.outputs === 2, 'It takes the region’s legs: 1 in, 2 out');
  assert(checkStep(before.toIR(), d.toIR(), '=').status === 'ok', 'Z(α);Z(β) = Z(α+β) — the rewrite checks');
  // Thick region, thin spider: refused
  const q = new DiagramDocument('q'); const qa = addN(q, NT.Z_SPIDER, 0, 0, { inputs: 1, outputs: 1 }); qa.thick = true;
  assert(!fits(q, [qa.id], fr).ok, 'A thin spider can’t replace a doubled one');
}

log('\n=== G4: Outside spiders keep their legs ===');
{
  const d = new DiagramDocument('legs');
  const s = addN(d, NT.Z_SPIDER, 100, 300, { inputs: 0, outputs: 2 });
  const a = addN(d, NT.MORPHISM, 60, 200, { label: 'a' });
  const b = addN(d, NT.MORPHISM, 140, 200, { label: 'b' });
  w(d, s, 0, a, 0); w(d, s, 1, b, 0);
  const src = new DiagramDocument('c'); const c = addN(src, NT.MORPHISM, 0, 0, { label: 'c' });
  replaceRegion(d, [a.id], copyFragment(src, [c.id]));
  const nc = [...d.nodes.values()].find(n => n.label === 'c');
  assert(s.outputs === 2, 'The spider still has both legs');
  assert(d.wires.some(x => x.fromNodeId === s.id && x.fromPort === 0 && x.toNodeId === nc.id), 'Leg 0 now feeds c');
  assert(d.wires.some(x => x.fromNodeId === s.id && x.fromPort === 1 && x.toNodeId === b.id), 'Leg 1 still feeds b');
  const bd = regionBoundary(d, [nc.id, b.id]);
  assert(bd.in.length === 2 && bd.in[0].nodeId === nc.id, 'Region legs read left to right');
}

log('\n=== G5: Plugging in ===');
{
  const d = new DiagramDocument('plug');
  const a = addN(d, NT.MORPHISM, 100, 200, { label: 'a' });
  const b = addN(d, NT.MORPHISM, 100, 100, { label: 'b' });
  const gap = b.getInputPort(0).y - a.getOutputPort(0).y;
  b.y -= gap - 5;                                   // b's input 5 units above a's output
  let c = plugCandidates(d, [b.id], 18);
  assert(c.length === 1 && c[0].from.nodeId === a.id && c[0].to.nodeId === b.id, 'a’s free output plugs into b’s input');
  b.y -= 100;
  assert(plugCandidates(d, [b.id], 18).length === 0, 'Too far: nothing');
  b.y += 100; b.thick = true;
  assert(plugCandidates(d, [b.id], 18).length === 0, 'Thick and thin don’t plug together');
  b.thick = false; w(d, a, 0, b, 0);
  assert(plugCandidates(d, [b.id], 18).length === 0, 'Ports already wired are not candidates');
}


log('\n=== M1: Measurement in circuits (the doubled picture) ===');
{
  const mkC = (n, f) => { const c = new CircuitDocument('m', n); f(c); return c; };
  const chan = c => contractIR(c.toIR()).tensor;
  const same = (A, B) => A && B && A.rows === B.rows && A.cols === B.cols && Tensor.equal(A, B, 1e-9);
  const m1 = mkC(1, c => c.setCell(0, 0, { gate: 'measure' }));
  assert(m1.isMixed() && m1.toIR().diagnostics.every(d => d.severity !== 'error'), 'A measuring circuit is a quantum process, well-typed');
  assert(same(chan(m1), Tensor.fromRows([[1, 0, 0, 0], [0, 0, 0, 1]].map(r => r.map(v => [v, 0])))),
    'Measuring a qubit: the white dot δ — thick (a, b) in, thin c out, a = b = c');
  const d = m1.doubledDiagram();
  const kinds = [...d.nodes.values()].map(n => n.type.key);
  assert(kinds.includes('dot'), 'Drawn with a white dot');
  const hm = mkC(1, c => { c.setInput(0, '0'); c.setCell(0, 0, { gate: 'H' }); c.setCell(1, 0, { gate: 'measure' }); });
  const p = chan(hm);
  assert(p.rows === 2 && p.cols === 1 && Math.abs(p.get(0, 0)[0] - 0.5) < 1e-9 && Math.abs(p.get(1, 0)[0] - 0.5) < 1e-9,
    '|0⟩, H, measure: outcomes 0 and 1 with probability ½ each (Born rule)');
  const hd = [...hm.doubledDiagram().nodes.values()];
  assert(hd.filter(n => n.type.key !== 'dot').every(n => n.thick), 'Every quantum generator is doubled (thick)');
  for (const [name, build] of [
    ['classically controlled X', c => { c.setCell(0, 0, { gate: 'measure' }); c.setCell(1, 0, { gate: 'ctrl' }); c.setCell(1, 1, { gate: 'X' }); }],
    ['classically controlled Z', c => { c.setCell(0, 0, { gate: 'measure' }); c.setCell(1, 0, { gate: 'ctrl' }); c.setCell(1, 1, { gate: 'Z' }); }],
    ['classically controlled H (doubled box, copy discarded)', c => { c.setCell(0, 0, { gate: 'measure' }); c.setCell(1, 0, { gate: 'ctrl' }); c.setCell(1, 1, { gate: 'H' }); }],
    ['classical anti-control', c => { c.setCell(0, 0, { gate: 'measure' }); c.setCell(1, 0, { gate: 'actrl' }); c.setCell(1, 1, { gate: 'X' }); }],
    ['Bell state, then measure one half', c => { c.setInput(0, '0'); c.setInput(1, '0'); c.setCell(0, 0, { gate: 'H' }); c.setCell(1, 0, { gate: 'ctrl' }); c.setCell(1, 1, { gate: 'X' }); c.setCell(2, 0, { gate: 'measure' }); }],
    ['discarded output', c => { c.setCell(0, 0, { gate: 'H' }); c.setOutput(1, 'discard'); }],
    ['classical outputs 1 and ⏚', c => { c.setCell(0, 0, { gate: 'measure' }); c.setCell(0, 1, { gate: 'measure' }); c.setOutput(0, '1'); c.setOutput(1, 'discard'); }],
  ]) {
    const c = mkC(2, build);
    assert(same(chan(c), circuitChannel(c)), `${name}: diagram = density-operator reference`);
  }
}

log('\n=== M2: Teleportation ===');
{
  const c = new CircuitDocument('teleport', 3);
  c.setInput(1, '0'); c.setInput(2, '0');
  c.setCell(0, 1, { gate: 'H' }); c.setCell(1, 1, { gate: 'ctrl' }); c.setCell(1, 2, { gate: 'X' });   // Bell pair on 1, 2
  c.setCell(2, 0, { gate: 'ctrl' }); c.setCell(2, 1, { gate: 'X' }); c.setCell(3, 0, { gate: 'H' });  // Bell measurement…
  c.setCell(4, 0, { gate: 'measure' }); c.setCell(4, 1, { gate: 'measure' });
  c.setCell(5, 1, { gate: 'ctrl' }); c.setCell(5, 2, { gate: 'X' });                                   // …and corrections
  c.setCell(6, 0, { gate: 'ctrl' }); c.setCell(6, 2, { gate: 'Z' });
  c.setOutput(0, 'discard'); c.setOutput(1, 'discard');
  const T = contractIR(c.toIR()).tensor;
  assert(T && Tensor.equal(T, Tensor.identity(4), 1e-9), 'Measure, correct, discard the bits: exactly the identity channel on the doubled wire');
  const d = c.doubledDiagram();
  assert([...d.nodes.values()].filter(n => n.type.key === 'dot').length === 6,
    'White dots: two measurements, two classical controls, and two deletes (the discarded bits)');
  c.setCell(6, 0, null);
  const broken = contractIR(c.toIR()).tensor;
  assert(!Tensor.equal(broken, Tensor.identity(4), 1e-6), 'Without the Z correction it is not the identity');
}

log('\n=== M3: Classical wires are typed ===');
{
  const c = new CircuitDocument('typed', 1);
  c.setCell(0, 0, { gate: 'measure' }); c.setCell(1, 0, { gate: 'H' });
  const err = c.toIR().diagnostics.find(d => d.severity === 'error');
  assert(err && /classical/.test(err.message), `A gate after the measurement is an error: "${err && err.message}"`);
  const o = new CircuitDocument('out', 1); o.setCell(0, 0, { gate: 'measure' }); o.setOutput(0, '+');
  assert(o.toIR().diagnostics.some(d => d.severity === 'error' && /not \+/.test(d.message)), 'A classical wire can’t end in ⟨+|');
  assert(circuitToDirac(c).latex === '' && /not available yet/.test(circuitToDirac(c).info), 'Dirac: not available yet (said so)');
  const pure = new CircuitDocument('pure', 1); pure.setCell(0, 0, { gate: 'H' });
  assert(!pure.isMixed() && contractIR(pure.toIR()).tensor.rows === 2, 'Circuits without measurement are unchanged');
  const j = CircuitDocument.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
  assert(j.isMixed() && j.columns[0][0].gate === 'measure', 'Measurements are saved');
}


log('\n=== D1: Quantum processes in Dirac notation — familiar and PQP ===');
{
  const mk = (n, f) => { const c = new CircuitDocument('p', n); f(c); return c; };
  const check = (c, latex) => { const sc = new SyncController(c); sc.onDiracChanged(latex, true); sc.verifyNow(); const r = sc.state; sc.destroy(); return r; };
  const meas = mk(1, c => c.setCell(0, 0, { gate: 'measure' }));
  const g = meas.generateDirac();
  assert(g.familiar.latex === '\\rho \\mapsto |0\\rangle\\langle 0| \\rho |0\\rangle\\langle 0| + |1\\rangle\\langle 1| \\rho |1\\rangle\\langle 1|',
    `Measurement, familiar: ${g.familiar.latex}`);
  assert(g.pqp.latex === '\\sum_{i} |i\\rangle \\otimes \\widehat{\\langle i|}', `Measurement, PQP: ${g.pqp.latex}`);
  assert(check(meas, g.familiar.latex) === 'synced' && check(meas, g.pqp.latex) === 'synced', 'Both generated forms verify');
  assert(check(meas, '\\rho \\mapsto \\sum_{i} |i\\rangle\\langle i| \\rho |i\\rangle\\langle i|') === 'synced', 'A student’s Σᵢ |i⟩⟨i| ρ |i⟩⟨i| verifies');
  assert(check(meas, '\\sum_i |i\\rangle \\hat{\\langle i|}') === 'synced', 'and so does Σᵢ |i⟩ ⟨i|̂ (\\hat, juxtaposed)');
  assert(check(meas, '\\rho \\mapsto \\rho') === 'not-equivalent', 'ρ ↦ ρ is not a measurement (it keeps coherences on a classical wire)');
  const disc = mk(1, c => c.setOutput(0, 'discard'));
  assert(check(disc, '\\rho \\mapsto \\mathrm{tr}(\\rho)') === 'synced', 'Discarding: ρ ↦ tr(ρ)');
  assert(check(disc, '\\sum_{i} \\widehat{\\langle i|}') === 'synced', 'Discarding, PQP: Σᵢ ⟨i|̂');
  const coin = mk(1, c => { c.setInput(0, '0'); c.setCell(0, 0, { gate: 'H' }); c.setCell(1, 0, { gate: 'measure' }); });
  assert(coin.generateDirac().familiar.latex === '\\frac{1}{2}|0\\rangle\\langle 0| + \\frac{1}{2}|1\\rangle\\langle 1|', 'A state, familiar: its density operator ½|0⟩⟨0| + ½|1⟩⟨1|');
  assert(check(coin, '\\frac{1}{2}(|0\\rangle\\langle 0| + |1\\rangle\\langle 1|)') === 'synced', 'and the student’s ½(|0⟩⟨0| + |1⟩⟨1|) verifies');
  assert(check(coin, '\\frac{1}{2}|0\\rangle + \\frac{1}{2}|1\\rangle') === 'synced', 'PQP: a probability distribution on the classical wire, ½|0⟩ + ½|1⟩');
  const dh = mk(1, c => { c.setCell(0, 0, { gate: 'H' }); c.setOutput(0, 'discard'); });
  assert(check(dh, '\\rho \\mapsto \\mathrm{tr}(H \\rho H^\\dagger)') === 'synced', 'Composition inside the trace: tr(HρH†)');
  const tel = new CircuitDocument('teleport', 3);
  tel.setInput(1, '0'); tel.setInput(2, '0');
  for (const [t, q, gate] of [[0, 1, 'H'], [1, 1, 'ctrl'], [1, 2, 'X'], [2, 0, 'ctrl'], [2, 1, 'X'], [3, 0, 'H'], [4, 0, 'measure'], [4, 1, 'measure'],
    [5, 1, 'ctrl'], [5, 2, 'X'], [6, 0, 'ctrl'], [6, 2, 'Z']]) tel.setCell(t, q, { gate });
  tel.setOutput(0, 'discard'); tel.setOutput(1, 'discard');
  const tg = tel.generateDirac();
  assert(tg.familiar.latex === '\\rho \\mapsto \\rho' && tg.pqp.latex === '\\widehat{I}', `Teleportation: ${tg.familiar.latex}  |  ${tg.pqp.latex}`);
  assert(check(tel, '\\rho \\mapsto \\rho') === 'synced', 'and ρ ↦ ρ verifies against the circuit');
  // A process typed for a plain linear map is refused with a reason
  const pure = new CircuitDocument('pure', 1); pure.setCell(0, 0, { gate: 'H' });
  assert(check(pure, '\\rho \\mapsto H \\rho H') === 'not-equivalent', 'ρ ↦ … against a linear map: not equivalent (said why)');
  // Shapes: a doubled matrix of the wrong size is explained
  assert(check(meas, '|0\\rangle\\langle 0|') === 'not-equivalent', 'An operator for a process with an input: not equivalent');
}

log('\n=== D2: Sums over a basis in Dirac notation ===');
{
  const r = new DiagramDocument('res'); r.sumIndices = ['i'];
  addN(r, NT.EFFECT, 100, 220, { label: 'i' }); addN(r, NT.STATE, 100, 120, { label: 'i' });
  const g = r.generateDirac();
  assert(!!g.latex, `Σᵢ |i⟩⟨i| generates: ${g.latex}`);
  const sc = new SyncController(r);
  for (const [tex, want] of [[g.latex, 'synced'], ['\\sum_i |i\\rangle\\langle i|', 'synced'], ['I', 'synced'], ['|0\\rangle\\langle 0|', 'not-equivalent']]) {
    sc.onDiracChanged(tex, true); sc.verifyNow();
    assert(sc.state === want, `${tex} → ${want}`);
  }
  sc.destroy();
  const T = evaluateDiagram(diagramToIR(r)).tensor;
  assert(Tensor.equal(T, Tensor.identity(2)), 'The diagram with its Σ evaluates to the identity');
  const pd = evalProcess(parseDirac('\\widehat{H}'), { in: ['q'], out: ['q'] }).tensor;
  const Hd = new DiagramDocument('Hd'); const h = addN(Hd, NT.HADAMARD, 100, 150); h.thick = true;
  assert(Tensor.equal(pd, contractIR(diagramToIR(Hd)).tensor, 1e-9), '\\widehat{H} equals the doubled H drawn thick');
}

// === Summary ===
log(`\n${'='.repeat(40)}`);
log(`${passed} passed, ${failed} failed`, failed ? 'fail' : 'pass');
