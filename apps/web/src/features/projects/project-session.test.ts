import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getProject } from "@/api/projects";
import { useCircuitStore } from "@/stores/circuit-store";
import { useEditorStore } from "@/stores/editor-store";
import { useProjectStore } from "@/stores/project-store";
import { jsonResponse, stubFetch } from "@/test/fetch";
import { FakeProjectsServer } from "@/test/projects-server";

import {
  AUTOSAVE_DEBOUNCE_MS,
  LAST_PROJECT_KEY,
  openProject,
  reloadFromServer,
  renameProject,
  resolveStartupProject,
  saveAsNewProject,
  saveNow,
  startProjectSession,
} from "./project-session";

let server: FakeProjectsServer;
let stop: () => void;

async function openStored(id: string) {
  expect(openProject(await getProject(id))).toBe(true);
}

function status() {
  return useProjectStore.getState().status;
}

beforeEach(() => {
  server = new FakeProjectsServer();
  stubFetch((input, init) => server.handle(input as string, init));
  stop = startProjectSession();
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe("project session", () => {
  it("round-trips code and circuit through save and reload", async () => {
    const { id } = server.add();
    await openStored(id);
    const circuit = useCircuitStore.getState();
    const resistor = circuit.addComponent("resistor", { x: 30, y: 4 });
    const led = circuit.addComponent("led", { x: 40, y: 4 });
    useCircuitStore.getState().connect({ componentId: "uno1", pinId: "D13" }, { componentId: resistor, pinId: "1" });
    useCircuitStore.getState().connect({ componentId: resistor, pinId: "2" }, { componentId: led, pinId: "A" });
    useEditorStore.getState().setCode("// blink");
    const saved = useCircuitStore.getState().serialize();

    expect(await saveNow()).toBe(true);
    expect(status()).toBe("saved");

    // «Перезагрузка страницы»: состояние сбрасывается и проект открывается заново.
    useCircuitStore.getState().reset();
    useEditorStore.getState().loadCode("");
    await openStored(id);
    expect(useCircuitStore.getState().serialize()).toEqual(saved);
    expect(useEditorStore.getState().code).toBe("// blink");
    expect(useCircuitStore.getState().past).toEqual([]);
    expect(window.localStorage.getItem(LAST_PROJECT_KEY)).toBe(id);
  });

  it("debounces autosave and reports status transitions", async () => {
    vi.useFakeTimers();
    const { id } = server.add();
    await openStored(id);
    expect(status()).toBe("saved");

    useEditorStore.getState().setCode("a");
    expect(status()).toBe("dirty");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 100);
    useEditorStore.getState().setCode("ab");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 100);
    expect(server.requests.filter((r) => r.method === "PATCH")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(200);
    const patches = server.requests.filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toMatchObject({ revision: 1, code: "ab" });
    expect(status()).toBe("saved");
    expect(useProjectStore.getState().revision).toBe(2);
  });

  it("does not mark loading a project as a change", async () => {
    const { id } = server.add({ code: "// x" });
    await openStored(id);
    expect(status()).toBe("saved");
  });

  it("stops on a revision conflict and never overwrites the server copy", async () => {
    const { id } = server.add({ code: "// base" });
    await openStored(id);
    server.touch(id, { code: "// other tab" });

    useEditorStore.getState().setCode("// mine");
    expect(await saveNow()).toBe(false);
    expect(status()).toBe("conflict");
    expect(useProjectStore.getState().conflict).toBe("revision");
    expect(server.projects.get(id)?.code).toBe("// other tab");

    // Дальнейшие правки не отправляются, пока конфликт не решён.
    useEditorStore.getState().setCode("// mine 2");
    expect(await saveNow()).toBe(false);
    expect(server.requests.filter((r) => r.method === "PATCH")).toHaveLength(1);

    // Вариант 1: сохранить свою версию как новый проект.
    expect(await saveAsNewProject()).toBe(true);
    expect(status()).toBe("saved");
    const copy = server.projects.get(useProjectStore.getState().projectId ?? "");
    expect(copy?.code).toBe("// mine 2");
    expect(copy?.name).toBe("Новый проект (копия)");
    expect(server.projects.get(id)?.code).toBe("// other tab");
  });

  it("reloads the server version on request", async () => {
    const { id } = server.add();
    await openStored(id);
    server.touch(id, { code: "// server" });
    useEditorStore.getState().setCode("// local");
    await saveNow();
    expect(await reloadFromServer()).toBe(true);
    expect(useEditorStore.getState().code).toBe("// server");
    expect(status()).toBe("saved");
  });

  it("reports a deleted project as a conflict", async () => {
    const { id } = server.add();
    await openStored(id);
    server.projects.delete(id);
    useEditorStore.getState().setCode("// orphan");
    await saveNow();
    expect(useProjectStore.getState().conflict).toBe("deleted");
  });

  it("retries with backoff on network errors", async () => {
    vi.useFakeTimers();
    const { id } = server.add();
    await openStored(id);
    server.failNext = () => Promise.reject(new TypeError("Failed to fetch"));
    useEditorStore.getState().setCode("// offline");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(status()).toBe("error");
    expect(useProjectStore.getState().errorKind).toBe("network");

    await vi.advanceTimersByTimeAsync(2000);
    expect(status()).toBe("saved");
    expect(server.projects.get(id)?.code).toBe("// offline");
  });

  it("does not retry a rejected document automatically", async () => {
    vi.useFakeTimers();
    const { id } = server.add();
    await openStored(id);
    server.failNext = () =>
      jsonResponse({ error: { code: "INVALID_CIRCUIT", message: "", details: [] } }, 422);
    useEditorStore.getState().setCode("// x");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(useProjectStore.getState().errorKind).toBe("invalid");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.requests.filter((r) => r.method === "PATCH")).toHaveLength(1);
  });

  it("saves changes made while a save is in flight", async () => {
    const { id } = server.add();
    await openStored(id);
    useEditorStore.getState().setCode("1");
    const first = saveNow();
    useEditorStore.getState().setCode("2");
    expect(status()).toBe("saving");
    await first;
    expect(await saveNow()).toBe(true);
    expect(server.projects.get(id)?.code).toBe("2");
    expect(server.projects.get(id)?.revision).toBe(3);
  });

  it("renames and saves immediately", async () => {
    const { id } = server.add();
    await openStored(id);
    renameProject("  Светофор ");
    await vi.waitFor(() => {
      expect(server.projects.get(id)?.name).toBe("Светофор");
    });
    renameProject("   ");
    expect(useProjectStore.getState().name).toBe("Светофор");
  });

  it("rejects an unsupported schemaVersion without touching the working document", async () => {
    const { id } = server.add({ circuit: { schemaVersion: 99 } });
    const before = useCircuitStore.getState().serialize();
    expect(openProject(await getProject(id))).toBe(false);
    expect(useProjectStore.getState()).toMatchObject({ phase: "loadError", loadError: "unsupportedVersion" });
    expect(useCircuitStore.getState().serialize()).toEqual(before);
    useEditorStore.getState().setCode("// not saved anywhere");
    expect(await saveNow()).toBe(false);
    expect(server.requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
  });

  it("warns before unload with unsaved changes", async () => {
    const { id } = server.add();
    await openStored(id);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    useEditorStore.getState().setCode("// unsaved");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe("resolveStartupProject", () => {
  it("opens the last project, falls back to the latest, else creates one", async () => {
    expect((await resolveStartupProject()).name).toBe("Новый проект");
    expect(server.projects.size).toBe(1);

    const other = server.add({ name: "Другой" });
    window.localStorage.setItem(LAST_PROJECT_KEY, other.id);
    expect((await resolveStartupProject()).id).toBe(other.id);

    window.localStorage.setItem(LAST_PROJECT_KEY, "missing");
    expect((await resolveStartupProject()).id).toBe(other.id);
    expect(server.projects.size).toBe(2);
  });
});
