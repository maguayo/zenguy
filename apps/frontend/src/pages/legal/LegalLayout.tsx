import type { ReactNode } from "react";

export function LegalLayout({
  children,
  lastUpdated = "27 August 2026",
  title,
}: {
  children: ReactNode;
  lastUpdated?: string;
  title: string;
}) {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-10 text-zinc-800 sm:px-6 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-xl border border-zinc-200 bg-white px-6 py-8 shadow-sm sm:px-10 sm:py-12">
        <a
          className="text-xl font-bold tracking-tight text-zinc-950 hover:text-accent-700"
          href="https://zenguy.com"
        >
          zenguy<span className="text-accent-600">.</span>
        </a>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-zinc-950">
          {title}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Effective and last updated: {lastUpdated}
        </p>
        <div className="legal-copy mt-10 space-y-8 text-[15px] leading-7">
          {children}
        </div>
        <footer className="mt-12 flex flex-wrap gap-4 border-t border-zinc-200 pt-6 text-sm">
          <a className="text-accent-700 hover:underline" href="https://zenguy.com/legal-notice/">
            Legal notice
          </a>
          <a className="text-accent-700 hover:underline" href="https://zenguy.com/privacy/">
            Privacy
          </a>
          <a className="text-accent-700 hover:underline" href="https://zenguy.com/terms/">
            Terms
          </a>
          <a className="text-accent-700 hover:underline" href="https://zenguy.com/cookies/">
            Cookies
          </a>
        </footer>
      </article>
    </main>
  );
}

export function LegalSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold text-zinc-950">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
