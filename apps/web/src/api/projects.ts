import { apiFetch } from "./http";
import type { CircuitDocument } from "@microlab/circuit-schema";

import {
  ProjectDetailSchema,
  ProjectListSchema,
  readDisplayErrorCode,
  type DisplayErrorCode,
  ProjectRevisionDetailSchema,
  ProjectRevisionListSchema,
  type ProjectDetail,
  type ProjectRevisionDetail,
  type ProjectRevisionSummary,
  type ProjectSummary,
} from "./schemas";

const PROJECTS_URL = "/api/v1/projects";

/** Клиентский лимит на один запрос к API проектов. */
const PROJECTS_TIMEOUT_MS = 15_000;

/**
 * Сбой запроса к API проектов.
 * - `unreachable` — сеть, таймаут или сервер временно недоступен (502/503/504): можно повторить;
 * - `http` — сервер ответил ошибкой; `code` — стабильный код ошибки API, если он есть;
 * - `unexpected` — ответ не соответствует контракту.
 */
export class ProjectApiError extends Error {
  readonly kind: "unreachable" | "http" | "unexpected";
  readonly status: number | null;
  readonly code: DisplayErrorCode | null;

  constructor(
    kind: "unreachable" | "http" | "unexpected",
    status: number | null,
    code: DisplayErrorCode | null,
  ) {
    super(`Project API request failed: ${kind} (HTTP ${status ?? "-"}, ${code ?? "no code"}).`);
    this.name = "ProjectApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }

  /** Сбой временный: повтор того же запроса может пройти. */
  get retryable(): boolean {
    return this.kind === "unreachable" || (this.status !== null && this.status >= 500);
  }
}

/** Новый проект: незаданные поля получают значения по умолчанию на сервере. */
export interface ProjectCreateInput {
  name: string;
  description?: string;
  code?: string;
  circuit?: CircuitDocument;
}

/** Изменение проекта: `revision` — версия, на которой основаны изменения. */
export interface ProjectPatch {
  revision: number;
  name?: string;
  description?: string;
  code?: string;
  circuit?: CircuitDocument;
}

async function request(
  url: string,
  init: { method: string; body?: unknown },
  signal?: AbortSignal,
): Promise<{ status: number; body: unknown }> {
  const timeout = AbortSignal.timeout(PROJECTS_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await apiFetch(url, {
      method: init.method,
      headers:
        init.body === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      cache: "no-store",
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted === true) throw error;
    throw new ProjectApiError("unreachable", null, null);
  }
  const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (response.ok) {
    return { status: response.status, body };
  }
  const code = readDisplayErrorCode(body);
  if ((response.status === 502 || response.status === 504) && code === null) {
    // Прокси или шлюз не достучался до API.
    throw new ProjectApiError("unreachable", response.status, null);
  }
  if (response.status === 503 && code === "DATABASE_UNAVAILABLE") {
    throw new ProjectApiError("unreachable", response.status, code);
  }
  throw new ProjectApiError("http", response.status, code);
}

function parseDetail(body: unknown, status: number): ProjectDetail {
  const parsed = ProjectDetailSchema.safeParse(body);
  if (!parsed.success) throw new ProjectApiError("unexpected", status, null);
  return parsed.data;
}

function projectUrl(id: string): string {
  return `${PROJECTS_URL}/${encodeURIComponent(id)}`;
}

export async function listProjects(signal?: AbortSignal): Promise<ProjectSummary[]> {
  const { status, body } = await request(PROJECTS_URL, { method: "GET" }, signal);
  const parsed = ProjectListSchema.safeParse(body);
  if (!parsed.success) throw new ProjectApiError("unexpected", status, null);
  return parsed.data.items;
}

export async function getProject(id: string, signal?: AbortSignal): Promise<ProjectDetail> {
  const { status, body } = await request(projectUrl(id), { method: "GET" }, signal);
  return parseDetail(body, status);
}

export async function createProject(data: ProjectCreateInput, signal?: AbortSignal): Promise<ProjectDetail> {
  const { status, body } = await request(PROJECTS_URL, { method: "POST", body: data }, signal);
  return parseDetail(body, status);
}

export async function updateProject(
  id: string,
  patch: ProjectPatch,
  signal?: AbortSignal,
): Promise<ProjectDetail> {
  const { status, body } = await request(projectUrl(id), { method: "PATCH", body: patch }, signal);
  return parseDetail(body, status);
}

export async function deleteProject(id: string, signal?: AbortSignal): Promise<void> {
  await request(projectUrl(id), { method: "DELETE" }, signal);
}

/** Сохранённые версии проекта, новые первыми. */
export async function listRevisions(id: string, signal?: AbortSignal): Promise<ProjectRevisionSummary[]> {
  const { status, body } = await request(`${projectUrl(id)}/revisions`, { method: "GET" }, signal);
  const parsed = ProjectRevisionListSchema.safeParse(body);
  if (!parsed.success) throw new ProjectApiError("unexpected", status, null);
  return parsed.data.items;
}

/** Код и схема сохранённой версии проекта. */
export async function getRevision(
  id: string,
  revision: number,
  signal?: AbortSignal,
): Promise<ProjectRevisionDetail> {
  const { status, body } = await request(
    `${projectUrl(id)}/revisions/${String(revision)}`,
    { method: "GET" },
    signal,
  );
  const parsed = ProjectRevisionDetailSchema.safeParse(body);
  if (!parsed.success) throw new ProjectApiError("unexpected", status, null);
  return parsed.data;
}
