/**
 * Typed main-thread client for the line-art worker (SPEC §8, ticket T-06).
 *
 * This is the ONLY way app code should run the pipeline. `renderLineArt` is
 * never called directly from a component: every conversion goes through the
 * worker so the convert screen's sliders keep painting.
 *
 * One worker is kept alive for the whole session (spawning one per slider
 * nudge would cost more than the conversion). Each call gets its own request
 * id and its own promise, so concurrent calls cannot cross-resolve. If the
 * worker itself dies, every in-flight promise rejects with a real Error and
 * the worker is discarded, so the next call transparently gets a fresh one.
 */

import type { LineArtSettings, PixelBuffer } from "./edges";
import type { EdgeWorkerRequest, EdgeWorkerResponse } from "./edges.worker";

interface PendingRequest {
  resolve: (value: PixelBuffer) => void;
  reject: (reason: Error) => void;
}

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function teardown(error: Error): void {
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function handleMessage(event: MessageEvent<EdgeWorkerResponse>): void {
  const message = event.data;
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.ok) {
    entry.resolve({ width: message.width, height: message.height, data: message.pixels });
  } else {
    entry.reject(new Error(message.message));
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL("./edges.worker.ts", import.meta.url), { type: "module" });
  created.onmessage = handleMessage;
  created.onerror = (event) => {
    teardown(new Error(event.message || "The line-art worker stopped unexpectedly."));
  };
  created.onmessageerror = () => {
    teardown(new Error("The line-art worker sent a result that could not be read."));
  };
  worker = created;
  return created;
}

/**
 * Convert an RGBA buffer to line art off the main thread.
 *
 * ⚠️ `input.data` is TRANSFERRED, not copied — the array you pass in is
 * DETACHED (length 0) as soon as this returns, and the same is true of the
 * buffer handed back the next time you feed it in. Keep a pristine copy of the
 * source pixels if you intend to re-convert at different settings, which the
 * convert screen does on every slider change.
 *
 * @returns a promise for a new buffer; rejects with a message-bearing Error if
 * the worker is unavailable, fails to start, or throws.
 */
export function renderLineArtAsync(
  input: PixelBuffer,
  settings: LineArtSettings,
): Promise<PixelBuffer> {
  if (typeof Worker === "undefined") {
    return Promise.reject(new Error("This browser cannot run the line-art worker."));
  }

  let instance: Worker;
  try {
    instance = getWorker();
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error("The line-art worker could not be started."),
    );
  }

  const id = nextRequestId++;
  return new Promise<PixelBuffer>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: EdgeWorkerRequest = {
      id,
      pixels: input.data,
      width: input.width,
      height: input.height,
      settings,
    };
    try {
      // Cast: `.buffer` is typed ArrayBufferLike; a caller passing a
      // SharedArrayBuffer-backed view would fail here at runtime, which is the
      // correct outcome and is caught by the try/catch below.
      instance.postMessage(request, [input.data.buffer as ArrayBuffer]);
    } catch (error) {
      pending.delete(id);
      reject(
        error instanceof Error ? error : new Error("The image could not be sent to the worker."),
      );
    }
  });
}

/**
 * Shut the worker down and reject anything still in flight. Call from a
 * screen's unmount so a backgrounded tab is not holding a worker open.
 */
export function terminateLineArtWorker(): void {
  teardown(new Error("The line-art worker was shut down."));
}
