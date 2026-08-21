import { AppState } from "react-native";
import { QueryClient, focusManager } from "@tanstack/react-query";

import { ApiError } from "./api";

export function shouldRetryQuery(count: number, error: unknown): boolean {
  return !(error instanceof ApiError && error.status < 500) && count < 2;
}

// Cache lives in memory only: nothing from a workspace is ever persisted.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      staleTime: 10_000,
    },
  },
});

// Refetch stale queries when the app returns to the foreground, the
// equivalent of the web app's refetchOnWindowFocus.
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener("change", (state) => {
    handleFocus(state === "active");
  });
  return () => subscription.remove();
});
