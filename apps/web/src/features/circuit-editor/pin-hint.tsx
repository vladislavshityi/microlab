import { getComponentDefinition, type PinRef } from "@microlab/circuit-schema";

import { getPlacedInstance } from "@/features/circuit-model/geometry";
import { t } from "@/i18n/t";
import { useCircuitStore } from "@/stores/circuit-store";

import { ELECTRICAL_TYPE_LABELS } from "./pin-labels";

export interface PinHintState {
  pin: PinRef;
  /** Прямоугольник вывода в координатах окна. */
  rect: { left: number; top: number; width: number };
}

/**
 * Подсказка вывода: имя, id и электрический тип из определения компонента (для платы —
 * также вывод микроконтроллера). Одна на холст, а не отдельный tooltip на каждый вывод.
 */
export function PinHint({ hint }: { hint: PinHintState }) {
  const type = useCircuitStore((state) => getPlacedInstance(state, hint.pin.componentId)?.type);
  const definition = type === undefined ? undefined : getComponentDefinition(type);
  const pin = definition?.pins.find((candidate) => candidate.id === hint.pin.pinId);
  if (pin === undefined) {
    return null;
  }
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground"
      style={{ left: hint.rect.left + hint.rect.width / 2, top: hint.rect.top - 4 }}
    >
      <div className="font-mono">
        {hint.pin.componentId}.{pin.id}
        {pin.name !== pin.id && <span className="text-muted-foreground"> · {pin.name}</span>}
      </div>
      <div className="text-muted-foreground">
        {t(ELECTRICAL_TYPE_LABELS[pin.electricalType])}
        {pin.mcuPin !== undefined && <span className="font-mono"> · {pin.mcuPin}</span>}
      </div>
    </div>
  );
}
