import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { useToast } from "../contexts/ToastContext";
import { useWorkspace } from "../contexts/WorkspaceContext";
import { ApiError } from "../lib/api";

export interface MutationErrorPresentation {
  message: string;
  redirectToBilling: boolean;
}

export function mutationErrorPresentation(
  error: unknown,
): MutationErrorPresentation | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "FORBIDDEN" || error.status === 403) {
    return {
      message: "You don't have permission to do that.",
      redirectToBilling: false,
    };
  }
  if (error.code === "BILLING_REQUIRED" || error.status === 402) {
    return {
      message: "Billing required — set up your subscription first.",
      redirectToBilling: true,
    };
  }
  return null;
}

export function useMutationError(): (error: unknown) => boolean {
  const navigate = useNavigate();
  const toast = useToast();
  const { current } = useWorkspace();

  return useCallback(
    (error: unknown) => {
      const presentation = mutationErrorPresentation(error);
      if (!presentation) return false;
      toast.error(presentation.message);
      if (presentation.redirectToBilling) {
        navigate(`/w/${current.id}/setup/billing`);
      }
      return true;
    },
    [current.id, navigate, toast],
  );
}
