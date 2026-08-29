import type { ReactNode } from "react";

/**
 * Marcos' hero layout: three widgets stacked in a narrow left column, the chart
 * taking the rest of the row. Below `lg` the widgets fold into a row of three
 * above the chart; on phones everything stacks.
 */
export function HeroSection({
  chart,
  footer,
  widgets,
}: {
  chart: ReactNode;
  footer?: ReactNode;
  widgets: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="grid content-start gap-4 sm:grid-cols-3 lg:grid-cols-1">{widgets}</div>
        <div className="min-w-0">{chart}</div>
      </div>
      {footer}
    </div>
  );
}
