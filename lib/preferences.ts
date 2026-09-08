/**
 * lib/preferences.ts — typed preference keys and defaults, in one place, so
 * every screen that reads or writes a `preferences` row (SPEC §5) uses the
 * same key names and the same default values.
 *
 * This ticket (T-13, Settings) is the only screen that WRITES these keys.
 * Later tickets (T-11 wake lock, T-07/T-09 opacity) import the constants
 * and `readPreferences` to READ them — wiring those screens to actually
 * change behaviour based on the values is explicitly their own scope, not
 * this ticket's.
 */

import { getPreference, setPreference } from "@/lib/storage";
import type { CameraFacing } from "@/lib/camera";

/** Default opacity for a newly-converted reference, 0–100 (SPEC §6.4). */
export const PREF_DEFAULT_OPACITY = "defaultOpacity";
/** Whether the Trace screen should hold the Screen Wake Lock (SPEC §6.4, T-11). */
export const PREF_KEEP_AWAKE = "keepAwake";
/** Which camera the Trace screen opens with (FTA-019). Session/device-local —
 *  not part of the reference record, same as `flipX`. */
export const PREF_CAMERA_FACING = "cameraFacing";

export const DEFAULT_OPACITY_VALUE = 50;
export const DEFAULT_KEEP_AWAKE_VALUE = true;
export const DEFAULT_CAMERA_FACING_VALUE: CameraFacing = "environment";

export interface Preferences {
  /** 0–100. Defaults to 50 when unset. */
  defaultOpacity: number;
  /** Defaults to true when unset. */
  keepAwake: boolean;
  /** Defaults to 'environment' (rear) when unset. */
  cameraFacing: CameraFacing;
}

/**
 * Reads both preferences, filling in the defaults above wherever a key is
 * unset OR the storage layer reports a failure. Never throws and never
 * surfaces a `StorageResult` to the caller — a screen that just wants "the
 * current settings, or sane defaults" should not have to unwrap two
 * results. A screen that needs to distinguish "storage is broken" from
 * "using defaults" (this ticket's Settings screen) should call
 * `getPreference` directly instead.
 */
export async function readPreferences(): Promise<Preferences> {
  const [opacityResult, keepAwakeResult, cameraFacingResult] = await Promise.all([
    getPreference<number>(PREF_DEFAULT_OPACITY),
    getPreference<boolean>(PREF_KEEP_AWAKE),
    getPreference<CameraFacing>(PREF_CAMERA_FACING),
  ]);

  const defaultOpacity =
    opacityResult.ok && opacityResult.value !== undefined
      ? opacityResult.value
      : DEFAULT_OPACITY_VALUE;

  const keepAwake =
    keepAwakeResult.ok && keepAwakeResult.value !== undefined
      ? keepAwakeResult.value
      : DEFAULT_KEEP_AWAKE_VALUE;

  const cameraFacing =
    cameraFacingResult.ok && cameraFacingResult.value !== undefined
      ? cameraFacingResult.value
      : DEFAULT_CAMERA_FACING_VALUE;

  return { defaultOpacity, keepAwake, cameraFacing };
}

/**
 * Writes one preference. Thin wrapper kept here (rather than callers using
 * `setPreference` directly) so every write goes through the same typed key
 * names as `readPreferences` and a future key rename only touches this file.
 */
const STORAGE_KEY: Record<keyof Preferences, string> = {
  defaultOpacity: PREF_DEFAULT_OPACITY,
  keepAwake: PREF_KEEP_AWAKE,
  cameraFacing: PREF_CAMERA_FACING,
};

export function writePreference<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
) {
  return setPreference(STORAGE_KEY[key], value);
}
