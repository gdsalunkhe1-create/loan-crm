// setupTests.js — auto-loaded by CRA/react-scripts before every Jest run
// (via jest-environment-jsdom's setupFilesAfterEach convention, no extra
// config needed). This file adds browser globals JSDOM doesn't provide by
// default but that PDF/canvas-related libraries assume exist at import
// time - jspdf, jspdf-autotable, fast-png, and iobuffer (their shared
// PNG-decoding dependency) all touch some subset of these during
// Dashboard.js's import chain, which is what pulls them into App.test.js.
import '@testing-library/jest-dom';

// TextEncoder/TextDecoder - needed by iobuffer (fast-png's byte-buffer
// helper). Node has these natively via 'util'; JSDOM just doesn't expose
// them as globals.
import { TextEncoder, TextDecoder } from 'util';
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;

// structuredClone - Node 17+ has this natively, but some older/CI Node
// versions or older jsdom bundles don't expose it as a global. jspdf's
// internal state handling can call it.
if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}

// Canvas 2D context - jspdf can probe for canvas support at import time.
// JSDOM's <canvas> exists but has no real rendering backend, so
// getContext() returns null unless a context is explicitly stubbed. A
// minimal stub is enough to satisfy an import-time capability check; it
// is NOT a real renderer, so don't rely on this for anything that
// actually draws.
if (typeof HTMLCanvasElement !== 'undefined' && !HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = () => null;
}

// URL.createObjectURL / revokeObjectURL - used by bsaExcelExport.js and
// cibilExcelExport.js's browser download flow (Blob -> object URL -> <a>
// click). JSDOM doesn't implement the Blob URL registry, so these throw
// "not implemented" if a test path reaches them. Stubbed here so an
// import (not an actual download) never crashes a test run.
if (typeof global.URL.createObjectURL === 'undefined') {
  global.URL.createObjectURL = () => 'blob:mock-url';
}
if (typeof global.URL.revokeObjectURL === 'undefined') {
  global.URL.revokeObjectURL = () => {};
}

// window.matchMedia - App.js's PWA install-prompt logic calls this
// (`window.matchMedia('(display-mode: standalone)')`) to detect whether
// the app is already installed. JSDOM doesn't implement matchMedia at
// all, so any component that touches it throws "not a function" the
// moment it mounts in a test. The mock below returns a plausible
// "not standalone, no media match" result so App.js's effect can run to
// completion without erroring - it is NOT a real media-query engine, so
// don't rely on it for anything that needs actual responsive behavior.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},    // deprecated API, some libs still call it
    removeListener: () => {}, // deprecated API, some libs still call it
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
