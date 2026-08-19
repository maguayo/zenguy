import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, MoreHorizontal, Plus, Upload } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import {
  deleteTest,
  exportTests,
  importTests,
  listTests,
  type ExportFormat,
  type ImportTestsSummary,
} from "../../api/tests";
import type { BrowserTest } from "../../api/types";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dropdown, type DropdownItem } from "../../components/ui/Dropdown";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { IconButton } from "../../components/ui/IconButton";
import { PageHeader } from "../../components/ui/PageHeader";
import { Table, type TableColumn } from "../../components/ui/Table";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import { ApiError } from "../../lib/api";
import { saveBlob } from "../../lib/download";
import { apiErrorMessage } from "../../lib/errors";
import { formatInterval, formatRelative } from "../../lib/format";
import { isActiveRun, useRunNow } from "./hooks";

export function importSummaryMessage(
  summary: Pick<ImportTestsSummary, "created" | "updated">,
): string {
  return `Import complete: ${summary.created} created, ${summary.updated} updated`;
}

export function importErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.details && error.details.length > 0) {
    const shown = error.details
      .slice(0, 3)
      .map((detail) => `${detail.field}: ${detail.message}`)
      .join("; ");
    const remaining = error.details.length - 3;
    return remaining > 0 ? `${shown} (+${remaining} more)` : shown;
  }
  return apiErrorMessage(error);
}

function TestActions({ test }: { test: BrowserTest }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const { can, current } = useWorkspace();
  const run = useRunNow(test);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const remove = useMutation({ mutationFn: () => deleteTest(current.id, test.id) });

  const removeTest = async () => {
    try {
      await remove.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "tests"] });
      toast.success("Test deleted");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const items: DropdownItem[] = [
    {
      label: "Open",
      onSelect: () => navigate(`/w/${current.id}/tests/${test.id}`),
    },
    ...(can("tests.run")
      ? [
          {
            disabled: isActiveRun(test) || run.pending,
            label: "Run now",
            onSelect: run.requestRun,
          },
        ]
      : []),
    ...(can("tests.manage")
      ? [
          {
            label: "Edit",
            onSelect: () => navigate(`/w/${current.id}/tests/${test.id}/edit`),
          },
          {
            label: "Delete",
            onSelect: () => setDeleteOpen(true),
            tone: "danger" as const,
          },
        ]
      : []),
  ];

  return (
    <>
      <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <Dropdown
          items={items}
          trigger={
            <IconButton aria-label={`Actions for ${test.name}`}>
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </IconButton>
          }
        />
      </div>
      <ConfirmDialog {...run.dialogProps} />
      <ConfirmDialog
        body="Its history stays available for 30 days."
        confirmLabel="Delete"
        onClose={() => setDeleteOpen(false)}
        onConfirm={removeTest}
        open={deleteOpen}
        title={`Delete "${test.name}"?`}
        tone="danger"
      />
    </>
  );
}

export function testColumns(workspaceId: string): TableColumn<BrowserTest>[] {
  return [
    {
      header: "Name",
      key: "name",
      render: (test) => (
        <div className="min-w-52">
          <p className="font-medium text-zinc-900">{test.name}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {test.device === "DESKTOP" ? "Desktop" : "Mobile"} ·{" "}
            {formatInterval(test.intervalHours)}
          </p>
        </div>
      ),
    },
    {
      header: "Last status",
      key: "lastStatus",
      render: (test) =>
        test.lastRun ? (
          <div className="space-y-1">
            <StatusBadge
              passedAfterRetry={test.lastRun.passedAfterRetry}
              status={test.lastRun.status}
            />
            {test.lastRun.finishedAt ? (
              <p className="text-xs text-zinc-500">{formatRelative(test.lastRun.finishedAt)}</p>
            ) : null}
          </div>
        ) : (
          "—"
        ),
    },
    {
      header: "Next run",
      key: "nextRun",
      render: (test) => <span className="whitespace-nowrap">{formatRelative(test.nextRunAt)}</span>,
    },
    {
      header: "Incident",
      key: "incident",
      render: (test) =>
        test.openIncidentId ? (
          <Link
            className="inline-flex"
            to={`/w/${workspaceId}/incidents/${test.openIncidentId}`}
            onClick={(event) => event.stopPropagation()}
          >
            <Badge tone="danger">Open</Badge>
          </Link>
        ) : (
          "—"
        ),
    },
    {
      className: "w-12 text-right",
      header: <span className="sr-only">Actions</span>,
      key: "actions",
      render: (test) => <TestActions test={test} />,
    },
  ];
}

export default function TestsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const { can, current } = useWorkspace();
  const fileInput = useRef<HTMLInputElement>(null);
  const tests = useQuery({
    queryFn: () => listTests(current.id),
    queryKey: ["ws", current.id, "tests"],
  });
  const columns = testColumns(current.id);
  const importFile = useMutation({
    mutationFn: (text: string) => importTests(current.id, text),
  });

  const runImport = async (file: File) => {
    try {
      const summary = await importFile.mutateAsync(await file.text());
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "tests"] });
      toast.success(importSummaryMessage(summary));
    } catch (error) {
      if (!handleMutationError(error)) toast.error(importErrorMessage(error));
    }
  };

  const runExport = async (format: ExportFormat) => {
    try {
      const { blob, filename } = await exportTests(current.id, format);
      saveBlob(blob, filename);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const canManage = can("tests.manage");
  const hasTests = (tests.data?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          canManage || hasTests ? (
            <div className="flex items-center gap-2">
              {hasTests ? (
                <Dropdown
                  align="end"
                  items={[
                    {
                      label: "Export as YAML",
                      onSelect: () => void runExport("yaml"),
                    },
                    {
                      label: "Export as JSON",
                      onSelect: () => void runExport("json"),
                    },
                  ]}
                  trigger={
                    <Button>
                      <Download aria-hidden="true" className="size-4" />
                      Export
                    </Button>
                  }
                />
              ) : null}
              {canManage ? (
                <>
                  <input
                    ref={fileInput}
                    accept=".yaml,.yml,.json"
                    className="hidden"
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void runImport(file);
                    }}
                  />
                  <Button
                    loading={importFile.isPending}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload aria-hidden="true" className="size-4" />
                    Import
                  </Button>
                  <Link
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
                    to={`/w/${current.id}/tests/new`}
                  >
                    <Plus aria-hidden="true" className="size-4" />
                    New test
                  </Link>
                </>
              ) : null}
            </div>
          ) : undefined
        }
        title="Browser Tests"
      />

      {tests.isError ? (
        <ErrorState onRetry={() => void tests.refetch()} />
      ) : (
        <Card className="overflow-hidden" padding="none">
          <Table
            columns={columns}
            empty={
              <EmptyState
                action={
                  can("tests.manage") ? (
                    <Link
                      className="inline-flex h-9 items-center rounded-md bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-700"
                      to={`/w/${current.id}/tests/new`}
                    >
                      Create your first test
                    </Link>
                  ) : undefined
                }
                className="m-4"
                description="Describe a flow in plain language and Zenguy will verify it in a real browser on a schedule."
                title="No browser tests yet"
              />
            }
            loading={tests.isPending}
            rowKey={(test) => test.id}
            rows={tests.data ?? []}
            onRowClick={(test) => navigate(`/w/${current.id}/tests/${test.id}`)}
          />
        </Card>
      )}
    </div>
  );
}
