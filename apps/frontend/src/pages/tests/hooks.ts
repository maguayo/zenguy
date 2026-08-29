import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { runNow } from "../../api/tests";
import type { BrowserTest } from "../../api/types";
import type { ConfirmDialogProps } from "../../components/ui/ConfirmDialog";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import { ApiError } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";

export const runCostCopy = "This will use 1 run. Retries don't use additional runs.";
export const irreversibleRunApprovalCopy =
  "You attest that all credentials and data are staging/test-only and authorize the configured exact, one-shot irreversible action scopes for this run.";

export function isActiveRun(test: BrowserTest): boolean {
  const status = test.recentRuns?.at(-1)?.status ?? test.lastRun?.status;
  return status === "QUEUED" || status === "RUNNING";
}

export interface UseRunNowResult {
  dialogProps: ConfirmDialogProps;
  pending: boolean;
  requestRun: () => void;
}

export function useRunNow(test: BrowserTest): UseRunNowResult {
  const { current } = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: () =>
      runNow(
        current.id,
        test.id,
        (test.irreversibleActionScopes?.length ?? 0) > 0,
      ),
  });

  const confirm = async () => {
    try {
      const result = await mutation.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "tests"] });
      toast.success("Run started");
      navigate(`/w/${current.id}/runs/${result.runId}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "ACTIVE_RUN_EXISTS") {
        toast.error("A run is already in progress for this test.");
      } else if (!handleMutationError(error)) {
        toast.error(apiErrorMessage(error));
      }
    }
  };

  return {
    dialogProps: {
      body:
        (test.irreversibleActionScopes?.length ?? 0) > 0
          ? `${runCostCopy} ${irreversibleRunApprovalCopy}`
          : runCostCopy,
      confirmLabel: "Run now",
      onClose: () => setOpen(false),
      onConfirm: confirm,
      open,
      title: `Run "${test.name}" now?`,
    },
    pending: mutation.isPending,
    requestRun: () => setOpen(true),
  };
}
