"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, IconButton, Sheet, Slider } from "@/components/ui";
import { clearAll } from "@/lib/storage";
import {
  DEFAULT_KEEP_AWAKE_VALUE,
  DEFAULT_OPACITY_VALUE,
  readPreferences,
  writePreference,
} from "@/lib/preferences";

const DELETE_KEYWORD = "DELETE";
const SAVE_DEBOUNCE_MS = 300;

/**
 * Settings — `/settings` (SPEC §6.4). Default opacity, keep-screen-awake,
 * and clear-all-data with a typed confirmation.
 *
 * Not built on the shared `ConfirmDialog` primitive: that component takes a
 * plain string body and has no way to disable its confirm button, and this
 * screen needs a text input plus a confirm button that stays disabled until
 * the user types DELETE. Built directly on `Sheet` instead, the same way
 * Library's rename sheet is — see `components/Library.tsx`.
 */
export function Settings() {
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [opacity, setOpacity] = useState(DEFAULT_OPACITY_VALUE);
  const [keepAwake, setKeepAwake] = useState(DEFAULT_KEEP_AWAKE_VALUE);

  const [clearOpen, setClearOpen] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState("");
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

  const opacitySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Same "fetch in an effect" pattern as Library (see that file's comment
    // on `react-hooks/set-state-in-effect`): the setState calls below only
    // run after the `await`, never synchronously inside the effect body, so
    // the lint rule does not flag this one and no disable is needed here.
    void (async () => {
      const prefs = await readPreferences();
      setOpacity(prefs.defaultOpacity);
      setKeepAwake(prefs.keepAwake);
      setLoaded(true);
    })();
  }, []);

  // Clear any pending debounced save on unmount so it never fires (and
  // writes) after the screen is gone.
  useEffect(() => {
    return () => {
      if (opacitySaveTimer.current) clearTimeout(opacitySaveTimer.current);
    };
  }, []);

  function handleOpacityChange(value: number) {
    setOpacity(value);
    if (opacitySaveTimer.current) clearTimeout(opacitySaveTimer.current);
    opacitySaveTimer.current = setTimeout(() => {
      void writePreference("defaultOpacity", value).then((result) => {
        if (!result.ok) setLoadError(result.error.message);
      });
    }, SAVE_DEBOUNCE_MS);
  }

  async function handleKeepAwakeToggle() {
    const next = !keepAwake;
    setKeepAwake(next);
    const result = await writePreference("keepAwake", next);
    if (!result.ok) setLoadError(result.error.message);
  }

  function openClearDialog() {
    setClearConfirmText("");
    setClearError(null);
    setClearOpen(true);
  }

  function closeClearDialog() {
    setClearOpen(false);
    setClearConfirmText("");
    setClearError(null);
  }

  async function handleClearConfirm() {
    setClearing(true);
    setClearError(null);
    const result = await clearAll();
    setClearing(false);
    if (result.ok) {
      setClearOpen(false);
      setCleared(true);
      router.push("/");
    } else {
      setClearError(result.error.message);
    }
  }

  const clearConfirmEnabled = clearConfirmText === DELETE_KEYWORD && !clearing;

  return (
    <main className="flex min-h-dvh flex-col bg-bg px-4 pt-[calc(1.5rem+var(--safe-top,0px))] pb-[calc(1.5rem+var(--safe-bottom,0px))] text-text">
      <div className="mb-6 flex items-center gap-3">
        <IconButton aria-label="Back" onClick={() => router.push("/")}>
          ←
        </IconButton>
        <h1 className="font-sans text-2xl">Settings</h1>
      </div>

      {loadError && (
        <p className="mb-4 font-sans text-sm text-text-muted">{loadError}</p>
      )}

      {!loaded && !loadError && (
        <p className="font-sans text-sm text-text-muted">Loading…</p>
      )}

      {loaded && (
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 font-sans text-sm text-text-muted">
              Default opacity
            </h2>
            <Slider label="Default opacity" value={opacity} onChange={handleOpacityChange} />
          </Card>

          <Card className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-sans text-sm text-text">
                Keep screen awake
              </h2>
              <p className="mt-1 font-sans text-xs text-text-muted">
                Stops the screen from sleeping while tracing.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={keepAwake}
              aria-label="Keep screen awake"
              onClick={() => {
                void handleKeepAwakeToggle();
              }}
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors ${
                keepAwake ? "bg-accent text-bg" : "bg-bg text-text-muted"
              }`}
            >
              {keepAwake ? "On" : "Off"}
            </button>
          </Card>

          <Card>
            <h2 className="mb-1 font-sans text-sm text-text">Clear all data</h2>
            <p className="mb-3 font-sans text-xs text-text-muted">
              Permanently deletes every reference and every setting stored on
              this device. This can&rsquo;t be undone.
            </p>
            {cleared && (
              <p className="mb-3 font-sans text-xs text-text-muted">
                Everything cleared.
              </p>
            )}
            <Button variant="quiet" onClick={openClearDialog}>
              Clear all data
            </Button>
          </Card>
        </div>
      )}

      <Sheet open={clearOpen} onClose={closeClearDialog} label="Clear all data">
        <h2 className="font-sans text-lg font-semibold text-text">
          Clear all data?
        </h2>
        <p className="mt-2 font-sans text-sm text-text-muted">
          This permanently deletes every reference and every setting stored on
          this device. This can&rsquo;t be undone. Type {DELETE_KEYWORD} to
          confirm.
        </p>
        <label className="sr-only" htmlFor="clear-confirm-input">
          Type {DELETE_KEYWORD} to confirm
        </label>
        <input
          id="clear-confirm-input"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          value={clearConfirmText}
          onChange={(event) => setClearConfirmText(event.target.value)}
          className="mt-4 min-h-11 w-full rounded-full bg-bg px-4 font-sans text-sm text-text"
        />
        {clearError && (
          <p className="mt-3 font-sans text-sm text-text-muted">{clearError}</p>
        )}
        <div className="mt-6 flex gap-3">
          <Button variant="quiet" className="flex-1" onClick={closeClearDialog}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            disabled={!clearConfirmEnabled}
            onClick={() => {
              void handleClearConfirm();
            }}
          >
            {clearing ? "Clearing…" : "Clear all data"}
          </Button>
        </div>
      </Sheet>
    </main>
  );
}
