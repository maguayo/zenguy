import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

import type { ArtifactRef } from "../api/types";
import { IconButton } from "./ui/IconButton";
import { Modal } from "./ui/Modal";

export interface ScreenshotItem extends ArtifactRef {
  caption: string;
}

export function nextScreenshotIndex(
  current: number,
  count: number,
  direction: 1 | -1,
): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, current + direction));
}

export function ScreenshotViewer({
  initialIndex,
  onClose,
  open,
  screenshots,
}: {
  initialIndex: number;
  onClose: () => void;
  open: boolean;
  screenshots: ScreenshotItem[];
}) {
  const [index, setIndex] = useState(initialIndex);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (open) setIndex(Math.min(Math.max(0, initialIndex), Math.max(0, screenshots.length - 1)));
  }, [initialIndex, open, screenshots.length]);

  useEffect(() => setExpired(false), [index, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((current) => nextScreenshotIndex(current, screenshots.length, -1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((current) => nextScreenshotIndex(current, screenshots.length, 1));
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, screenshots.length]);

  const screenshot = screenshots[index];

  return (
    <Modal
      className="!p-0"
      contentClassName="flex h-[calc(100dvh-57px)] flex-col p-0"
      headerClassName="border-zinc-800 [&_button]:text-zinc-300 [&_button:hover]:bg-zinc-800"
      onClose={onClose}
      open={open}
      panelClassName="h-[100dvh] max-h-[100dvh] max-w-none rounded-none bg-zinc-950"
      title={<span className="text-white">Screenshot evidence</span>}
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8">
        {screenshot && !expired ? (
          <img
            alt={`Screenshot ${index + 1}`}
            className="max-h-full max-w-full object-contain"
            src={screenshot.url}
            onError={() => setExpired(true)}
          />
        ) : (
          <div className="grid place-items-center gap-3 text-zinc-400">
            <ImageOff aria-hidden="true" className="size-10" />
            <p>Screenshot expired</p>
          </div>
        )}
        <IconButton
          aria-label="Previous screenshot"
          className="absolute left-3 bg-zinc-900/70 text-white hover:bg-zinc-800 disabled:opacity-30 sm:left-6"
          disabled={index <= 0}
          onClick={() => setIndex((current) => nextScreenshotIndex(current, screenshots.length, -1))}
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
        </IconButton>
        <IconButton
          aria-label="Next screenshot"
          className="absolute right-3 bg-zinc-900/70 text-white hover:bg-zinc-800 disabled:opacity-30 sm:right-6"
          disabled={index >= screenshots.length - 1}
          onClick={() => setIndex((current) => nextScreenshotIndex(current, screenshots.length, 1))}
        >
          <ChevronRight aria-hidden="true" className="size-5" />
        </IconButton>
      </div>
      <div className="border-t border-zinc-800 px-4 py-3 text-center text-sm text-zinc-300">
        <p>
          {screenshots.length === 0 ? 0 : index + 1} of {screenshots.length}
        </p>
        {screenshot?.caption ? <p className="mt-1 text-zinc-400">{screenshot.caption}</p> : null}
      </div>
    </Modal>
  );
}
