import { jsonResponse } from "./fetch";

interface StoredProject {
  id: string;
  name: string;
  description: string;
  board: "arduino-uno-r3";
  schemaVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  code: string;
  circuit: Record<string, unknown>;
}

const EMPTY_CIRCUIT = {
  schemaVersion: 1,
  board: { id: "uno1", type: "arduino-uno-r3" },
  components: [],
  connections: [],
};

export const SIMULATION_ID = "sim-00000000-0001";

export function simulationInfo(projectId: string, status: "starting" | "running" | "paused" | "stopped" | "failed") {
  return {
    simulationId: SIMULATION_ID,
    projectId,
    status,
    startTime: "2026-09-26T10:00:00.000Z",
    endTime: status === "stopped" || status === "failed" ? "2026-09-26T10:01:00.000Z" : null,
    errorCode: null,
    timestamp: 0,
    cycle: 0,
  };
}

export const COMPILATION = {
  status: "success",
  diagnostics: [],
  sizes: { flashBytes: 1024, flashMaxBytes: 32256, ramBytes: 200, ramMaxBytes: 2048 },
  firmware: null,
  compilerOutput: "",
  compilerOutputTruncated: false,
  toolchain: { arduinoCli: "1.5.1", platform: "arduino:avr@1.8.8", fqbn: "arduino:avr:uno" },
  durationMs: 700,
} as const;

export function simulationStartResponse(projectId: string) {
  return {
    session: simulationInfo(projectId, "running"),
    validation: { issues: [], nets: [] },
    compilation: COMPILATION,
  };
}

function error(status: number, code: string) {
  return jsonResponse({ error: { code, message: code, details: [] } }, status);
}

/**
 * Упрощённый сервер API проектов в памяти для тестов: CRUD и проверка номера версии
 * (409 REVISION_CONFLICT) как у настоящего backend.
 */
export class FakeProjectsServer {
  readonly projects = new Map<string, StoredProject>();
  readonly requests: { method: string; url: string; body: unknown }[] = [];
  private nextId = 1;
  private clock = 0;
  /** Если задано, следующий ответ будет этой ошибкой (однократно). */
  failNext: (() => Response | Promise<Response>) | null = null;
  /** Ответ на команды симуляции (`start`, `pause`, …); по умолчанию — успешный. */
  simulation: (action: string, projectId: string, body: unknown) => Response = (action, projectId) =>
    action === "start"
      ? jsonResponse(simulationStartResponse(projectId), 200)
      : jsonResponse(
          {
            session: simulationInfo(projectId, action === "pause" ? "paused" : action === "stop" ? "stopped" : "running"),
            appliedCycle: 160_000,
          },
          200,
        );

  add(data: Partial<StoredProject> = {}): StoredProject {
    const now = new Date(Date.UTC(2026, 8, 26, 10, 0, this.clock++)).toISOString();
    const project: StoredProject = {
      id: `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`,
      name: "Новый проект",
      description: "",
      board: "arduino-uno-r3",
      schemaVersion: 1,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      code: "void setup() {\n}\n\nvoid loop() {\n}\n",
      circuit: structuredClone(EMPTY_CIRCUIT),
      ...data,
    };
    this.projects.set(project.id, project);
    return project;
  }

  /** Имитирует сохранение из другой вкладки. */
  touch(id: string, changes: Partial<StoredProject> = {}): void {
    const project = this.projects.get(id);
    if (project === undefined) throw new Error("no project");
    Object.assign(project, changes, { revision: project.revision + 1 });
  }

  handles(url: string): boolean {
    return url.startsWith("/api/v1/projects");
  }

  async handle(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? "GET";
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    this.requests.push({ method, url, body });
    if (this.failNext !== null) {
      const fail = this.failNext;
      this.failNext = null;
      return fail();
    }
    const simulation = /^\/api\/v1\/projects\/([^/]+)\/simulation\/(\w+)$/.exec(url);
    if (simulation !== null) return this.simulation(simulation[2] ?? "", decodeURIComponent(simulation[1] ?? ""), body);
    const id = /^\/api\/v1\/projects\/([^/]+)$/.exec(url)?.[1];
    if (id === undefined) {
      if (method === "GET") {
        const items = [...this.projects.values()]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((project) => {
            const summary: Partial<StoredProject> = { ...project };
            delete summary.code;
            delete summary.circuit;
            return summary;
          });
        return jsonResponse({ items }, 200);
      }
      return jsonResponse(this.add(body as Partial<StoredProject>), 201);
    }
    const project = this.projects.get(decodeURIComponent(id));
    if (project === undefined) return error(404, "PROJECT_NOT_FOUND");
    if (method === "GET") return jsonResponse(project, 200);
    if (method === "DELETE") {
      this.projects.delete(project.id);
      return new Response(null, { status: 204 });
    }
    const patch = body as Partial<StoredProject> & { revision: number };
    if (patch.revision !== project.revision) return error(409, "REVISION_CONFLICT");
    const changes: Partial<StoredProject> = { ...patch };
    delete changes.revision;
    Object.assign(project, changes, {
      revision: project.revision + 1,
      updatedAt: new Date(Date.UTC(2026, 8, 26, 11, 0, this.clock++)).toISOString(),
    });
    return jsonResponse(project, 200);
  }
}
