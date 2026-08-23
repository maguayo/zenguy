import { afterEach, describe, expect, it } from "vitest";

import {
  clearPrincipalCache,
  queryClient,
  queryHashForPrincipal,
  setQueryPrincipal,
} from "./query-client";

describe("principal query cache", () => {
  afterEach(() => {
    setQueryPrincipal(null);
    queryClient.clear();
  });

  it("uses distinct effective cache entries for the same key under users A and B", () => {
    setQueryPrincipal("usr_a");
    queryClient.setQueryData(["workspaces"], [{ id: "workspace-a" }]);
    setQueryPrincipal("usr_b");

    expect(queryClient.getQueryData(["workspaces"])).toBeUndefined();
    queryClient.setQueryData(["workspaces"], [{ id: "workspace-b" }]);

    expect(queryClient.getQueryCache().getAll().map((query) => query.queryHash)).toEqual(
      expect.arrayContaining([
        queryHashForPrincipal("usr_a", ["workspaces"]),
        queryHashForPrincipal("usr_b", ["workspaces"]),
      ]),
    );
  });

  it("does not expose A cache after A logs out and B signs in", async () => {
    setQueryPrincipal("usr_a");
    queryClient.setQueryData(["ws", "workspace-a", "members"], [{ id: "member-a" }]);

    await clearPrincipalCache(null);
    setQueryPrincipal("usr_b");

    expect(queryClient.getQueryData(["ws", "workspace-a", "members"])).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it("does not expose A cache when the active session directly adopts B", async () => {
    setQueryPrincipal("usr_a");
    queryClient.setQueryData(["workspaces"], [{ id: "workspace-a" }]);

    await clearPrincipalCache(null);
    setQueryPrincipal("usr_b");
    queryClient.setQueryData(["workspaces"], [{ id: "workspace-b" }]);

    expect(queryClient.getQueryData(["workspaces"])).toEqual([{ id: "workspace-b" }]);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
    expect(queryClient.getQueryCache().getAll()[0]?.queryHash).toBe(
      queryHashForPrincipal("usr_b", ["workspaces"]),
    );
  });
});
