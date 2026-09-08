import { Button } from "./Button";
import { Sheet } from "./Sheet";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// Built on Sheet. Destructive confirm + cancel only — a typed "type DELETE
// to confirm" step is T-13's concern, not this ticket's.
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Sheet open={open} onClose={onCancel} label={title}>
      <h2 className="font-sans text-lg font-semibold text-text">{title}</h2>
      <p className="mt-2 font-sans text-sm text-text-muted">{body}</p>
      <div className="mt-6 flex gap-3">
        <Button variant="quiet" className="flex-1" onClick={onCancel}>
          {cancelLabel}
        </Button>
        {/* The SPEC §7 palette has no separate "destructive" token, so the
            confirm action uses the same accent primary variant as every
            other primary action — the destructive semantics live in the
            copy (title/body/label), not a new colour. */}
        <Button variant="primary" className="flex-1" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
