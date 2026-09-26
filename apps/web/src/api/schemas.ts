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
export type IssueCode = components["schemas"]["IssueCode"];
export type CircuitIssue = components["schemas"]["CircuitIssue"];
export type CircuitValidationResponse = components["schemas"]["CircuitValidationResponse"];
export type ProjectSummary = components["schemas"]["ProjectSummary"];
export type ProjectDetail = components["schemas"]["ProjectDetail"];
export type ProjectList = components["schemas"]["ProjectList"];
export type ProjectCreate = components["schemas"]["ProjectCreate"];
export type ProjectUpdate = components["schemas"]["ProjectUpdate"];
export type CompileDiagnostic = components["schemas"]["CompileDiagnostic"];
export type CompileResponse = components["schemas"]["CompileResponse"];
export type SimulationInfo = components["schemas"]["SimulationInfo"];
export type SimulationStartResponse = components["schemas"]["SimulationStartResponse"];
export type SimulationStartErrorResponse = components["schemas"]["SimulationStartErrorResponse"];
export type SimulationCommandResponse = components["schemas"]["SimulationCommandResponse"];
export type UserInfo = components["schemas"]["UserInfo"];
export type UserRole = UserInfo["role"];
export type GroupSummary = components["schemas"]["GroupSummary"];
export type GroupMemberInfo = components["schemas"]["GroupMemberInfo"];
export type InviteInfo = components["schemas"]["InviteInfo"];
export type GroupProjectSummary = components["schemas"]["GroupProjectSummary"];
export type AdminUserInfo = components["schemas"]["AdminUserInfo"];
export type AdminUserList = components["schemas"]["AdminUserList"];
export type AdminUserCreated = components["schemas"]["AdminUserCreated"];

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
  "UNKNOWN_COMPONENT_TYPE",
  "SOURCE_TOO_LARGE",
  "COMPILER_UNAVAILABLE",
  "COMPILER_BUSY",
  "COMPILATION_TIMEOUT",
  "COMPILER_OUTPUT_TOO_LARGE",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "CSRF_FAILED",
  "INVALID_CREDENTIALS",
  "PASSWORD_CHANGE_REQUIRED",
  "WEAK_PASSWORD",
  "EMAIL_TAKEN",
  "INVALID_INVITE_CODE",
  "RATE_LIMITED",
  "USER_NOT_FOUND",
  "GROUP_NOT_FOUND",
  "INVITE_NOT_FOUND",
  "PROJECT_LIMIT_REACHED",
  "PROJECT_NOT_FOUND",
  "REVISION_NOT_FOUND",
  "REVISION_CONFLICT",
  "INVALID_CIRCUIT",
  "CIRCUIT_HAS_ERRORS",
  "COMPILATION_FAILED",
  "SIMULATOR_UNAVAILABLE",
  "SIMULATOR_BUSY",
  "SIMULATION_NOT_RUNNING",
  "SIMULATION_START_FAILED",
  "INVALID_SIMULATION_INPUT",
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

export const IssueCodeSchema = z.enum([
  "INVALID_DOCUMENT",
  "UNSUPPORTED_SCHEMA_VERSION",
  "DUPLICATE_COMPONENT_ID",
  "DUPLICATE_CONNECTION_ID",
  "UNKNOWN_COMPONENT_TYPE",
  "NOT_A_BOARD",
  "BOARD_AS_COMPONENT",
  "UNKNOWN_PROPERTY",
  "INVALID_PROPERTY",
  "BROKEN_CONNECTION_REFERENCE",
  "UNKNOWN_PIN",
  "NON_ORTHOGONAL_ROUTE",
  "POWER_SHORT_TO_GROUND",
  "POWER_RAILS_SHORTED",
  "VIN_CONNECTED_TO_RAIL",
  "OUTPUT_TO_RAIL",
  "OUTPUTS_CONNECTED",
  "LED_WITHOUT_RESISTOR",
  "LED_REVERSED",
  "GPIO_CURRENT_EXCEEDS_LIMIT",
  "GPIO_GROUP_CURRENT_EXCEEDS_LIMIT",
  "MISSING_GROUND",
  "FLOATING_POWER_PIN",
  "POWER_DOMAIN_MISMATCH",
  "SERIAL_PINS_USED",
  "I2C_PINS_USED",
  "SPI_PINS_USED",
]) satisfies z.ZodType<IssueCode>;

export const CircuitIssueSchema = z.object({
  code: IssueCodeSchema,
  severity: z.enum(["ERROR", "WARNING", "INFO"]),
  message: z.string(),
  refs: z.array(
    z.object({
      kind: z.enum(["component", "connection", "pin", "net", "field"]),
      id: z.string(),
    }),
  ),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
}) satisfies z.ZodType<CircuitIssue>;

export const CircuitValidationResponseSchema = z.object({
  issues: z.array(CircuitIssueSchema),
  nets: z.array(z.object({ id: z.string(), members: z.array(z.string()) })),
}) satisfies z.ZodType<CircuitValidationResponse>;

export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  board: z.literal("arduino-uno-r3"),
  schemaVersion: z.number().int(),
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<ProjectSummary>;

export const ProjectDetailSchema = ProjectSummarySchema.extend({
  owner: z.object({ id: z.string(), displayName: z.string() }),
  access: z.enum(["owner", "viewer"]),
  code: z.string(),
  // Документ схемы разбирается отдельно (parseCircuitDocument) с проверкой schemaVersion.
  circuit: z.record(z.string(), z.unknown()),
}) satisfies z.ZodType<ProjectDetail>;

export const ProjectListSchema = z.object({
  items: z.array(ProjectSummarySchema),
}) satisfies z.ZodType<ProjectList>;

export const CompileDiagnosticSchema = z.object({
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  column: z.number().int().nullable(),
  severity: z.enum(["error", "warning", "note"]),
  message: z.string(),
}) satisfies z.ZodType<CompileDiagnostic>;

export const CompileResponseSchema = z.object({
  status: z.enum(["success", "error"]),
  diagnostics: z.array(CompileDiagnosticSchema),
  sizes: z
    .object({
      flashBytes: z.number().int(),
      flashMaxBytes: z.number().int(),
      ramBytes: z.number().int(),
      ramMaxBytes: z.number().int(),
    })
    .nullable(),
  firmware: z
    .object({
      format: z.literal("ihex"),
      data: z.string(),
      sha256: z.string(),
    })
    .nullable(),
  compilerOutput: z.string(),
  compilerOutputTruncated: z.boolean(),
  toolchain: z.object({ arduinoCli: z.string(), platform: z.string(), fqbn: z.string() }),
  durationMs: z.number().int(),
}) satisfies z.ZodType<CompileResponse>;

export const SimulationInfoSchema = z.object({
  simulationId: z.string(),
  projectId: z.string(),
  status: z.enum(["starting", "running", "paused", "stopped", "failed"]),
  startTime: z.string(),
  endTime: z.string().nullable(),
  errorCode: z.string().nullable(),
  timestamp: z.number().int(),
  cycle: z.number().int(),
}) satisfies z.ZodType<SimulationInfo>;

export const SimulationStartResponseSchema = z.object({
  session: SimulationInfoSchema,
  validation: CircuitValidationResponseSchema,
  compilation: CompileResponseSchema,
}) satisfies z.ZodType<SimulationStartResponse>;

export const SimulationStartErrorResponseSchema = ErrorResponseSchema.extend({
  validation: CircuitValidationResponseSchema.nullable().exactOptional(),
  compilation: CompileResponseSchema.nullable().exactOptional(),
}) satisfies z.ZodType<SimulationStartErrorResponse>;

export const SimulationCommandResponseSchema = z.object({
  session: SimulationInfoSchema,
  appliedCycle: z.number().int().nullable(),
}) satisfies z.ZodType<SimulationCommandResponse>;

const RoleSchema = z.enum(["student", "teacher", "admin"]);
const UserRefSchema = z.object({ id: z.string(), displayName: z.string() });

export const UserInfoSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: RoleSchema,
  mustChangePassword: z.boolean(),
}) satisfies z.ZodType<UserInfo>;

export const GroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  teacher: UserRefSchema,
  memberCount: z.number().int(),
  createdAt: z.string(),
}) satisfies z.ZodType<GroupSummary>;

export const GroupListSchema = z.object({ items: z.array(GroupSummarySchema) });

export const GroupMemberListSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), email: z.string(), displayName: z.string(), joinedAt: z.string() }),
  ),
});

export const InviteInfoSchema = z.object({
  id: z.string(),
  code: z.string(),
  expiresAt: z.string().nullable(),
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
  revoked: z.boolean(),
  active: z.boolean(),
  createdAt: z.string(),
}) satisfies z.ZodType<InviteInfo>;

export const InviteListSchema = z.object({ items: z.array(InviteInfoSchema) });

export const GroupProjectListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      owner: UserRefSchema,
      revision: z.number().int(),
      updatedAt: z.string(),
    }),
  ),
});

export const AdminUserInfoSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: RoleSchema,
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
}) satisfies z.ZodType<AdminUserInfo>;

export const AdminUserListSchema = z.object({
  items: z.array(AdminUserInfoSchema),
  total: z.number().int(),
}) satisfies z.ZodType<AdminUserList>;

export const AdminUserCreatedSchema = z.object({
  user: AdminUserInfoSchema,
  temporaryPassword: z.string().nullable(),
}) satisfies z.ZodType<AdminUserCreated>;

export const TemporaryPasswordSchema = z.object({ temporaryPassword: z.string() });

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
