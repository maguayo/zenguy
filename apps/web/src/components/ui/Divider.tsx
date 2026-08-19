import type { HTMLAttributes } from "react";
import clsx from "clsx";

export function Divider({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={clsx("border-0 border-t border-zinc-200", className)} {...props} />;
}
