import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";

import { useWorkspace } from "../contexts/WorkspaceContext";
import { IconButton } from "./ui/IconButton";
import { Sidebar } from "./Sidebar";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function MobileDrawer({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      );
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
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        aria-label="Close navigation"
        className="absolute inset-0 bg-zinc-950/40"
        type="button"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        aria-label="Navigation"
        aria-modal="true"
        className="relative h-full w-[min(320px,90vw)] border-r border-zinc-200 bg-white shadow-lg"
        role="dialog"
      >
        <IconButton
          aria-label="Close navigation"
          className="absolute right-2 top-3 z-10"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-4" />
        </IconButton>
        <Sidebar onNavigate={onClose} />
      </div>
    </div>
  );
}

export function AppLayout() {
  const location = useLocation();
  const { can, current, subscriptionStatus } = useWorkspace();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
    window.scrollTo({ left: 0, top: 0 });
  }, [location.pathname, location.search]);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-zinc-200 md:block">
        <Sidebar />
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 grid h-14 grid-cols-[40px_1fr_40px] items-center border-b border-zinc-200 bg-white px-3 md:hidden">
          <IconButton aria-label="Menu" onClick={() => setDrawerOpen(true)}>
            <Menu aria-hidden="true" className="size-5" />
          </IconButton>
          <Link
            className="justify-self-center text-lg font-bold tracking-tight text-zinc-950"
            to={`/w/${current.id}/overview`}
          >
            zenguy<span className="text-accent-600">.</span>
          </Link>
          <span aria-hidden="true" />
        </header>

        {subscriptionStatus === "PAST_DUE" ? (
          <div className="border-b border-warn-600/20 bg-warn-50 px-4 py-3 text-sm text-zinc-800 md:px-6">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
              <p>Your last payment failed. Update your payment method to keep runs going.</p>
              {can("billing.manage") ? (
                <Link
                  className="inline-flex h-8 items-center rounded-md border border-warn-600/30 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-warn-50"
                  to={`/w/${current.id}/billing`}
                >
                  Update payment
                </Link>
              ) : (
                <p className="font-medium">Contact your workspace owner.</p>
              )}
            </div>
          </div>
        ) : null}

        <main className="mx-auto max-w-6xl px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>

      {drawerOpen ? <MobileDrawer onClose={() => setDrawerOpen(false)} /> : null}
    </div>
  );
}
