import { vi } from "vitest";

/**
 * Minimal stand-ins for MediaStream / MediaStreamTrack. jsdom implements
 * neither, and getUserMedia does not exist there at all, so every camera test
 * drives lib/camera.ts against these.
 */
export class FakeMediaStreamTrack extends EventTarget {
  readonly kind = "video";
  readonly stop = vi.fn();

  constructor(private readonly facingMode?: string) {
    super();
  }

  getSettings(): MediaTrackSettings {
    return this.facingMode ? { facingMode: this.facingMode } : {};
  }

  /** Simulate the OS or another app taking the camera away. */
  fireEnded(): void {
    this.dispatchEvent(new Event("ended"));
  }
}

export class FakeMediaStream {
  readonly tracks: FakeMediaStreamTrack[];

  constructor(tracks: FakeMediaStreamTrack[]) {
    this.tracks = tracks;
  }

  getTracks(): FakeMediaStreamTrack[] {
    return this.tracks;
  }

  getVideoTracks(): FakeMediaStreamTrack[] {
    return this.tracks;
  }
}

export function fakeStream(facingMode?: string, trackCount = 1): FakeMediaStream {
  return new FakeMediaStream(
    Array.from(
      { length: trackCount },
      () => new FakeMediaStreamTrack(facingMode),
    ),
  );
}

/** The fakes are structurally close enough for the code under test; this is
 *  the one cast, kept in a single place rather than sprinkled through specs. */
export function asMediaStream(stream: FakeMediaStream): MediaStream {
  return stream as unknown as MediaStream;
}

type GetUserMediaMock = (
  constraints: MediaStreamConstraints,
) => Promise<MediaStream>;

/** Install (or remove, with `null`) a fake navigator.mediaDevices.getUserMedia. */
export function installGetUserMedia(
  getUserMedia: GetUserMediaMock | null,
): void {
  Object.defineProperty(navigator, "mediaDevices", {
    value: getUserMedia ? { getUserMedia } : undefined,
    configurable: true,
    writable: true,
  });
}
