import { Table, StatusBadge, EmptyState } from "@zenguy/frontend";

interface RunRow {
  duration: string;
  id: string;
  name: string;
  started: string;
  status: string;
}

const columns = [
  { header: "Test", key: "name", render: (r: RunRow) => <span style={{ fontWeight: 500 }}>{r.name}</span> },
  { header: "Status", key: "status", render: (r: RunRow) => <StatusBadge status={r.status} /> },
  { header: "Started", key: "started", render: (r: RunRow) => r.started },
  { header: "Duration", key: "duration", render: (r: RunRow) => r.duration },
];

const rows: RunRow[] = [
  { duration: "48s", id: "run_1", name: "Checkout flow", started: "2 min ago", status: "PASSED" },
  { duration: "1m 12s", id: "run_2", name: "Signup with Google", started: "14 min ago", status: "FAILED" },
  { duration: "—", id: "run_3", name: "Password reset email", started: "just now", status: "RUNNING" },
  { duration: "52s", id: "run_4", name: "Invite a teammate", started: "1 h ago", status: "PASSED" },
];

export const RecentRuns = () => (
  <Table columns={columns} rowKey={(r: RunRow) => r.id} rows={rows} />
);

export const Loading = () => (
  <Table columns={columns} loading rowKey={(r: RunRow) => r.id} rows={[]} />
);

export const Empty = () => (
  <Table
    columns={columns}
    empty={<EmptyState description="Runs appear here once a test executes." title="No runs yet" />}
    rowKey={(r: RunRow) => r.id}
    rows={[]}
  />
);
