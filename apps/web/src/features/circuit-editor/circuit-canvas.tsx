import { Background, BackgroundVariant, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useRef, useState, type RefObject } from "react";

import { t } from "@/i18n/t";
import { useUiStore } from "@/stores/ui-store";

// Пустые массивы вынесены из компонента, чтобы ссылки были стабильными между рендерами.
const NO_NODES: Node[] = [];
const NO_EDGES: Edge[] = [];

const ARIA_LABELS = {
  "controls.ariaLabel": t("canvas.controls.label"),
  "controls.zoomIn.ariaLabel": t("canvas.controls.zoomIn"),
  "controls.zoomOut.ariaLabel": t("canvas.controls.zoomOut"),
  "controls.fitView.ariaLabel": t("canvas.controls.fitView"),
};

/**
 * Холст схемы. Сейчас только отображение: сетка, масштаб, панорамирование.
 * React Flow — лишь визуальное представление; модели схемы пока нет, поэтому граф пуст.
 */
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

export function CircuitCanvas() {
  const colorMode = useUiStore((state) => state.resolvedTheme);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasSize = useHasSize(containerRef);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {hasSize && (
        <ReactFlow
          nodes={NO_NODES}
          edges={NO_EDGES}
          colorMode={colorMode}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          ariaLabelConfig={ARIA_LABELS}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      )}
      <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-sm text-muted-foreground">
        {t("canvas.empty")}
      </p>
    </div>
  );
}
