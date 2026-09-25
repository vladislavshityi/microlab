import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

import { useCircuitStore } from "@/stores/circuit-store";
import { useEditorStore } from "@/stores/editor-store";
import { useUiStore } from "@/stores/ui-store";

// jsdom не реализует API, которые используют панели и холст схемы.
class ResizeObserverStub {
  observe(): void {
    // Размеры в jsdom всегда нулевые — наблюдать нечего.
  }
  unobserve(): void {
    // См. observe().
  }
  disconnect(): void {
    // См. observe().
  }
}

class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) {
    const scale = /scale\(([\d.]+)\)/.exec(transform ?? "")?.[1];
    this.m22 = scale === undefined ? 1 : Number(scale);
  }
}

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: ResizeObserverStub,
    configurable: true,
    writable: true,
  });
}
// @xyflow/react читает масштаб через DOMMatrixReadOnly.
Object.defineProperty(globalThis, "DOMMatrixReadOnly", {
  value: DOMMatrixReadOnlyStub,
  configurable: true,
  writable: true,
});

const initialUiState = useUiStore.getState();
const initialEditorState = useEditorStore.getState();
const initialCircuitState = useCircuitStore.getState();

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  useUiStore.setState(initialUiState, true);
  useEditorStore.setState(initialEditorState, true);
  useCircuitStore.setState(initialCircuitState, true);
});

afterEach(() => {
  cleanup();
});
