"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { importPhoto } from "@/lib/import";
import { setPendingImport } from "@/lib/pendingImport";

/**
 * "+ Add photo" (SPEC §6.1): opens the system photo picker via a hidden
 * file input, decodes the pick with `importPhoto`, hands the result off
 * through `lib/pendingImport.ts`, and routes to `/convert` (T-07).
 *
 * Deliberately no `capture` attribute on the input — the user is importing
 * from their photo roll, not taking a new photo with the camera.
 */
export function AddPhotoButton() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so re-picking the very same file still fires
    // `change` next time, regardless of how this pick turns out.
    event.target.value = "";

    if (!file) {
      // Cancelling the picker: leave no error state and do not navigate.
      return;
    }

    setError(null);

    const result = await importPhoto(file);
    if (result.ok) {
      setPendingImport(result.value);
      router.push("/convert");
      return;
    }

    setError(result.error.message);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={() => inputRef.current?.click()}>+ Add photo</Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleChange(event);
        }}
      />
      {error && <p className="text-sm text-text-muted">{error}</p>}
    </div>
  );
}
