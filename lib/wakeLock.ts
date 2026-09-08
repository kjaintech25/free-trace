/**
 * Screen Wake Lock (SPEC §6.3, §10 item 5) — deliberately React-free, same
 * shape as lib/camera.ts: a plain async function over the platform API so it
 * is unit-testable in jsdom against a mocked `navigator.wakeLock`, with the
 * hook (components/useWakeLock.ts) owning only the lifecycle.
 *
 * SPEC §10.5 / acceptance criterion: unsupported or refused must degrade
 * completely silently — no thrown error, no `console.error`, no user-visible
 * anything. A wake lock is a nicety; failing to get one is not a failure the
 * user can act on.
 */

/**
 * Requests the screen wake lock. Returns the sentinel on success, or `null`
 * when the API does not exist on this browser or the request rejects (denied
 * by the platform, page not visible, etc.) — both are expected, ordinary
 * outcomes here, not errors.
 */
export async function acquireWakeLock(): Promise<WakeLockSentinel | null> {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    return null;
  }

  try {
    return await navigator.wakeLock.request("screen");
  } catch {
    // Silent by design (SPEC §10.5): iOS Safari can reject this for reasons
    // outside the app's control (not a user gesture yet, low power mode,
    // multiple tabs). Nothing here is worth surfacing.
    return null;
  }
}

/**
 * Releases a previously-acquired sentinel. Safe to call with `null` (the
 * common case: nothing was acquired) and safe to call on an already-released
 * sentinel — `release()` is idempotent per spec, but this still swallows any
 * rejection for the same reason `acquireWakeLock` does.
 */
export async function releaseWakeLock(
  sentinel: WakeLockSentinel | null,
): Promise<void> {
  if (sentinel === null) return;
  try {
    await sentinel.release();
  } catch {
    // Silent by design — see acquireWakeLock.
  }
}
