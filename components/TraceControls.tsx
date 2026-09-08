"use client";

import { CloseTraceButton } from "@/components/CloseTraceButton";
import { IconButton, Slider } from "@/components/ui";

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
 * NOT here: the collapse-to-a-pill-after-4s behaviour is T-11's.
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
}: TraceControlsProps) {
  return (
    <div
      data-slot="controls"
      className="absolute inset-x-0 bottom-0 z-30 flex justify-center pb-[calc(var(--safe-bottom)+1rem)] pl-[calc(var(--safe-left)+1rem)] pr-[calc(var(--safe-right)+1rem)]"
    >
      <div className="flex w-full max-w-sm flex-col gap-1 rounded-full bg-surface/80 px-6 py-2 backdrop-blur-md">
        <Slider label="Opacity" value={opacity} onChange={onOpacityChange} />
        <div className="flex items-center justify-center gap-3">
          <IconButton
            aria-label="Lock overlay"
            active={locked}
            onClick={onLockToggle}
          >
            <LockIcon locked={locked} />
          </IconButton>
          <IconButton
            aria-label="Flip horizontal"
            active={flipped}
            onClick={onFlipToggle}
          >
            <FlipIcon />
          </IconButton>
          <IconButton
            aria-label="Invert"
            active={inverted}
            onClick={onInvertToggle}
          >
            <InvertIcon />
          </IconButton>
          <CloseTraceButton />
        </div>
      </div>
    </div>
  );
}
