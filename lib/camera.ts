/**
 * Camera acquisition for the Trace screen (SPEC §6.3, hazards §10.1–§10.4).
 *
 * Deliberately React-free: every platform decision that can go wrong on iOS
 * lives here as a plain function, so it is unit-testable in jsdom against a
 * mocked `navigator.mediaDevices`. The component (components/CameraFeed.tsx)
 * only owns the element, the state machine and the copy.
 */

/** Lifecycle of the feed. Every one of these renders something the user can
 *  act on — SPEC §9: never a blank screen. */
export type CameraStatus =
  | "idle"
  | "starting"
  | "live"
  | "denied"
  | "unavailable"
  | "ended";

export type UnavailableReason =
  | "insecure-origin"
  | "no-camera"
  | "in-use"
  | "unknown";

export type CameraFailure =
  | { status: "denied" }
  | { status: "unavailable"; reason: UnavailableReason };

/** Which physical camera is requested/resolved. Mirrors the W3C `facingMode`
 *  values Free Trace actually uses — no `left`/`right`. */
export type CameraFacing = "environment" | "user";

export type CameraStartResult =
  | {
      ok: true;
      stream: MediaStream;
      usedExactFallback: boolean;
      /** From `track.getSettings().facingMode`; `"unknown"` when the browser
       *  did not report one (some do not). */
      resolvedFacing: CameraFacing | "unknown";
    }
  | { ok: false; failure: CameraFailure };

/** SPEC §10.2: ask for the rear camera as a *preference* first. `ideal` never
 *  rejects, so this is the request that is most likely to hand back something. */
export const IDEAL_ENVIRONMENT: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" } },
  audio: false,
};

/** The one retry we make when `ideal` was ignored and we got the selfie camera.
 *  `exact` *can* reject — that rejection is handled, never surfaced. */
export const EXACT_ENVIRONMENT: MediaStreamConstraints = {
  video: { facingMode: { exact: "environment" } },
  audio: false,
};

/** Symmetric pair for the front (selfie) camera — same ideal→exact shape. */
export const IDEAL_USER: MediaStreamConstraints = {
  video: { facingMode: { ideal: "user" } },
  audio: false,
};

export const EXACT_USER: MediaStreamConstraints = {
  video: { facingMode: { exact: "user" } },
  audio: false,
};

export const AUTOSTART_KEY = "freetrace:camera-autostart";

type GetUserMedia = (
  constraints: MediaStreamConstraints,
) => Promise<MediaStream>;

/**
 * `navigator.mediaDevices` is `undefined` — not empty — on insecure origins
 * and in browsers without the API at all (SPEC §10.1). Returning null rather
 * than throwing keeps the caller's control flow linear.
 */
function resolveGetUserMedia(): GetUserMedia | null {
  if (typeof navigator === "undefined") return null;
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  if (!devices || typeof devices.getUserMedia !== "function") return null;
  return devices.getUserMedia.bind(devices);
}

/**
 * Map a getUserMedia rejection onto a state the UI has copy for.
 *
 * Duck-types `name` rather than testing `instanceof Error`: browsers reject
 * with a `DOMException`, which is not an `Error` subclass everywhere.
 */
export function classifyCameraError(error: unknown): CameraFailure {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return { status: "denied" };
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return { status: "unavailable", reason: "no-camera" };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return { status: "unavailable", reason: "in-use" };
    default:
      return { status: "unavailable", reason: "unknown" };
  }
}

/** True when the stream we were handed is the front (selfie) camera. */
export function isFrontFacing(stream: MediaStream): boolean {
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.getSettings !== "function") return false;
  return track.getSettings().facingMode === "user";
}

/**
 * True only when the browser told us it gave us the *other* camera than the
 * one we asked for. An unreported (or unreadable) `facingMode` is treated as
 * "close enough" — same policy `isFrontFacing` already used for the
 * environment case, generalised to both directions so `startCamera` behaves
 * identically for 'environment' as `startRearCamera` always did.
 */
function isWrongFacing(stream: MediaStream, desired: CameraFacing): boolean {
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.getSettings !== "function") return false;
  const opposite: CameraFacing = desired === "environment" ? "user" : "environment";
  return track.getSettings().facingMode === opposite;
}

/** From `track.getSettings().facingMode`, narrowed to the two values Free
 *  Trace cares about; anything else (including unset) is `"unknown"`. */
function resolveFacingFromStream(stream: MediaStream): CameraFacing | "unknown" {
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.getSettings !== "function") return "unknown";
  const facingMode = track.getSettings().facingMode;
  return facingMode === "user" || facingMode === "environment"
    ? facingMode
    : "unknown";
}

/** Release the hardware. Safe to call with null and safe to call twice. */
export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/**
 * Fire `onEnded` if any track dies on its own — another app grabbing the
 * camera, or the OS revoking it. Returns an unsubscribe function.
 */
export function watchStreamEnd(
  stream: MediaStream,
  onEnded: () => void,
): () => void {
  const tracks = stream.getTracks();
  for (const track of tracks) {
    track.addEventListener("ended", onEnded);
  }
  return () => {
    for (const track of tracks) {
      track.removeEventListener("ended", onEnded);
    }
  };
}

/**
 * Acquire a camera, with the SPEC §10.2 ideal→exact fallback, generalised
 * to either physical camera.
 *
 * 1. Ask with `ideal: <facing>`.
 * 2. If the resolved track reports the *other* camera, ask once more with
 *    `exact: <facing>`.
 * 3. If that second request is refused, keep the first stream. The user gets
 *    a working (if wrong-facing) feed rather than nothing.
 *
 * Never throws: failures come back as a `CameraFailure` the UI has copy for.
 * For `facing: 'environment'` this is byte-for-byte the same request shapes
 * and fallback behaviour `startRearCamera` always had.
 */
export async function startCamera(
  facing: CameraFacing,
): Promise<CameraStartResult> {
  const getUserMedia = resolveGetUserMedia();
  if (!getUserMedia) {
    return {
      ok: false,
      failure: { status: "unavailable", reason: "insecure-origin" },
    };
  }

  const idealConstraints =
    facing === "environment" ? IDEAL_ENVIRONMENT : IDEAL_USER;
  const exactConstraints =
    facing === "environment" ? EXACT_ENVIRONMENT : EXACT_USER;

  let stream: MediaStream;
  try {
    stream = await getUserMedia(idealConstraints);
  } catch (error) {
    return { ok: false, failure: classifyCameraError(error) };
  }

  if (!isWrongFacing(stream, facing)) {
    return {
      ok: true,
      stream,
      usedExactFallback: false,
      resolvedFacing: resolveFacingFromStream(stream),
    };
  }

  try {
    const exactStream = await getUserMedia(exactConstraints);
    stopStream(stream);
    return {
      ok: true,
      stream: exactStream,
      usedExactFallback: true,
      resolvedFacing: resolveFacingFromStream(exactStream),
    };
  } catch {
    // No camera the device is willing to give us under `exact`. Keeping the
    // wrong-facing stream is strictly better than a dead screen.
    return {
      ok: true,
      stream,
      usedExactFallback: false,
      resolvedFacing: resolveFacingFromStream(stream),
    };
  }
}

/** Thin alias kept for callers and tests written against the rear-only API. */
export async function startRearCamera(): Promise<CameraStartResult> {
  return startCamera("environment");
}

/**
 * Has the user already started the camera in this browsing session? If so the
 * screen may skip the "Start camera" gesture — permission is already granted,
 * so no prompt is being dodged (SPEC §10.4).
 */
export function shouldAutoStart(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(AUTOSTART_KEY) === "1";
  } catch {
    // Private browsing / storage disabled: fall back to the explicit button.
    return false;
  }
}

/** Remember a *successful* start, so re-entering the screen is one tap shorter. */
export function rememberAutoStart(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(AUTOSTART_KEY, "1");
  } catch {
    // Storage is a convenience here; the button path still works without it.
  }
}
