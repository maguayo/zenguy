import { describe, expect, it, vi } from "vitest";
import { resolveAttemptDispatch } from "./attempt_dispatch";
import type { AttemptMessage } from "../../domain/queues";

const message = { attemptId: "att_1" } as AttemptMessage;

describe("resolveAttemptDispatch", () => {
  it("usa la cola cuando RUNNER_DISPATCH no es container", async () => {
    const send = vi.fn();
    const dispatch = resolveAttemptDispatch({
      RUNNER_DISPATCH: "queue",
      RUN_QUEUE: { send },
    } as never);
    await dispatch.send(message, { delaySeconds: 60 });
    expect(send).toHaveBeenCalledWith(message, { delaySeconds: 60 });
  });

  it("usa la cola cuando RUNNER_DISPATCH no está definido", async () => {
    const send = vi.fn();
    const dispatch = resolveAttemptDispatch({ RUN_QUEUE: { send } } as never);
    await dispatch.send(message, { delaySeconds: 0 });
    expect(send).toHaveBeenCalledWith(message, { delaySeconds: 0 });
  });

  it("entrega al DO RunnerContainer con el delay cuando RUNNER_DISPATCH=container", async () => {
    const doFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const getByName = vi.fn(() => ({ fetch: doFetch }));
    const dispatch = resolveAttemptDispatch({
      RUNNER_DISPATCH: "container",
      RUNNER_CONTAINER: { getByName },
    } as never);
    await dispatch.send(message, { delaySeconds: 120 });
    expect(getByName).toHaveBeenCalledWith("att_1");
    const [url, init] = doFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(url)).toContain("/dispatch");
    expect(JSON.parse(init.body as string)).toEqual({
      message: { attemptId: "att_1" },
      delaySeconds: 120,
    });
  });

  it("normaliza la ausencia de opciones a delaySeconds 0", async () => {
    const doFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const dispatch = resolveAttemptDispatch({
      RUNNER_DISPATCH: "container",
      RUNNER_CONTAINER: { getByName: () => ({ fetch: doFetch }) },
    } as never);
    await dispatch.send(message);
    const [, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).delaySeconds).toBe(0);
  });

  it("falla en construcción si falta el binding RUNNER_CONTAINER", () => {
    expect(() =>
      resolveAttemptDispatch({ RUNNER_DISPATCH: "container" } as never),
    ).toThrow(/RUNNER_CONTAINER/);
  });

  it("propaga un fallo del DO como error", async () => {
    const dispatch = resolveAttemptDispatch({
      RUNNER_DISPATCH: "container",
      RUNNER_CONTAINER: {
        getByName: () => ({
          fetch: async () => new Response(null, { status: 500 }),
        }),
      },
    } as never);
    await expect(dispatch.send(message)).rejects.toThrow(/500/);
  });
});
