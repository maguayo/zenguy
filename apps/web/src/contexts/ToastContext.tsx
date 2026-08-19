import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import clsx from "clsx";

import { IconButton } from "../components/ui/IconButton";

type ToastTone = "success" | "error";

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface ToastApi {
  error: (message: string) => void;
  success: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function appendToast(items: ToastItem[], item: ToastItem): ToastItem[] {
  return [...items, item].slice(-4);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const add = useCallback(
    (message: string, tone: ToastTone) => {
      const id = ++nextId.current;
      setItems((current) => appendToast(current, { id, message, tone }));
      const duration = tone === "error" ? 6_000 : 4_000;
      timers.current.set(id, window.setTimeout(() => remove(id), duration));
    },
    [remove],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      error: (message) => add(message, "error"),
      success: (message) => add(message, "success"),
    }),
    [add],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions removals"
        className="pointer-events-none fixed right-4 top-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={clsx(
              "pointer-events-auto flex items-start gap-3 rounded-lg border bg-white p-3 shadow-lg",
              item.tone === "success" ? "border-ok-600/20" : "border-danger-600/20",
            )}
            role="status"
          >
            {item.tone === "success" ? (
              <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ok-600" />
            ) : (
              <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger-600" />
            )}
            <p className="min-w-0 flex-1 text-sm text-zinc-800">{item.message}</p>
            <IconButton aria-label="Dismiss notification" onClick={() => remove(item.id)}>
              <X aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used within ToastProvider");
  return value;
}
