# Decision Record: Compute Location

Phase 0 evaluation per the project spec. Three options evaluated with working
spikes (in `spikes/phase0/`).

---

## Option (a): Pure JS

### Spike results

**Spike A1 (`spike-a-pure-js.html`):** math.js 13.x from CDN.
- Complex numbers, kron, multiply, trace, transpose: ✅
- Partial trace, tensor contraction over index pairs: ❌ needs custom code
- CDN size: ~170 KB gzipped. Loads instantly.

**Spike A2 (`spike-a-custom-tensor.html`):** Hand-written ops, zero deps, ~80 lines.
- All ops verified: complex arithmetic, matMul, kron, trace, dagger,
  partialTrace, inner/outer products, snake equation (cup·cap = 2).
- **6-qubit (64×64) performance:** sub-millisecond for kron build and multiply.

### Assessment

| Criterion | Rating |
|---|---|
| Tensor contraction at target sizes | ✅ Sub-ms at 64×64 |
| Dirac parser + printer | ✅ Recursive descent in JS |
| Named-object recognition | ✅ Compare against known matrices |
| Numeric verification | ✅ Matrix compare up to phase: ~20 lines |
| Symbolic phases (rational π-multiples) | ✅ Custom `{num,den}` struct |
| Basic ZX rewriting (fusion, snake, π-copy) | ⚠️ ~200-400 lines. Sufficient for A–C |
| gflow-based circuit extraction | ❌ Substantial project |
| Load cost | ✅ Zero |
| Offline / static hosting | ✅ Perfect |

---

## Option (b): Pyodide + PyZX in a Web Worker

### Spike results (`spike-b-pyodide.html`)

| Metric | Value |
|---|---|
| Pyodide core download | ~5 MB (2.8 MB wasm + 2.3 MB stdlib) |
| Cold init (wasm compile) | ~2-4s |
| PyZX install via micropip | ~1-2s (pure Python wheel + numpy) |
| **Total cold start** | **~6-10s** |
| Warm simplify+extract (3q, 20 gates) | **<100ms** |

PyZX 0.10.8 is a pure Python wheel (`py3-none-any.whl`). Runtime deps: numpy
(Pyodide built-in), typing-extensions (pure Python). Heavy optional deps
(matplotlib, qiskit) not needed.

### Assessment

| Criterion | Rating |
|---|---|
| Full ZX simplification | ✅ PyZX `full_reduce` |
| gflow circuit extraction | ✅ PyZX `extract_circuit` |
| Cold load cost | ⚠️ 6-10s — acceptable if lazy-loaded with visible state |
| Warm latency | ✅ <100ms |
| Static hosting | ✅ All files self-hostable |

---

## Option (c): Python backend — REJECTED

Fails the static-file deployment constraint. Options (a)+(b) cover all needs.

---

## Decision: Hybrid (a) + (b)

```
┌─────────────────────────────────────────────────┐
│  Always available (pure JS, instant)            │
│  • Custom tensor engine (~100 lines)            │
│  • Dirac parser + printer                       │
│  • Named-object recognition + verification      │
│  • Basic ZX simplification (fusion, snake, etc) │
│  • Pedagogical classifier + sync controller     │
└─────────────────────────────────────────────────┘
            │ lazy-loaded on first request
            ▼
┌─────────────────────────────────────────────────┐
│  Pyodide + PyZX in Web Worker                   │
│  • Full ZX simplification + circuit extraction  │
│  • Loading state: "Loading ZX engine (~10s)…"   │
└─────────────────────────────────────────────────┘
```

### Rationale

1. **Core features are trivially feasible in pure JS.** Custom tensor module
   (no math.js — 170KB for marginal benefit over ~100 lines). Sub-ms at target.
2. **Basic ZX rules** (spider fusion, identity, snake, π-copy, Hopf, bialgebra)
   are ~200-400 lines of JS, sufficient for Categories A–C without Pyodide.
3. **Full ZX + circuit extraction** needs PyZX. 6-10s cold start is acceptable
   once per session with a visible loading state. Warm calls <100ms.
4. **Symbolic algebra:** `{num,den}` rational phases + small expression tree
   covers scope. SymPy not needed; can be added to Pyodide worker later.
5. **No server.** Fully static-file deployable.

### Fallback

If Pyodide+PyZX breaks, circuit extraction degrades gracefully. All other
features (interpretation, verification, Dirac sync, Categories A–C) continue
via pure JS.

---

## Spike file locations

| Artifact | Path |
|---|---|
| This decision record | `docs/decision-compute.md` |
| Spike A1: math.js | `spikes/phase0/spike-a-pure-js.html` |
| Spike A2: custom tensor | `spikes/phase0/spike-a-custom-tensor.html` |
| Spike B: Pyodide+PyZX | `spikes/phase0/spike-b-pyodide.html` |
