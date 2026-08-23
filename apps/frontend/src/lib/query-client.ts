import { hashKey, QueryClient, type QueryKey } from "@tanstack/react-query";

import { ApiError } from "./api";

export function shouldRetryQuery(count: number, error: unknown): boolean {
  return !(error instanceof ApiError && error.status < 500) && count < 2;
}

let activePrincipalId: string | null = null;

/**
 * Query keys at call sites stay ergonomic, while their cache identity is
 * always namespaced by the authenticated principal. This is a second line of
 * defence in case a future identity transition forgets to clear one query.
 */
export function principalQueryHash(queryKey: QueryKey): string {
  return queryHashForPrincipal(activePrincipalId, queryKey);
}

export function queryHashForPrincipal(principalId: string | null, queryKey: QueryKey): string {
  return hashKey(["principal", principalId ?? "signed-out", queryKey]);
}

export function setQueryPrincipal(principalId: string | null): void {
  activePrincipalId = principalId;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryKeyHashFn: principalQueryHash,
      refetchOnWindowFocus: true,
      retry: shouldRetryQuery,
      staleTime: 10_000,
    },
  },
});

/** Remove every request/result and move cache lookups to the requested principal. */
export async function clearPrincipalCache(nextPrincipalId: string | null = null): Promise<void> {
  try {
    await queryClient.cancelQueries();
  } finally {
    setQueryPrincipal(nextPrincipalId);
    queryClient.clear();
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem("zenguy:lastWorkspace");
      } catch {
        // Query data is still cleared when storage is blocked by the browser.
      }
    }
  }
}
