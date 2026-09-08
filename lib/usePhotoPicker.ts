/**
 * lib/usePhotoPicker.ts — shared photo-picker wiring (FTA-018).
 *
 * Pulled out of `AddPhotoButton` so the convert screen's "Choose a different
 * photo" action can trigger the same system picker + `importPhoto` decode
 * path without duplicating the file-input plumbing. Callers own what happens
 * to a successful pick (`onPicked`) — this hook only owns opening the picker,
 * resetting the input so re-picking the same file still fires `change`, and
 * surfacing a decode error.
 */

import { useCallback, useRef, useState } from "react";
import { importPhoto, type ImportedImage } from "@/lib/import";

export interface UsePhotoPickerOptions {
  /** Called with the decoded photo on a successful pick. Never called on cancel. */
  onPicked: (image: ImportedImage) => void;
}

export interface UsePhotoPicker {
  /** Attach to the hidden <input type="file">'s ref. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Attach to the hidden <input>'s onChange. */
  handleChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  /** Opens the system photo picker. */
  openPicker: () => void;
  /** Decode error message from the most recent pick, if any. */
  error: string | null;
}

export function usePhotoPicker({ onPicked }: UsePhotoPickerOptions): UsePhotoPicker {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset immediately so re-picking the very same file still fires
      // `change` next time, regardless of how this pick turns out.
      event.target.value = "";

      if (!file) {
        // Cancelling the picker: leave no error state and do not navigate.
        return;
      }

      setError(null);
      void importPhoto(file).then((result) => {
        if (result.ok) {
          onPicked(result.value);
          return;
        }
        setError(result.error.message);
      });
    },
    [onPicked],
  );

  return { inputRef, handleChange, openPicker, error };
}

export type { ImportedImage };
