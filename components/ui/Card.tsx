import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "className"> {
  children: ReactNode;
  className?: string;
}

// SPEC §7: 12px radius on cards and sheets.
export function Card({ children, className = "", ...rest }: CardProps) {
  return (
    <div className={`rounded-xl bg-surface p-4 ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
