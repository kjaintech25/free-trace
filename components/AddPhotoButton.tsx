"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { setPendingImport } from "@/lib/pendingImport";
import { usePhotoPicker } from "@/lib/usePhotoPicker";

/**
 * "+ Add photo" (SPEC §6.1): opens the system photo picker via a hidden
 * file input, decodes the pick with `importPhoto`, hands the result off
 * through `lib/pendingImport.ts`, and routes to `/convert` (T-07).
 *
 * The picker itself is `lib/usePhotoPicker.ts` (FTA-018) — shared with the
 * convert screen's "Choose a different photo" action, which uses the same
 * hook but does not navigate.
 *
 * Deliberately no `capture` attribute on the input — the user is importing
 * from their photo roll, not taking a new photo with the camera.
 */
export function AddPhotoButton() {
  const router = useRouter();
  const { inputRef, handleChange, openPicker, error } = usePhotoPicker({
    onPicked: (image) => {
      setPendingImport(image);
      router.push("/convert");
    },
  });

  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={openPicker}>+ Add photo</Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleChange}
      />
      {error && <p className="text-sm text-text-muted">{error}</p>}
    </div>
  );
}
