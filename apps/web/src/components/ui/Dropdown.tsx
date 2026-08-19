import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";

export interface DropdownItem {
  children?: DropdownItem[];
  description?: string;
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  onSelect: () => void;
  separatorBefore?: boolean;
  suffix?: ReactNode;
  tone?: "danger";
}

export interface DropdownProps {
  align?: "start" | "end";
  items: DropdownItem[];
  trigger: ReactElement<Record<string, unknown>>;
  triggerWrapperClassName?: string;
}

export function nextMenuIndex(
  current: number,
  direction: 1 | -1,
  items: Pick<DropdownItem, "disabled">[],
): number {
  if (items.length === 0) return -1;
  let index = current;
  for (let attempts = 0; attempts < items.length; attempts += 1) {
    index = (index + direction + items.length) % items.length;
    if (!items[index]?.disabled) return index;
  }
  return -1;
}

export function Dropdown({
  align = "end",
  items,
  trigger,
  triggerWrapperClassName,
}: DropdownProps) {
  const menuId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 176 });

  const triggerElement = () =>
    wrapperRef.current?.querySelector<HTMLElement>(
      "button, a[href], [tabindex]:not([tabindex='-1'])",
    );

  const positionMenu = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(176, rect.width);
    setPosition({
      left: align === "end" ? Math.max(8, rect.right - width) : rect.left,
      top: rect.bottom + 6,
      width,
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    positionMenu();

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handlePosition = () => positionMenu();
    document.addEventListener("mousedown", handlePointer);
    window.addEventListener("resize", handlePosition);
    window.addEventListener("scroll", handlePosition, true);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("resize", handlePosition);
      window.removeEventListener("scroll", handlePosition, true);
    };
  }, [align, open]);

  useEffect(() => {
    if (!open) setSubmenuIndex(null);
  }, [open]);

  const focusItem = (index: number) => {
    menuRef.current
      ?.querySelectorAll<HTMLButtonElement>('[data-dropdown-root-item="true"]')
      [index]?.focus();
  };

  const focusSubmenuItem = (index: number, childIndex = 0) => {
    menuRef.current
      ?.querySelectorAll<HTMLButtonElement>(`[data-dropdown-submenu="${index}"]`)
      [childIndex]?.focus();
  };

  const openAndFocus = (direction: 1 | -1) => {
    setOpen(true);
    requestAnimationFrame(() => {
      const start = direction === 1 ? -1 : 0;
      focusItem(nextMenuIndex(start, direction, items));
    });
  };

  const renderedTrigger = cloneElement(trigger, {
    "aria-controls": open ? menuId : undefined,
    "aria-expanded": open,
    "aria-haspopup": "menu",
  });

  return (
    <>
      <span
        ref={wrapperRef}
        className={clsx("inline-flex", triggerWrapperClassName)}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openAndFocus(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        {renderedTrigger}
      </span>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              aria-labelledby={menuId}
              className="fixed z-[60] rounded-md border border-zinc-200 bg-white py-1 shadow-lg"
              id={menuId}
              role="menu"
              style={{ left: position.left, top: position.top, width: position.width }}
              onKeyDown={(event) => {
                const buttons = Array.from(
                  menuRef.current?.querySelectorAll<HTMLButtonElement>(
                    '[data-dropdown-root-item="true"]',
                  ) ?? [],
                );
                const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  focusItem(nextMenuIndex(current, event.key === "ArrowDown" ? 1 : -1, items));
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  focusItem(nextMenuIndex(event.key === "Home" ? -1 : 0, event.key === "Home" ? 1 : -1, items));
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  triggerElement()?.focus();
                } else if (event.key === "ArrowRight" && current >= 0) {
                  const children = items[current]?.children;
                  if (children?.length) {
                    event.preventDefault();
                    setSubmenuIndex(current);
                    requestAnimationFrame(() =>
                      focusSubmenuItem(current, nextMenuIndex(-1, 1, children)),
                    );
                  }
                } else if (event.key === "ArrowLeft" && submenuIndex !== null) {
                  event.preventDefault();
                  setSubmenuIndex(null);
                  focusItem(submenuIndex);
                }
              }}
            >
              {items.map((item, index) => (
                <div
                  key={`${item.label}-${index}`}
                  className={clsx(
                    "relative",
                    item.separatorBefore && "mt-1 border-t border-zinc-200 pt-1",
                  )}
                  onMouseEnter={() => {
                    if (item.children?.length) setSubmenuIndex(index);
                  }}
                >
                  <button
                    className={clsx(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 focus:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50",
                      item.tone === "danger" ? "text-danger-700" : "text-zinc-700",
                    )}
                    disabled={item.disabled}
                    aria-expanded={item.children?.length ? submenuIndex === index : undefined}
                    aria-haspopup={item.children?.length ? "menu" : undefined}
                    data-dropdown-root-item="true"
                    role="menuitem"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (item.children?.length) {
                        setSubmenuIndex(index);
                        requestAnimationFrame(() =>
                          focusSubmenuItem(
                            index,
                            nextMenuIndex(-1, 1, item.children ?? []),
                          ),
                        );
                        return;
                      }
                      item.onSelect();
                      setOpen(false);
                      triggerElement()?.focus();
                    }}
                  >
                    {item.icon ? <span aria-hidden="true" className="shrink-0">{item.icon}</span> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {item.description ? (
                        <span className="block truncate text-xs text-zinc-500">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                    {item.suffix ? (
                      <span className="shrink-0">{item.suffix}</span>
                    ) : item.children?.length ? (
                      <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
                    ) : null}
                  </button>
                  {item.children?.length && submenuIndex === index ? (
                    <div
                      aria-label={item.label}
                      className="absolute right-full top-0 mr-1 w-40 rounded-md border border-zinc-200 bg-white py-1 shadow-lg"
                      role="menu"
                    >
                      {item.children.map((child, childIndex) => (
                        <button
                          key={`${child.label}-${childIndex}`}
                          className={clsx(
                            "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 focus:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50",
                            child.tone === "danger" ? "text-danger-700" : "text-zinc-700",
                          )}
                          data-dropdown-submenu={index}
                          disabled={child.disabled}
                          role="menuitem"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            child.onSelect();
                            setOpen(false);
                            triggerElement()?.focus();
                          }}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            const children = item.children ?? [];
                            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                              event.preventDefault();
                              focusSubmenuItem(
                                index,
                                nextMenuIndex(
                                  childIndex,
                                  event.key === "ArrowDown" ? 1 : -1,
                                  children,
                                ),
                              );
                            } else if (event.key === "ArrowLeft" || event.key === "Escape") {
                              event.preventDefault();
                              setSubmenuIndex(null);
                              focusItem(index);
                            }
                          }}
                        >
                          {child.icon ? (
                            <span aria-hidden="true" className="shrink-0">
                              {child.icon}
                            </span>
                          ) : null}
                          <span className="min-w-0 flex-1 truncate">{child.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
