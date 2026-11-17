import { LoaderCircle, type LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

type Props = {
  open: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  pendingLabel?: string;
  busy?: boolean;
  error?: string | null;
  destructive?: boolean;
  icon: LucideIcon;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export default function ConfirmationDialog({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  pendingLabel = confirmLabel,
  busy = false,
  error,
  destructive = false,
  icon: Icon,
  onOpenChange,
  onConfirm,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="confirmation-dialog"
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <div
          className={`confirmation-dialog__icon${destructive ? " is-destructive" : ""}`}
          aria-hidden="true"
        >
          <Icon size={21} />
        </div>
        <DialogHeader className="confirmation-dialog__header">
          <DialogTitle className="confirmation-dialog__title">
            {title}
          </DialogTitle>
          <DialogDescription className="confirmation-dialog__description">
            {description}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="confirmation-dialog__error" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="confirmation-dialog__footer">
          <button
            type="button"
            className="outline-button"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirmation-dialog__confirm${destructive ? " is-destructive" : ""}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? (
              <LoaderCircle
                size={17}
                className="confirmation-dialog__spinner"
                aria-hidden="true"
              />
            ) : (
              <Icon size={17} aria-hidden="true" />
            )}
            {busy ? pendingLabel : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
