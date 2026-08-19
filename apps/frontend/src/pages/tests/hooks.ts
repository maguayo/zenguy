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

export function isActiveRun(test: BrowserTest): boolean {
  return test.lastRun?.status === "QUEUED" || test.lastRun?.status === "RUNNING";
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
    mutationFn: () => runNow(current.id, test.id),
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
      body: runCostCopy,
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
