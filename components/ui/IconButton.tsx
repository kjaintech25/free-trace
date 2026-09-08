import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  /** Required — this button carries no visible label text. */
  "aria-label": string;
  active?: boolean;
  children: ReactNode;
  className?: string;
}

// Circular hit area, fixed at 44x44 regardless of the icon size passed as
// children (SPEC §7 one-thumb rule: every interactive element on the Trace
// screen must be reachable by one thumb and be at least 44x44pt).
const base =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-40";

export function IconButton({
  active = false,
  children,
  className = "",
  ...rest
}: IconButtonProps) {
  const stateClasses = active
    ? "bg-accent text-bg"
    : "bg-surface text-text-muted";

  return (
    <button
      type="button"
      aria-pressed={active}
      className={`${base} ${stateClasses} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
