import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOSTART_KEY,
  classifyCameraError,
  isFrontFacing,
  rememberAutoStart,
  shouldAutoStart,
  startRearCamera,
  stopStream,
  watchStreamEnd,
} from "@/lib/camera";
import {
  asMediaStream,
  fakeStream,
  installGetUserMedia,
} from "@/tests/helpers/fake-media";

const IDEAL = { video: { facingMode: { ideal: "environment" } }, audio: false };
const EXACT = { video: { facingMode: { exact: "environment" } }, audio: false };

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  installGetUserMedia(null);
  vi.restoreAllMocks();
});

describe("startRearCamera — the request shape", () => {
  it("asks for the rear camera with facingMode ideal environment and no audio", async () => {
    const stream = fakeStream("environment");
    const getUserMedia = vi.fn().mockResolvedValue(asMediaStream(stream));
    installGetUserMedia(getUserMedia);

    const result = await startRearCamera();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith(IDEAL);
    if (!result.ok) throw new Error("expected a stream");
    expect(result.stream).toBe(asMediaStream(stream));
    expect(result.usedExactFallback).toBe(false);
  });

  it("does not make a second request when the rear camera was returned", async () => {
    const getUserMedia = vi
      .fn()
      .mockResolvedValue(asMediaStream(fakeStream("environment")));
    installGetUserMedia(getUserMedia);

    await startRearCamera();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe("startRearCamera — front-camera fallback (SPEC §10.2)", () => {
  it("retries with exact: environment when the front camera came back, and keeps the rear stream", async () => {
    const front = fakeStream("user");
    const rear = fakeStream("environment");
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(asMediaStream(front))
      .mockResolvedValueOnce(asMediaStream(rear));
    installGetUserMedia(getUserMedia);

    const result = await startRearCamera();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, IDEAL);
    expect(getUserMedia).toHaveBeenNthCalledWith(2, EXACT);
    if (!result.ok) throw new Error("expected a stream");
    expect(result.stream).toBe(asMediaStream(rear));
    expect(result.usedExactFallback).toBe(true);
    // The discarded front-facing stream must not stay live.
    expect(front.tracks[0].stop).toHaveBeenCalledTimes(1);
  });

  it("keeps the first stream when the exact retry is rejected — never leaves the user with nothing", async () => {
    const front = fakeStream("user");
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(asMediaStream(front))
      .mockRejectedValueOnce(
        new DOMException("no rear camera", "OverconstrainedError"),
      );
    installGetUserMedia(getUserMedia);

    const result = await startRearCamera();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    if (!result.ok) throw new Error("expected the first stream to be kept");
    expect(result.stream).toBe(asMediaStream(front));
    expect(result.usedExactFallback).toBe(false);
    expect(front.tracks[0].stop).not.toHaveBeenCalled();
  });
});

describe("startRearCamera — failure mapping", () => {
  it("maps a permission denial to `denied`", async () => {
    installGetUserMedia(
      vi.fn().mockRejectedValue(new DOMException("nope", "NotAllowedError")),
    );

    const result = await startRearCamera();

    expect(result).toEqual({ ok: false, failure: { status: "denied" } });
  });

  it("maps NotFoundError to `unavailable` / no-camera", async () => {
    installGetUserMedia(
      vi.fn().mockRejectedValue(new DOMException("none", "NotFoundError")),
    );

    const result = await startRearCamera();

    expect(result).toEqual({
      ok: false,
      failure: { status: "unavailable", reason: "no-camera" },
    });
  });

  it("maps a missing mediaDevices (insecure origin, SPEC §10.1) to `unavailable`", async () => {
    installGetUserMedia(null);

    const result = await startRearCamera();

    expect(result).toEqual({
      ok: false,
      failure: { status: "unavailable", reason: "insecure-origin" },
    });
  });

  it("maps a camera already in use to `unavailable` / in-use", async () => {
    installGetUserMedia(
      vi.fn().mockRejectedValue(new DOMException("busy", "NotReadableError")),
    );

    const result = await startRearCamera();

    expect(result).toEqual({
      ok: false,
      failure: { status: "unavailable", reason: "in-use" },
    });
  });
});

describe("classifyCameraError", () => {
  it("treats an unrecognised rejection as unavailable rather than throwing", () => {
    expect(classifyCameraError(new Error("boom"))).toEqual({
      status: "unavailable",
      reason: "unknown",
    });
    expect(classifyCameraError("a string")).toEqual({
      status: "unavailable",
      reason: "unknown",
    });
    expect(classifyCameraError(null)).toEqual({
      status: "unavailable",
      reason: "unknown",
    });
  });
});

describe("isFrontFacing", () => {
  it("is true only for a track reporting facingMode user", () => {
    expect(isFrontFacing(asMediaStream(fakeStream("user")))).toBe(true);
    expect(isFrontFacing(asMediaStream(fakeStream("environment")))).toBe(false);
    // Some browsers report no facingMode at all — treat that as "keep it".
    expect(isFrontFacing(asMediaStream(fakeStream(undefined)))).toBe(false);
    expect(isFrontFacing(asMediaStream(fakeStream("user", 0)))).toBe(false);
  });
});

describe("stopStream", () => {
  it("stops every track and tolerates null", () => {
    const stream = fakeStream("environment", 3);
    stopStream(asMediaStream(stream));
    for (const track of stream.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(() => stopStream(null)).not.toThrow();
  });
});

describe("watchStreamEnd", () => {
  it("fires once a track ends, and unsubscribes cleanly", () => {
    const stream = fakeStream("environment", 2);
    const onEnded = vi.fn();
    const unwatch = watchStreamEnd(asMediaStream(stream), onEnded);

    stream.tracks[0].fireEnded();
    expect(onEnded).toHaveBeenCalledTimes(1);

    unwatch();
    stream.tracks[1].fireEnded();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});

describe("session auto-start memory", () => {
  it("is off until a start is remembered", () => {
    expect(shouldAutoStart()).toBe(false);
    rememberAutoStart();
    expect(window.sessionStorage.getItem(AUTOSTART_KEY)).toBe("1");
    expect(shouldAutoStart()).toBe(true);
  });

  it("degrades to false when sessionStorage throws (private browsing)", () => {
    vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(shouldAutoStart()).toBe(false);
    expect(() => rememberAutoStart()).not.toThrow();
  });
});
