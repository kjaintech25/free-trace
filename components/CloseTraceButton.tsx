"use client";

import { useRouter } from "next/navigation";
import { IconButton } from "@/components/ui";

/**
 * Close affordance for the Trace screen (SPEC §6.3). Its own file because
 * `IconButton` renders a <button>, so routing needs a client component —
 * app/trace/[id]/page.tsx stays a server component that reads its params.
 */
export function CloseTraceButton() {
  const router = useRouter();

  return (
    <IconButton aria-label="Close" onClick={() => router.push("/")}>
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
        <path d="M6 6 18 18M18 6 6 18" />
      </svg>
    </IconButton>
  );
}
