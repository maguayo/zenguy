import { Copy } from "lucide-react";

import { useToast } from "../contexts/ToastContext";
import { IconButton } from "./ui/IconButton";

export interface CopyButtonProps {
  label?: string;
  text: string;
}

export function CopyButton({ label = "Copy", text }: CopyButtonProps) {
  const toast = useToast();

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  return (
    <IconButton aria-label={label} onClick={() => void copy()}>
      <Copy aria-hidden="true" className="size-4" />
    </IconButton>
  );
}
