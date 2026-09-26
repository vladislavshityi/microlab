import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import {
  CircuitValidationResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  ProjectDetailSchema,
  ProjectListSchema,
  ProjectSummarySchema,
  readDisplayErrorCode,
  type CircuitValidationResponse,
  type ErrorResponse,
  type HealthResponse,
  type ProjectDetail,
  type ProjectList,
  type ProjectSummary,
} from "./schemas";
import { HEALTH_DB_DOWN, HEALTH_OK } from "@/test/fetch";

describe("HealthResponseSchema", () => {
  it("is exactly the generated OpenAPI type (compile-time)", () => {
    expectTypeOf<z.infer<typeof HealthResponseSchema>>().toEqualTypeOf<HealthResponse>();
    expectTypeOf<z.infer<typeof ErrorResponseSchema>>().toEqualTypeOf<ErrorResponse>();
    expectTypeOf<z.infer<typeof CircuitValidationResponseSchema>>().toEqualTypeOf<CircuitValidationResponse>();
    expectTypeOf<z.infer<typeof ProjectSummarySchema>>().toEqualTypeOf<ProjectSummary>();
    expectTypeOf<z.infer<typeof ProjectDetailSchema>>().toEqualTypeOf<ProjectDetail>();
    expectTypeOf<z.infer<typeof ProjectListSchema>>().toEqualTypeOf<ProjectList>();
  });

  it("accepts the 200 and 503 bodies from the contract", () => {
    expect(HealthResponseSchema.parse(HEALTH_OK)).toEqual(HEALTH_OK);
    expect(HealthResponseSchema.parse(HEALTH_DB_DOWN)).toEqual(HEALTH_DB_DOWN);
  });

  it.each([
    ["missing version", { status: "ok", checks: { database: { status: "ok" } } }],
    ["unknown status", { ...HEALTH_OK, status: "degraded" }],
    ["unknown database status", { ...HEALTH_OK, checks: { database: { status: "maybe" } } }],
    ["unknown database code", { ...HEALTH_DB_DOWN, checks: { database: { status: "error", code: "X" } } }],
    ["not an object", "ok"],
    ["null", null],
  ])("rejects %s", (_name, body) => {
    expect(HealthResponseSchema.safeParse(body).success).toBe(false);
  });

  it("strips unknown extra keys (tolerant reader)", () => {
    expect(HealthResponseSchema.parse({ ...HEALTH_OK, extra: 1 })).toEqual(HEALTH_OK);
  });
});

describe("CircuitValidationResponseSchema", () => {
  const body = {
    issues: [
      {
        code: "LED_WITHOUT_RESISTOR",
        severity: "WARNING",
        message: "LED led1 has no current-limiting resistor in its path.",
        refs: [{ kind: "component", id: "led1" }],
        params: { component: "led1", currentMa: 30 },
      },
    ],
    nets: [{ id: "NET_001", members: ["uno1.D13", "led1.A"] }],
  };

  it("accepts a validation result", () => {
    expect(CircuitValidationResponseSchema.parse(body)).toEqual(body);
  });

  it("rejects unknown issue codes and severities", () => {
    const [issue] = body.issues;
    expect(CircuitValidationResponseSchema.safeParse({ ...body, issues: [{ ...issue, code: "X" }] }).success).toBe(false);
    expect(CircuitValidationResponseSchema.safeParse({ ...body, issues: [{ ...issue, severity: "FATAL" }] }).success).toBe(
      false,
    );
  });
});

describe("ErrorResponseSchema", () => {
  it("accepts the error envelope", () => {
    const body = { error: { code: "INTERNAL_ERROR", message: "Internal server error.", details: [] } };
    expect(ErrorResponseSchema.parse(body)).toEqual(body);
  });

  it("rejects unknown error codes", () => {
    const body = { error: { code: "SOMETHING_ELSE", message: "", details: [] } };
    expect(ErrorResponseSchema.safeParse(body).success).toBe(false);
  });
});

describe("readDisplayErrorCode (tolerant reader for display)", () => {
  it.each([
    ["a known code", "INTERNAL_ERROR", "INTERNAL_ERROR"],
    ["a code unknown to this frontend", "RATE_LIMITED", "RATE_LIMITED"],
    ["free-form text", "Traceback (most recent call last)", null],
    ["lower-case text", "internal_error", null],
    ["an empty string", "", null],
  ])("%s", (_name, code, expected) => {
    expect(readDisplayErrorCode({ error: { code, message: "m", details: [] } })).toBe(expected);
  });

  it("returns null for a body without an error envelope", () => {
    expect(readDisplayErrorCode({ status: "ok" })).toBeNull();
    expect(readDisplayErrorCode(undefined)).toBeNull();
  });
});

describe("ProjectDetailSchema", () => {
  const project = {
    id: "3f1c7a52-6a57-4a0b-9d0e-6a8f0f1d2c3b",
    name: "Мигалка",
    description: "",
    board: "arduino-uno-r3",
    schemaVersion: 1,
    revision: 3,
    createdAt: "2026-09-26T10:00:00Z",
    updatedAt: "2026-09-26T10:05:00Z",
    code: "void setup() {}",
    circuit: { schemaVersion: 1 },
  };

  it("accepts a project and its summary in a list", () => {
    expect(ProjectDetailSchema.parse(project)).toEqual(project);
    const summary = Object.fromEntries(
      Object.entries(project).filter(([key]) => key !== "code" && key !== "circuit"),
    );
    expect(ProjectListSchema.parse({ items: [summary] }).items[0]).toEqual(summary);
    expect(ProjectSummarySchema.safeParse({ ...summary, board: "esp32" }).success).toBe(false);
  });
});
