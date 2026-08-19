import { useEffect, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, MoreHorizontal, Plus, TriangleAlert } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import {
  createSecret,
  deleteSecret,
  listSecrets,
  replaceSecret,
  type CreateSecretInput,
  type ReplaceSecretInput,
} from "../../api/secrets";
import type { Secret } from "../../api/types";
import { DomainListInput, isAllowedDomain } from "../../components/DomainListInput";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dropdown, type DropdownItem } from "../../components/ui/Dropdown";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { Table, type TableColumn } from "../../components/ui/Table";
import { fieldError } from "../../components/ui/form";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import { ApiError } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";
import { formatRelative } from "../../lib/format";

export const stagingCredentialsWarning =
  "Use staging or test credentials only. Never use personal accounts, real cards, or credentials with destructive permissions.";

export type SecretFormMode = "create" | "replace" | "meta";

const secretFormBase = z.object({
  allowedDomains: z.array(z.string()),
  description: z.string(),
  key: z.string(),
  value: z.string(),
});

export type SecretFormValues = z.infer<typeof secretFormBase>;

export function secretFormSchema(mode: SecretFormMode) {
  return secretFormBase.superRefine((values, context) => {
    if (mode === "create" && !/^[A-Z][A-Z0-9_]{1,63}$/u.test(values.key)) {
      context.addIssue({
        code: "custom",
        message: "Use 2–64 uppercase letters, numbers, or underscores.",
        path: ["key"],
      });
    }
    if (
      (mode === "create" || mode === "replace") &&
      (values.value.length < 1 || values.value.length > 4_096)
    ) {
      context.addIssue({
        code: "custom",
        message: "Value must be between 1 and 4096 characters.",
        path: ["value"],
      });
    }
    if (mode === "create" || mode === "meta") {
      if (values.allowedDomains.length < 1 || values.allowedDomains.length > 20) {
        context.addIssue({
          code: "custom",
          message: "Add between 1 and 20 allowed domains.",
          path: ["allowedDomains"],
        });
      } else if (values.allowedDomains.some((domain) => !isAllowedDomain(domain))) {
        context.addIssue({
          code: "custom",
          message: "Each allowed domain must be a hostname or wildcard.",
          path: ["allowedDomains"],
        });
      }
    }
  });
}

export function secretFormDefaults(secret?: Secret): SecretFormValues {
  return {
    allowedDomains: secret?.allowedDomains ?? [],
    description: secret?.description ?? "",
    key: secret?.key ?? "",
    value: "",
  };
}

export function createSecretInput(values: SecretFormValues): CreateSecretInput {
  return {
    allowedDomains: values.allowedDomains,
    ...(values.description.trim() ? { description: values.description.trim() } : {}),
    key: values.key,
    value: values.value,
  };
}

export function replaceValueInput(values: SecretFormValues): ReplaceSecretInput {
  return { value: values.value };
}

export function replaceMetaInput(values: SecretFormValues): ReplaceSecretInput {
  return {
    allowedDomains: values.allowedDomains,
    description: values.description.trim() || null,
  };
}

interface SecretFormModalProps {
  mode: SecretFormMode;
  onClose: () => void;
  open: boolean;
  secret?: Secret;
}

function SecretFormModal({ mode, onClose, open, secret }: SecretFormModalProps) {
  const { current } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const form = useForm<SecretFormValues>({
    defaultValues: secretFormDefaults(secret),
    mode: "onChange",
    resolver: zodResolver(secretFormSchema(mode)),
  });
  const save = useMutation({
    mutationFn: (values: SecretFormValues) => {
      if (mode === "create") return createSecret(current.id, createSecretInput(values));
      if (!secret) throw new Error("Secret not found");
      return replaceSecret(
        current.id,
        secret.id,
        mode === "replace" ? replaceValueInput(values) : replaceMetaInput(values),
      );
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset(secretFormDefaults(secret));
    save.reset();
  }, [form, mode, open, secret]);

  const close = () => {
    if (!save.isPending) {
      form.reset(secretFormDefaults(secret));
      onClose();
    }
  };

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      await save.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "secrets"] });
      toast.success(
        mode === "create"
          ? "Secret created"
          : mode === "replace"
            ? "Secret value replaced"
            : "Secret updated",
      );
      form.reset(secretFormDefaults(secret));
      onClose();
    } catch (error) {
      if (mode === "create" && error instanceof ApiError && error.code === "CONFLICT") {
        form.setError("key", { message: "A secret with this key already exists." });
        return;
      }
      if (handleMutationError(error)) return;
      const message = apiErrorMessage(error);
      form.setError("root", { message });
      toast.error(message);
    }
  });

  const title =
    mode === "create"
      ? "Add secret"
      : mode === "replace"
        ? `Replace {{${secret?.key ?? "SECRET"}}}`
        : `Edit {{${secret?.key ?? "SECRET"}}}`;
  const rootError = form.formState.errors.root?.message;

  return (
    <Modal
      footer={
        <>
          <Button disabled={save.isPending} onClick={close}>
            Cancel
          </Button>
          <Button
            form="secret-form"
            loading={save.isPending}
            type="submit"
            variant="primary"
          >
            {mode === "create" ? "Add secret" : mode === "replace" ? "Replace value" : "Save changes"}
          </Button>
        </>
      }
      onClose={close}
      open={open}
      title={title}
    >
      <form className="space-y-4" id="secret-form" noValidate onSubmit={(event) => void submit(event)}>
        {mode === "create" ? (
          <Field
            error={fieldError(form.formState, "key")}
            hint="Uppercase letters, digits and _ — e.g. SHOP_PASSWORD. Use it in instructions as {{SHOP_PASSWORD}}."
            htmlFor="secret-key"
            label="Key"
            required
          >
            <Controller
              control={form.control}
              name="key"
              render={({ field }) => (
                <Input
                  {...field}
                  autoComplete="off"
                  className="font-mono"
                  id="secret-key"
                  invalid={Boolean(fieldError(form.formState, "key"))}
                  maxLength={64}
                  placeholder="SHOP_PASSWORD"
                  onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                />
              )}
            />
          </Field>
        ) : null}

        {mode === "replace" ? (
          <p className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-600">
            The current value can't be viewed. Entering a new value replaces it immediately.
          </p>
        ) : null}

        {mode === "create" || mode === "replace" ? (
          <Field
            error={fieldError(form.formState, "value")}
            hint="You won't be able to view this value again — only replace it."
            htmlFor="secret-value"
            label={mode === "create" ? "Value" : "New value"}
            required
          >
            <Input
              autoComplete="off"
              id="secret-value"
              invalid={Boolean(fieldError(form.formState, "value"))}
              maxLength={4_096}
              type="password"
              {...form.register("value")}
            />
          </Field>
        ) : null}

        {mode === "create" || mode === "meta" ? (
          <Field
            error={fieldError(form.formState, "allowedDomains")}
            hint="example.com matches only that host. *.example.com also matches its subdomains. Secrets are only ever typed on these domains."
            htmlFor="secret-domains"
            label="Allowed domains"
            required
          >
            <Controller
              control={form.control}
              name="allowedDomains"
              render={({ field }) => (
                <DomainListInput
                  id="secret-domains"
                  invalid={Boolean(fieldError(form.formState, "allowedDomains"))}
                  value={field.value}
                  onChange={(domains) => {
                    field.onChange(domains);
                    void form.trigger("allowedDomains");
                  }}
                />
              )}
            />
          </Field>
        ) : null}

        {mode === "create" || mode === "meta" ? (
          <Field htmlFor="secret-description" label="Description">
            <Input
              id="secret-description"
              placeholder="Optional note for your team"
              {...form.register("description")}
            />
          </Field>
        ) : null}

        {rootError ? (
          <p className="rounded-md bg-danger-50 p-3 text-sm text-danger-700" role="alert">
            {rootError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function SecretActions({
  onDelete,
  onEdit,
  onReplace,
  secret,
}: {
  onDelete: () => void;
  onEdit: () => void;
  onReplace: () => void;
  secret: Secret;
}) {
  const items: DropdownItem[] = [
    { label: "Replace value…", onSelect: onReplace },
    { label: "Edit domains…", onSelect: onEdit },
    { label: "Delete", onSelect: onDelete, separatorBefore: true, tone: "danger" },
  ];
  return (
    <Dropdown
      items={items}
      trigger={
        <IconButton aria-label={`Actions for ${secret.key}`}>
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </IconButton>
      }
    />
  );
}

export function secretColumns(
  renderActions?: (secret: Secret) => ReactNode,
): TableColumn<Secret>[] {
  return [
    {
      header: "Key",
      key: "key",
      render: (secret) => (
        <span className="inline-flex items-center gap-2 font-mono text-sm font-medium text-zinc-900">
          <KeyRound aria-hidden="true" className="size-4 text-zinc-400" />
          {secret.key}
        </span>
      ),
    },
    {
      header: "Allowed domains",
      key: "domains",
      render: (secret) => (
        <div className="flex min-w-48 flex-wrap gap-1">
          {secret.allowedDomains.map((domain) => (
            <Badge key={domain} className="font-mono" tone="neutral">
              {domain}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      header: "Description",
      key: "description",
      render: (secret) => <span className="block max-w-60 truncate">{secret.description ?? "—"}</span>,
    },
    {
      header: "Updated",
      key: "updated",
      render: (secret) => <span className="whitespace-nowrap">{formatRelative(secret.updatedAt)}</span>,
    },
    {
      header: "Created by",
      key: "createdBy",
      render: (secret) => secret.createdBy?.name ?? "System",
    },
    {
      className: "w-12 text-right",
      header: <span className="sr-only">Actions</span>,
      key: "actions",
      render: (secret) => renderActions?.(secret) ?? null,
    },
  ];
}

export default function SecretsPage() {
  const { can, current } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const [createOpen, setCreateOpen] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<Secret>();
  const [editTarget, setEditTarget] = useState<Secret>();
  const [deleteTarget, setDeleteTarget] = useState<Secret>();
  const secrets = useQuery({
    queryFn: () => listSecrets(current.id),
    queryKey: ["ws", current.id, "secrets"],
  });
  const remove = useMutation({
    mutationFn: (secret: Secret) => deleteSecret(current.id, secret.id),
  });

  const removeSecret = async () => {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync(deleteTarget);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "secrets"] });
      toast.success("Secret deleted");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const columns = secretColumns(
    can("secrets.manage")
      ? (secret) => (
          <SecretActions
            secret={secret}
            onDelete={() => setDeleteTarget(secret)}
            onEdit={() => setEditTarget(secret)}
            onReplace={() => setReplaceTarget(secret)}
          />
        )
      : undefined,
  );

  const addButton = can("secrets.manage") ? (
    <Button onClick={() => setCreateOpen(true)} variant="primary">
      <Plus aria-hidden="true" className="size-4" />
      Add secret
    </Button>
  ) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader actions={addButton} title="Secrets" />

      <div className="flex items-start gap-3 rounded-lg border border-warn-600/25 bg-warn-50 p-4 text-warn-600" role="note">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <p className="text-sm font-medium">{stagingCredentialsWarning}</p>
      </div>

      {secrets.isError ? (
        <ErrorState onRetry={() => void secrets.refetch()} />
      ) : (
        <Card padding="none">
          <Table
            columns={columns}
            empty={
              <EmptyState
                action={addButton}
                className="m-4"
                description="Store credentials once, encrypted, and reference them in tests as {{KEY}}."
                icon={<KeyRound aria-hidden="true" className="size-7" />}
                title="No secrets yet"
              />
            }
            loading={secrets.isPending}
            rowKey={(secret) => secret.id}
            rows={secrets.data ?? []}
          />
        </Card>
      )}

      <SecretFormModal mode="create" onClose={() => setCreateOpen(false)} open={createOpen} />
      <SecretFormModal
        mode="replace"
        onClose={() => setReplaceTarget(undefined)}
        open={Boolean(replaceTarget)}
        secret={replaceTarget}
      />
      <SecretFormModal
        mode="meta"
        onClose={() => setEditTarget(undefined)}
        open={Boolean(editTarget)}
        secret={editTarget}
      />
      <ConfirmDialog
        body="Tests that reference it will start failing."
        confirmLabel="Delete"
        onClose={() => setDeleteTarget(undefined)}
        onConfirm={removeSecret}
        open={Boolean(deleteTarget)}
        title={`Delete {{${deleteTarget?.key ?? "SECRET"}}}?`}
        tone="danger"
      />
    </div>
  );
}
