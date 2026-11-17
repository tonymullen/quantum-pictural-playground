/**
 * ContractIR — Evaluate an IRGraph by contracting its tensor network.
 * Returns the overall tensor: (2^nOpenOut) × (2^nOpenIn), or null if symbolic.
 */
import C from './Complex.js';
import Tensor from './Tensor.js';
import { generatorTensor } from './Interpret.js';

/**
 * @param {import('./IR.js').IRGraph} graph
 * @returns {{ tensor: Tensor|null, symbolic: boolean, reason?: string }}
 */
export default function contractIR(graph) {
  if (graph.nodes.size === 0)
    return { tensor: Tensor.fromRows([[C.ONE]]), symbolic: false };

  const tensors = new Map();
  for (const node of graph.nodes.values()) {
    const t = generatorTensor(node);
    if (!t) return { tensor: null, symbolic: true,
      reason: `"${node.label||node.kind}" has no concrete matrix` };
    tensors.set(node.id, t);
  }

  const nodeList = Array.from(graph.nodes.values());
  // Build port-slot maps
  const portSlots = new Map();
  let totalIn = 0, totalOut = 0;
  for (const node of nodeList) {
    for (let i = 0; i < node.totalIn; i++)
      portSlots.set(`${node.id}:in:${i}`, totalIn++);
    for (let i = 0; i < node.totalOut; i++)
      portSlots.set(`${node.id}:out:${i}`, totalOut++);
  }

  // Big Kronecker product of all generators
  let big = tensors.get(nodeList[0].id);
  for (let i = 1; i < nodeList.length; i++)
    big = Tensor.kron(big, tensors.get(nodeList[i].id));

  // Internal edge pairs (contracted indices)
  const pairs = [];
  for (const e of graph.edges) {
    const os = portSlots.get(`${e.srcNodeId}:out:${e.srcPort}`);
    const is_ = portSlots.get(`${e.tgtNodeId}:in:${e.tgtPort}`);
    if (os !== undefined && is_ !== undefined) pairs.push({ os, is: is_ });
  }

  // Open (boundary) slots
  const cOut = new Set(pairs.map(p => p.os));
  const cIn = new Set(pairs.map(p => p.is));
  const openOut = [], openIn = [];
  for (let i = 0; i < totalOut; i++) if (!cOut.has(i)) openOut.push(i);
  for (let i = 0; i < totalIn; i++) if (!cIn.has(i)) openIn.push(i);

  const dO = 1 << openOut.length, dI = 1 << openIn.length;
  const dC = 1 << pairs.length;
  const result = Tensor.zeros(dO, dI);

  // Brute-force contraction
  for (let oi = 0; oi < dO; oi++)
    for (let ii = 0; ii < dI; ii++) {
      let sum = C.ZERO;
      for (let ci = 0; ci < dC; ci++) {
        const ob = new Array(totalOut).fill(0);
        const ib = new Array(totalIn).fill(0);
        for (let k = 0; k < openOut.length; k++)
          ob[openOut[k]] = (oi >> (openOut.length-1-k)) & 1;
        for (let k = 0; k < openIn.length; k++)
          ib[openIn[k]] = (ii >> (openIn.length-1-k)) & 1;
        for (let k = 0; k < pairs.length; k++) {
          const bit = (ci >> (pairs.length-1-k)) & 1;
          ob[pairs[k].os] = bit; ib[pairs[k].is] = bit;
        }
        let row = 0, col = 0;
        for (let b = 0; b < totalOut; b++) row = (row<<1)|ob[b];
        for (let b = 0; b < totalIn; b++) col = (col<<1)|ib[b];
        sum = C.add(sum, big.get(row, col));
      }
      result.set(oi, ii, sum);
    }
  return { tensor: result, symbolic: false };
}
