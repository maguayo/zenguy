import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Plus,
  Trash2,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  addStatusPageItem,
  deleteStatusPage,
  fetchStatusPagePreview,
  getStatusPage,
  publishStatusPage,
  removeStatusPageItem,
  reorderStatusPageItems,
  unpublishStatusPage,
  updateStatusPage,
  updateStatusPageItem,
} from "../../api/status_pages";
import { listTests } from "../../api/tests";
import { listMonitors } from "../../api/uptime";
import type {
  StatusPageDetail,
  StatusPageInput,
  StatusPageItem,
  StatusPageTheme,
} from "../../api/types";
import { CopyButton } from "../../components/CopyButton";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { Textarea } from "../../components/ui/Textarea";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import { ApiError } from "../../lib/api";
import { apiErrorMessage, apiFieldErrors } from "../../lib/errors";
import { slugIssue, statusPageUrl } from "./StatusPagesListPage";

export interface PageSettingsForm {
  accentColor: string;
  description: string;
  slug: string;
  theme: StatusPageTheme;
  title: string;
}

export function settingsFromPage(page: StatusPageDetail): PageSettingsForm {
  return {
    accentColor: page.accentColor ?? "",
    description: page.description ?? "",
    slug: page.slug,
    theme: page.theme,
    title: page.title,
  };
}

/** Only the fields that differ from the loaded page, in API shape. */
export function changedPageFields(
  page: StatusPageDetail,
  form: PageSettingsForm,
): StatusPageInput {
  const changes: StatusPageInput = {};
  if (form.title.trim() !== page.title) changes.title = form.title.trim();
  if (form.slug !== page.slug) changes.slug = form.slug;
  const description = form.description.trim() === "" ? null : form.description.trim();
  if (description !== page.description) changes.description = description;
  const accentColor = form.accentColor === "" ? null : form.accentColor.toLowerCase();
  if (accentColor !== page.accentColor) changes.accentColor = accentColor;
  if (form.theme !== page.theme) changes.theme = form.theme;
  return changes;
}

export function moveId(ids: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  const current = ids[index];
  const other = ids[target];
  if (current === undefined || other === undefined) return ids;
  const next = [...ids];
  next[index] = other;
  next[target] = current;
  return next;
}

export function EditorItemRow({
  first,
  item,
  last,
  manage,
  onMove,
  onRemove,
  onRename,
}: {
  first: boolean;
  item: StatusPageItem;
  last: boolean;
  manage: boolean;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onRename: (changes: { displayName?: string; groupName?: string | null }) => void;
}) {
  const [displayName, setDisplayName] = useState(item.displayName);
  const [groupName, setGroupName] = useState(item.groupName ?? "");

  const commit = () => {
    const changes: { displayName?: string; groupName?: string | null } = {};
    if (displayName.trim() !== item.displayName && displayName.trim() !== "") {
      changes.displayName = displayName.trim();
    }
    const group = groupName.trim() === "" ? null : groupName.trim();
    if (group !== item.groupName) changes.groupName = group;
    if (Object.keys(changes).length > 0) onRename(changes);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3" role="row">
      <Badge tone={item.resourceType === "UPTIME_MONITOR" ? "info" : "accent"}>
        {item.resourceType === "UPTIME_MONITOR" ? "Monitor" : "Browser test"}
      </Badge>
      <div className="min-w-0 flex-1 basis-52">
        <Input
          aria-label={`Public name for ${item.displayName}`}
          disabled={!manage}
          onBlur={commit}
          onChange={(event) => setDisplayName(event.target.value)}
          value={displayName}
        />
      </div>
      <div className="w-40">
        <Input
          aria-label={`Group for ${item.displayName}`}
          disabled={!manage}
          onBlur={commit}
          onChange={(event) => setGroupName(event.target.value)}
          placeholder="No group"
          value={groupName}
        />
      </div>
      {manage ? (
        <div className="flex items-center gap-1">
          <IconButton
            aria-label={`Move ${item.displayName} up`}
            disabled={first}
            onClick={() => onMove(-1)}
          >
            <ArrowUp aria-hidden="true" className="size-4" />
          </IconButton>
          <IconButton
            aria-label={`Move ${item.displayName} down`}
            disabled={last}
            onClick={() => onMove(1)}
          >
            <ArrowDown aria-hidden="true" className="size-4" />
          </IconButton>
          <IconButton
            aria-label={`Remove ${item.displayName}`}
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}

interface PickerResource {
  id: string;
  name: string;
  type: "UPTIME_MONITOR" | "BROWSER_TEST";
}

function AddItemModal({
  existing,
  onAdd,
  onClose,
  open,
  workspaceId,
}: {
  existing: Set<string>;
  onAdd: (input: {
    displayName: string;
    groupName: string | null;
    resourceId: string;
    resourceType: "UPTIME_MONITOR" | "BROWSER_TEST";
  }) => Promise<void>;
  onClose: () => void;
  open: boolean;
  workspaceId: string;
}) {
  const monitors = useQuery({
    enabled: open,
    queryFn: () => listMonitors(workspaceId),
    queryKey: ["ws", workspaceId, "monitors"],
  });
  const tests = useQuery({
    enabled: open,
    queryFn: () => listTests(workspaceId),
    queryKey: ["ws", workspaceId, "tests"],
  });
  const [selected, setSelected] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [saving, setSaving] = useState(false);

  const resources: PickerResource[] = useMemo(
    () => [
      ...(monitors.data ?? []).map((monitor) => ({
        id: monitor.id,
        name: monitor.name,
        type: "UPTIME_MONITOR" as const,
      })),
      ...(tests.data ?? []).map((test) => ({
        id: test.id,
        name: test.name,
        type: "BROWSER_TEST" as const,
      })),
    ],
    [monitors.data, tests.data],
  );
  const available = resources.filter((resource) => !existing.has(resource.id));
  const selectedResource = available.find((resource) => resource.id === selected);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (selectedResource === undefined || displayName.trim() === "") return;
    setSaving(true);
    try {
      await onAdd({
        displayName: displayName.trim(),
        groupName: groupName.trim() === "" ? null : groupName.trim(),
        resourceId: selectedResource.id,
        resourceType: selectedResource.type,
      });
      setSelected("");
      setDisplayName("");
      setGroupName("");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} open={open} title="Add a system">
      <form className="space-y-4" onSubmit={submit}>
        <Field
          hint="Only what you add here becomes public."
          htmlFor="status-item-resource"
          label="Monitor or browser test"
          required
        >
          <Select
            id="status-item-resource"
            onChange={(event) => {
              setSelected(event.target.value);
              const resource = available.find(
                (candidate) => candidate.id === event.target.value,
              );
              if (resource !== undefined) setDisplayName(resource.name);
            }}
            required
            value={selected}
          >
            <option disabled value="">
              {monitors.isPending || tests.isPending
                ? "Loading…"
                : available.length === 0
                  ? "Everything is already on this page"
                  : "Pick a system"}
            </option>
            {available.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.type === "UPTIME_MONITOR" ? "Monitor" : "Test"} —{" "}
                {resource.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          hint="Shown publicly instead of the internal name. Keep it customer-friendly."
          htmlFor="status-item-name"
          label="Public name"
          required
        >
          <Input
            id="status-item-name"
            onChange={(event) => setDisplayName(event.target.value)}
            required
            value={displayName}
          />
        </Field>
        <Field hint="Optional section heading." htmlFor="status-item-group" label="Group">
          <Input
            id="status-item-group"
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="Core services"
            value={groupName}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="secondary">
            Cancel
          </Button>
          <Button
            disabled={saving || selectedResource === undefined}
            type="submit"
            variant="primary"
          >
            Add to page
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditorSkeleton() {
  return (
    <div className="space-y-4" role="status">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function StatusPageEditorPage() {
  const { can, current } = useWorkspace();
  const { pageId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const manage = can("status_pages.manage");

  const detailKey = ["ws", current.id, "status-pages", pageId];
  const detail = useQuery({
    enabled: pageId !== "",
    queryFn: () => getStatusPage(current.id, pageId),
    queryKey: detailKey,
  });
  const preview = useQuery({
    enabled: detail.isSuccess,
    queryFn: () => fetchStatusPagePreview(current.id, pageId),
    queryKey: [...detailKey, "preview"],
  });

  const [form, setForm] = useState<PageSettingsForm | null>(null);
  const [settingsErrors, setSettingsErrors] = useState<Record<string, string>>(
    {},
  );
  useEffect(() => {
    if (detail.data !== undefined) setForm(settingsFromPage(detail.data));
  }, [detail.data]);

  const setFormField = (changes: Partial<PageSettingsForm>) => {
    setForm((previous) => (previous === null ? previous : { ...previous, ...changes }));
    setSettingsErrors((previous) => {
      const next = { ...previous };
      for (const key of Object.keys(changes)) delete next[key];
      return next;
    });
  };

  const [addOpen, setAddOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removeItemId, setRemoveItemId] = useState<string | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: detailKey });
  };

  const runMutation = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      await refresh();
      toast.success(success);
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  if (detail.isError) {
    return <ErrorState onRetry={() => void detail.refetch()} />;
  }
  if (detail.isPending || form === null) {
    return <EditorSkeleton />;
  }
  const page = detail.data;
  const items = page.items;
  const publicUrl = statusPageUrl(window.location.origin, page.slug);
  const slugChanged = form.slug !== page.slug;
  const dirty = Object.keys(changedPageFields(page, form)).length > 0;
  const liveSlugIssue = slugChanged ? slugIssue(form.slug) : null;

  const saveSettings = async () => {
    setSettingsErrors({});
    try {
      await updateStatusPage(current.id, pageId, changedPageFields(page, form));
      await refresh();
      toast.success("Settings saved");
    } catch (error) {
      if (handleMutationError(error)) return;
      const fields = apiFieldErrors(error);
      if (Object.keys(fields).length > 0) {
        setSettingsErrors(fields);
        return;
      }
      if (error instanceof ApiError && error.code === "CONFLICT") {
        setSettingsErrors({ slug: error.message });
        return;
      }
      toast.error(apiErrorMessage(error));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          manage ? (
            <div className="flex items-center gap-2">
              <Button onClick={() => setDeleteOpen(true)} variant="danger">
                Delete
              </Button>
              {page.publishedAt === null ? (
                <Button
                  onClick={() =>
                    void runMutation(
                      () => publishStatusPage(current.id, pageId),
                      "Status page published",
                    )
                  }
                  variant="primary"
                >
                  Publish
                </Button>
              ) : (
                <Button onClick={() => setUnpublishOpen(true)} variant="secondary">
                  Unpublish
                </Button>
              )}
            </div>
          ) : undefined
        }
        description={
          page.publishedAt === null
            ? "Draft — only your team can see it."
            : "Live and public."
        }
        title={page.title}
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          {page.publishedAt === null ? (
            <Badge tone="neutral">Draft</Badge>
          ) : (
            <Badge tone="ok">Published</Badge>
          )}
          <span className="min-w-0 truncate font-mono text-xs text-zinc-600" title={publicUrl}>
            {publicUrl}
          </span>
          <CopyButton label="Copy public URL" text={publicUrl} />
          {page.publishedAt === null ? null : (
            <a
              className="inline-flex items-center gap-1 text-xs font-medium text-accent-700 hover:underline"
              href={publicUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          )}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold text-zinc-900">Page settings</h2>
            <Field error={settingsErrors.title} htmlFor="sp-title" label="Title" required>
              <Input
                disabled={!manage}
                id="sp-title"
                invalid={settingsErrors.title !== undefined}
                onChange={(event) => setFormField({ title: event.target.value })}
                value={form.title}
              />
            </Field>
            <Field
              error={settingsErrors.slug ?? liveSlugIssue ?? undefined}
              hint={
                slugChanged ? (
                  <span className="text-warn-700">
                    Changing the slug breaks the previous URL.
                  </span>
                ) : (
                  "Lowercase letters, digits and hyphens."
                )
              }
              htmlFor="sp-slug"
              label="Slug"
              required
            >
              <Input
                disabled={!manage}
                id="sp-slug"
                invalid={
                  settingsErrors.slug !== undefined || liveSlugIssue !== null
                }
                onChange={(event) => setFormField({ slug: event.target.value })}
                value={form.slug}
              />
            </Field>
            <Field htmlFor="sp-description" label="Description">
              <Textarea
                disabled={!manage}
                id="sp-description"
                onChange={(event) =>
                  setFormField({ description: event.target.value })
                }
                placeholder="Health of our public services."
                rows={2}
                value={form.description}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field
                error={settingsErrors.accentColor}
                hint="Optional."
                htmlFor="sp-accent"
                label="Accent color"
              >
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Accent color picker"
                    className="h-9 w-10 cursor-pointer rounded-md border border-zinc-300 bg-white"
                    disabled={!manage}
                    onChange={(event) =>
                      setFormField({ accentColor: event.target.value })
                    }
                    type="color"
                    value={form.accentColor === "" ? "#10b981" : form.accentColor}
                  />
                  <Input
                    disabled={!manage}
                    id="sp-accent"
                    invalid={settingsErrors.accentColor !== undefined}
                    onChange={(event) =>
                      setFormField({ accentColor: event.target.value })
                    }
                    pattern="#[0-9a-fA-F]{6}"
                    placeholder="#10b981"
                    value={form.accentColor}
                  />
                </div>
              </Field>
              <Field htmlFor="sp-theme" label="Theme">
                <Select
                  disabled={!manage}
                  id="sp-theme"
                  onChange={(event) =>
                    setFormField({
                      theme: event.target.value as StatusPageTheme,
                    })
                  }
                  value={form.theme}
                >
                  <option value="SYSTEM">System</option>
                  <option value="LIGHT">Light</option>
                  <option value="DARK">Dark</option>
                </Select>
              </Field>
            </div>
            {manage ? (
              <div className="flex justify-end">
                <Button
                  disabled={!dirty || liveSlugIssue !== null}
                  onClick={() => void saveSettings()}
                  variant="primary"
                >
                  Save settings
                </Button>
              </div>
            ) : null}
          </Card>

          <Card padding="none">
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">Systems</h2>
                <p className="text-xs text-zinc-500">
                  Public name and order; internal names never leave the workspace.
                </p>
              </div>
              {manage ? (
                <Button onClick={() => setAddOpen(true)} variant="secondary">
                  <Plus aria-hidden="true" className="size-4" />
                  Add system
                </Button>
              ) : null}
            </div>
            {items.length === 0 ? (
              <EmptyState
                className="m-4"
                description="Nothing is shown publicly until you add a monitor or browser test."
                title="No systems on this page"
              />
            ) : (
              <div className="divide-y divide-zinc-200" role="table">
                {items.map((item, index) => (
                  <EditorItemRow
                    key={item.id}
                    first={index === 0}
                    item={item}
                    last={index === items.length - 1}
                    manage={manage}
                    onMove={(delta) =>
                      void runMutation(
                        () =>
                          reorderStatusPageItems(
                            current.id,
                            pageId,
                            moveId(
                              items.map((entry) => entry.id),
                              index,
                              delta,
                            ),
                          ),
                        "Order updated",
                      )
                    }
                    onRemove={() => setRemoveItemId(item.id)}
                    onRename={(changes) =>
                      void runMutation(
                        () =>
                          updateStatusPageItem(current.id, pageId, item.id, changes),
                        "System updated",
                      )
                    }
                  />
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Preview</h2>
            <Button
              disabled={preview.isFetching}
              onClick={() => void preview.refetch()}
              variant="ghost"
            >
              Refresh
            </Button>
          </div>
          {preview.isError ? (
            <ErrorState onRetry={() => void preview.refetch()} />
          ) : preview.isPending ? (
            <Skeleton className="h-[600px] w-full" />
          ) : (
            <iframe
              className="h-[600px] w-full rounded-md border border-zinc-200 bg-white"
              sandbox=""
              srcDoc={preview.data}
              title="Status page preview"
            />
          )}
        </Card>
      </div>

      <AddItemModal
        existing={new Set(items.map((item) => item.resourceId))}
        onAdd={async (input) => {
          await runMutation(
            () => addStatusPageItem(current.id, pageId, input),
            "System added",
          );
        }}
        onClose={() => setAddOpen(false)}
        open={addOpen}
        workspaceId={current.id}
      />
      <ConfirmDialog
        body="The public URL will start returning a not-found page until you publish again."
        confirmLabel="Unpublish"
        onClose={() => setUnpublishOpen(false)}
        onConfirm={() =>
          void runMutation(
            () => unpublishStatusPage(current.id, pageId),
            "Status page unpublished",
          )
        }
        open={unpublishOpen}
        title={`Unpublish "${page.title}"?`}
        tone="danger"
      />
      <ConfirmDialog
        body="The page and its public URL are removed. Monitors and tests are untouched."
        confirmLabel="Delete"
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          try {
            await deleteStatusPage(current.id, pageId);
            await queryClient.invalidateQueries({
              queryKey: ["ws", current.id, "status-pages"],
            });
            toast.success("Status page deleted");
            navigate(`/w/${current.id}/status-pages`);
          } catch (error) {
            if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
          }
        }}
        open={deleteOpen}
        title={`Delete "${page.title}"?`}
        tone="danger"
      />
      <ConfirmDialog
        body="It disappears from the public page immediately."
        confirmLabel="Remove"
        onClose={() => setRemoveItemId(null)}
        onConfirm={() => {
          const target = removeItemId;
          setRemoveItemId(null);
          if (target !== null) {
            void runMutation(
              () => removeStatusPageItem(current.id, pageId, target),
              "System removed",
            );
          }
        }}
        open={removeItemId !== null}
        title="Remove this system from the page?"
        tone="danger"
      />
    </div>
  );
}
