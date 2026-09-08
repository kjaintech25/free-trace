/**
 * Web Worker host for the line-art engine (SPEC §8, ticket T-06).
 *
 * The pipeline itself lives in `lib/edges.ts` and is never called on the main
 * thread by app code — `lib/edgesClient.ts` is the only sanctioned entry point
 * and it always goes through this worker, so dragging a slider on the convert
 * screen cannot block paint.
 *
 * Both directions TRANSFER their pixel buffer rather than copying it, so a
 * 12MP image costs no structured-clone memcpy. The consequence is that the
 * sender's `Uint8ClampedArray` is DETACHED once posted; see edgesClient.ts.
 */

import { renderLineArt, type LineArtSettings } from "./edges";

export interface EdgeWorkerRequest {
  /** Correlates a response with its call; the client allocates it. */
  id: number;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  settings: LineArtSettings;
}

export type EdgeWorkerResponse =
  | { id: number; ok: true; width: number; height: number; pixels: Uint8ClampedArray }
  | { id: number; ok: false; message: string };

/**
 * The project tsconfig loads the `dom` lib, so `self` is typed as a Window
 * here and `postMessage` resolves to the window overload. Adding
 * `lib="webworker"` would redeclare those globals for the whole program, so
 * narrow just the two members this file uses instead.
 */
interface DedicatedWorkerScope {
  onmessage: ((event: MessageEvent<EdgeWorkerRequest>) => void) | null;
  postMessage: (message: EdgeWorkerResponse, transfer: Transferable[]) => void;
}

const scope = globalThis as unknown as DedicatedWorkerScope;

scope.onmessage = (event) => {
  const { id, pixels, width, height, settings } = event.data;
  try {
    const result = renderLineArt({ width, height, data: pixels }, settings);
    scope.postMessage(
      { id, ok: true, width: result.width, height: result.height, pixels: result.data },
      // Cast: `.buffer` is typed ArrayBufferLike (it could be a
      // SharedArrayBuffer), but a buffer this function just allocated is
      // always a plain, transferable ArrayBuffer.
      [result.data.buffer as ArrayBuffer],
    );
  } catch (error) {
    scope.postMessage(
      {
        id,
        ok: false,
        message: error instanceof Error ? error.message : "Line-art conversion failed.",
      },
      [],
    );
  }
};
