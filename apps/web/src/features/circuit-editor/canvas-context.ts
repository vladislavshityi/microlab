import { createContext, useContext, type KeyboardEvent, type PointerEvent } from "react";
import type { PinRef } from "@microlab/circuit-schema";

/** Действия с выводами, которые холст передаёт узлам (стабильные ссылки). */
export interface PinActions {
  onPinPointerDown: (pin: PinRef, event: PointerEvent<HTMLElement>) => void;
  onPinKeyDown: (pin: PinRef, event: KeyboardEvent<HTMLElement>) => void;
  /** Показать подсказку вывода над прямоугольником в координатах окна. */
  showPinHint: (pin: PinRef, rect: { left: number; top: number; width: number }) => void;
  hidePinHint: () => void;
}

const noop = () => undefined;

export const PinActionsContext = createContext<PinActions>({
  onPinPointerDown: noop,
  onPinKeyDown: noop,
  showPinHint: noop,
  hidePinHint: noop,
});

export function usePinActions(): PinActions {
  return useContext(PinActionsContext);
}
