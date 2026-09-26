import { describe, expect, it } from "vitest";

import { fetchHealth, HEALTH_URL, interpretHealthResponse } from "./health";
import { HEALTH_DB_DOWN, HEALTH_OK, jsonResponse, stubFetch } from "@/test/fetch";

describe("interpretHealthResponse", () => {
  it("200 + valid body → ok", async () => {
    const result = await interpretHealthResponse(
      jsonResponse(HEALTH_OK, 200, { "X-Request-ID": "req-1" }),
    );
    expect(result).toEqual({ kind: "ok", version: "1.0.0", requestId: "req-1" });
  });

  it("503 + valid body → databaseDown with code", async () => {
    const result = await interpretHealthResponse(jsonResponse(HEALTH_DB_DOWN, 503));
    expect(result).toEqual({
      kind: "databaseDown",
      version: "1.0.0",
      code: "DATABASE_UNAVAILABLE",
      requestId: null,
    });
  });

  it.each([502, 504])("%i from the proxy → backendUnreachable", async (status) => {
    const result = await interpretHealthResponse(new Response("", { status }));
    expect(result).toEqual({ kind: "backendUnreachable", httpStatus: status, requestId: null });
  });

  it("500 with the error envelope → unexpected with the stable code", async () => {
    const result = await interpretHealthResponse(
      jsonResponse(
        { error: { code: "INTERNAL_ERROR", message: "Traceback: secret", details: [] } },
        500,
        { "X-Request-ID": "abc" },
      ),
    );
    expect(result).toEqual({
      kind: "unexpected",
      httpStatus: 500,
      code: "INTERNAL_ERROR",
      requestId: "abc",
    });
  });

  it("500 with an error code unknown to this frontend → unexpected, code kept for display", async () => {
    const result = await interpretHealthResponse(
      jsonResponse({ error: { code: "RATE_LIMITED", message: "secret", details: [] } }, 500),
    );
    expect(result).toEqual({
      kind: "unexpected",
      httpStatus: 500,
      code: "RATE_LIMITED",
      requestId: null,
    });
  });

  it("does not display a code that is not a stable identifier", async () => {
    const result = await interpretHealthResponse(
      jsonResponse({ error: { code: "psycopg error: password=x", message: "", details: [] } }, 500),
    );
    expect(result).toMatchObject({ kind: "unexpected", code: null });
  });

  it.each([
    ["200 with an invalid body", jsonResponse({ status: "ok" }, 200)],
    ["200 with a non-JSON body", new Response("<html>", { status: 200 })],
    ["200 with an 'unavailable' body", jsonResponse(HEALTH_DB_DOWN, 200)],
    ["503 with an 'ok' body", jsonResponse(HEALTH_OK, 503)],
    ["404", jsonResponse({ error: { code: "NOT_FOUND", message: "", details: [] } }, 404)],
  ])("%s → unexpected", async (_name, response) => {
    const result = await interpretHealthResponse(response);
    expect(result.kind).toBe("unexpected");
  });

  it("ignores a malformed X-Request-ID header", async () => {
    const result = await interpretHealthResponse(
      jsonResponse(HEALTH_OK, 200, { "X-Request-ID": "bad id <script>" }),
    );
    expect(result).toMatchObject({ requestId: null });
  });
});

describe("fetchHealth", () => {
  it("requests the relative health URL", async () => {
    const fetchMock = stubFetch(() => Promise.resolve(jsonResponse(HEALTH_OK, 200)));
    await fetchHealth();
    expect(fetchMock).toHaveBeenCalledWith(HEALTH_URL, expect.objectContaining({ method: "GET" }));
    expect(HEALTH_URL).toBe("/api/v1/health");
  });

  it("network error → backendUnreachable", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(fetchHealth()).resolves.toEqual({
      kind: "backendUnreachable",
      httpStatus: null,
      requestId: null,
    });
  });

  it("re-throws cancellation requested by the caller", async () => {
    const controller = new AbortController();
    stubFetch((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    const pending = fetchHealth(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
