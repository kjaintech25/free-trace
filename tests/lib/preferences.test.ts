import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPreference } from "@/lib/storage";
import {
  DEFAULT_CAMERA_FACING_VALUE,
  DEFAULT_KEEP_AWAKE_VALUE,
  DEFAULT_OPACITY_VALUE,
  PREF_CAMERA_FACING,
  PREF_DEFAULT_OPACITY,
  PREF_KEEP_AWAKE,
  readPreferences,
} from "@/lib/preferences";

vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>(
    "@/lib/storage",
  );
  return {
    ...actual,
    getPreference: vi.fn(),
    setPreference: vi.fn(),
  };
});

const getPreferenceMock = vi.mocked(getPreference);

beforeEach(() => {
  getPreferenceMock.mockReset();
});

describe("readPreferences — both keys unset", () => {
  it("fills in the documented defaults", async () => {
    getPreferenceMock.mockResolvedValue({ ok: true, value: undefined });

    const prefs = await readPreferences();

    expect(prefs).toEqual({
      defaultOpacity: DEFAULT_OPACITY_VALUE,
      keepAwake: DEFAULT_KEEP_AWAKE_VALUE,
      cameraFacing: DEFAULT_CAMERA_FACING_VALUE,
    });
  });
});

describe("readPreferences — storage failure", () => {
  it("never throws and falls back to defaults instead of propagating the error", async () => {
    getPreferenceMock.mockResolvedValue({
      ok: false,
      error: { kind: "unknown", message: "boom" },
    });

    const prefs = await readPreferences();

    expect(prefs).toEqual({
      defaultOpacity: DEFAULT_OPACITY_VALUE,
      keepAwake: DEFAULT_KEEP_AWAKE_VALUE,
      cameraFacing: DEFAULT_CAMERA_FACING_VALUE,
    });
  });
});

describe("readPreferences — stored values present", () => {
  it("returns the stored values, keyed by the exported constants", async () => {
    getPreferenceMock.mockImplementation(async (key: string) => {
      if (key === PREF_DEFAULT_OPACITY) return { ok: true, value: 30 };
      if (key === PREF_KEEP_AWAKE) return { ok: true, value: false };
      if (key === PREF_CAMERA_FACING) return { ok: true, value: "user" };
      throw new Error(`unexpected key ${key}`);
    });

    const prefs = await readPreferences();

    expect(prefs).toEqual({
      defaultOpacity: 30,
      keepAwake: false,
      cameraFacing: "user",
    });
  });
});
