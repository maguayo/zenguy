import { ShieldAlert } from "lucide-react";

import { Card } from "./ui/Card";

export function AccessDenied({ message }: { message: string }) {
  return (
    <Card className="mx-auto max-w-xl text-center">
      <ShieldAlert aria-hidden="true" className="mx-auto size-8 text-zinc-500" />
      <h1 className="mt-3 text-lg font-semibold text-zinc-900">Access denied</h1>
      <p className="mt-1 text-sm text-zinc-500">{message}</p>
    </Card>
  );
}
