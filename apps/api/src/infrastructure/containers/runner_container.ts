import { Container } from "@cloudflare/containers";
import type { AttemptMessage } from "../../domain/queues";
import {
  WATCHDOG_DELAY_SECONDS,
  WATCHDOG_MAX_RECHECKS,
  WATCHDOG_RECHECK_SECONDS,
  buildRunnerEnvVars,
  parseDispatchPayload,
  watchdogClaim,
  type RunnerContainerEnv,
  type WatchdogState,
} from "./runner_support";

/**
 * Un Durable Object por attempt (name = attemptId) que ejecuta el runner de
 * browser-tests como contenedor efímero one-shot en Cloudflare Containers.
 *
 * Flujo: POST /dispatch {message, delaySeconds} → (aplaza si hay delay) →
 * start() con el AttemptMessage y las credenciales en envVars → el contenedor
 * hace el claim por el protocolo runner de siempre, ejecuta y muere.
 *
 * Watchdog: a los 8 minutos el DO relanza un claim con delivery id fresco por
 * la API pública. Un attempt sano o terminal responde SKIP (inofensivo); uno
 * pasado de plazo dispara la recuperación WORKER_LOST existente y su retry; un
 * EXECUTE significa que nadie llegó a reclamarlo (contenedor muerto antes del
 * claim) y se relanza el contenedor con ese mismo delivery id.
 */
export class RunnerContainer extends Container<RunnerContainerEnv> {
  sleepAfter = "15m";
  enableInternet = true;
  entrypoint = ["python", "/opt/zenguy/runner/browser_worker.py", "--cloudflare"];

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/dispatch") {
      return new Response("not found", { status: 404 });
    }
    const payload = parseDispatchPayload(
      await request.json().catch(() => null),
    );
    if (payload === null) {
      return new Response("invalid dispatch payload", { status: 400 });
    }
    if (payload.delaySeconds > 0) {
      await this.schedule(payload.delaySeconds, "launch", payload.message);
    } else {
      await this.launch(payload.message);
    }
    return Response.json({ dispatched: true, delaySeconds: payload.delaySeconds });
  }

  async launch(message: AttemptMessage): Promise<void> {
    await this.launchWithDelivery(message, `cf-${crypto.randomUUID()}`);
  }

  async launchWithDelivery(
    message: AttemptMessage,
    deliveryId: string,
  ): Promise<void> {
    await this.start({
      envVars: buildRunnerEnvVars(this.env, message, deliveryId),
    });
    await this.schedule(WATCHDOG_DELAY_SECONDS, "watchdog", {
      message,
      checksLeft: WATCHDOG_MAX_RECHECKS,
    } satisfies WatchdogState);
  }

  async watchdog(state: WatchdogState): Promise<void> {
    const deliveryId = `cf-watchdog-${crypto.randomUUID()}`;
    const disposition = await watchdogClaim(
      this.env,
      state.message,
      deliveryId,
    ).catch(() => null);
    if (disposition === "AUTH_ERROR") {
      console.error("runner_container_watchdog_auth_error", {
        attemptId: state.message.attemptId,
      });
      return;
    }
    if (disposition === "EXECUTE") {
      // Nadie llegó a reclamarlo: el claim del watchdog ya posee el attempt
      // con este delivery id; el contenedor relanzado reclama idempotente.
      await this.launchWithDelivery(state.message, deliveryId);
      return;
    }
    // SKIP: sano o terminal. null: transitorio. Revalidar unas pocas veces
    // para cubrir un contenedor que murió a mitad de run: el claim posterior
    // dispara la recuperación WORKER_LOST del protocolo.
    if (state.checksLeft > 0) {
      await this.schedule(WATCHDOG_RECHECK_SECONDS, "watchdog", {
        message: state.message,
        checksLeft: state.checksLeft - 1,
      } satisfies WatchdogState);
    }
  }

  override onError(error: unknown): unknown {
    console.error("runner_container_error", { error: String(error) });
    return error;
  }
}
