import type { Layout } from "react-resizable-panels";

import { parseJson, readStorage, writeStorage } from "@/lib/storage";

/**
 * Сохранение размеров панелей между сессиями (настройка конкретного пользователя
 * в этом браузере, а не часть проекта).
 *
 * Сохранённое значение используется, только если оно в точности соответствует
 * текущему набору панелей и корректно по величинам; иначе — размеры по умолчанию.
 */

const KEY_PREFIX = "microlab.layout.";

function isValidLayout(value: unknown, panelIds: readonly string[]): value is Layout {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length !== panelIds.length) {
    return false;
  }
  let total = 0;
  for (const [id, size] of entries) {
    if (!panelIds.includes(id) || typeof size !== "number" || !Number.isFinite(size) || size < 0) {
      return false;
    }
    total += size;
  }
  // Размеры хранятся в процентах от группы.
  return Math.abs(total - 100) < 1;
}

export function readLayout(groupId: string, panelIds: readonly string[]): Layout | undefined {
  const value = parseJson(readStorage(KEY_PREFIX + groupId));
  return isValidLayout(value, panelIds) ? value : undefined;
}

export function writeLayout(groupId: string, layout: Layout): void {
  writeStorage(KEY_PREFIX + groupId, JSON.stringify(layout));
}
