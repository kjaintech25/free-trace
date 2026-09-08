"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AddPhotoButton } from "@/components/AddPhotoButton";
import { Card, ConfirmDialog, IconButton, Sheet } from "@/components/ui";
import {
  deleteReference,
  listReferences,
  updateReference,
  type Reference,
} from "@/lib/storage";

/**
 * Library — `/` (SPEC §6.1). Two-column grid of saved references, newest
 * first, with an overflow sheet per card for rename / re-tune / delete.
 *
 * "+ Add photo" placement: a sticky bottom bar on `surface` (not a top
 * action) — it keeps the primary action within one-thumb reach at the
 * bottom of the screen, consistent with the Trace screen's control bar
 * (SPEC §7 one-thumb rule), and never sits above content the user is
 * scrolling through to find a card.
 */
export function Library() {
  const router = useRouter();
  const [references, setReferences] = useState<Reference[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Overflow sheet state: which reference id (if any) has its sheet open.
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function refresh() {
    const result = await listReferences();
    if (result.ok) {
      setReferences(result.value);
      setLoadError(null);
    } else {
      setLoadError(result.error.message);
    }
  }

  useEffect(() => {
    // `react-hooks/set-state-in-effect` flags this: it statically traces the
    // async `refresh()` call for a later `setState`. That is exactly the
    // documented "fetch in an effect" pattern (React has no built-in
    // data-fetching primitive and SPEC §4 forbids a state/query library), so
    // the setState itself is legitimate — it runs after an `await`, never
    // synchronously inside the effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, []);

  // One effect over the whole list (not one per card) creates every thumbnail
  // object URL together and revokes them together on unmount/list change —
  // required so 50 cards stay cheap (SPEC T-05 performance note). URL
  // creation is a `useMemo` (pure derivation of the list, no setState in an
  // effect); a separate effect only performs the revoke cleanup, which is
  // not a setState call and is not flagged by the lint rule above.
  const thumbUrls = useMemo(() => {
    if (!references) return {};
    const urls: Record<string, string> = {};
    for (const ref of references) {
      urls[ref.id] = URL.createObjectURL(ref.thumbnail);
    }
    return urls;
  }, [references]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(thumbUrls)) {
        URL.revokeObjectURL(url);
      }
    };
  }, [thumbUrls]);

  const menuRef = references?.find((r) => r.id === menuId) ?? null;

  function closeMenu() {
    setMenuId(null);
  }

  function openRename() {
    if (!menuRef) return;
    setRenameValue(menuRef.name);
    setRenameId(menuRef.id);
    setMenuId(null);
  }

  function openRetune() {
    if (!menuRef) return;
    router.push(`/convert?ref=${menuRef.id}`);
    setMenuId(null);
  }

  function openDeleteConfirm() {
    if (!menuRef) return;
    setDeleteId(menuRef.id);
    setMenuId(null);
  }

  async function confirmRename() {
    if (!renameId) return;
    const id = renameId;
    const name = renameValue.trim() || "Untitled";
    setRenameId(null);
    const result = await updateReference(id, { name });
    if (result.ok) {
      await refresh();
    } else {
      setActionError(result.error.message);
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    const id = deleteId;
    setDeleteId(null);
    const result = await deleteReference(id);
    if (result.ok) {
      await refresh();
    } else {
      setActionError(result.error.message);
    }
  }

  const hasItems = references !== null && references.length > 0;

  return (
    <main className="flex min-h-dvh flex-col bg-bg text-text">
      <div
        className="flex-1 overflow-y-auto px-4 pt-[calc(1.5rem+var(--safe-top,0px))]"
        style={{ paddingBottom: hasItems ? "6rem" : "1.5rem" }}
      >
        <h1 className="mb-4 font-sans text-2xl">Free Trace</h1>

        {loadError && (
          <p className="mb-4 font-sans text-sm text-text-muted">{loadError}</p>
        )}
        {actionError && (
          <p className="mb-4 font-sans text-sm text-text-muted">
            {actionError}
          </p>
        )}

        {references === null && !loadError && (
          <p className="font-sans text-sm text-text-muted">Loading…</p>
        )}

        {references !== null && references.length === 0 && (
          <div className="flex flex-col items-center gap-4 pt-12 text-center">
            <p className="font-sans text-sm text-text-muted">
              No references yet — add a photo to trace.
            </p>
            <AddPhotoButton />
          </div>
        )}

        {hasItems && (
          <ul className="grid grid-cols-2 gap-3">
            {references!.map((reference) => (
              <LibraryCard
                key={reference.id}
                reference={reference}
                thumbUrl={thumbUrls[reference.id]}
                onOpenMenu={() => setMenuId(reference.id)}
                onOpen={() => router.push(`/trace/${reference.id}`)}
              />
            ))}
          </ul>
        )}
      </div>

      {hasItems && (
        <div
          className="sticky bottom-0 flex justify-center bg-surface/90 px-4 pt-3 backdrop-blur"
          style={{
            paddingBottom: "calc(0.75rem + var(--safe-bottom, 0px))",
          }}
        >
          <AddPhotoButton />
        </div>
      )}

      <Sheet open={menuId !== null} onClose={closeMenu} label="Reference actions">
        <div className="flex flex-col gap-1 pb-2">
          <SheetAction label="Rename" onClick={openRename} />
          <SheetAction label="Re-tune" onClick={openRetune} />
          <SheetAction label="Delete" onClick={openDeleteConfirm} />
        </div>
      </Sheet>

      <Sheet
        open={renameId !== null}
        onClose={() => setRenameId(null)}
        label="Rename reference"
      >
        <div className="flex flex-col gap-3 pb-2">
          <label className="font-sans text-sm text-text-muted" htmlFor="rename-input">
            Name
          </label>
          <input
            id="rename-input"
            type="text"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            className="min-h-11 rounded-full bg-bg px-4 font-sans text-sm text-text"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setRenameId(null)}
              className="min-h-11 flex-1 rounded-full bg-bg font-sans text-sm text-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void confirmRename();
              }}
              className="min-h-11 flex-1 rounded-full bg-accent font-sans text-sm text-bg"
            >
              Save
            </button>
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete this reference?"
        body="The photo, its line art and its trace settings will be removed from this device. This can't be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={() => setDeleteId(null)}
      />
    </main>
  );
}

function SheetAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 rounded-lg px-2 text-left font-sans text-base text-text active:bg-bg"
    >
      {label}
    </button>
  );
}

function LibraryCard({
  reference,
  thumbUrl,
  onOpenMenu,
  onOpen,
}: {
  reference: Reference;
  thumbUrl: string | undefined;
  onOpenMenu: () => void;
  onOpen: () => void;
}) {
  return (
    <li>
      <Card className="relative overflow-hidden">
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${reference.name}`}
          className="-m-4 block text-left"
        >
          <div className="aspect-square w-full overflow-hidden bg-bg">
            {thumbUrl && (
              // Thumbnails are transient blob: object URLs from IndexedDB,
              // not static assets next/image's optimizer can resolve.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <p className="truncate px-4 pb-3 pt-2 font-sans text-sm text-text">
            {reference.name}
          </p>
        </button>
        <IconButton
          aria-label={`Actions for ${reference.name}`}
          onClick={onOpenMenu}
          className="absolute right-1 top-1 bg-bg/60 text-text"
        >
          ⋯
        </IconButton>
      </Card>
    </li>
  );
}
