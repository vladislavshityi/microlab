import { useEffect, useState } from "react";

/** Индикатор занятости показывается не раньше чем через это время… */
const INDICATOR_SHOW_DELAY_MS = 150;
/** …и, появившись, держится не меньше этого времени, чтобы не мерцать. */
const INDICATOR_MIN_VISIBLE_MS = 300;

/**
 * Флаг с задержкой для визуальных индикаторов загрузки.
 * Только для визуала: состояние доступности (aria-busy, aria-disabled) должно использовать
 * исходный флаг.
 */
export function useDelayedFlag(active: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const [shownAt, setShownAt] = useState<number | null>(null);

  useEffect(() => {
    if (active && !visible) {
      const timer = window.setTimeout(() => {
        setVisible(true);
        setShownAt(Date.now());
      }, INDICATOR_SHOW_DELAY_MS);
      return () => {
        window.clearTimeout(timer);
      };
    }
    if (!active && visible) {
      const elapsed = shownAt === null ? INDICATOR_MIN_VISIBLE_MS : Date.now() - shownAt;
      const timer = window.setTimeout(
        () => {
          setVisible(false);
          setShownAt(null);
        },
        Math.max(0, INDICATOR_MIN_VISIBLE_MS - elapsed),
      );
      return () => {
        window.clearTimeout(timer);
      };
    }
    return undefined;
  }, [active, visible, shownAt]);

  return visible;
}
