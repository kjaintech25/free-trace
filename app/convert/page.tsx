"use client";

/**
 * Convert — `/convert` (SPEC §6.2, ticket T-07).
 *
 * Reached either from the library's "+ Add photo" (a pending import stashed
 * in `lib/pendingImport.ts`) or from a saved reference's "Re-tune" action
 * (`?ref=<id>`). Decodes the source once, keeps a PRISTINE copy of its pixels
 * (the worker client detaches whatever buffer it's handed — see
 * `lib/edgesClient.ts`), and re-converts a fresh copy on every settings
 * change, debounced so the slider stays smooth.
 *
 * `useSearchParams` requires a `<Suspense>` boundary for the static build
 * (Next.js), hence the wrapper default export below.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, IconButton, Slider } from "@/components/ui";
import {
  DEFAULT_LINE_ART_SETTINGS,
  EDGE_STRENGTH_RANGE,
  MAX_LONG_EDGE,
  THICKNESS_RANGE,
  THRESHOLD_RANGE,
  normaliseLineArtSettings,
  type LineArtSettings,
  type PixelBuffer,
} from "@/lib/edges";
import { renderLineArtAsync, terminateLineArtWorker } from "@/lib/edgesClient";
import { downscaleToMax } from "@/lib/image";
import { takePendingImport } from "@/lib/pendingImport";
import { readPreferences } from "@/lib/preferences";
import { getReference, saveReference, updateReference } from "@/lib/storage";
import { usePhotoPicker } from "@/lib/usePhotoPicker";

/** Settle window (SPEC §6.2: preview updates within ~150ms of a slider settling). */
const DEBOUNCE_MS = 120;

/** Where this screen's source came from, and how "Save" should behave. */
type EntryMode =
  | { kind: "new"; originalImage: Blob; thumbnail: Blob }
  | { kind: "retune"; refId: string; originalImage: Blob };

export default function ConvertPage() {
  return (
    <Suspense fallback={null}>
      <ConvertScreen />
    </Suspense>
  );
}

function ConvertScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [entry, setEntry] = useState<EntryMode | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [loadingEntry, setLoadingEntry] = useState(true);

  const [settings, setSettings] = useState<LineArtSettings | null>(null);
  const [lineArt, setLineArt] = useState<PixelBuffer | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);

  const [comparing, setComparing] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The pristine, never-transferred source pixels. A ref, not state: it never
  // needs to trigger a render on its own, only the settings/entry it is
  // derived alongside.
  const sourceRef = useRef<PixelBuffer | null>(null);
  const requestIdRef = useRef(0);

  // -------------------------------------------------------------------------
  // Entry: pending import, or a `?ref=` re-tune.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const pending = takePendingImport();
      if (pending) {
        try {
          const pixels = await downscaleToMax(pending.original, MAX_LONG_EDGE);
          if (cancelled) return;
          sourceRef.current = pixels;
          setEntry({
            kind: "new",
            originalImage: pending.original,
            thumbnail: pending.thumbnail,
          });
          setSettings(DEFAULT_LINE_ART_SETTINGS);
        } catch (error) {
          if (cancelled) return;
          setEntryError(
            error instanceof Error
              ? error.message
              : "That photo could not be prepared for conversion.",
          );
        } finally {
          if (!cancelled) setLoadingEntry(false);
        }
        return;
      }

      const refId = searchParams.get("ref");
      if (refId) {
        const result = await getReference(refId);
        if (cancelled) return;
        if (!result.ok) {
          setEntryError(result.error.message);
          setLoadingEntry(false);
          return;
        }
        try {
          const pixels = await downscaleToMax(result.value.originalImage, MAX_LONG_EDGE);
          if (cancelled) return;
          sourceRef.current = pixels;
          setEntry({
            kind: "retune",
            refId,
            originalImage: result.value.originalImage,
          });
          setSettings(normaliseLineArtSettings(result.value.settings));
        } catch (error) {
          if (cancelled) return;
          setEntryError(
            error instanceof Error
              ? error.message
              : "That reference's photo could not be reloaded.",
          );
        } finally {
          if (!cancelled) setLoadingEntry(false);
        }
        return;
      }

      if (!cancelled) setLoadingEntry(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
    // Intentionally runs once: `takePendingImport` is a one-time hand-off and
    // must not be re-drained on an unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Terminate the worker when this screen goes away.
  // -------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      terminateLineArtWorker();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Compare original object URL — derived from the entry, not stored as its
  // own state (that would mean calling setState from inside an effect).
  // -------------------------------------------------------------------------
  const originalUrl = useMemo(
    () => (entry ? URL.createObjectURL(entry.originalImage) : null),
    [entry],
  );
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    };
  }, [originalUrl]);

  // -------------------------------------------------------------------------
  // Conversion: debounced ~120ms after the last settings change, including
  // the very first run once the source is ready. Stale responses (a newer
  // request was issued before this one resolved) are dropped.
  // -------------------------------------------------------------------------
  const convert = useCallback(async (currentSettings: LineArtSettings, src: PixelBuffer) => {
    const id = ++requestIdRef.current;
    try {
      // A fresh copy every time: `renderLineArtAsync` transfers (detaches)
      // whatever buffer it's handed, so the pristine source must never be
      // passed directly (lib/edgesClient.ts's own doc comment).
      const result = await renderLineArtAsync(
        { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) },
        currentSettings,
      );
      if (id !== requestIdRef.current) return; // superseded by a newer request
      setLineArt(result);
      setConvertError(null);
    } catch (error) {
      if (id !== requestIdRef.current) return;
      setConvertError(
        error instanceof Error ? error.message : "That photo could not be converted.",
      );
    }
  }, []);

  useEffect(() => {
    if (!settings || !sourceRef.current) return;
    const src = sourceRef.current;
    const snapshot = settings;
    const timer = window.setTimeout(() => {
      void convert(snapshot, src);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [settings, convert]);

  // -------------------------------------------------------------------------
  // Paint the current line art. The canvas keeps showing the previous frame
  // until a new one lands — never cleared while a conversion is in flight.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!lineArt || !canvasRef.current) return;
    const canvas = canvasRef.current;
    if (canvas.width !== lineArt.width) canvas.width = lineArt.width;
    if (canvas.height !== lineArt.height) canvas.height = lineArt.height;
    const ctx = canvas.getContext("2d");
    // jsdom (the test environment) has no `ImageData` global at all; a real
    // browser always does. Guarding rather than importing a polyfill keeps
    // this file dependency-free for a gap that is purely a test-harness one.
    if (!ctx || typeof ImageData === "undefined") return;
    // `Uint8ClampedArray`'s buffer is typed `ArrayBufferLike` (it could be a
    // SharedArrayBuffer); re-wrapping guarantees a plain `ArrayBuffer`-backed
    // array, which is what `ImageData`'s constructor requires.
    const imageData = new ImageData(
      new Uint8ClampedArray(lineArt.data),
      lineArt.width,
      lineArt.height,
    );
    ctx.putImageData(imageData, 0, 0);
  }, [lineArt]);

  function updateSetting<K extends keyof LineArtSettings>(key: K, value: LineArtSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  // -------------------------------------------------------------------------
  // Back (FTA-018): nothing here is saved. A new import simply returns to
  // the library — there was never anything persisted to undo. A re-tune
  // returns to the trace screen it came from, leaving the stored reference
  // exactly as it was (no updateReference call).
  // -------------------------------------------------------------------------
  function handleBack() {
    if (!entry) return;
    if (entry.kind === "retune") {
      router.push(`/trace/${entry.refId}`);
      return;
    }
    router.push("/");
  }

  // -------------------------------------------------------------------------
  // "Choose a different photo" (FTA-018): swaps the source in place — no
  // navigation, no pendingImport hand-off (this bypasses that module
  // entirely; it's for the one-time import->convert hop, not an in-place
  // swap). The four controls reset to engine defaults and a fresh
  // conversion is requested through the same debounced effect a slider
  // change uses, by changing `settings` (its identity, not just a field).
  // -------------------------------------------------------------------------
  const { inputRef: photoPickerInputRef, handleChange: handlePhotoPickerChange, openPicker, error: photoPickerError } =
    usePhotoPicker({
      onPicked: (image) => {
        void (async () => {
          setConvertError(null);
          try {
            const pixels = await downscaleToMax(image.original, MAX_LONG_EDGE);
            sourceRef.current = pixels;
            setEntry((previous) => {
              if (!previous) return previous;
              if (previous.kind === "new") {
                return { kind: "new", originalImage: image.original, thumbnail: image.thumbnail };
              }
              return { kind: "retune", refId: previous.refId, originalImage: image.original };
            });
            setSettings(DEFAULT_LINE_ART_SETTINGS);
          } catch (error) {
            setConvertError(
              error instanceof Error
                ? error.message
                : "That photo could not be prepared for conversion.",
            );
          }
        })();
      },
    });

  function encodePng(canvas: HTMLCanvasElement): Promise<Blob | null> {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    });
  }

  async function handleSave() {
    if (!entry || !settings || !canvasRef.current) return;
    setSaving(true);
    setSaveError(null);

    const png = await encodePng(canvasRef.current);
    if (!png) {
      setSaveError("That line art could not be encoded. Please try again.");
      setSaving(false);
      return;
    }

    if (entry.kind === "new") {
      const { defaultOpacity } = await readPreferences();
      const result = await saveReference({
        name: "Untitled",
        originalImage: entry.originalImage,
        lineArtImage: png,
        thumbnail: entry.thumbnail,
        settings,
        lastOpacity: defaultOpacity,
      });
      if (result.ok) {
        router.push(`/trace/${result.value.id}`);
        return;
      }
      setSaveError(result.error.message);
      setSaving(false);
      return;
    }

    const result = await updateReference(entry.refId, { lineArtImage: png, settings });
    if (result.ok) {
      router.push(`/trace/${entry.refId}`);
      return;
    }
    setSaveError(result.error.message);
    setSaving(false);
  }

  // -------------------------------------------------------------------------
  // Empty / error state — nothing to convert.
  // -------------------------------------------------------------------------
  if (!loadingEntry && !entry) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-text">
        <p className="text-sm text-text-muted">
          {entryError ?? "Nothing to convert. Pick a photo from the library first."}
        </p>
        <Button onClick={() => router.push("/")}>Back to library</Button>
      </main>
    );
  }

  if (loadingEntry || !settings) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg text-text">
        <p className="text-sm text-text-muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-dvh flex-col bg-bg text-text">
      <IconButton
        aria-label="Back"
        onClick={handleBack}
        className="absolute left-[calc(var(--safe-left)+1rem)] top-[calc(var(--safe-top)+1rem)] z-10 bg-surface/80 backdrop-blur-md"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 6 9 12l6 6" />
        </svg>
      </IconButton>

      <div className="flex flex-1 items-center justify-center p-4">
        <div
          className="relative aspect-square w-full max-w-md overflow-hidden rounded-xl bg-black"
          style={{ touchAction: "none" }}
          onPointerDown={() => setComparing(true)}
          onPointerUp={() => setComparing(false)}
          onPointerCancel={() => setComparing(false)}
          onPointerLeave={() => setComparing(false)}
        >
          <canvas ref={canvasRef} className="h-full w-full object-contain" />
          {comparing && originalUrl && (
            // An object URL blob preview has no business going through
            // next/image's remote loader pipeline.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={originalUrl}
              alt="Original photo"
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
        </div>
      </div>

      {convertError && (
        <p className="px-4 text-center text-sm text-text-muted">{convertError}</p>
      )}
      {saveError && <p className="px-4 text-center text-sm text-text-muted">{saveError}</p>}
      {photoPickerError && (
        <p className="px-4 text-center text-sm text-text-muted">{photoPickerError}</p>
      )}

      <div
        className="flex flex-col gap-4 rounded-t-xl bg-surface p-4"
        style={{ paddingBottom: "calc(1rem + var(--safe-bottom))" }}
      >
        <Slider
          label="Edge strength"
          value={settings.edgeStrength}
          min={EDGE_STRENGTH_RANGE.min}
          max={EDGE_STRENGTH_RANGE.max}
          step={EDGE_STRENGTH_RANGE.step}
          onChange={(value) => updateSetting("edgeStrength", value)}
        />
        <Slider
          label="Threshold"
          value={settings.threshold}
          min={THRESHOLD_RANGE.min}
          max={THRESHOLD_RANGE.max}
          step={THRESHOLD_RANGE.step}
          onChange={(value) => updateSetting("threshold", value)}
        />
        <Slider
          label="Line thickness"
          unit=""
          value={settings.thickness}
          min={THICKNESS_RANGE.min}
          max={THICKNESS_RANGE.max}
          step={THICKNESS_RANGE.step}
          onChange={(value) => updateSetting("thickness", value)}
        />
        <div className="flex items-center justify-between gap-3">
          <Button
            variant={settings.inverted ? "primary" : "quiet"}
            aria-pressed={settings.inverted}
            onClick={() => updateSetting("inverted", !settings.inverted)}
          >
            Invert
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save to library"}
          </Button>
        </div>

        <Button variant="quiet" onClick={openPicker}>
          Choose a different photo
        </Button>
        <input
          ref={photoPickerInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoPickerChange}
        />
      </div>
    </main>
  );
}
