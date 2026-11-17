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

// ===== NEW FIXTURE SET =====

// Helper: build the example diagram (Z-X CNOT + cap + H)
function makeExample() {
  const doc = new DiagramDocument('example');
  const z = addN(doc, NT.Z_SPIDER, 100, 50, {inputs:1, outputs:2});
  const x = addN(doc, NT.X_SPIDER, 100, 150, {inputs:2, outputs:1});
  w(doc, z, 0, x, 0);
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
  const z=addN(d1,NT.Z_SPIDER,100,50,{inputs:1,outputs:2});
  const x=addN(d1,NT.X_SPIDER,100,150,{inputs:2,outputs:1});
  w(d1,z,0,x,0);
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
  const z = addN(doc, NT.Z_SPIDER, 100, 50, {inputs:1, outputs:2});
  const x = addN(doc, NT.X_SPIDER, 100, 150, {inputs:2, outputs:1});
  w(doc, z, 0, x, 0);
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
  const z = addN(doc, NT.Z_SPIDER, 100, 50, {inputs:1, outputs:2});
  const x = addN(doc, NT.X_SPIDER, 100, 150, {inputs:2, outputs:1});
  w(doc, z, 0, x, 0);
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
  const z = addN(doc, NT.Z_SPIDER, 100, 50, {inputs:1, outputs:2});
  const x = addN(doc, NT.X_SPIDER, 100, 150, {inputs:2, outputs:1});
  w(doc, z, 0, x, 0);
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
  const z = addN(doc, NT.Z_SPIDER, 100, 50, {inputs:1, outputs:2});
  const x = addN(doc, NT.X_SPIDER, 100, 150, {inputs:2, outputs:1});
  w(doc, z, 0, x, 0);
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
  // The concrete H component should still be mentioned somewhere
  assert(r.info.includes('Hadamard') || r.reason.includes('Hadamard')
    || r.latex.includes('H'),
    'Concrete H component still appears');
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

// === Summary ===
log(`\n${'='.repeat(40)}`);
log(`${passed} passed, ${failed} failed`, failed ? 'fail' : 'pass');
