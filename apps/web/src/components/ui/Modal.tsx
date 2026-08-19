import {
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import clsx from "clsx";

import { IconButton } from "./IconButton";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface ModalProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
  panelClassName?: string;
  title: ReactNode;
}

export function Modal({
  children,
  className,
  footer,
  onClose,
  open,
  panelClassName,
  title,
  ...props
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(focusableSelector);
    (firstFocusable ?? panel)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hasAttribute("disabled"));

      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      className={clsx(
        "fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-3 sm:p-4",
        className,
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      {...props}
    >
      <div
        ref={panelRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className={clsx(
          "max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-lg",
          panelClassName,
        )}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-900" id={titleId}>
            {title}
          </h2>
          <IconButton aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" className="size-4" />
          </IconButton>
        </div>
        <div className="p-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
