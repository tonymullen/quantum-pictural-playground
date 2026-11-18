/**
 * App Entry Point — Quantum Pictural Playground
 *
 * Registers editor types and initializes the Blender-style layout manager.
 */
import EditorRegistry from './editors/EditorRegistry.js';
import DiagramEditor from './editors/DiagramEditor/DiagramEditor.js';
import DiracEditor from './editors/DiracEditor/DiracEditor.js';
import CircuitEditor from './editors/CircuitEditor/CircuitEditor.js';
import LayoutManager from './layout/LayoutManager.js';
import DocumentStore from './editors/DocumentStore.js';
import CircuitDocument from './editors/CircuitEditor/CircuitDocument.js';
import { derivedDiagram } from './editors/CircuitEditor/CircuitDiagramLink.js';

// Register available editor types
EditorRegistry.register(DiagramEditor);
EditorRegistry.register(DiracEditor);
EditorRegistry.register(CircuitEditor);

// Boot the layout manager into the #app root
const appRoot = document.getElementById('app');
const layout = new LayoutManager(appRoot);

// Expose for debugging (and, until the circuit editor exists, for building circuits
// from the console: const c = new __QPP.CircuitDocument('Bell', 2); __QPP.DocumentStore.add(c); …)
window.__QPP = { layout, EditorRegistry, DocumentStore, CircuitDocument, derivedDiagram };
