import { useEffect, useState, type ReactNode } from "react";

import { Button } from "./Button";
import { Field } from "./Field";
import { Input } from "./Input";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  body: ReactNode;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  open: boolean;
  requireText?: string;
  title: ReactNode;
  tone?: "default" | "danger";
}

export function ConfirmDialog({
  body,
  confirmLabel = "Confirm",
  onClose,
  onConfirm,
  open,
  requireText,
  title,
  tone = "default",
}: ConfirmDialogProps) {
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) setConfirmation("");
  }, [open]);

  const isEnabled = !requireText || confirmation === requireText;

  const confirm = async () => {
    if (!isEnabled || loading) return;
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      footer={
        <>
          <Button disabled={loading} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!isEnabled}
            loading={loading}
            onClick={() => void confirm()}
            variant={tone === "danger" ? "danger" : "primary"}
          >
            {confirmLabel}
          </Button>
        </>
      }
      onClose={loading ? () => undefined : onClose}
      open={open}
      title={title}
    >
      <div className="space-y-4">
        <div className="text-sm text-zinc-600">{body}</div>
        {requireText ? (
          <Field htmlFor="confirmation-text" label={`Type “${requireText}” to confirm`}>
            <Input
              autoComplete="off"
              id="confirmation-text"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
