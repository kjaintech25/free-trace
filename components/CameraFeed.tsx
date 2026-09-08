"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import {
  rememberAutoStart,
  shouldAutoStart,
  startCamera,
  stopStream,
  watchStreamEnd,
  type CameraFacing,
  type CameraStartResult,
  type UnavailableReason,
} from "@/lib/camera";

type FeedState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "live" }
  | { status: "denied" }
  | { status: "ended" }
  | { status: "unavailable"; reason: UnavailableReason };

type LiveCameraStartResult = Extract<CameraStartResult, { ok: true }>;

/** How long the "Only one camera available" notice stays up (FTA-019). */
const FLIP_NOTICE_MS = 3000;

const UNAVAILABLE_COPY: Record<UnavailableReason, string> = {
  "insecure-origin":
    "This page is not on a secure (https) connection, so the browser will not hand over the camera. Open Free Trace over https.",
  "no-camera":
    "No camera was found on this device. Free Trace needs a rear camera to trace over.",
  "in-use":
    "The camera is busy in another app or browser tab. Close that, then try again.",
  unknown: "The camera could not be started. This is often temporary.",
};

function Panel({
  title,
  body,
  actionLabel,
  onAction,
  hint,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  hint?: ReactNode;
}) {
  // z-20 puts the failure copy above the T-09 overlay slot (z-10) so its action
  // stays tappable, and level with the close button, which is later in the DOM
  // and so stays reachable on top of it.
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-bg/95 px-8 text-center"
    >
      <p className="font-sans text-base font-medium text-text">{title}</p>
      <p className="max-w-xs font-sans text-sm text-text-muted">{body}</p>
      {actionLabel ? <Button onClick={onAction}>{actionLabel}</Button> : null}
      {hint ? (
        <p className="max-w-xs font-sans text-xs text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

function StatePanel({
  state,
  onStart,
}: {
  state: FeedState;
  onStart: () => void;
}) {
  switch (state.status) {
    case "live":
      return null;

    case "idle":
      // SPEC §10.4: attaching the stream behind a tap gives the permission
      // prompt a user gesture, which is what iOS Safari wants.
      return (
        <Panel
          title="Camera off"
          body="Free Trace uses your rear camera to show the paper under your line art. Nothing is recorded and nothing leaves this device."
          actionLabel="Start camera"
          onAction={onStart}
        />
      );

    case "starting":
      return (
        <Panel
          title="Starting camera…"
          body="If your browser asks for permission, choose Allow."
        />
      );

    case "denied":
      return (
        <Panel
          title="Camera access was blocked"
          body="Free Trace cannot show the paper without the camera. Nothing is recorded and nothing leaves this device."
          actionLabel="Try again"
          onAction={onStart}
          hint="On iPhone, if this keeps failing: Settings → Safari → Camera → Allow."
        />
      );

    case "unavailable":
      return (
        <Panel
          title="Camera unavailable"
          body={UNAVAILABLE_COPY[state.reason]}
          actionLabel="Try again"
          onAction={onStart}
        />
      );

    case "ended":
      return (
        <Panel
          title="Camera stopped"
          body="The feed ended unexpectedly — another app may have taken the camera."
          actionLabel="Restart"
          onAction={onStart}
        />
      );
  }
}

export interface CameraFeedProps {
  /** Which physical camera to request (FTA-019). Defaults to the rear
   *  camera — unchanged behaviour for every caller that doesn't pass this. */
  facing?: CameraFacing;
  /** Fires once a stream is live, with the camera the browser actually gave
   *  us (never `"unknown"` outward — falls back to the requested facing when
   *  the browser didn't report one). */
  onResolvedFacing?: (facing: CameraFacing) => void;
}

/**
 * The live rear-camera feed for the Trace screen (SPEC §6.3).
 *
 * Full-bleed and `object-fit: cover`, so the feed fills the viewport at its
 * real aspect ratio — cropped, never letterboxed and never stretched. The
 * overlay, opacity, gestures and wake lock are later tickets (T-09/T-10/T-11).
 *
 * `facing` (FTA-019): changing it while live stops the current tracks and
 * starts the new camera, staying in the same six-state machine (transiently
 * "starting"). If the new camera can't be found (`OverconstrainedError` /
 * `NotFoundError` — both map to `classifyCameraError`'s `"no-camera"`), the
 * previous camera is restarted rather than leaving the screen dead, and a
 * brief muted notice is shown instead of the full failure panel.
 */
export function CameraFeed({
  facing = "environment",
  onResolvedFacing,
}: CameraFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const unwatchRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  // Guards against a slow getUserMedia resolving after a newer start()/
  // switchFacing(), or after unmount — either would leak a live camera.
  const startTokenRef = useRef(0);
  // The last `facing` prop value this component actually acted on — used as
  // "the camera we had before this switch" when a flip needs to be undone.
  const previousFacingRef = useRef(facing);
  const [state, setState] = useState<FeedState>({ status: "idle" });
  const [resolvedFacing, setResolvedFacing] = useState<CameraFacing | "unknown">(
    "unknown",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read from event handlers/effects, never from render — keeps the
  // facing-change effect below able to see the current status without
  // depending on `state` (which would fire it for unrelated state changes).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const releaseStream = useCallback(() => {
    unwatchRef.current?.();
    unwatchRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }, []);

  const showNotice = useCallback((message: string) => {
    if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = setTimeout(() => {
      setNotice(null);
    }, FLIP_NOTICE_MS);
  }, []);

  const attachStream = useCallback(
    (result: LiveCameraStartResult, token: number, requestedFacing: CameraFacing) => {
      streamRef.current = result.stream;
      unwatchRef.current = watchStreamEnd(result.stream, () => {
        if (!mountedRef.current) return;
        releaseStream();
        setState({ status: "ended" });
      });

      const video = videoRef.current;
      if (video) {
        video.srcObject = result.stream;
        void video.play().catch(() => {
          // Autoplay can reject if the page is backgrounded mid-start. The
          // stream is live and the `autoPlay` attribute picks it up on
          // return, so this is not a failure state.
        });
      }

      if (!mountedRef.current || token !== startTokenRef.current) return;
      rememberAutoStart();
      const resolved =
        result.resolvedFacing === "unknown" ? requestedFacing : result.resolvedFacing;
      setResolvedFacing(result.resolvedFacing);
      onResolvedFacing?.(resolved);
      setState({ status: "live" });
    },
    [releaseStream, onResolvedFacing],
  );

  const start = useCallback(async () => {
    const token = ++startTokenRef.current;
    releaseStream();
    setState({ status: "starting" });

    const result = await startCamera(facing);

    if (!mountedRef.current || token !== startTokenRef.current) {
      if (result.ok) stopStream(result.stream);
      return;
    }

    if (!result.ok) {
      setState(
        result.failure.status === "denied"
          ? { status: "denied" }
          : { status: "unavailable", reason: result.failure.reason },
      );
      return;
    }

    attachStream(result, token, facing);
  }, [facing, releaseStream, attachStream]);

  // Restart the camera we had running before a flip that could not be
  // satisfied — a one-camera device is never left with a dead screen.
  const restartAfterFailedSwitch = useCallback(
    async (fallbackFacing: CameraFacing, token: number) => {
      const result = await startCamera(fallbackFacing);

      if (!mountedRef.current || token !== startTokenRef.current) {
        if (result.ok) stopStream(result.stream);
        return;
      }

      if (!result.ok) {
        // The previous camera failing too is rare and outside the scope of
        // "only one camera" — surface the normal failure panel.
        setState(
          result.failure.status === "denied"
            ? { status: "denied" }
            : { status: "unavailable", reason: result.failure.reason },
        );
        return;
      }

      attachStream(result, token, fallbackFacing);
      showNotice("Only one camera available");
    },
    [attachStream, showNotice],
  );

  const switchFacing = useCallback(
    async (nextFacing: CameraFacing, fallbackFacing: CameraFacing) => {
      const token = ++startTokenRef.current;
      releaseStream();
      setState({ status: "starting" });

      const result = await startCamera(nextFacing);

      if (!mountedRef.current || token !== startTokenRef.current) {
        if (result.ok) stopStream(result.stream);
        return;
      }

      if (!result.ok) {
        if (
          result.failure.status === "unavailable" &&
          result.failure.reason === "no-camera"
        ) {
          await restartAfterFailedSwitch(fallbackFacing, token);
          return;
        }
        setState(
          result.failure.status === "denied"
            ? { status: "denied" }
            : { status: "unavailable", reason: result.failure.reason },
        );
        return;
      }

      attachStream(result, token, nextFacing);
    },
    [releaseStream, attachStream, restartAfterFailedSwitch],
  );

  const handleStart = useCallback(() => {
    void start();
  }, [start]);

  // Flip while live: stop the old tracks and start the new camera. A flip
  // while idle/starting/failed just changes what the *next* start() call
  // (button tap, autostart, retry) will ask for — nothing to tear down yet.
  useEffect(() => {
    const fallbackFacing = previousFacingRef.current;
    previousFacingRef.current = facing;
    if (facing === fallbackFacing) return;
    if (stateRef.current.status !== "live") return;
    void switchFacing(facing, fallbackFacing);
  }, [facing, switchFacing]);

  useEffect(() => {
    mountedRef.current = true;

    // Deferred by a microtask on purpose: start() sets state on its first
    // line, and calling it straight from the effect body cascades a render
    // (react-hooks/set-state-in-effect). The user-visible behaviour is
    // identical — this still runs before the first paint.
    if (shouldAutoStart()) {
      queueMicrotask(() => {
        if (mountedRef.current) void start();
      });
    }

    // Navigating away, backgrounding into the bfcache, or closing the tab:
    // hand the camera back rather than holding the indicator light on.
    const handlePageHide = () => {
      releaseStream();
      startTokenRef.current += 1;
      setState({ status: "idle" });
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", handlePageHide);
      releaseStream();
      if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: `start` closes over the facing prop's value at mount time, which is what autostart should use.
  }, []);

  const effectiveFacing: CameraFacing =
    resolvedFacing === "unknown" ? facing : resolvedFacing;
  const mirrored = effectiveFacing === "user";

  return (
    <div className="absolute inset-0 overflow-hidden bg-bg">
      {/*
        playsInline keeps iOS Safari from taking the video fullscreen; muted is
        what makes autoplay legal at all; autoPlay covers the resume-after-
        background case. There is no fullscreen API call anywhere in this file.
      */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        disablePictureInPicture
        data-slot="camera"
        data-status={state.status}
        data-facing={effectiveFacing}
        className="absolute inset-0 h-full w-full object-cover"
        // The overlay is never mirrored — only the raw feed, and only for the
        // front camera, so the composited line art still reads correctly.
        style={mirrored ? { transform: "scaleX(-1)" } : undefined}
      />
      {notice ? (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-x-0 top-[calc(var(--safe-top,0px)+1rem)] z-10 flex justify-center px-4"
        >
          <p className="rounded-full bg-surface/80 px-4 py-1.5 font-sans text-xs text-text-muted backdrop-blur-md">
            {notice}
          </p>
        </div>
      ) : null}
      <StatePanel state={state} onStart={handleStart} />
    </div>
  );
}
