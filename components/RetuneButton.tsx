"use client";

import { useRouter } from "next/navigation";
import { IconButton } from "@/components/ui";

/**
 * Re-tune shortcut for the Trace screen (FTA-018) — mirrors the library
 * ⋯ sheet's "Re-tune" action (`components/Library.tsx`'s `openRetune`) so
 * the same reference reaches `/convert` the same way from either screen.
 * Its own file for the same reason as `CloseTraceButton`: `IconButton`
 * renders a <button>, so routing needs a client component while
 * `app/trace/[id]/page.tsx` stays server-only.
 */
export function RetuneButton({ referenceId }: { referenceId: string }) {
  const router = useRouter();

  return (
    <IconButton
      aria-label="Re-tune line art"
      onClick={() => router.push(`/convert?ref=${referenceId}`)}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <line x1="4" y1="7" x2="20" y2="7" />
        <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
        <line x1="4" y1="17" x2="20" y2="17" />
        <circle cx="15" cy="17" r="2" fill="currentColor" stroke="none" />
      </svg>
    </IconButton>
  );
}
