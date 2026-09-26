import { z } from "zod";

import { SimulationInfoSchema } from "@/api/schemas";

/**
 * Сообщения потока событий симуляции (WebSocket, протокол версии 1).
 *
 * - `event_batch` — пачка событий одного среза симуляции, пересылаемая API без изменений;
 * - `session_state` — состояние сессии при подключении и в начале каждой новой сессии:
 *   последние события состояния выводов и компонентов и хвост вывода Serial.
 *
 * Разбор терпимый: неизвестные типы событий и лишние поля игнорируются.
 */

const SimulationEventSchema = z.object({
  version: z.literal(1),
  type: z.string(),
  timestamp: z.number().int(),
  payload: z.record(z.string(), z.unknown()),
});

export type SimulationEvent = z.infer<typeof SimulationEventSchema>;

const EventBatchSchema = z.object({
  version: z.literal(1),
  type: z.literal("event_batch"),
  timestamp: z.number().int(),
  events: z.array(z.unknown()),
});

const SessionStateSchema = z.object({
  version: z.literal(1),
  type: z.literal("session_state"),
  session: SimulationInfoSchema.nullable(),
  events: z.array(z.unknown()),
  serialTail: z.array(z.number().int().min(0).max(255)),
});

export type EventBatch = Omit<z.infer<typeof EventBatchSchema>, "events"> & { events: SimulationEvent[] };
export type SessionState = Omit<z.infer<typeof SessionStateSchema>, "events"> & { events: SimulationEvent[] };
export type StreamMessage = EventBatch | SessionState;

function parseEvents(raw: readonly unknown[]): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  for (const item of raw) {
    const parsed = SimulationEventSchema.safeParse(item);
    if (parsed.success) events.push(parsed.data);
  }
  return events;
}

/** Разбирает сообщение потока; null — сообщение не по протоколу (игнорируется). */
export function parseStreamMessage(data: unknown): StreamMessage | null {
  let value: unknown = data;
  if (typeof data === "string") {
    try {
      value = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const batch = EventBatchSchema.safeParse(value);
  if (batch.success) return { ...batch.data, events: parseEvents(batch.data.events) };
  const state = SessionStateSchema.safeParse(value);
  if (state.success) return { ...state.data, events: parseEvents(state.data.events) };
  return null;
}

/** Строковое поле payload или undefined. */
export function payloadString(event: SimulationEvent, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" ? value : undefined;
}

/** Числовое поле payload или undefined. */
export function payloadNumber(event: SimulationEvent, key: string): number | undefined {
  const value = event.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
