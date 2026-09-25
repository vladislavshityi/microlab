import { getComponentDefinition, type GridPoint } from "@microlab/circuit-schema";

import { findFreePosition } from "@/features/circuit-model/circuit-commands";
import { pickCircuit, useCircuitStore } from "@/stores/circuit-store";
import { useUiStore } from "@/stores/ui-store";

/** Точка размещения, если холст ещё не сообщил центр видимой области: справа от платы. */
const FALLBACK_CENTER: GridPoint = { x: 18, y: 6 };

/**
 * Добавляет компонент в центр видимой области холста (добавление щелчком или с
 * клавиатуры — альтернатива перетаскиванию). Возвращает id или null для неизвестного типа.
 */
export function addComponentAtViewCenter(type: string): string | null {
  const definition = getComponentDefinition(type);
  if (definition === undefined || definition.category === "board") {
    return null;
  }
  const center = useUiStore.getState().canvasCenter ?? FALLBACK_CENTER;
  const store = useCircuitStore.getState();
  const position = findFreePosition(
    pickCircuit(store),
    {
      x: center.x - Math.floor(definition.visual.width / 2),
      y: center.y - Math.floor(definition.visual.height / 2),
    },
    definition.visual,
  );
  return store.addComponent(type, position);
}
