import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { getComponentDefinition, type GridPoint, type PinRef } from "@microlab/circuit-schema";

import type { ConnectionRejection } from "@/features/circuit-model/connection-rules";
import { samePin } from "@/features/circuit-model/connection-rules";
import { GRID_PX, rotatedSize, worldToGrid } from "@/features/circuit-model/geometry";
import { t, type PlainTranslationKey } from "@/i18n/t";
import { isTextInputTarget } from "@/lib/platform";
import { useCircuitStore } from "@/stores/circuit-store";
import { useUiStore } from "@/stores/ui-store";

import { breadboardHoleFromPoint } from "./breadboard";
import { BreadboardNode } from "./breadboard-node";
import { PinActionsContext, type PinActions } from "./canvas-context";
import { CanvasToolbar } from "./canvas-toolbar";
import { ComponentNode } from "./component-node";
import { ConnectionPreview } from "./connection-preview";
import { COMPONENT_DRAG_MIME } from "./drag-data";
import {
  createEdgeBuilder,
  createNodeBuilder,
  type CircuitFlowNode,
  type WireFlowEdge,
} from "./flow-model";
import { PinHint, type PinHintState } from "./pin-hint";
import { WireEdge } from "./wire-edge";

// Типы узлов и рёбер вынесены из компонента, чтобы ссылки были стабильными между рендерами.
const NODE_TYPES = { circuit: ComponentNode, breadboard: BreadboardNode };
const EDGE_TYPES = { wire: WireEdge };
const SNAP_GRID: [number, number] = [GRID_PX, GRID_PX];
/** Панорамирование: средняя кнопка мыши или Space + перетаскивание левой кнопкой. */
const PAN_ON_DRAG = [1];
const MULTI_SELECTION_KEYS = ["Shift", "Meta", "Control"];
/** Смещение указателя, после которого отпускание вне вывода отменяет соединение, px. */
const CONNECT_DRAG_THRESHOLD = 4;

const ARIA_LABELS = {
  "controls.ariaLabel": t("canvas.controls.label"),
  "controls.zoomIn.ariaLabel": t("canvas.controls.zoomIn"),
  "controls.zoomOut.ariaLabel": t("canvas.controls.zoomOut"),
  "controls.fitView.ariaLabel": t("canvas.controls.fitView"),
};

const REJECTION_NOTICES: Readonly<Record<ConnectionRejection, PlainTranslationKey>> = {
  SAME_PIN: "canvas.connection.samePin",
  DUPLICATE: "canvas.connection.duplicate",
  UNKNOWN_PIN: "canvas.connection.unknownPin",
};

/**
 * Панели получают размеры только после первой раскладки, а React Flow требует
 * ненулевой контейнер при монтировании — поэтому холст монтируется, когда размер известен.
 */
function useHasSize(ref: RefObject<HTMLElement | null>): boolean {
  const [hasSize, setHasSize] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (element === null || hasSize) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 0 && element.clientHeight > 0) {
        setHasSize(true);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, hasSize]);
  return hasSize;
}

function pinFromPoint(x: number, y: number): PinRef | null {
  const target = document.elementFromPoint(x, y);
  if (target === null) return null;
  const hole = breadboardHoleFromPoint(target, x, y);
  if (hole !== null) return hole;
  const element = target.closest<HTMLElement>("[data-pin-id]");
  const componentId = element?.dataset["pinComponent"];
  const pinId = element?.dataset["pinId"];
  return componentId === undefined || pinId === undefined ? null : { componentId, pinId };
}

function finishConnection(from: PinRef, to: PinRef): void {
  const rejection = useCircuitStore.getState().connect(from, to);
  if (rejection !== null) {
    useUiStore.getState().showNotice(REJECTION_NOTICES[rejection]);
  }
}

/** Начать соединение от вывода или завершить уже начатое на этом выводе. */
function activatePin(pin: PinRef): "started" | "finished" | "cancelled" {
  const store = useCircuitStore.getState();
  const pending = store.pendingConnection;
  if (pending === null) {
    store.setPendingConnection(pin);
    return "started";
  }
  if (samePin(pending, pin)) {
    store.setPendingConnection(null);
    return "cancelled";
  }
  finishConnection(pending, pin);
  return "finished";
}

function onNodesChange(changes: NodeChange<CircuitFlowNode>[]): void {
  const store = useCircuitStore.getState();
  const positions: Record<string, GridPoint> = {};
  let moved = false;
  const selected = new Set(store.selection.componentIds);
  let selectionChanged = false;
  for (const change of changes) {
    if (change.type === "position" && change.position !== undefined) {
      positions[change.id] = worldToGrid(change.position);
      moved = true;
    } else if (change.type === "select") {
      selectionChanged = true;
      if (change.selected) selected.add(change.id);
      else selected.delete(change.id);
    }
  }
  if (moved) {
    store.moveItems(positions);
  }
  if (selectionChanged) {
    store.select({ componentIds: [...selected], connectionIds: store.selection.connectionIds });
  }
}

function onEdgesChange(changes: EdgeChange<WireFlowEdge>[]): void {
  const store = useCircuitStore.getState();
  const selected = new Set(store.selection.connectionIds);
  let selectionChanged = false;
  for (const change of changes) {
    if (change.type === "select") {
      selectionChanged = true;
      if (change.selected) selected.add(change.id);
      else selected.delete(change.id);
    }
  }
  if (selectionChanged) {
    store.select({ componentIds: store.selection.componentIds, connectionIds: [...selected] });
  }
}

function beginGesture(): void {
  useCircuitStore.getState().beginGesture();
}

function endGesture(): void {
  useCircuitStore.getState().endGesture();
}

function onPaneClick(): void {
  useCircuitStore.getState().setPendingConnection(null);
}

function CircuitFlow({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const colorMode = useUiStore((state) => state.resolvedTheme);
  const board = useCircuitStore((state) => state.board);
  const components = useCircuitStore((state) => state.components);
  const componentOrder = useCircuitStore((state) => state.componentOrder);
  const connections = useCircuitStore((state) => state.connections);
  const connectionOrder = useCircuitStore((state) => state.connectionOrder);
  const selection = useCircuitStore((state) => state.selection);
  const pending = useCircuitStore((state) => state.pendingConnection !== null);
  const { screenToFlowPosition, fitView, getViewport, setViewport } = useReactFlow<CircuitFlowNode, WireFlowEdge>();

  // Сдвиг холста округляется до целых пикселей: при дробном сдвиге линии символов
  // попадают между пикселями экрана и сглаживаются (выглядят размытыми).
  const snapViewport = useCallback(() => {
    const viewport = getViewport();
    const x = Math.round(viewport.x);
    const y = Math.round(viewport.y);
    if (x !== viewport.x || y !== viewport.y) {
      void setViewport({ x, y, zoom: viewport.zoom }, { duration: 0 });
    }
  }, [getViewport, setViewport]);

  const [buildNodes] = useState(createNodeBuilder);
  const [buildEdges] = useState(createEdgeBuilder);
  const nodes = useMemo(
    () => buildNodes({ board, components, componentOrder }, selection),
    [buildNodes, board, components, componentOrder, selection],
  );
  const edges = useMemo(
    () => buildEdges({ connections, connectionOrder }, selection),
    [buildEdges, connections, connectionOrder, selection],
  );

  const [hint, setHint] = useState<PinHintState | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);

  const pinActions = useMemo<PinActions>(
    () => ({
      onPinPointerDown: (pin, event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        if (activatePin(pin) !== "started") return;
        const startX = event.clientX;
        const startY = event.clientY;
        const onUp = (up: PointerEvent) => {
          window.removeEventListener("pointerup", onUp);
          const current = useCircuitStore.getState().pendingConnection;
          if (current === null || !samePin(current, pin)) return;
          const target = pinFromPoint(up.clientX, up.clientY);
          if (target !== null && !samePin(target, pin)) {
            finishConnection(pin, target);
          } else if (
            target === null &&
            Math.hypot(up.clientX - startX, up.clientY - startY) > CONNECT_DRAG_THRESHOLD
          ) {
            useCircuitStore.getState().setPendingConnection(null);
          }
          // Иначе это щелчок по выводу: соединение завершается щелчком по второму выводу.
        };
        window.addEventListener("pointerup", onUp);
      },
      onPinKeyDown: (pin, event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        activatePin(pin);
      },
      showPinHint: (pin, rect) => {
        setHint({ pin, rect: { left: rect.left, top: rect.top, width: rect.width } });
      },
      hidePinHint: () => {
        setHint(null);
      },
    }),
    [],
  );

  const fit = useCallback(() => {
    void fitView({ padding: 0.15, duration: 0 }).then(snapViewport);
  }, [fitView, snapViewport]);

  // Показ объектов по запросу (щелчок на замечании в панели «Проблемы»).
  const canvasFocus = useUiStore((state) => state.canvasFocus);
  useEffect(() => {
    if (canvasFocus === null || canvasFocus.ids.length === 0) return;
    void fitView({ nodes: canvasFocus.ids.map((id) => ({ id })), padding: 0.4, maxZoom: 1.5, duration: 0 }).then(
      snapViewport,
    );
  }, [canvasFocus, fitView, snapViewport]);

  const updateCenter = useCallback(() => {
    const element = containerRef.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    const center = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    useUiStore.getState().setCanvasCenter(worldToGrid(center));
  }, [containerRef, screenToFlowPosition]);

  const onViewportSettled = useCallback(() => {
    snapViewport();
    updateCenter();
  }, [snapViewport, updateCenter]);

  const onDragOver = useCallback((event: DragEvent) => {
    if (event.dataTransfer.types.includes(COMPONENT_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      const type = event.dataTransfer.getData(COMPONENT_DRAG_MIME);
      const definition = getComponentDefinition(type);
      if (definition === undefined || definition.category === "board") return;
      event.preventDefault();
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const size = rotatedSize(definition.visual, 0);
      // Курсор — центр символа.
      const position = worldToGrid({
        x: point.x - (size.width * GRID_PX) / 2,
        y: point.y - (size.height * GRID_PX) / 2,
      });
      useCircuitStore.getState().addComponent(type, position);
      flowRef.current?.focus({ preventScroll: true });
    },
    [screenToFlowPosition],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTextInputTarget(event.target)) return;
      const store = useCircuitStore.getState();
      let handled = true;
      if (event.key === "Escape") {
        if (store.pendingConnection !== null) store.setPendingConnection(null);
        else handled = false;
      } else if (event.key === "Delete" || event.key === "Backspace") {
        store.deleteSelection();
      } else if (event.code === "KeyR") {
        store.rotateSelection();
      } else if (event.code === "KeyD") {
        store.duplicateSelection();
      } else if (event.code === "KeyF") {
        fit();
      } else if (event.code === "KeyA") {
        useUiStore.getState().requestComponentSearch();
      } else {
        handled = false;
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [fit],
  );
  const readOnly = useCircuitStore((state) => state.readOnly);

  return (
    <PinActionsContext.Provider value={pinActions}>
      <div
        ref={flowRef}
        tabIndex={-1}
        className="h-full w-full outline-none"
        onDragOver={onDragOver}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
        onPointerDown={() => {
          // Клавиши холста работают, только когда фокус внутри холста.
          const element = flowRef.current;
          if (element !== null && !element.contains(document.activeElement)) {
            element.focus({ preventScroll: true });
          }
        }}
      >
        <ReactFlow<CircuitFlowNode, WireFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          nodesDraggable={!readOnly}
          onEdgesChange={onEdgesChange}
          onNodeDragStart={beginGesture}
          onNodeDragStop={endGesture}
          onSelectionDragStart={beginGesture}
          onSelectionDragStop={endGesture}
          onPaneClick={onPaneClick}
          onInit={onViewportSettled}
          onMoveEnd={onViewportSettled}
          colorMode={colorMode}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.25}
          maxZoom={4}
          snapToGrid
          snapGrid={SNAP_GRID}
          connectionMode={ConnectionMode.Loose}
          nodesConnectable={false}
          connectOnClick={false}
          edgesReconnectable={false}
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect={false}
          selectionOnDrag
          panOnDrag={PAN_ON_DRAG}
          panOnScroll
          panActivationKeyCode="Space"
          selectionKeyCode={null}
          multiSelectionKeyCode={MULTI_SELECTION_KEYS}
          deleteKeyCode={null}
          ariaLabelConfig={ARIA_LABELS}
        >
          <Background variant={BackgroundVariant.Dots} gap={GRID_PX} size={1} />
          <Controls showInteractive={false} showFitView={false} />
          <Panel position="top-left">
            <CanvasToolbar onFitView={fit} />
          </Panel>
          <CanvasHintPanel pending={pending} />
          <ConnectionPreview />
        </ReactFlow>
      </div>
      {hint !== null && <PinHint hint={hint} />}
    </PinActionsContext.Provider>
  );
}

/** Подсказка внизу холста: как добавить компоненты или завершить соединение. */
function CanvasHintPanel({ pending }: { pending: boolean }) {
  const empty = useCircuitStore((state) => state.componentOrder.length === 0);
  if (!pending && !empty) {
    return null;
  }
  return (
    <Panel position="bottom-center">
      <p role="status" className="rounded-md border bg-card px-3 py-1 text-xs text-muted-foreground">
        {pending ? t("canvas.hint.connecting") : t("canvas.hint.empty")}
      </p>
    </Panel>
  );
}

/**
 * Холст схемы: отображение Circuit Model через React Flow. Узлы и провода вычисляются
 * из circuitStore; все изменения (перемещение, соединения, удаление) идут через команды
 * store, поэтому React Flow не хранит собственного состояния схемы.
 */
export function CircuitCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasSize = useHasSize(containerRef);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {hasSize && (
        <ReactFlowProvider>
          <CircuitFlow containerRef={containerRef} />
        </ReactFlowProvider>
      )}
    </div>
  );
}
