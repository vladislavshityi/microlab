import { z } from "zod";

import type { components } from "./generated/openapi";

// Проверка ответов API во время выполнения.
// Типы берутся из apps/api/openapi.json через `pnpm gen:api`; схемы ниже написаны вручную
// и связаны со сгенерированными типами на этапе компиляции:
// - `satisfies z.ZodType<…>` — распарсенные данные совместимы с типом контракта;
// - `schemas.test.ts` проверяет точное равенство типов в обе стороны, поэтому любое
//   расхождение ломает `tsc`.

export type HealthResponse = components["schemas"]["HealthResponse"];
export type ErrorResponse = components["schemas"]["ErrorResponse"];
export type ErrorCode = components["schemas"]["ErrorCode"];

// Tolerant reader: неизвестные лишние ключи отбрасываются, а не отвергаются, чтобы
// аддитивное обратно совместимое изменение backend не превращало исправную систему
// в "unexpected response".
export const DatabaseCheckSchema = z.object({
  status: z.enum(["ok", "error"]),
  code: z.literal("DATABASE_UNAVAILABLE").exactOptional(),
}) satisfies z.ZodType<components["schemas"]["DatabaseCheck"]>;

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  version: z.string(),
  checks: z.object({
    database: DatabaseCheckSchema,
  }),
}) satisfies z.ZodType<HealthResponse>;

export const ErrorCodeSchema = z.enum([
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "VALIDATION_ERROR",
  "HTTP_ERROR",
  "INTERNAL_ERROR",
  "DATABASE_UNAVAILABLE",
]) satisfies z.ZodType<ErrorCode>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.array(
      z.object({
        field: z.string(),
        message: z.string(),
        code: z.string(),
      }),
    ),
  }),
}) satisfies z.ZodType<ErrorResponse>;

/**
 * Код ошибки в том виде, в каком его видит пользователь: известный {@link ErrorCode} или более
 * новый код, которого этот frontend ещё не знает (tolerant reader). `string & {}` сохраняет
 * автодополнение в редакторе для известных кодов.
 */
export type DisplayErrorCode = ErrorCode | (string & {});

/** Формат стабильного идентификатора для кодов, которые можно показывать (не произвольный текст). */
const DISPLAY_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Извлекает `error.code` из конверта ошибки только для отображения. В отличие от
 * {@link ErrorResponseSchema} (точный контракт), принимает коды, добавленные в backend позже,
 * но только если они похожи на стабильный идентификатор; `message` и `details` игнорируются.
 */
export const DisplayErrorCodeSchema = z.object({
  error: z.object({
    code: z.string().regex(DISPLAY_ERROR_CODE_PATTERN),
  }),
});

export function readDisplayErrorCode(body: unknown): DisplayErrorCode | null {
  const parsed = DisplayErrorCodeSchema.safeParse(body);
  return parsed.success ? parsed.data.error.code : null;
}
