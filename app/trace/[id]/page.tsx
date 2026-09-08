import { CameraFeed } from "@/components/CameraFeed";
import { CloseTraceButton } from "@/components/CloseTraceButton";

/**
 * Trace screen (SPEC §6.3) — the screen that matters.
 *
 * This ticket (T-08) builds only the live rear-camera feed underneath. The
 * line art, the opacity slider, the gestures and the wake lock arrive in
 * T-09/T-10/T-11 and hang off the `data-slot="overlay"` element below.
 */
export default async function TracePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Read but deliberately unused: loading the reference out of IndexedDB is
  // T-09's job, and lib/storage.ts is being built in another lane.
  const { id } = await params;

  return (
    <main
      data-reference-id={id}
      // Fixed + overflow-hidden: the trace screen never scrolls, and
      // overscroll-none kills iOS pull-to-refresh mid-drawing (SPEC §7).
      className="fixed inset-0 overflow-hidden overscroll-none bg-bg text-text select-none"
      style={{ WebkitTouchCallout: "none" }}
    >
      <CameraFeed />

      {/* T-09 composites the line art here, above the video. */}
      <div
        data-slot="overlay"
        className="pointer-events-none absolute inset-0 z-10"
      />

      <div className="absolute top-0 right-0 z-20 pt-[var(--safe-top)] pr-[var(--safe-right)]">
        <div className="p-3">
          <CloseTraceButton />
        </div>
      </div>
    </main>
  );
}
