/**
 * App Entry Point — Quantum Pictural Playground
 *
 * Registers editor types and initializes the Blender-style layout manager.
 */
import EditorRegistry from './editors/EditorRegistry.js';
import DiagramEditor from './editors/DiagramEditor/DiagramEditor.js';
import DiracEditor from './editors/DiracEditor/DiracEditor.js';
import LayoutManager from './layout/LayoutManager.js';

// Register available editor types
EditorRegistry.register(DiagramEditor);
EditorRegistry.register(DiracEditor);

// Boot the layout manager into the #app root
const appRoot = document.getElementById('app');
const layout = new LayoutManager(appRoot);

// Expose for debugging
window.__QPP = { layout, EditorRegistry };
