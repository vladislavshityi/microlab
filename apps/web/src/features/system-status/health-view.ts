import type { HealthResult } from "@/api/health";
import { t, type PlainTranslationKey } from "@/i18n/t";

export type StatusTone = "success" | "error" | "warning" | "unknown";

export interface StatusCell {
  tone: StatusTone;
  label: PlainTranslationKey;
}

export interface HealthDetail {
  key: "errorCode" | "httpStatus" | "requestId";
  text: string;
}

export interface HealthView {
  backend: StatusCell;
  database: StatusCell;
  version: string | null;
  summary: {
    tone: Exclude<StatusTone, "unknown">;
    title: PlainTranslationKey;
    description: PlainTranslationKey;
  };
  details: HealthDetail[];
  /** Повторная проверка — основное действие, если что-то не так. */
  retryIsPrimary: boolean;
}

function detailsFor(
  code: string | null,
  httpStatus: number | null,
  requestId: string | null,
): HealthDetail[] {
  const details: HealthDetail[] = [];
  if (code !== null) {
    details.push({ key: "errorCode", text: t("health.meta.errorCode", { code }) });
  }
  if (httpStatus !== null) {
    details.push({
      key: "httpStatus",
      text: t("health.meta.httpStatus", { status: String(httpStatus) }),
    });
  }
  if (requestId !== null) {
    details.push({ key: "requestId", text: t("health.meta.requestId", { id: requestId }) });
  }
  return details;
}

/** Чистое отображение результата health в то, что показывает страница состояния. */
export function toHealthView(result: HealthResult): HealthView {
  switch (result.kind) {
    case "ok":
      return {
        backend: { tone: "success", label: "health.backend.ok" },
        database: { tone: "success", label: "health.database.ok" },
        version: result.version,
        summary: {
          tone: "success",
          title: "health.summary.ok.title",
          description: "health.summary.ok.description",
        },
        details: [],
        retryIsPrimary: false,
      };
    case "databaseDown":
      return {
        backend: { tone: "success", label: "health.backend.ok" },
        database: { tone: "error", label: "health.database.error" },
        version: result.version,
        summary: {
          tone: "error",
          title: "health.summary.databaseDown.title",
          description: "health.summary.databaseDown.description",
        },
        details: detailsFor(result.code, null, result.requestId),
        retryIsPrimary: true,
      };
    case "backendUnreachable":
      return {
        backend: { tone: "error", label: "health.backend.unreachable" },
        database: { tone: "unknown", label: "health.database.unknown" },
        version: null,
        summary: {
          tone: "error",
          title: "health.summary.backendUnreachable.title",
          description: "health.summary.backendUnreachable.description",
        },
        // HTTP-статус показывается только для состояния "unexpected".
        details: detailsFor(null, null, result.requestId),
        retryIsPrimary: true,
      };
    case "unexpected":
      return {
        backend: { tone: "warning", label: "health.backend.unexpected" },
        database: { tone: "unknown", label: "health.database.unknown" },
        version: null,
        summary: {
          tone: "warning",
          title: "health.summary.unexpected.title",
          description: "health.summary.unexpected.description",
        },
        details: detailsFor(result.code, result.httpStatus, result.requestId),
        retryIsPrimary: true,
      };
  }
}
