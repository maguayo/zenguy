import { useEffect, useMemo, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ArrowRightLeft, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { listMembers } from "../../api/members";
import type { AuditEntry, Member, Workspace } from "../../api/types";
import {
  deleteWorkspace,
  listAuditLogs,
  transferOwnership,
  updateWorkspace,
} from "../../api/workspaces";
import { CopyButton } from "../../components/CopyButton";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { DescriptionList } from "../../components/ui/DescriptionList";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { LoadMore } from "../../components/ui/LoadMore";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { Table, type TableColumn } from "../../components/ui/Table";
import { fieldError } from "../../components/ui/form";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import { ApiError, type ApiPage } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";

export const workspaceSettingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workspace name is required.")
    .max(80, "Workspace name must be 80 characters or fewer."),
  timezone: z.string().min(1, "Choose a timezone."),
});

type WorkspaceSettingsValues = z.infer<typeof workspaceSettingsSchema>;

export function filterWorkspaceTimezones(timezones: string[], filter: string): string[] {
  const needle = filter.trim().toLocaleLowerCase();
  if (!needle) return timezones;
  return timezones.filter((timezone) => timezone.toLocaleLowerCase().includes(needle));
}

export function transferCandidates(members: Member[], actorUserId: string): Member[] {
  return members.filter((member) => member.userId !== actorUserId);
}

export function prettyAuditMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata, null, 2);
}

export function auditColumns(
  timezone: string,
  renderCopy?: (resourceId: string) => ReactNode,
): TableColumn<AuditEntry>[] {
  return [
    {
      header: "Time",
      key: "time",
      render: (entry) => (
        <span className="whitespace-nowrap">{formatDateTime(entry.createdAt, timezone)}</span>
      ),
    },
    {
      header: "Actor",
      key: "actor",
      render: (entry) => entry.actor?.name ?? "System",
    },
    {
      header: "Action",
      key: "action",
      render: (entry) => <code className="whitespace-nowrap text-xs">{entry.action}</code>,
    },
    {
      header: "Resource",
      key: "resource",
      render: (entry) => {
        if (!entry.resourceType && !entry.resourceId) return "—";
        const resourceId = entry.resourceId ?? "—";
        return (
          <div className="flex max-w-64 items-center gap-1">
            <span
              className="truncate"
              title={`${entry.resourceType ?? "resource"} · ${resourceId}`}
            >
              {entry.resourceType ?? "resource"} · {resourceId}
            </span>
            {entry.resourceId ? renderCopy?.(entry.resourceId) : null}
          </div>
        );
      },
    },
    {
      header: "Details",
      key: "details",
      render: (entry) =>
        entry.metadata ? (
          <details className="min-w-32">
            <summary className="cursor-pointer text-xs font-medium text-accent-700">
              View JSON
            </summary>
            <pre className="mt-2 max-h-64 max-w-sm overflow-auto rounded-md bg-zinc-950 p-3 text-xs text-zinc-100">
              {prettyAuditMetadata(entry.metadata)}
            </pre>
          </details>
        ) : (
          "—"
        ),
    },
  ];
}

function GeneralCard({ workspace }: { workspace: Workspace }) {
  const { can } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const [timezoneFilter, setTimezoneFilter] = useState("");
  const availableTimezones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const form = useForm<WorkspaceSettingsValues>({
    defaultValues: { name: workspace.name, timezone: workspace.timezone },
    resolver: zodResolver(workspaceSettingsSchema),
  });
  const save = useMutation({
    mutationFn: (values: WorkspaceSettingsValues) => updateWorkspace(workspace.id, values),
  });

  useEffect(() => {
    form.reset({ name: workspace.name, timezone: workspace.timezone });
    setTimezoneFilter("");
  }, [form, workspace.id, workspace.name, workspace.timezone]);

  const selectedTimezone = form.watch("timezone");
  const filteredTimezones = useMemo(() => {
    const matches = filterWorkspaceTimezones(availableTimezones, timezoneFilter);
    return matches.includes(selectedTimezone)
      ? matches
      : [selectedTimezone, ...matches].filter(Boolean);
  }, [availableTimezones, selectedTimezone, timezoneFilter]);

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      await save.mutateAsync(values);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["ws", workspace.id, "audit"] }),
      ]);
      toast.success("Workspace settings saved");
    } catch (error) {
      if (handleMutationError(error)) return;
      if (error instanceof ApiError && error.details?.length) {
        let handled = false;
        for (const detail of error.details) {
          if (detail.field === "name" || detail.field === "timezone") {
            form.setError(detail.field, { message: detail.message });
            handled = true;
          }
        }
        if (handled) return;
      }
      form.setError("root", { message: apiErrorMessage(error) });
    }
  });

  if (!can("workspace.settings")) {
    return (
      <Card title="General">
        <DescriptionList
          items={[
            { label: "Name", value: workspace.name },
            { label: "Timezone", value: workspace.timezone.replaceAll("_", " ") },
          ]}
        />
      </Card>
    );
  }

  return (
    <Card title="General">
      <form className="max-w-2xl space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        <Field
          error={fieldError(form.formState, "name")}
          htmlFor="settings-workspace-name"
          label="Name"
          required
        >
          <Input
            autoComplete="organization"
            id="settings-workspace-name"
            invalid={Boolean(fieldError(form.formState, "name"))}
            {...form.register("name")}
          />
        </Field>

        <Field
          error={fieldError(form.formState, "timezone")}
          htmlFor="settings-workspace-timezone"
          label="Timezone"
          required
        >
          <Input
            aria-label="Filter timezones"
            className="mb-2"
            placeholder="Filter timezones"
            type="search"
            value={timezoneFilter}
            onChange={(event) => setTimezoneFilter(event.target.value)}
          />
          <Select
            id="settings-workspace-timezone"
            invalid={Boolean(fieldError(form.formState, "timezone"))}
            {...form.register("timezone")}
          >
            {filteredTimezones.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
          {filteredTimezones.length <= 1 && timezoneFilter ? (
            <p className="mt-1.5 text-xs text-zinc-500">
              No other timezones match “{timezoneFilter}”.
            </p>
          ) : null}
        </Field>

        {form.formState.errors.root?.message ? (
          <p className="rounded-md bg-danger-50 p-3 text-sm text-danger-700" role="alert">
            {form.formState.errors.root.message}
          </p>
        ) : null}

        <Button loading={save.isPending} type="submit" variant="primary">
          Save changes
        </Button>
      </form>
    </Card>
  );
}

function AuditLogCard() {
  const { can, current, timezone } = useWorkspace();
  const audit = useInfiniteQuery<ApiPage<AuditEntry>>({
    enabled: can("audit.view"),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listAuditLogs(current.id, pageParam as string | null, 25),
    queryKey: ["ws", current.id, "audit"],
  });

  if (!can("audit.view")) return null;

  const rows = audit.data?.pages.flatMap((page) => page.items) ?? [];
  const columns = auditColumns(timezone, (resourceId) => (
    <CopyButton label={`Copy resource ID ${resourceId}`} text={resourceId} />
  ));

  return (
    <Card padding="none">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">Audit log</h2>
      </div>
      {audit.isError ? (
        <ErrorState className="m-4" onRetry={() => void audit.refetch()} />
      ) : (
        <>
          <Table
            columns={columns}
            empty={<EmptyState className="m-4" title="No audit entries yet." />}
            loading={audit.isPending}
            rowKey={(entry) => entry.id}
            rows={rows}
          />
          <div className="px-4 pb-4">
            <LoadMore
              loading={audit.isFetchingNextPage}
              nextCursor={
                audit.hasNextPage ? audit.data?.pages.at(-1)?.nextCursor ?? null : null
              }
              onMore={() => void audit.fetchNextPage()}
            />
          </div>
        </>
      )}
    </Card>
  );
}

function DangerZone() {
  const { user } = useAuth();
  const { can, current } = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const [transferOpen, setTransferOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [transferCandidate, setTransferCandidate] = useState<Member>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const members = useQuery({
    enabled: can("workspace.transfer") && transferOpen,
    queryFn: () => listMembers(current.id),
    queryKey: ["ws", current.id, "members"],
  });
  const transfer = useMutation({
    mutationFn: (newOwnerUserId: string) => transferOwnership(current.id, newOwnerUserId),
  });
  const deletion = useMutation({ mutationFn: () => deleteWorkspace(current.id, current.name) });

  if (!can("workspace.transfer") || !can("workspace.delete")) return null;

  const candidates = transferCandidates(members.data ?? [], user?.id ?? "");

  const openTransferConfirmation = () => {
    const candidate = candidates.find((member) => member.userId === selectedUserId);
    if (!candidate) return;
    setTransferCandidate(candidate);
    setTransferOpen(false);
  };

  const confirmTransfer = async () => {
    if (!transferCandidate) return;
    try {
      await transfer.mutateAsync(transferCandidate.userId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["ws", current.id, "members"] }),
        queryClient.invalidateQueries({ queryKey: ["ws", current.id, "audit"] }),
      ]);
      toast.success(`Ownership transferred to ${transferCandidate.name}`);
      setTransferCandidate(undefined);
      setSelectedUserId("");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const confirmDeletion = async () => {
    try {
      await deletion.mutateAsync();
      localStorage.removeItem("zenguy:lastWorkspace");
      queryClient.setQueryData<Workspace[]>(["workspaces"], (workspaces) =>
        workspaces?.filter((workspace) => workspace.id !== current.id),
      );
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Workspace deleted");
      navigate("/", { replace: true });
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  return (
    <Card className="border-danger-600/30 bg-danger-50" title="Danger zone">
      <div className="divide-y divide-danger-600/20">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4">
          <div>
            <h3 className="text-sm font-medium text-zinc-900">Transfer ownership</h3>
            <p className="mt-1 text-sm text-zinc-600">
              Give another existing member full control of this workspace.
            </p>
          </div>
          <Button onClick={() => setTransferOpen(true)}>
            <ArrowRightLeft aria-hidden="true" className="size-4" />
            Transfer ownership…
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 pt-4">
          <div>
            <h3 className="text-sm font-medium text-zinc-900">Delete workspace</h3>
            <p className="mt-1 text-sm text-zinc-600">
              Cancel billing and permanently remove workspace data after retention.
            </p>
          </div>
          <Button onClick={() => setDeleteOpen(true)} variant="danger">
            <Trash2 aria-hidden="true" className="size-4" />
            Delete workspace…
          </Button>
        </div>
      </div>

      <Modal
        footer={
          <>
            <Button onClick={() => setTransferOpen(false)}>Cancel</Button>
            <Button
              disabled={!selectedUserId}
              onClick={openTransferConfirmation}
              variant="primary"
            >
              Continue
            </Button>
          </>
        }
        onClose={() => setTransferOpen(false)}
        open={transferOpen}
        title="Transfer ownership"
      >
        {members.isPending ? (
          <div className="grid min-h-32 place-items-center">
            <Spinner label="Loading members" size={5} />
          </div>
        ) : members.isError ? (
          <ErrorState onRetry={() => void members.refetch()} />
        ) : candidates.length === 0 ? (
          <EmptyState
            className="min-h-32"
            title="Invite someone first — owners can only transfer to an existing member."
          />
        ) : (
          <Field htmlFor="new-owner" label="New owner" required>
            <Select
              id="new-owner"
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
            >
              <option value="">Choose a member</option>
              {candidates.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name} — {member.email}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </Modal>

      <ConfirmDialog
        body="You will become an Admin."
        confirmLabel="Transfer ownership"
        onClose={() => setTransferCandidate(undefined)}
        onConfirm={confirmTransfer}
        open={Boolean(transferCandidate)}
        title={`Transfer ownership to ${transferCandidate?.name ?? "this member"}?`}
      />

      <ConfirmDialog
        body="This cancels the subscription immediately, stops all scheduled runs and checks, revokes invitations, and permanently removes data after the retention window. Type the workspace name to confirm."
        confirmLabel="Delete workspace"
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDeletion}
        open={deleteOpen}
        requireText={current.name}
        title="Delete workspace?"
        tone="danger"
      />
    </Card>
  );
}

export default function SettingsPage() {
  const { current } = useWorkspace();

  return (
    <div className="space-y-6">
      <PageHeader title="Workspace Settings" />
      <GeneralCard workspace={current} />
      <AuditLogCard />
      <DangerZone />
    </div>
  );
}
