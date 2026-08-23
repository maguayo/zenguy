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

  it("fails closed when required push unregistration fails", async () => {
    const unregister = jest.fn(async () => {
      throw new Error("push DELETE failed");
    });
    const off = onBeforeSignOut(unregister);

    await expect(runBeforeSignOut({ required: true })).rejects.toThrow(
      "Required principal cleanup failed",
    );
    expect(unregister).toHaveBeenCalledTimes(1);
    off();
  });

  it("fails closed when required principal cleanup times out", async () => {
    const off = onBeforeSignOut(() => new Promise<void>(() => undefined));

    await expect(runBeforeSignOut({ required: true, timeoutMs: 5 })).rejects.toThrow(
      "Required principal cleanup failed",
    );
    off();
  });
});
