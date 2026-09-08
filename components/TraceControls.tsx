"use client";

import { CloseTraceButton } from "@/components/CloseTraceButton";
import { RetuneButton } from "@/components/RetuneButton";
import { IconButton, Slider } from "@/components/ui";
import type { CameraFacing } from "@/lib/camera";

export interface TraceControlsProps {
  /** 0–100. */
  opacity: number;
  onOpacityChange: (value: number) => void;
  /** Engaged lock — amber. T-10 gives it its behaviour; here it only toggles. */
  locked: boolean;
  onLockToggle: () => void;
  flipped: boolean;
  onFlipToggle: () => void;
  inverted: boolean;
  onInvertToggle: () => void;
  /** Which physical camera is active (FTA-019). */
  cameraFacing: CameraFacing;
  onCameraFlip: () => void;
  /** The open reference's id — routes the Re-tune shortcut (FTA-018). */
  referenceId: string;
  /**
   * Collapsed to a single small pill after ~4s idle (SPEC §6.3, T-11). The
   * idle timer itself lives in TraceScreen — this component only renders
   * the two states.
   */
  collapsed: boolean;
}

const ICON = {
  viewBox: "0 0 24 24",
  width: 20,
  height: 20,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg {...ICON} aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      {/* Open shackle when unlocked, closed when locked — the shape says the
          state as well as the colour does, for a glance mid-drawing. */}
      <path d={locked ? "M8 10.5V7a4 4 0 0 1 8 0v3.5" : "M8 10.5V7a4 4 0 0 1 8 0"} />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M12 3v18" strokeDasharray="2 3" />
      <path d="M9.5 6.5 4 12l5.5 5.5z" />
      <path d="M14.5 6.5 20 12l-5.5 5.5z" />
    </svg>
  );
}

function InvertIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Camera body with two rotate arrows — kept simple, not literally a photo
 *  of front vs. rear. */
function CameraFlipIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <rect x="3.5" y="7.5" width="17" height="12" rx="2.5" />
      <circle cx="12" cy="13.5" r="3.25" />
      <path d="M8.5 7.5 10 5h4l1.5 2.5" />
      <path d="M17.5 3.5a5 5 0 0 1 1.9 2.7" />
      <path d="M6.5 3.5a5 5 0 0 0-1.9 2.7" />
    </svg>
  );
}

/**
 * The floating control bar (SPEC §6.3).
 *
 * Placement rules it exists to satisfy:
 *  - Bottom third and one-thumb reachable (SPEC §7): the user's other hand is
 *    holding a pencil, so nothing lives at the top of the screen.
 *  - Above the overlay (z-30) but clear of the camera failure panel, which is
 *    centred at z-20 and must stay tappable.
 *  - `surface` at 80% alpha via the token, never a hex — translucent, dark and
 *    low-contrast so it never competes with the reference image (SPEC §7).
 *  - Fully rounded, and padded past `--safe-bottom` so the home indicator does
 *    not sit on the buttons.
 *
 * The row is centred rather than spread edge-to-edge: at `rounded-full` the
 * pill's curve cuts into the corners at the row's height, and a spread row
 * would push the outer buttons under it.
 *
 * Collapse-to-a-pill-after-4s (T-11, SPEC §6.3): `collapsed` toggles which of
 * the two states below is visible. SPEC §9 forbids any layout shift when
 * this happens, so BOTH states stay mounted, in the same `absolute` box, at
 * all times — never unmounted/remounted, which would be a differently-sized
 * element reflowing the readout underneath it. Only `transform` and
 * `opacity` change (compositor-only properties, same reasoning as
 * TraceOverlay), on a plain ~150ms CSS transition, and `motion-reduce:`
 * drops the transition duration to zero for `prefers-reduced-motion`.
 *
 * FTA-018's Re-tune shortcut sits next to Close at the pill's right edge —
 * the two "leave this screen" actions grouped together. Six icons at 44pt
 * each (SPEC §7) no longer fit at `gap-3` (12px) inside the pill at 390px
 * width, so the row's gap drops to `gap-2` (8px):
 *   available inner width = min(390 - 2*16 safe/outer padding, 384 max-w-sm)
 *                            - 2*24 pill px-6  = 358 - 48 = 310px
 *   row width  = 6 * 44 + 5 * 8            = 264 + 40    = 304px  (fits, 6px spare)
 * (`gap-3`'s 12px would have needed 324px — 14px over budget.)
 */
export function TraceControls({
  opacity,
  onOpacityChange,
  locked,
  onLockToggle,
  flipped,
  onFlipToggle,
  inverted,
  onInvertToggle,
  cameraFacing,
  onCameraFlip,
  referenceId,
  collapsed,
}: TraceControlsProps) {
  return (
    <div
      data-slot="controls"
      className="absolute inset-x-0 bottom-0 z-30 flex justify-center pb-[calc(var(--safe-bottom)+1rem)] pl-[calc(var(--safe-left)+1rem)] pr-[calc(var(--safe-right)+1rem)]"
    >
      {/* The one positioned box both states share — a CSS grid with a single
          cell, so stacking the two on top of each other costs no layout of
          its own and neither state's size affects the other's. */}
      <div
        data-slot="chrome"
        data-chrome={collapsed ? "collapsed" : "expanded"}
        className="grid w-full max-w-sm place-items-center"
      >
        <div
          className={`col-start-1 row-start-1 flex w-full flex-col gap-1 rounded-full bg-surface/80 px-6 py-2 backdrop-blur-md transition-[opacity,transform] duration-150 motion-reduce:duration-0 ${
            collapsed
              ? "pointer-events-none scale-95 opacity-0"
              : "scale-100 opacity-100"
          }`}
          aria-hidden={collapsed}
        >
          <Slider label="Opacity" value={opacity} onChange={onOpacityChange} />
          <div className="flex items-center justify-center gap-2">
            <IconButton
              aria-label="Lock overlay"
              active={locked}
              onClick={onLockToggle}
              tabIndex={collapsed ? -1 : undefined}
            >
              <LockIcon locked={locked} />
            </IconButton>
            <IconButton
              aria-label="Flip horizontal"
              active={flipped}
              onClick={onFlipToggle}
              tabIndex={collapsed ? -1 : undefined}
            >
              <FlipIcon />
            </IconButton>
            <IconButton
              aria-label="Invert"
              active={inverted}
              onClick={onInvertToggle}
              tabIndex={collapsed ? -1 : undefined}
            >
              <InvertIcon />
            </IconButton>
            <IconButton
              aria-label="Flip camera"
              active={cameraFacing === "user"}
              onClick={onCameraFlip}
              tabIndex={collapsed ? -1 : undefined}
              data-facing={cameraFacing}
            >
              <CameraFlipIcon />
            </IconButton>
            <RetuneButton referenceId={referenceId} />
            <CloseTraceButton />
          </div>
        </div>

        {/* The collapsed pill: ≥44pt tap target, surface/80, opacity readout
            only (SPEC §6.3). A tap anywhere on the screen already restarts
            the idle timer via TraceScreen's root capture listeners, so this
            button needs no click handler of its own to "restore" — it just
            has to be a real, focusable, tappable element. */}
        <button
          type="button"
          aria-label={`Show controls — opacity ${opacity}%`}
          tabIndex={collapsed ? undefined : -1}
          className={`col-start-1 row-start-1 flex h-11 min-w-11 items-center justify-center rounded-full bg-surface/80 px-4 backdrop-blur-md transition-[opacity,transform] duration-150 motion-reduce:duration-0 ${
            collapsed
              ? "scale-100 opacity-100"
              : "pointer-events-none scale-95 opacity-0"
          }`}
          aria-hidden={!collapsed}
        >
          <span className="numeral text-sm text-text">{opacity}%</span>
        </button>
      </div>
    </div>
  );
}
