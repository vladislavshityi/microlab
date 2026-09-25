import { useCallback, useEffect, useState, type RefObject } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import {
  usePanelRef,
  type Layout,
  type PanelImperativeHandle,
  type PanelSize,
} from "react-resizable-panels";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { CircuitCanvas } from "@/features/circuit-editor/circuit-canvas";
import { ComponentsSidebar } from "@/features/components-library/components-sidebar";
import { PropertiesPanel } from "@/features/properties-panel/properties-panel";
import { t } from "@/i18n/t";
import { useUiStore, type CollapsiblePanel } from "@/stores/ui-store";

import { BottomPanel } from "./bottom-panel";
import { readLayout, writeLayout } from "./layout-storage";
import { SidePanel } from "./side-panel";
import { StatusBar } from "./status-bar";
import { Toolbar } from "./toolbar";

const HORIZONTAL_GROUP = "workspace-horizontal";
const HORIZONTAL_PANELS = ["components", "canvas", "properties"] as const;
const VERTICAL_GROUP = "workspace-vertical";
const VERTICAL_PANELS = ["main", "bottom"] as const;

/** Ширина свёрнутой боковой панели и высота свёрнутой нижней (строка вкладок), px. */
const COLLAPSED_SIZE = 32;

/** Ниже этой ширины окна боковые панели по умолчанию уже. */
const WIDE_VIEWPORT = 1280;

function saveLayout(groupId: string) {
  return (layout: Layout) => {
    writeLayout(groupId, layout);
  };
}

/** Связывает панель с флагом свёрнутости в uiStore и даёт команды свернуть/развернуть. */
function useCollapsible(panel: CollapsiblePanel, panelRef: RefObject<PanelImperativeHandle | null>) {
  const collapsed = useUiStore((state) => state.collapsed[panel]);
  const setCollapsed = useUiStore((state) => state.setCollapsed);

  // Свёрнутость определяется по фактическому размеру: onResize вызывается раньше, чем
  // обновляется внутреннее состояние панели, доступное через isCollapsed(). Нулевой размер
  // означает, что раскладка ещё не рассчитана, а не свёрнутую панель.
  const sync = useCallback(
    (size: PanelSize) => {
      setCollapsed(panel, size.inPixels > 0 && size.inPixels <= COLLAPSED_SIZE + 1);
    },
    [panel, setCollapsed],
  );

  const collapse = useCallback(() => {
    panelRef.current?.collapse();
  }, [panelRef]);

  const expand = useCallback(() => {
    panelRef.current?.expand();
  }, [panelRef]);

  const toggle = useCallback(() => {
    if (collapsed) {
      panelRef.current?.expand();
    } else {
      panelRef.current?.collapse();
    }
  }, [collapsed, panelRef]);

  return { collapsed, sync, collapse, expand, toggle };
}

/**
 * Рабочее пространство IDE: верхняя панель, компоненты, холст схемы, свойства,
 * нижняя панель со вкладками и строка состояния. Размеры панелей меняются
 * перетаскиванием или клавишами-стрелками на разделителе; двойной щелчок по
 * разделителю сворачивает или разворачивает соседнюю панель.
 */
export function Workspace() {
  // Сохранённые размеры читаются один раз при монтировании.
  const [horizontalLayout] = useState(() => readLayout(HORIZONTAL_GROUP, HORIZONTAL_PANELS));
  const [verticalLayout] = useState(() => readLayout(VERTICAL_GROUP, VERTICAL_PANELS));
  const [wide] = useState(() => window.innerWidth >= WIDE_VIEWPORT);

  const componentsRef = usePanelRef();
  const propertiesRef = usePanelRef();
  const bottomRef = usePanelRef();
  const components = useCollapsible("components", componentsRef);
  const properties = useCollapsible("properties", propertiesRef);
  const bottom = useCollapsible("bottom", bottomRef);

  // Запрос поиска компонентов (клавиша A на холсте) разворачивает свёрнутую панель;
  // фокус в поле поиска переводит сама панель после появления.
  const searchRequested = useUiStore((state) => state.componentSearchRequested);
  const { collapsed: componentsCollapsed, expand: expandComponents } = components;
  useEffect(() => {
    if (searchRequested && componentsCollapsed) {
      expandComponents();
    }
  }, [searchRequested, componentsCollapsed, expandComponents]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <a
        href="#workspace-canvas"
        className="sr-only focus:not-sr-only focus:absolute focus:top-1 focus:left-1 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-1 focus:ring-2 focus:ring-ring"
      >
        {t("workspace.skip.canvas")}
      </a>
      <a
        href="#workspace-bottom"
        className="sr-only focus:not-sr-only focus:absolute focus:top-1 focus:left-1 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-1 focus:ring-2 focus:ring-ring"
      >
        {t("workspace.skip.bottom")}
      </a>
      <p className="hidden shrink-0 border-b bg-warning-muted px-3 py-1 text-xs text-warning max-[1023px]:block">
        {t("workspace.narrowViewport")}
      </p>
      <Toolbar />
      <main className="min-h-0 flex-1">
        <ResizablePanelGroup
          id={VERTICAL_GROUP}
          orientation="vertical"
          defaultLayout={verticalLayout}
          onLayoutChanged={saveLayout(VERTICAL_GROUP)}
        >
          <ResizablePanel id="main" minSize={160}>
            <ResizablePanelGroup
              id={HORIZONTAL_GROUP}
              orientation="horizontal"
              defaultLayout={horizontalLayout}
              onLayoutChanged={saveLayout(HORIZONTAL_GROUP)}
            >
              <ResizablePanel
                id="components"
                panelRef={componentsRef}
                defaultSize={wide ? 240 : 200}
                minSize={200}
                maxSize={360}
                collapsible
                collapsedSize={COLLAPSED_SIZE}
                groupResizeBehavior="preserve-pixel-size"
                onResize={components.sync}
              >
                <nav aria-label={t("workspace.region.components")} className="h-full">
                  <SidePanel
                    title={t("workspace.region.components")}
                    collapsed={components.collapsed}
                    collapseLabel={t("workspace.panel.collapseComponents")}
                    expandLabel={t("workspace.panel.expandComponents")}
                    collapseIcon={PanelLeftClose}
                    expandIcon={PanelLeftOpen}
                    onCollapse={components.collapse}
                    onExpand={components.expand}
                  >
                    <ComponentsSidebar />
                  </SidePanel>
                </nav>
              </ResizablePanel>
              <ResizableHandle
                aria-label={t("workspace.resize.components")}
                disableDoubleClick
                onDoubleClick={components.toggle}
              />
              <ResizablePanel id="canvas" minSize={400}>
                <section
                  id="workspace-canvas"
                  tabIndex={-1}
                  aria-label={t("workspace.region.canvas")}
                  className="h-full outline-none"
                >
                  <CircuitCanvas />
                </section>
              </ResizablePanel>
              <ResizableHandle
                aria-label={t("workspace.resize.properties")}
                disableDoubleClick
                onDoubleClick={properties.toggle}
              />
              <ResizablePanel
                id="properties"
                panelRef={propertiesRef}
                defaultSize={wide ? 280 : 240}
                minSize={240}
                maxSize={400}
                collapsible
                collapsedSize={COLLAPSED_SIZE}
                groupResizeBehavior="preserve-pixel-size"
                onResize={properties.sync}
              >
                <aside aria-label={t("workspace.region.properties")} className="h-full">
                  <SidePanel
                    title={t("workspace.region.properties")}
                    collapsed={properties.collapsed}
                    collapseLabel={t("workspace.panel.collapseProperties")}
                    expandLabel={t("workspace.panel.expandProperties")}
                    collapseIcon={PanelRightClose}
                    expandIcon={PanelRightOpen}
                    onCollapse={properties.collapse}
                    onExpand={properties.expand}
                  >
                    <PropertiesPanel />
                  </SidePanel>
                </aside>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle
            aria-label={t("workspace.resize.bottom")}
            disableDoubleClick
            onDoubleClick={bottom.toggle}
          />
          <ResizablePanel
            id="bottom"
            panelRef={bottomRef}
            defaultSize={240}
            minSize={120}
            maxSize="70%"
            collapsible
            collapsedSize={COLLAPSED_SIZE}
            groupResizeBehavior="preserve-pixel-size"
            onResize={bottom.sync}
          >
            <section
              id="workspace-bottom"
              tabIndex={-1}
              aria-label={t("workspace.region.bottom")}
              className="h-full outline-none"
            >
              <BottomPanel
                collapsed={bottom.collapsed}
                onCollapse={bottom.collapse}
                onExpand={bottom.expand}
              />
            </section>
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
      <StatusBar />
    </div>
  );
}
