/**
 * Canvas-dependent image helpers for the line-art path (SPEC §8, ticket T-06).
 *
 * Deliberately separate from `lib/edges.ts`: the engine there is pure and
 * DOM-free so it can be unit-tested and run in a worker. Everything in THIS
 * file needs a real canvas, so it is browser-only and is not covered by the
 * unit tests — it is verified by the convert screen (T-07) instead.
 */

import { MAX_LONG_EDGE, type PixelBuffer } from "./edges";

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Decoded source plus how to release it. */
interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decodeBlob(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }

  // Older iOS Safari has no createImageBitmap for every blob type; fall back to
  // an <img> element and an object URL.
  const url = URL.createObjectURL(blob);
  try {
    const element = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("That file could not be read as an image."));
      image.src = url;
    });
    return {
      source: element,
      width: element.naturalWidth,
      height: element.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function createContext(width: number, height: number): Canvas2D {
  if (typeof OffscreenCanvas === "function") {
    const context = new OffscreenCanvas(width, height).getContext("2d", {
      willReadFrequently: true,
    });
    if (context) return context;
  }
  if (typeof document === "undefined") {
    throw new Error("Image conversion needs a browser canvas, which is unavailable here.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Could not get a 2D canvas context to convert this photo.");
  }
  return context;
}

/**
 * Decode `blob` and, if its long edge exceeds `maxLongEdge`, downscale it
 * (SPEC §8). Returns raw RGBA pixels ready for `renderLineArt`.
 *
 * Aspect ratio is preserved and the result is at least 1x1. An image already
 * within the cap is returned at its native size, not upscaled.
 *
 * @throws a message-bearing Error the caller can show the user — the file was
 * not a decodable image, or no canvas was available.
 */
export async function downscaleToMax(
  blob: Blob,
  maxLongEdge: number = MAX_LONG_EDGE,
): Promise<PixelBuffer> {
  const cap = Number.isFinite(maxLongEdge) && maxLongEdge > 0 ? maxLongEdge : MAX_LONG_EDGE;
  const decoded = await decodeBlob(blob);
  try {
    const longEdge = Math.max(decoded.width, decoded.height);
    if (longEdge === 0) {
      throw new Error("That image has no pixels.");
    }
    const scale = longEdge > cap ? cap / longEdge : 1;
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));

    const context = createContext(width, height);
    context.drawImage(decoded.source, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  } finally {
    decoded.release();
  }
}
