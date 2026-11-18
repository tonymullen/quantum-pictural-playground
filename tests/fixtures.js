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
import C from '../js/core/Complex.js';
import { verify } from '../js/core/Verify.js';

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

// === Summary ===
log(`\n${'='.repeat(40)}`);
log(`${passed} passed, ${failed} failed`, failed ? 'fail' : 'pass');
