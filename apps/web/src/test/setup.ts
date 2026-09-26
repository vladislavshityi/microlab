import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { useCircuitStore } from "@/stores/circuit-store";
import { resetProjectSession } from "@/features/projects/project-session";
import { useEditorStore } from "@/stores/editor-store";
import { useProjectStore } from "@/stores/project-store";
import { useSimulationStore } from "@/stores/simulation-store";
import { useUiStore } from "@/stores/ui-store";

import { FakeWebSocket } from "./fake-websocket";

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
const initialProjectState = useProjectStore.getState();

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  useUiStore.setState(initialUiState, true);
  useEditorStore.setState(initialEditorState, true);
  useCircuitStore.setState(initialCircuitState, true);
  useProjectStore.setState(initialProjectState, true);
  useSimulationStore.getState().resetForProject();
  resetProjectSession();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  cleanup();
});
