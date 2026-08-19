import type { ReactNode } from "react";
import clsx from "clsx";

import { TableSkeleton } from "./Skeleton";

export interface TableColumn<TRow> {
  className?: string;
  header: ReactNode;
  key: string;
  render: (row: TRow) => ReactNode;
}

export interface TableProps<TRow> {
  columns: TableColumn<TRow>[];
  empty?: ReactNode;
  loading?: boolean;
  onRowClick?: (row: TRow) => void;
  rowKey: (row: TRow) => string;
  rows: TRow[];
}

export function Table<TRow>({
  columns,
  empty,
  loading = false,
  onRowClick,
  rowKey,
  rows,
}: TableProps<TRow>) {
  if (loading) return <TableSkeleton columns={columns.length} />;
  if (rows.length === 0) return <>{empty ?? null}</>;

  return (
    <div className="relative overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
            {columns.map((column) => (
              <th
                key={column.key}
                className={clsx("whitespace-nowrap px-3 py-2.5 font-medium", column.className)}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={clsx(
                onRowClick &&
                  "cursor-pointer transition-colors hover:bg-zinc-50 focus-visible:bg-zinc-50",
              )}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={() => onRowClick?.(row)}
              onKeyDown={(event) => {
                if (onRowClick && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onRowClick(row);
                }
              }}
            >
              {columns.map((column) => (
                <td key={column.key} className={clsx("px-3 py-2.5 align-middle", column.className)}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
