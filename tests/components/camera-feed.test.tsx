import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraFeed } from "@/components/CameraFeed";
import { AUTOSTART_KEY } from "@/lib/camera";
import {
  asMediaStream,
  fakeStream,
  installGetUserMedia,
  type FakeMediaStream,
} from "@/tests/helpers/fake-media";

// jsdom has no media pipeline: play() is a "not implemented" stub that logs to
// the virtual console. Stub it so the component's own await is exercised
// without the noise.
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  installGetUserMedia(null);
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

function getVideo(): HTMLVideoElement {
  const video = document.querySelector("video");
  if (!video) throw new Error("no <video> element rendered");
  return video;
}

async function startCamera(stream: FakeMediaStream) {
  const getUserMedia = vi.fn().mockResolvedValue(asMediaStream(stream));
  installGetUserMedia(getUserMedia);
  const view = render(<CameraFeed />);
  fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
  await waitFor(() => {
    expect(getVideo().dataset.status).toBe("live");
  });
  return { ...view, getUserMedia };
}

describe("CameraFeed — the gesture-gated start (SPEC §10.4)", () => {
  it("shows a Start camera button first and does not touch the camera until it is tapped", async () => {
    const getUserMedia = vi
      .fn()
      .mockResolvedValue(asMediaStream(fakeStream("environment")));
    installGetUserMedia(getUserMedia);

    render(<CameraFeed />);

    expect(screen.getByRole("button", { name: "Start camera" })).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledTimes(1);
    });
  });

  it("auto-starts without the button when this session already started the camera", async () => {
    window.sessionStorage.setItem(AUTOSTART_KEY, "1");
    const getUserMedia = vi
      .fn()
      .mockResolvedValue(asMediaStream(fakeStream("environment")));
    installGetUserMedia(getUserMedia);

    render(<CameraFeed />);

    await waitFor(() => {
      expect(getVideo().dataset.status).toBe("live");
    });
    expect(screen.queryByRole("button", { name: "Start camera" })).toBeNull();
  });
});

describe("CameraFeed — the video element (SPEC §10.4, no fullscreen takeover)", () => {
  it("sets playsInline, muted and autoPlay, and covers the viewport", async () => {
    await startCamera(fakeStream("environment"));

    const video = getVideo();
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(true);
    expect(video.muted).toBe(true);
    // object-cover + inset-0 + full width/height: fills the viewport at the
    // feed's real aspect ratio — cropped, never letterboxed or stretched.
    expect(video.className).toContain("object-cover");
    expect(video.className).toContain("absolute");
    expect(video.className).toContain("inset-0");
    expect(video.className).toContain("h-full");
    expect(video.className).toContain("w-full");
  });

  it("attaches the live stream to the element", async () => {
    const stream = fakeStream("environment");
    await startCamera(stream);
    expect(getVideo().srcObject).toBe(asMediaStream(stream));
  });
});

describe("CameraFeed — failure states are never a black screen (SPEC §9)", () => {
  it("renders an explanation, a retry action and the iOS hint when permission is denied", async () => {
    installGetUserMedia(
      vi.fn().mockRejectedValue(new DOMException("nope", "NotAllowedError")),
    );

    render(<CameraFeed />);
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));

    await waitFor(() => {
      expect(screen.getByText("Camera access was blocked")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(
      screen.getByText(/Settings → Safari → Camera → Allow/),
    ).toBeTruthy();
    expect(getVideo().dataset.status).toBe("denied");
  });

  it("retries when Try again is tapped, and reaches live once permission is granted", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("nope", "NotAllowedError"))
      .mockResolvedValueOnce(asMediaStream(fakeStream("environment")));
    installGetUserMedia(getUserMedia);

    render(<CameraFeed />);
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(getVideo().dataset.status).toBe("live");
    });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("explains a missing camera (NotFoundError) instead of failing silently", async () => {
    installGetUserMedia(
      vi.fn().mockRejectedValue(new DOMException("none", "NotFoundError")),
    );

    render(<CameraFeed />);
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));

    await waitFor(() => {
      expect(screen.getByText("Camera unavailable")).toBeTruthy();
    });
    expect(screen.getByText(/No camera was found on this device/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(getVideo().dataset.status).toBe("unavailable");
  });

  it("handles a track ending unexpectedly with a Restart action", async () => {
    const stream = fakeStream("environment");
    await startCamera(stream);

    await act(async () => {
      stream.tracks[0].fireEnded();
    });

    expect(screen.getByText("Camera stopped")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy();
    expect(getVideo().dataset.status).toBe("ended");
    // The dead stream is released rather than held open.
    expect(getVideo().srcObject).toBeNull();
  });
});

describe("CameraFeed — flipping cameras while live (FTA-019)", () => {
  it("stops the old tracks and starts a new stream when `facing` changes", async () => {
    const rear = fakeStream("environment", 2);
    const front = fakeStream("user");
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(asMediaStream(rear))
      .mockResolvedValueOnce(asMediaStream(front));
    installGetUserMedia(getUserMedia);

    const { rerender } = render(<CameraFeed facing="environment" />);
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
    await waitFor(() => {
      expect(getVideo().dataset.status).toBe("live");
    });
    expect(getVideo().dataset.facing).toBe("environment");

    rerender(<CameraFeed facing="user" />);

    await waitFor(() => {
      expect(getVideo().dataset.facing).toBe("user");
    });
    expect(getVideo().dataset.status).toBe("live");
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    for (const track of rear.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(getVideo().srcObject).toBe(asMediaStream(front));
  });

  it("calls onResolvedFacing with the camera the browser actually handed back", async () => {
    const front = fakeStream("user");
    installGetUserMedia(vi.fn().mockResolvedValue(asMediaStream(front)));
    const onResolvedFacing = vi.fn();

    render(<CameraFeed facing="user" onResolvedFacing={onResolvedFacing} />);
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));

    await waitFor(() => {
      expect(onResolvedFacing).toHaveBeenCalledWith("user");
    });
  });

  it("mirrors the video only when the live camera is the front camera", async () => {
    installGetUserMedia(vi.fn().mockResolvedValue(asMediaStream(fakeStream("user"))));

    render(<CameraFeed facing="user" />);
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));

    await waitFor(() => {
      expect(getVideo().dataset.status).toBe("live");
    });
    expect(getVideo().style.transform).toBe("scaleX(-1)");
  });

  it("does not mirror the video for the rear camera", async () => {
    await startCamera(fakeStream("environment"));
    expect(getVideo().style.transform).toBe("");
  });

  it("on a one-camera device, a failed flip restarts the previous camera and shows a brief notice instead of an error panel", async () => {
    const rear = fakeStream("environment");
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(asMediaStream(rear))
      .mockRejectedValueOnce(
        new DOMException("no front camera", "OverconstrainedError"),
      )
      .mockResolvedValueOnce(asMediaStream(fakeStream("environment")));
    installGetUserMedia(getUserMedia);

    const { rerender } = render(<CameraFeed facing="environment" />);
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
    await waitFor(() => {
      expect(getVideo().dataset.status).toBe("live");
    });

    rerender(<CameraFeed facing="user" />);

    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledTimes(3);
    });
    // Back to live on the rear camera, not a failure panel.
    expect(getVideo().dataset.status).toBe("live");
    expect(getVideo().dataset.facing).toBe("environment");
    expect(screen.queryByText("Camera unavailable")).toBeNull();
    expect(screen.getByText("Only one camera available")).toBeTruthy();
  });

  it("the one-camera notice clears itself after a few seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(asMediaStream(fakeStream("environment")))
      .mockRejectedValueOnce(
        new DOMException("no front camera", "NotFoundError"),
      )
      .mockResolvedValueOnce(asMediaStream(fakeStream("environment")));
    installGetUserMedia(getUserMedia);

    const { rerender } = render(<CameraFeed facing="environment" />);
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
    await waitFor(() => {
      expect(getVideo().dataset.status).toBe("live");
    });

    rerender(<CameraFeed facing="user" />);
    await waitFor(() => {
      expect(screen.getByText("Only one camera available")).toBeTruthy();
    });

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByText("Only one camera available")).toBeNull();
    vi.useRealTimers();
  });
});

describe("CameraFeed — the camera is handed back", () => {
  it("stops every track on unmount", async () => {
    const stream = fakeStream("environment", 2);
    const { unmount } = await startCamera(stream);

    for (const track of stream.tracks) {
      expect(track.stop).not.toHaveBeenCalled();
    }

    unmount();

    for (const track of stream.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
  });

  it("stops every track on pagehide (navigating away / bfcache)", async () => {
    const stream = fakeStream("environment", 2);
    await startCamera(stream);

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });

    for (const track of stream.tracks) {
      expect(track.stop).toHaveBeenCalledTimes(1);
    }
    expect(screen.getByRole("button", { name: "Start camera" })).toBeTruthy();
  });
});
