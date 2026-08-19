import { Link } from "react-router-dom";

import { Card } from "../components/ui/Card";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">404</p>
        <h1 className="mt-2 text-xl font-semibold text-zinc-900">Page not found</h1>
        <p className="mt-2 text-sm text-zinc-500">
          The page you requested doesn't exist or has moved.
        </p>
        <Link
          className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white transition-colors hover:bg-accent-700"
          to="/"
        >
          Home
        </Link>
      </Card>
    </main>
  );
}
