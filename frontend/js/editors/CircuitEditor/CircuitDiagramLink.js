/**
 * CircuitDiagramLink — Keep a diagram document generated from a circuit.
 *
 * The diagram (named "<circuit> · diagram", with derivedFrom = circuit id)
 * is registered in the DocumentStore and regenerated whenever the circuit
 * changes, so it can be opened in any Diagram Editor panel. It is a view of
 * the circuit: edits made to it are replaced on the next circuit change.
 */
import DocumentStore from '../DocumentStore.js';
import DiagramDocument from '../DiagramEditor/DiagramDocument.js';
import irToDiagram from './IRToDiagram.js';
import circuitToIR from '../../core/CircuitToIR.js';

/** The circuit's IR with boundaries in qubit order (layout does not depend on tensor order). */
const circuitToIRForLayout = c => circuitToIR({ ...c.toJSON(), id: c.id, tensorOrder: 'big-endian' });

/**
 * Get (creating if needed) the diagram generated from `circuit`, kept in sync.
 * @param {import('./CircuitDocument.js').default} circuit
 * @returns {DiagramDocument}
 */
export function derivedDiagram(circuit) {
  let diagram = DocumentStore.list('diagram').find(d => d.derivedFrom === circuit.id);
  if (!diagram) {
    diagram = new DiagramDocument(`${circuit.name} · diagram`);
    diagram.derivedFrom = circuit.id;
    DocumentStore.add(diagram);
  }
  if (!circuit._diagramSync) {
    circuit._diagramSync = () => {
      const d = DocumentStore.list('diagram').find(x => x.derivedFrom === circuit.id);
      if (!d) return;
      if (d.name !== `${circuit.name} · diagram`) {
        d.name = `${circuit.name} · diagram`;
        DocumentStore.notifyListChange();
      }
      // Lay out in qubit order; the diagram then applies the circuit's tensor order itself
      d.tensorOrder = circuit.tensorOrder;
      const { nodes, wires } = irToDiagram(circuitToIRForLayout(circuit));
      d.replaceContents(nodes, wires);
    };
    circuit.onChange(circuit._diagramSync);
  }
  circuit._diagramSync();
  return diagram;
}
