import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Trash2 } from "lucide-react";

import {
  deleteIncidentUpdate,
  listIncidentUpdates,
  postIncidentUpdate,
} from "../../api/incidents";
import type { IncidentUpdate } from "../../api/types";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { IconButton } from "../../components/ui/IconButton";
import { Skeleton } from "../../components/ui/Skeleton";
import { Textarea } from "../../components/ui/Textarea";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import { apiErrorMessage } from "../../lib/errors";
import { formatDateTime } from "../../lib/format";

export const PUBLIC_UPDATE_MAX_LENGTH = 2000;

export function PublicUpdateRow({
  manage,
  onDelete,
  timezone,
  update,
}: {
  manage: boolean;
  onDelete: () => void;
  timezone: string;
  update: IncidentUpdate;
}) {
  return (
    <div className="flex items-start gap-3 px-5 py-3" role="row">
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-sm text-zinc-800">{update.message}</p>
        <p className="mt-1 text-[11px] text-zinc-500">
          {formatDateTime(update.createdAt, timezone)}
        </p>
      </div>
      {manage ? (
        <IconButton aria-label="Delete public update" onClick={onDelete}>
          <Trash2 aria-hidden="true" className="size-4" />
        </IconButton>
      ) : null}
    </div>
  );
}

export function PublicUpdatesPanel({ incidentId }: { incidentId: string }) {
  const { can, current, timezone } = useWorkspace();
  const queryClient = useQueryClient();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const manage = can("status_pages.manage");
  const [message, setMessage] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const queryKey = ["ws", current.id, "incidents", incidentId, "public-updates"];
  const updates = useQuery({
    queryFn: () => listIncidentUpdates(current.id, incidentId),
    queryKey,
  });
  const post = useMutation({
    mutationFn: () => postIncidentUpdate(current.id, incidentId, message),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await post.mutateAsync();
      setMessage("");
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Public update posted");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const remove = async (updateId: string) => {
    try {
      await deleteIncidentUpdate(current.id, incidentId, updateId);
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Public update deleted");
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const overLimit = message.length > PUBLIC_UPDATE_MAX_LENGTH;

  return (
    <Card className="overflow-hidden" padding="none">
      <div className="flex items-center gap-2 px-5 pt-4">
        <Megaphone aria-hidden="true" className="size-4 text-zinc-500" />
        <h2 className="text-sm font-semibold text-zinc-900">Public updates</h2>
        <span className="text-[11px] text-zinc-500">
          Visible on your public status pages
        </span>
      </div>

      {updates.isPending ? (
        <div className="space-y-2 p-5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-40" />
        </div>
      ) : updates.isError ? (
        <p className="p-5 text-sm text-zinc-500">
          Could not load public updates.
        </p>
      ) : updates.data.length === 0 ? (
        <p className="px-5 py-4 text-sm text-zinc-500">
          No public updates yet.
          {manage ? " Tell your customers what is going on." : ""}
        </p>
      ) : (
        <div className="mt-2 divide-y divide-zinc-100" role="table">
          {updates.data.map((update) => (
            <PublicUpdateRow
              key={update.id}
              manage={manage}
              onDelete={() => setDeleteId(update.id)}
              timezone={timezone}
              update={update}
            />
          ))}
        </div>
      )}

      {manage ? (
        <form className="border-t border-zinc-200 p-4" onSubmit={submit}>
          <Textarea
            aria-label="Public update message"
            onChange={(event) => setMessage(event.target.value)}
            placeholder="We are investigating elevated error rates…"
            rows={2}
            value={message}
          />
          <div className="mt-2 flex items-center justify-between">
            <span
              className={
                overLimit ? "text-[11px] text-danger-600" : "text-[11px] text-zinc-500"
              }
            >
              {message.length}/{PUBLIC_UPDATE_MAX_LENGTH}
            </span>
            <Button
              disabled={post.isPending || message.trim() === "" || overLimit}
              type="submit"
              variant="primary"
            >
              Post publicly
            </Button>
          </div>
        </form>
      ) : null}

      <ConfirmDialog
        body="It disappears from your public status pages immediately."
        confirmLabel="Delete"
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          const target = deleteId;
          setDeleteId(null);
          if (target !== null) void remove(target);
        }}
        open={deleteId !== null}
        title="Delete this public update?"
        tone="danger"
      />
    </Card>
  );
}
