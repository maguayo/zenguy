import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { IconButton } from "./ui/IconButton";

export interface CopyButtonProps {
  label?: string;
  text: string;
}

export function CopyButton({ label = "Copy", text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };

  return (
    <>
      <IconButton aria-label={label} onClick={() => void copy()}>
        {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
      </IconButton>
      {copied
        ? createPortal(
            <div
              aria-live="polite"
              className="fixed right-4 top-4 z-[70] rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white shadow-lg"
              role="status"
            >
              Copied
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
