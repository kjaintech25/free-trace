import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "quiet";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  children: ReactNode;
  className?: string;
}

// Shared button classes. Fully rounded pill, minimum 44px hit height per the
// SPEC §7 one-thumb rule, focus ring inherited from the global focus-visible
// rule in globals.css.
const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 font-sans text-sm font-medium transition-opacity disabled:pointer-events-none disabled:opacity-40";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-bg",
  quiet: "bg-surface text-text",
};

export function Button({
  variant = "primary",
  children,
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`${base} ${variants[variant]} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
