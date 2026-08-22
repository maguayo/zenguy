import { describe, expect, it, jest } from "@jest/globals";

import { onBeforeSignOut, runBeforeSignOut } from "./session-hooks";

describe("sign-out hooks", () => {
  it("runs registered hooks and tolerates failures", async () => {
    const ran = jest.fn(async () => undefined);
    const failing = jest.fn(async () => {
      throw new Error("network");
    });
    const offRan = onBeforeSignOut(ran);
    const offFailing = onBeforeSignOut(failing);
    await expect(runBeforeSignOut()).resolves.toBeUndefined();
    expect(ran).toHaveBeenCalledTimes(1);
    expect(failing).toHaveBeenCalledTimes(1);
    offRan();
    offFailing();
    await runBeforeSignOut();
    expect(ran).toHaveBeenCalledTimes(1);
  });
});
