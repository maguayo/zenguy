import { useRef, type KeyboardEvent } from "react";
import clsx from "clsx";

export interface TabItem {
  count?: number;
  key: string;
  label: string;
}

export interface TabsProps {
  items: TabItem[];
  onChange: (key: string) => void;
  value: string;
}

export function Tabs({ items, onChange, value }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const move = (event: KeyboardEvent<HTMLButtonElement>, direction: 1 | -1) => {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const current = buttons.indexOf(event.currentTarget);
    const next = buttons[(current + direction + buttons.length) % buttons.length];
    if (next) {
      event.preventDefault();
      next.focus();
      onChange(next.dataset.key ?? "");
    }
  };

  return (
    <div ref={listRef} className="flex gap-5 overflow-x-auto border-b border-zinc-200" role="tablist">
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            aria-selected={active}
            className={clsx(
              "-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-0.5 text-sm font-medium",
              active
                ? "border-accent-600 text-accent-700"
                : "border-transparent text-zinc-500 hover:text-zinc-800",
            )}
            data-key={item.key}
            role="tab"
            tabIndex={active ? 0 : -1}
            type="button"
            onClick={() => onChange(item.key)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") move(event, 1);
              else if (event.key === "ArrowLeft") move(event, -1);
              else if (event.key === "Home" && items[0]) {
                event.preventDefault();
                onChange(items[0].key);
                listRef.current?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus();
              } else if (event.key === "End" && items.at(-1)) {
                event.preventDefault();
                onChange(items.at(-1)?.key ?? "");
                Array.from(
                  listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
                )
                  .at(-1)
                  ?.focus();
              }
            }}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
