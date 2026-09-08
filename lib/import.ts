/**
 * lib/import.ts — photo import and thumbnailing (SPEC §5, §6.1; T-04).
 *
 * Pipeline: system photo picker hands us a `File` -> decode it with EXIF
 * orientation applied by the browser -> optionally downscale an oversized
 * source -> produce a small JPEG thumbnail -> hand all three back to the
 * caller (which stashes them in `lib/pendingImport.ts` for `/convert`, a
 * later ticket, to pick up).
 *
 * No DOM component here — this is pure browser-API glue, unit-testable for
 * its decision logic (see `needsDownscale` / `fitWithin`) even though the
 * canvas/createImageBitmap parts themselves need a real browser and are
 * exercised through mocking in component tests instead.
 *
 * Never throws: every exported entry point returns an `ImportResult`.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Long edge above which a source photo is downscaled before storage. */
export const MAX_LONG_EDGE = 4096;
/** File size above which a source photo is downscaled, regardless of pixels. */
export const MAX_BYTES = 25 * 1024 * 1024; // ~25MB
/** Long edge of the generated thumbnail (SPEC §5). */
export const THUMBNAIL_LONG_EDGE = 400;

const DOWNSCALE_QUALITY = 0.92;
const THUMBNAIL_QUALITY = 0.8;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ImportedImage {
  /** The (possibly downscaled) decoded photo, ready to hand to /convert. */
  original: Blob;
  width: number;
  height: number;
  /** JPEG, long edge <= THUMBNAIL_LONG_EDGE. */
  thumbnail: Blob;
}

export type ImportErrorKind = "unsupported" | "decode-failed" | "unknown";

export interface ImportError {
  kind: ImportErrorKind;
  /** Plain English, safe to render to the user as-is. */
  message: string;
}

export type ImportResult =
  | { ok: true; value: ImportedImage }
  | { ok: false; error: ImportError };

function ok(value: ImportedImage): ImportResult {
  return { ok: true, value };
}

function fail(kind: ImportErrorKind, message: string): ImportResult {
  return { ok: false, error: { kind, message } };
}

// ---------------------------------------------------------------------------
// Pure decision logic — unit-testable without a browser (jsdom has no
// canvas/createImageBitmap at all, so anything DOM-dependent is exercised
// through mocking in component tests instead; these two functions carry all
// the actual "what number do we pick" logic and need no DOM to test).
// ---------------------------------------------------------------------------

/**
 * Whether a decoded source needs downscaling before it is kept as `original`
 * (SPEC: files over ~25MB or long edge over 4096px are downscaled, never
 * rejected).
 */
export function needsDownscale(input: {
  width: number;
  height: number;
  bytes: number;
}): boolean {
  const longEdge = Math.max(input.width, input.height);
  return longEdge > MAX_LONG_EDGE || input.bytes > MAX_BYTES;
}

/**
 * Given a source size, returns the integer dimensions that fit within
 * `maxLongEdge` on the long edge, preserving aspect ratio. A source already
 * within the limit is returned unchanged (never upscaled).
 */
export function fitWithin(
  size: { width: number; height: number },
  maxLongEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(size.width, size.height);
  if (longEdge <= maxLongEdge) {
    return { width: size.width, height: size.height };
  }
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/**
 * Decodes `file` into a bitmap with EXIF orientation applied so an iPhone
 * portrait photo comes out upright rather than sideways.
 *
 * Primary path: `createImageBitmap(file, { imageOrientation: "from-image" })`.
 * This is the modern, correct path — the browser reads the EXIF orientation
 * tag and rotates/flips the decoded pixels accordingly, so nothing downstream
 * (canvas draws, thumbnailing) has to know about orientation at all.
 *
 * Fallback: if `imageOrientation` is not a supported option on this browser
 * (older Safari/Chrome), we fall back to decoding via an `<img>` element and
 * drawing it to a canvas. Current Safari and Chrome apply EXIF orientation to
 * `<img>` decoding by default even without any option, so this fallback still
 * produces an upright image on those browsers — it is `createImageBitmap`
 * *without* the option that would NOT honour EXIF, which is why the primary
 * path passes the option explicitly rather than relying on the fallback.
 */
async function decodeOriented(
  file: File,
): Promise<{ bitmap: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return { bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // Either the option isn't supported, or this particular file failed to
      // decode via createImageBitmap. Fall through to the <img> path, which
      // covers browsers without the option and lets a genuine decode failure
      // surface from the <img> attempt with its own error handling.
    }
  }
  return decodeViaImgElement(file);
}

function decodeViaImgElement(
  file: File,
): Promise<{ bitmap: CanvasImageSource; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        bitmap: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("<img> decode failed"));
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

interface DrawableCanvas {
  getContext(id: "2d"): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  convertToBlob?(opts: { type: string; quality: number }): Promise<Blob>;
}

function makeCanvas(width: number, height: number): DrawableCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height) as unknown as DrawableCanvas;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as DrawableCanvas;
}

function canvasToBlob(
  canvas: DrawableCanvas,
  type: string,
  quality: number,
): Promise<Blob> {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    const el = canvas as unknown as HTMLCanvasElement;
    el.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas.toBlob returned null"));
      },
      type,
      quality,
    );
  });
}

function drawResized(
  source: CanvasImageSource,
  targetWidth: number,
  targetHeight: number,
): DrawableCanvas {
  const canvas = makeCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  // Both CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D share
  // this drawImage overload; the cast is needed because TS can't unify the
  // two context types' drawImage signatures structurally.
  (ctx as CanvasRenderingContext2D).drawImage(
    source,
    0,
    0,
    targetWidth,
    targetHeight,
  );
  return canvas;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Imports a photo picked from the system photo picker: decodes it with EXIF
 * orientation applied, downscales it if it's oversized, and produces a
 * thumbnail. Never throws.
 */
export async function importPhoto(file: File): Promise<ImportResult> {
  if (!file.type.startsWith("image/")) {
    return fail(
      "unsupported",
      "That file isn't a photo. Pick an image from your library.",
    );
  }

  let decoded: { bitmap: CanvasImageSource; width: number; height: number };
  try {
    decoded = await decodeOriented(file);
  } catch {
    return fail(
      "decode-failed",
      "This photo's format isn't supported on this device. Try a different photo, or re-save it as JPEG or PNG first.",
    );
  }

  const { bitmap, width, height } = decoded;

  try {
    let original: Blob;
    let outWidth = width;
    let outHeight = height;

    if (needsDownscale({ width, height, bytes: file.size })) {
      const fitted = fitWithin({ width, height }, MAX_LONG_EDGE);
      outWidth = fitted.width;
      outHeight = fitted.height;
      const canvas = drawResized(bitmap, outWidth, outHeight);
      original = await canvasToBlob(canvas, "image/jpeg", DOWNSCALE_QUALITY);
    } else {
      original = file;
    }

    const thumbSize = fitWithin(
      { width: outWidth, height: outHeight },
      THUMBNAIL_LONG_EDGE,
    );
    const thumbCanvas = drawResized(bitmap, thumbSize.width, thumbSize.height);
    const thumbnail = await canvasToBlob(
      thumbCanvas,
      "image/jpeg",
      THUMBNAIL_QUALITY,
    );

    return ok({ original, width: outWidth, height: outHeight, thumbnail });
  } catch {
    return fail(
      "unknown",
      "Something went wrong preparing that photo. Please try again.",
    );
  } finally {
    if (typeof ImageBitmap !== "undefined" && bitmap instanceof ImageBitmap) {
      bitmap.close();
    }
  }
}
