import { memo } from "react";
import { Handle, type NodeProps } from "@xyflow/react";
import type { ComponentDefinition, PinDefinition, Rotation } from "@microlab/circuit-schema";

import { GRID_PX, rotatedSize } from "@/features/circuit-model/geometry";
import { t } from "@/i18n/t";
import { cn } from "@/lib/utils";
import { useCircuitStore } from "@/stores/circuit-store";

import { usePinActions } from "./canvas-context";
import { componentSummary, PIN_HIT_PX, pinLayouts, type CircuitFlowNode, type PinLayout } from "./flow-model";
import { ELECTRICAL_TYPE_LABELS } from "./pin-labels";
import { ComponentSymbol } from "./symbols";

interface PinHandleProps {
  componentId: string;
  pin: PinDefinition;
  layout: PinLayout;
}

/** Вывод компонента: точка захвата для соединений, доступная мышью и клавиатурой. */
const PinHandle = memo(function PinHandle({ componentId, pin, layout }: PinHandleProps) {
  const actions = usePinActions();
  const pending = useCircuitStore(
    (state) =>
      state.pendingConnection?.componentId === componentId && state.pendingConnection.pinId === pin.id,
  );
  const ref = { componentId, pinId: pin.id };
  return (
    <Handle
      id={pin.id}
      type="source"
      position={layout.position}
      isConnectable={false}
      isConnectableStart={false}
      isConnectableEnd={false}
      className={cn("circuit-pin", pending && "circuit-pin-pending")}
      style={{ left: layout.x, top: layout.y, width: PIN_HIT_PX, height: PIN_HIT_PX }}
      role="button"
      tabIndex={0}
      aria-pressed={pending}
      aria-label={t("canvas.pin.label", {
        component: componentId,
        pin: pin.name === pin.id ? pin.id : `${pin.name} (${pin.id})`,
        type: t(ELECTRICAL_TYPE_LABELS[pin.electricalType]),
      })}
      data-pin-component={componentId}
      data-pin-id={pin.id}
      onPointerDown={(event) => {
        actions.onPinPointerDown(ref, event);
      }}
      onKeyDown={(event) => {
        actions.onPinKeyDown(ref, event);
      }}
      onPointerEnter={(event) => {
        actions.showPinHint(ref, event.currentTarget.getBoundingClientRect());
      }}
      onPointerLeave={actions.hidePinHint}
      onFocus={(event) => {
        actions.showPinHint(ref, event.currentTarget.getBoundingClientRect());
      }}
      onBlur={actions.hidePinHint}
    />
  );
});

interface NodeBodyProps {
  componentId: string;
  definition: ComponentDefinition;
  rotation: Rotation;
  properties: CircuitFlowNode["data"]["properties"];
  isBoard: boolean;
}

const NodeBody = memo(function NodeBody({ componentId, definition, rotation, properties, isBoard }: NodeBodyProps) {
  const size = rotatedSize(definition.visual, rotation);
  const width = size.width * GRID_PX;
  const height = size.height * GRID_PX;
  const layouts = pinLayouts(definition, rotation);
  const summary = componentSummary(definition, properties);
  return (
    <div className="circuit-node relative" style={{ width, height }}>
      <ComponentSymbol
        definition={definition}
        rotation={rotation}
        properties={properties}
        widthPx={width}
        heightPx={height}
      />
      {layouts.map((layout) => {
        const pin = definition.pins.find((candidate) => candidate.id === layout.id);
        return pin === undefined ? null : (
          <PinHandle key={pin.id} componentId={componentId} pin={pin} layout={layout} />
        );
      })}
      {!isBoard && (
        <div className="pointer-events-none absolute top-full left-1/2 mt-0.5 -translate-x-1/2 font-mono text-[10px] leading-none whitespace-nowrap text-muted-foreground">
          {summary === null ? componentId : `${componentId} · ${summary}`}
        </div>
      )}
    </div>
  );
});

/** Узел холста для платы или компонента; данные — из Circuit Model. */
export const ComponentNode = memo(function ComponentNode({ data }: NodeProps<CircuitFlowNode>) {
  return (
    <NodeBody
      componentId={data.componentId}
      definition={data.definition}
      rotation={data.rotation}
      properties={data.properties}
      isBoard={data.isBoard}
    />
  );
});
