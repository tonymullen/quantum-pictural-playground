# Fix: bra/ket direction, shape verification, scalar handling, boundary order

## Bug origins

### Bug 1: Effects rendered as states
- `_tensorToLatex()` in DiagramToDirac.js line 118-133 decides ket vs bra by
  matrix shape: cols===1 → ket (state), rows===1 → bra (effect). This is
  correct for the raw tensor. The cap tensor IS 1×4 (effect shape), so it
  should print as a bra. BUT `_translateComponent` at line 93 uses `cl.latex`
  from recognition, which for ⟨Φ⁺| is `(|00\rangle + |11\rangle)` — a KET
  form. The recognition library has the Bell bra's latex as a ket expression
  wrapped in parens. Fix: Bell bra latex must use `\langle`.
  Actually re-reading KnownGates.js line 72: the latex IS `(\langle 00| + 
  \langle 11|)`. So the library is correct. The bug must be that the recognition
  matches the BELL_PHI_PLUS (ket, 4×1) instead of BELL_BRA_PHI_PLUS (bra, 1×4)
  because `equalUpToPhase` doesn't check shape — it only checks element count.
  Since both have 4 elements (4×1 vs 1×4), flattened comparison succeeds.

### Bug 2: Shape-blind verification  
- `Tensor.equalUpToPhase()` in Tensor.js compares `A.d` and `B.d` arrays. 
  It checks `A.rows !== B.rows || A.cols !== B.cols` as the FIRST check, 
  which SHOULD catch shape mismatches. But the ket (4×1) vs bra (1×4) case:
  4≠1 for rows, so it returns {equal:false}. So recognition shouldn't match...
  unless the iterate-all-entries loop happens to match by coincidence? Let me
  re-check: BELL_PHI_PLUS is 4×1 = [1,0,0,1], BELL_BRA is 1×4 = [1,0,0,1].
  equalUpToPhase checks rows/cols FIRST → 4≠1 → returns false. So the bra
  should NOT match the ket entry. The bug report says the cap shows as |Φ⁺⟩ —
  this means recognise() is matching the bra tensor against the ket entry.
  Let me check: the cap contracts to a 1×4 tensor. Recognition iterates all
  entries. The ket entry is 4×1. equalUpToPhase says 1≠4 → false. The bra
  entry is 1×4. equalUpToPhase says 1===1, 4===4 → checks elements → matches.
  So recognition SHOULD return the bra name. The user report says "This is
  |Φ⁺⟩ (unnorm)" — maybe the library order matters? The ket entry comes first.
  Wait — I need to check if recognise() stops at the FIRST match. Yes it does.
  The ket entry (4×1) fails shape check. The bra entry (1×4) succeeds. So the
  name should be "⟨Φ⁺| (unnorm)". The user report says "|Φ⁺⟩ (unnorm)" which
  suggests the shape check IS failing or the ordering is wrong. Need to verify
  in browser.

  ACTUAL ROOT CAUSE for Bug 2: `verify()` in Verify.js does NOT check shape
  before `equalUpToPhase`. It calls `Tensor.equal(a, b)` which does check, 
  then `Tensor.equalUpToPhase(a, b)` which also checks. So shape IS checked.
  But the status display says "up to phase 1.414" — this means the generated
  ket IS matching as equivalent to the diagram bra. The flattened d arrays are
  the same ([1,0,0,1]) regardless of shape. Need to add explicit shape check
  before ANY numeric comparison in verify().

### Bug 3: Scalars called phases
- `verifyStatusDisplay()` in Verify.js line 97 calls everything "phase" even
  when |c|≠1. The scalar 1/√2 ≈ 0.707 is not a phase. Need to distinguish
  |c|=1 (phase) from |c|≠1 (scalar).
- Generate should fold scalars so its own output verifies exactly (no scalar).

### Bug 4: Boundary ordering
- Currently ordered by x-position within the whole diagram, not grouped by
  component. Components should be ordered left-to-right by leftmost node x,
  then boundaries within each component by through-wire.
