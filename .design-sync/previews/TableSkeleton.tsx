import { TableSkeleton } from "@zenguy/frontend";

export const RunsTableLoading = () => (
  <div style={{ maxWidth: 640 }}>
    <TableSkeleton />
  </div>
);

export const ColumnCounts = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 640 }}>
    <div>
      <p style={{ fontSize: 12, color: "#71717a", margin: "0 0 8px" }}>3 columns — incidents list</p>
      <TableSkeleton columns={3} />
    </div>
    <div>
      <p style={{ fontSize: 12, color: "#71717a", margin: "0 0 8px" }}>6 columns — monitor checks</p>
      <TableSkeleton columns={6} />
    </div>
  </div>
);
