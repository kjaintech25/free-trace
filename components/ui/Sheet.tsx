import type { ReactNode } from "react";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Accessible label for the sheet region, e.g. "Confirm delete". */
  label?: string;
}

// Bottom sheet on `surface`, 12px top radius, safe-area-aware bottom padding,
// translucent dark scrim (SPEC §7). Rendered inline (not a portal) — the
// scaffold has no portal target set up yet; later tickets may move this to
// one without changing the public props.
export function Sheet({ open, onClose, children, label }: SheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Scrim */}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-bg/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative w-full max-w-md rounded-t-xl bg-surface px-4 pt-4"
        style={{
          paddingBottom: "calc(1rem + var(--safe-bottom, 0px))",
        }}
      >
        {children}
      </div>
    </div>
  );
}
