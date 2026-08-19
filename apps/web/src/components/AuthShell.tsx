import type { ReactNode } from "react";

import { Card } from "./ui/Card";

export interface AuthShellProps {
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  title: ReactNode;
}

export function AuthShell({ children, description, footer, title }: AuthShellProps) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-2xl font-bold tracking-tight text-zinc-950">
          zenguy<span className="text-accent-600">.</span>
        </div>
        <Card className="p-6" padding="none">
          <div className="mb-5 text-center">
            <h1 className="text-xl font-semibold text-zinc-900">{title}</h1>
            {description ? <p className="mt-1.5 text-sm text-zinc-500">{description}</p> : null}
          </div>
          {children}
        </Card>
        {footer ? <div className="mt-4 text-center text-sm text-zinc-500">{footer}</div> : null}
      </div>
    </main>
  );
}
