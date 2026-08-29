import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, Signal } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { createStatusPage, listStatusPages } from "../../api/status_pages";
import type { StatusPage } from "../../api/types";
import { CopyButton } from "../../components/CopyButton";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton } from "../../components/ui/Skeleton";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import { apiErrorMessage } from "../../lib/errors";

export function suggestSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 63);
}

export function statusPageUrl(origin: string, slug: string): string {
  return `${origin}/status/${slug}`;
}

export function StatusPageRowContent({
  origin,
  page,
  workspaceId,
}: {
  origin: string;
  page: StatusPage;
  workspaceId: string;
}) {
  const url = statusPageUrl(origin, page.slug);
  return (
    <>
      <div className="min-w-0 flex-1" role="cell">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            className="min-w-0 truncate text-sm font-semibold text-zinc-950 hover:text-accent-700 hover:underline"
            to={`/w/${workspaceId}/status-pages/${page.id}`}
          >
            {page.title}
          </Link>
          {page.publishedAt === null ? (
            <Badge tone="neutral">Draft</Badge>
          ) : (
            <Badge tone="ok">Published</Badge>
          )}
        </div>
        <p className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-zinc-500">
          <span className="truncate" title={url}>
            {url}
          </span>
        </p>
      </div>
      <div className="flex items-center gap-1.5" role="cell">
        <CopyButton label="Copy public URL" text={url} />
        {page.publishedAt === null ? null : (
          <a
            aria-label={`Open ${page.title} in a new tab`}
            className="inline-flex size-9 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            href={url}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        )}
      </div>
    </>
  );
}

function StatusPagesSkeleton() {
  return (
    <Card aria-label="Loading status pages" padding="none" role="status">
      <div className="divide-y divide-zinc-200">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="size-8" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function CreateStatusPageModal({
  onClose,
  open,
  workspaceId,
}: {
  onClose: () => void;
  open: boolean;
  workspaceId: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const create = useMutation({
    mutationFn: () => createStatusPage(workspaceId, { slug, title }),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const page = await create.mutateAsync();
      await queryClient.invalidateQueries({
        queryKey: ["ws", workspaceId, "status-pages"],
      });
      toast.success("Status page created");
      navigate(`/w/${workspaceId}/status-pages/${page.id}`);
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  return (
    <Modal onClose={onClose} open={open} title="New status page">
      <form className="space-y-4" onSubmit={submit}>
        <Field htmlFor="status-page-title" label="Title" required>
          <Input
            id="status-page-title"
            onChange={(event) => {
              setTitle(event.target.value);
              if (!slugTouched) setSlug(suggestSlug(event.target.value));
            }}
            placeholder="Acme Status"
            required
            value={title}
          />
        </Field>
        <Field
          hint="Lowercase letters, digits and hyphens. This becomes the public URL."
          htmlFor="status-page-slug"
          label="Slug"
          required
        >
          <Input
            id="status-page-slug"
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
            pattern="[a-z0-9][a-z0-9-]{1,61}[a-z0-9]"
            placeholder="acme"
            required
            value={slug}
          />
        </Field>
        <p className="font-mono text-[11px] text-zinc-500">
          {statusPageUrl(window.location.origin, slug || "your-slug")}
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="secondary">
            Cancel
          </Button>
          <Button disabled={create.isPending} type="submit" variant="primary">
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function StatusPagesListPage() {
  const { can, current } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const pages = useQuery({
    queryFn: () => listStatusPages(current.id),
    queryKey: ["ws", current.id, "status-pages"],
  });
  const manage = can("status_pages.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          manage ? (
            <Button onClick={() => setCreateOpen(true)} variant="primary">
              <Plus aria-hidden="true" className="size-4" />
              New status page
            </Button>
          ) : undefined
        }
        description="Public pages where your customers see the health of what Zenguy watches."
        title="Status Pages"
      />

      {pages.isError ? (
        <ErrorState onRetry={() => void pages.refetch()} />
      ) : pages.isPending ? (
        <StatusPagesSkeleton />
      ) : pages.data.length === 0 ? (
        <Card padding="none">
          <EmptyState
            action={
              manage ? (
                <Button onClick={() => setCreateOpen(true)} variant="primary">
                  Create your first status page
                </Button>
              ) : undefined
            }
            className="m-4"
            description="Pick which monitors and browser tests to show publicly, under names you choose. Nothing is published until you say so."
            icon={<Signal aria-hidden="true" className="size-6" />}
            title="No status pages yet"
          />
        </Card>
      ) : (
        <Card padding="none">
          <div aria-label="Status pages" className="divide-y divide-zinc-200" role="table">
            {pages.data.map((page) => (
              <div
                key={page.id}
                className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-zinc-50/70"
                role="row"
              >
                <StatusPageRowContent
                  origin={window.location.origin}
                  page={page}
                  workspaceId={current.id}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      <CreateStatusPageModal
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        workspaceId={current.id}
      />
    </div>
  );
}
