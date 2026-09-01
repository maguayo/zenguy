import { useCallback } from "react";
import { useRouter } from "expo-router";

import { useToast } from "@/contexts/ToastContext";
import { ApiError } from "@/lib/api";

export interface MutationErrorPresentation {
  message: string;
  redirectToAccessUnavailable: boolean;
}

export function mutationErrorPresentation(error: unknown): MutationErrorPresentation | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "FORBIDDEN" || error.status === 403) {
    return { message: "You don't have permission to do that.", redirectToAccessUnavailable: false };
  }
  if (error.code === "BILLING_REQUIRED" || error.status === 402) {
    return {
      message: "This workspace does not currently have mobile access.",
      redirectToAccessUnavailable: true,
    };
  }
  return null;
}

/** Shows the shared toast for 403/402 and reports whether the error was handled. */
export function useMutationError(): (error: unknown) => boolean {
  const router = useRouter();
  const toast = useToast();

  return useCallback(
    (error: unknown) => {
      const presentation = mutationErrorPresentation(error);
      if (!presentation) return false;
      toast.error(presentation.message);
      if (presentation.redirectToAccessUnavailable) router.push("/access-unavailable");
      return true;
    },
    [router, toast],
  );
}
