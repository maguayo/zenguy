import { useState } from "react";
import { ImageOff } from "lucide-react";

import type { Attempt } from "../api/types";
import type { ScreenshotItem } from "./ScreenshotViewer";

export interface FilmstripItem extends ScreenshotItem {
  label: string;
  sequence: number | null;
}

export function filmstripItems(attempt: Attempt): FilmstripItem[] {
  return attempt.screenshots.map((screenshot, index) => {
    const step = attempt.steps.find((candidate) => candidate.screenshot?.id === screenshot.id);
    if (step === undefined) {
      const fallback = `Screenshot ${index + 1}`;
      return { ...screenshot, caption: fallback, label: fallback, sequence: null };
    }
    return {
      ...screenshot,
      caption: step.description,
      label: `Step ${step.sequence} · ${step.actionType}`,
      sequence: step.sequence,
    };
  });
}

function FilmstripThumbnail({
  index,
  item,
  onOpen,
}: {
  index: number;
  item: FilmstripItem;
  onOpen: () => void;
}) {
  const [expired, setExpired] = useState(false);
  const name = item.sequence === null ? `screenshot ${index + 1}` : `step ${item.sequence} screenshot`;

  return (
    <button
      aria-label={`Open ${name}`}
      className="block w-56 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 text-left transition hover:border-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2"
      type="button"
      onClick={onOpen}
    >
      {expired ? (
        <span className="grid h-36 place-items-center gap-1 text-xs text-zinc-500">
          <ImageOff aria-hidden="true" className="size-5" />
          Screenshot expired
        </span>
      ) : (
        <img
          alt={item.label}
          className="h-36 w-full object-cover object-top"
          loading="lazy"
          src={item.url}
          onError={() => setExpired(true)}
        />
      )}
      <span className="block truncate border-t border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-700">
        {item.label}
      </span>
    </button>
  );
}

export function ScreenshotFilmstrip({
  items,
  onOpen,
}: {
  items: FilmstripItem[];
  onOpen: (index: number) => void;
}) {
  if (items.length === 0) return null;

  return (
    <ol aria-label="Step screenshots" className="flex gap-3 overflow-x-auto pb-2">
      {items.map((item, index) => (
        <li className="shrink-0" key={item.id}>
          <FilmstripThumbnail index={index} item={item} onOpen={() => onOpen(index)} />
        </li>
      ))}
    </ol>
  );
}
