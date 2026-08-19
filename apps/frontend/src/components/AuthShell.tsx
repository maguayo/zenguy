import type { ReactNode } from "react";
import { Check } from "lucide-react";

export interface AuthShellProps {
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  title: ReactNode;
}

function Wordmark({ className }: { className?: string }) {
  return (
    <div className={className}>
      zenguy<span className="text-indigo-400">.</span>
    </div>
  );
}

const FEED_STEPS = [
  { latency: "0.9s", text: "Open aurora-plants.com" },
  { latency: "1.4s", text: "Add “Monstera XL” to the cart" },
  { latency: "2.1s", text: "Pay with a test card" },
  { latency: "0.7s", text: "Order confirmation is shown" },
];

function UptimeDot() {
  return (
    <span className="relative flex size-2 shrink-0">
      <span className="auth-breathe absolute inline-flex size-full rounded-full bg-emerald-400" />
      <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
    </span>
  );
}

function MonitorFeed() {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 font-mono text-[13px]">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium text-zinc-200">checkout-flow</span>
        <span className="text-xs text-zinc-500">every 15 min</span>
      </div>
      <ul className="mt-4 space-y-2.5">
        {FEED_STEPS.map((step, index) => (
          <li
            key={step.text}
            className="auth-feed-item flex items-center gap-3"
            style={{ animationDelay: `${0.5 + index * 0.7}s` }}
          >
            <Check aria-hidden="true" className="size-3.5 shrink-0 text-emerald-400" strokeWidth={3} />
            <span className="flex-1 text-zinc-300">{step.text}</span>
            <span className="text-xs text-zinc-500">{step.latency}</span>
          </li>
        ))}
      </ul>
      <div className="auth-feed-item mt-4 border-t border-white/10 pt-4" style={{ animationDelay: "3.4s" }}>
        <div className="flex items-center gap-3">
          <UptimeDot />
          <span className="flex-1 text-zinc-300">api.aurora-plants.com</span>
          <span className="text-xs text-emerald-400">99.98%</span>
        </div>
        <div aria-hidden="true" className="mt-3 flex gap-[3px]">
          {Array.from({ length: 28 }, (_, index) => (
            <span
              key={index}
              className="h-4 w-1 rounded-[2px] bg-emerald-500/60"
              style={{ opacity: index % 9 === 4 ? 0.35 : undefined }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MonitorPanel() {
  return (
    <aside className="hidden flex-col justify-between bg-zinc-950 p-10 lg:flex xl:p-14">
      <Wordmark className="text-2xl font-bold tracking-tight text-white" />
      <div className="max-w-md py-10">
        <h2 className="font-display text-5xl text-white italic">Stay zen.</h2>
        <p className="mt-4 text-[15px] leading-relaxed text-zinc-400">
          Zenguy runs real-browser tests and uptime checks around the clock — and only speaks up
          when something breaks.
        </p>
        <div className="mt-10">
          <MonitorFeed />
        </div>
      </div>
      <p className="font-mono text-xs text-zinc-500">
        2,847 checks in the last hour · 0 open incidents
      </p>
    </aside>
  );
}

export function AuthShell({ children, description, footer, title }: AuthShellProps) {
  return (
    <main className="min-h-screen bg-white lg:grid lg:grid-cols-[minmax(420px,44%)_minmax(0,1fr)]">
      <div className="flex items-center justify-between bg-zinc-950 px-5 py-4 lg:hidden">
        <Wordmark className="text-lg font-bold tracking-tight text-white" />
        <span className="flex items-center gap-2 font-mono text-xs text-zinc-400">
          <UptimeDot />
          All quiet
        </span>
      </div>
      <MonitorPanel />
      <div className="flex justify-center px-4 py-12 sm:px-6 lg:items-center lg:py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{title}</h1>
            {description ? <p className="mt-2 text-sm text-zinc-500">{description}</p> : null}
          </div>
          {children}
          {footer ? (
            <div className="mt-8 border-t border-zinc-100 pt-5 text-sm text-zinc-500">{footer}</div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
