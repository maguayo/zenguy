import type { AttemptMessage } from "../../domain/queues";

/**
 * Destino de los AttemptMessage: la cola clásica (worker por pull) o el
 * Durable Object RunnerContainer que arranca un contenedor efímero por
 * attempt en Cloudflare Containers. `delaySeconds` es contrato: los retries
 * funcionales llegan con 60/120 s de retraso y el DO debe respetarlos
 * aplazando el arranque, igual que lo hacía la cola.
 */
export type AttemptDispatchOptions = { delaySeconds?: number };

export type AttemptDispatch = {
  send(
    message: AttemptMessage,
    options?: AttemptDispatchOptions,
  ): Promise<unknown>;
};

type RunnerContainerNamespace = {
  getByName(name: string): {
    fetch(url: string, init?: RequestInit): Promise<Response>;
  };
};

type DispatchEnv = {
  RUNNER_DISPATCH?: string;
  RUN_QUEUE: Pick<Queue<AttemptMessage>, "send">;
  RUNNER_CONTAINER?: RunnerContainerNamespace;
};

export function resolveAttemptDispatch(env: DispatchEnv): AttemptDispatch {
  if (env.RUNNER_DISPATCH !== "container") {
    return {
      send: (message, options) => env.RUN_QUEUE.send(message, options),
    };
  }
  const containers = env.RUNNER_CONTAINER;
  if (containers === undefined) {
    throw new Error(
      "RUNNER_DISPATCH=container requiere el binding RUNNER_CONTAINER",
    );
  }
  return {
    send: async (message, options) => {
      const stub = containers.getByName(message.attemptId);
      const response = await stub.fetch("http://runner-container/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          delaySeconds: options?.delaySeconds ?? 0,
        }),
      });
      if (!response.ok) {
        throw new Error(
          `RunnerContainer dispatch failed with HTTP ${response.status}`,
        );
      }
    },
  };
}
