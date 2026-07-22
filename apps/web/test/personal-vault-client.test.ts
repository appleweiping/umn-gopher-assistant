import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonalVaultClient } from "../lib/personal-vault/client";
import type { PersonalVaultClientError } from "../lib/personal-vault/client";

type WorkerListener = (event: MessageEvent<unknown>) => void;

class FakeWorker {
  static latest: FakeWorker | undefined;

  readonly messages: unknown[] = [];
  readonly terminate = vi.fn();
  readonly #listeners = new Map<string, Set<WorkerListener>>();

  constructor() {
    FakeWorker.latest = this;
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<WorkerListener>();
    listeners.add(listener as WorkerListener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.#listeners.get(type)?.delete(listener as WorkerListener);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  respond(data: unknown): void {
    for (const listener of this.#listeners.get("message") ?? []) {
      listener(new MessageEvent("message", { data }));
    }
  }
}

function requestAt(worker: FakeWorker, index: number): { readonly id: string; readonly method: string } {
  return worker.messages[index] as { readonly id: string; readonly method: string };
}

describe("PersonalVaultClient graceful termination", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    FakeWorker.latest = undefined;
  });

  it("queues lock behind a pending write and terminates only after both responses", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const client = new PersonalVaultClient(new URL("http://localhost/worker.mjs"));
    const worker = FakeWorker.latest;
    if (worker === undefined) throw new Error("Worker was not constructed.");

    const write = client.addTask("Persist me");
    const closing = client.terminateWhenSettled(1_000);
    expect(worker.messages.map((message) => (message as { method: string }).method)).toEqual([
      "add-task",
      "lock",
    ]);
    expect(worker.terminate).not.toHaveBeenCalled();

    const writeRequest = requestAt(worker, 0);
    worker.respond({
      id: writeRequest.id,
      method: "add-task",
      ok: true,
      snapshot: { revision: 2, tasks: [{ done: false, id: "task-1", title: "Persist me" }] },
    });
    await expect(write).resolves.toMatchObject({ method: "add-task" });
    expect(worker.terminate).not.toHaveBeenCalled();

    const lockRequest = requestAt(worker, 1);
    worker.respond({ id: lockRequest.id, method: "lock", ok: true });
    await closing;
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(client.inspect()).rejects.toMatchObject({
      code: "UNAVAILABLE",
    } satisfies Partial<PersonalVaultClientError>);
  });

  it("forces termination after the bounded drain timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const client = new PersonalVaultClient(new URL("http://localhost/worker.mjs"));
    const worker = FakeWorker.latest;
    if (worker === undefined) throw new Error("Worker was not constructed.");

    const closing = client.terminateWhenSettled(50);
    await vi.advanceTimersByTimeAsync(50);
    await closing;

    expect(requestAt(worker, 0).method).toBe("lock");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
