import { AppState } from "react-native";
import { focusManager, hashKey, QueryClient, type QueryKey } from "@tanstack/react-query";

import { ApiError } from "./api";

export function shouldRetryQuery(count: number, error: unknown): boolean {
  return !(error instanceof ApiError && error.status < 500) && count < 2;
}

let activePrincipalId: string | null = null;

/** Namespaces every query cache entry by the authenticated user. */
export function principalQueryHash(queryKey: QueryKey): string {
  return queryHashForPrincipal(activePrincipalId, queryKey);
}

export function queryHashForPrincipal(principalId: string | null, queryKey: QueryKey): string {
  return hashKey(["principal", principalId ?? "signed-out", queryKey]);
}

export function setQueryPrincipal(principalId: string | null): void {
  activePrincipalId = principalId;
}

// Cache lives in memory only: nothing from a workspace is ever persisted.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryKeyHashFn: principalQueryHash,
      retry: shouldRetryQuery,
      staleTime: 10_000,
    },
  },
});

/** Cancel and remove all old-principal queries/mutations before changing identity. */
export async function clearPrincipalCache(nextPrincipalId: string | null = null): Promise<void> {
  try {
    await queryClient.cancelQueries();
  } finally {
    setQueryPrincipal(nextPrincipalId);
    queryClient.clear();
  }
}

// Refetch stale queries when the app returns to the foreground, the
// equivalent of the web app's refetchOnWindowFocus.
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener("change", (state) => {
    handleFocus(state === "active");
  });
  return () => subscription.remove();
});
