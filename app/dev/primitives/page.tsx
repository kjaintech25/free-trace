"use client";

import { useState } from "react";
import {
  Button,
  Card,
  ConfirmDialog,
  IconButton,
  Sheet,
  Slider,
} from "@/components/ui";

// Inline SVG lock icon — no icon library per SPEC §4.
function LockIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-sans text-sm font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </section>
  );
}

// Renders every primitive in every state (default, active, disabled, sheet
// open, dialog open, slider at 0/50/100) for visual review. Plain client
// page, no auth, no gating (SPEC §2: no accounts of any kind).
export default function PrimitivesPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [lockActive, setLockActive] = useState(false);
  const [sliderZero, setSliderZero] = useState(0);
  const [sliderMid, setSliderMid] = useState(50);
  const [sliderFull, setSliderFull] = useState(100);

  return (
    <main className="flex min-h-dvh flex-col gap-10 bg-bg p-6 text-text">
      <h1 className="font-sans text-2xl font-semibold">Design primitives</h1>

      <Section title="Button — primary / quiet / disabled">
        <Button variant="primary">Primary</Button>
        <Button variant="quiet">Quiet</Button>
        <Button variant="primary" disabled>
          Primary disabled
        </Button>
        <Button variant="quiet" disabled>
          Quiet disabled
        </Button>
      </Section>

      <Section title="IconButton — default / active / disabled">
        <IconButton aria-label="Lock (inactive)">
          <LockIcon />
        </IconButton>
        <IconButton
          aria-label="Lock (toggle)"
          active={lockActive}
          onClick={() => setLockActive((v) => !v)}
        >
          <LockIcon />
        </IconButton>
        <IconButton aria-label="Lock (disabled)" disabled>
          <LockIcon />
        </IconButton>
      </Section>

      <Section title="Slider — 0 / 50 / 100">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <Slider label="Opacity at 0" value={sliderZero} onChange={setSliderZero} />
          <Slider label="Opacity at 50" value={sliderMid} onChange={setSliderMid} />
          <Slider label="Opacity at 100" value={sliderFull} onChange={setSliderFull} />
          <Slider label="Opacity disabled" value={50} onChange={() => {}} disabled />
        </div>
      </Section>

      <Section title="Card">
        <Card className="w-64">
          <p className="font-sans text-sm text-text">
            Card surface, 12px radius.
          </p>
        </Card>
      </Section>

      <Section title="Sheet">
        <Button variant="quiet" onClick={() => setSheetOpen(true)}>
          Open sheet
        </Button>
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} label="Example sheet">
          <p className="pb-4 font-sans text-sm text-text">
            This is a bottom sheet on the surface token, with 12px top radius
            and safe-area-aware bottom padding.
          </p>
        </Sheet>
      </Section>

      <Section title="ConfirmDialog">
        <Button variant="quiet" onClick={() => setDialogOpen(true)}>
          Open confirm dialog
        </Button>
        <ConfirmDialog
          open={dialogOpen}
          title="Delete this reference?"
          body="This removes the photo, its line art, and its settings. This cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={() => setDialogOpen(false)}
          onCancel={() => setDialogOpen(false)}
        />
      </Section>
    </main>
  );
}
