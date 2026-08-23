import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { runNow } from "@/api/tests";
import type { BrowserTest } from "@/api/types";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import { confirm } from "@/ui";

export const runCostCopy = "This will use 1 run. Retries don't use additional runs.";
export const irreversibleRunApprovalCopy =
  "You attest that all credentials and data are staging/test-only and authorize the configured exact, one-shot irreversible action scopes for this run.";

export function isActiveRun(test: BrowserTest): boolean {
  return test.lastRun?.status === "QUEUED" || test.lastRun?.status === "RUNNING";
}

export interface UseRunNowResult {
  pending: boolean;
  requestRun: () => void;
}

/** "Run now" with the web's confirmation copy, using the native alert instead of a dialog. */
export function useRunNow(
  test: Pick<BrowserTest, "id" | "name" | "irreversibleActionScopes">,
): UseRunNowResult {
  const { current } = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const handleMutationError = useMutationError();
  const queryClient = useQueryClient();
  const hasIrreversibleScopes = (test.irreversibleActionScopes?.length ?? 0) > 0;
  const mutation = useMutation({
    mutationFn: () => runNow(current.id, test.id, hasIrreversibleScopes),
  });

  const requestRun = async () => {
    if (mutation.isPending) return;
    const confirmed = await confirm({
      confirmLabel: "Run now",
      message: hasIrreversibleScopes
        ? `${runCostCopy} ${irreversibleRunApprovalCopy}`
        : runCostCopy,
      title: `Run "${test.name}" now?`,
    });
    if (!confirmed) return;
    try {
      const result = await mutation.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "tests"] });
      toast.success("Run started");
      router.push(`/w/${current.id}/runs/${result.runId}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "ACTIVE_RUN_EXISTS") {
        toast.error("A run is already in progress for this test.");
      } else if (!handleMutationError(error)) {
        toast.error(apiErrorMessage(error));
      }
    }
  };

  return { pending: mutation.isPending, requestRun: () => void requestRun() };
}
