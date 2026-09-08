"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import {
  rememberAutoStart,
  shouldAutoStart,
  startRearCamera,
  stopStream,
  watchStreamEnd,
  type UnavailableReason,
} from "@/lib/camera";

type FeedState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "live" }
  | { status: "denied" }
  | { status: "ended" }
  | { status: "unavailable"; reason: UnavailableReason };

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

/**
 * The live rear-camera feed for the Trace screen (SPEC §6.3).
 *
 * Full-bleed and `object-fit: cover`, so the feed fills the viewport at its
 * real aspect ratio — cropped, never letterboxed and never stretched. The
 * overlay, opacity, gestures and wake lock are later tickets (T-09/T-10/T-11).
 */
export function CameraFeed() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const unwatchRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  // Guards against a slow getUserMedia resolving after a newer start(), or
  // after unmount — either would leak a live camera.
  const startTokenRef = useRef(0);
  const [state, setState] = useState<FeedState>({ status: "idle" });

  const releaseStream = useCallback(() => {
    unwatchRef.current?.();
    unwatchRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    const token = ++startTokenRef.current;
    releaseStream();
    setState({ status: "starting" });

    const result = await startRearCamera();

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

    streamRef.current = result.stream;
    unwatchRef.current = watchStreamEnd(result.stream, () => {
      if (!mountedRef.current) return;
      releaseStream();
      setState({ status: "ended" });
    });

    const video = videoRef.current;
    if (video) {
      video.srcObject = result.stream;
      try {
        await video.play();
      } catch {
        // Autoplay can reject if the page is backgrounded mid-start. The
        // stream is live and the `autoPlay` attribute picks it up on return,
        // so this is not a failure state.
      }
    }

    if (!mountedRef.current || token !== startTokenRef.current) return;
    rememberAutoStart();
    setState({ status: "live" });
  }, [releaseStream]);

  const handleStart = useCallback(() => {
    void start();
  }, [start]);

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
    };
  }, [start, releaseStream]);

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
        className="absolute inset-0 h-full w-full object-cover"
      />
      <StatePanel state={state} onStart={handleStart} />
    </div>
  );
}
