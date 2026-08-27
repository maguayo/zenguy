import type { AttemptMessage } from "../../domain/queues";

/**
 * Lógica pura del RunnerContainer, separada de la clase Durable Object para
 * poder testearla en vitest sin el runtime de Workers (`cloudflare:workers`).
 */
export type RunnerContainerEnv = {
  RUNNER_ENVIRONMENT: string;
  PUBLIC_API_URL: string;
  RUNNER_CF_API_TOKEN: string;
  OPENAI_API_KEY_CF: string;
  RUNNER_CF_ACCESS_CLIENT_ID: string;
  RUNNER_CF_ACCESS_CLIENT_SECRET: string;
  /**
   * "El test manda": cuando es truthy, el runner ejecuta lo que digan las
   * instrucciones del test sin gate de acciones irreversibles ni allowlist de
   * dominios (checkout, login, compra). Var del Worker para poder desactivarlo
   * sin reconstruir la imagen.
   */
  RUNNER_UNRESTRICTED_ACTIONS?: string;
};

function envFlagEnabled(raw: string | undefined): boolean {
  return ["1", "t", "y"].includes((raw ?? "").trim().toLowerCase().charAt(0));
}

export const WATCHDOG_DELAY_SECONDS = 8 * 60;
export const WATCHDOG_RECHECK_SECONDS = 4 * 60;
export const WATCHDOG_MAX_RECHECKS = 3;

export type WatchdogState = {
  message: AttemptMessage;
  checksLeft: number;
};

export function runnerWorkerId(environment: string): string {
  return `zenguy-${environment}-cf`;
}

export function buildRunnerEnvVars(
  env: RunnerContainerEnv,
  message: AttemptMessage,
  deliveryId: string,
) {
  if (
    !env.RUNNER_CF_API_TOKEN ||
    !env.OPENAI_API_KEY_CF ||
    !env.RUNNER_CF_ACCESS_CLIENT_ID ||
    !env.RUNNER_CF_ACCESS_CLIENT_SECRET ||
    !env.RUNNER_ENVIRONMENT ||
    !env.PUBLIC_API_URL
  ) {
    throw new Error(
      "RunnerContainer requiere RUNNER_ENVIRONMENT, PUBLIC_API_URL y sus cuatro secretos",
    );
  }
  return {
    ZENGUY_ISOLATED_RUNNER: "cloudflare",
    ZENGUY_RUNNER_ENVIRONMENT: env.RUNNER_ENVIRONMENT,
    ZENGUY_WORKER_ID: runnerWorkerId(env.RUNNER_ENVIRONMENT),
    ZENGUY_API_URL: env.PUBLIC_API_URL,
    ZENGUY_ATTEMPT_MESSAGE: JSON.stringify(message),
    ZENGUY_DELIVERY_ID: deliveryId,
    ZENGUY_RUNNER_TOKEN: env.RUNNER_CF_API_TOKEN,
    OPENAI_API_KEY: env.OPENAI_API_KEY_CF,
    CF_ACCESS_CLIENT_ID: env.RUNNER_CF_ACCESS_CLIENT_ID,
    CF_ACCESS_CLIENT_SECRET: env.RUNNER_CF_ACCESS_CLIENT_SECRET,
    ZENGUY_UNRESTRICTED_ACTIONS: envFlagEnabled(env.RUNNER_UNRESTRICTED_ACTIONS)
      ? "1"
      : "0",
    // Paginas de pasarela/checkout son pesadas y tardan mas que la home en
    // disparar 'load'; el default de 30 s de browser-use las dejaba en
    // about:blank. 60 s da margen sin colgar un attempt real (limite 300 s).
    TIMEOUT_NavigateToUrlEvent: "60",
    // Tiendas con mucha media first-party generan un DOM grande; construirlo en
    // el contenedor puede pasar de los 30 s por defecto de browser-use, que
    // entonces devuelve un DOM VACIO y el agente se atasca. 90 s da margen para
    // que la captura termine con un DOM real.
    TIMEOUT_BrowserStateRequestEvent: "90",
  };
}

export function parseDispatchPayload(
  body: unknown,
): { message: AttemptMessage; delaySeconds: number } | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as { message?: unknown; delaySeconds?: unknown };
  const message = candidate.message as AttemptMessage | undefined;
  if (
    message === undefined ||
    message === null ||
    typeof message.attemptId !== "string" ||
    message.attemptId === ""
  ) {
    return null;
  }
  const rawDelay =
    typeof candidate.delaySeconds === "number" ? candidate.delaySeconds : 0;
  return { message, delaySeconds: Math.max(0, Math.trunc(rawDelay)) };
}

/**
 * Claim del watchdog contra la API pública. Devuelve la disposición,
 * AUTH_ERROR para credenciales inválidas, o null cuando la respuesta no es
 * interpretable (tratada como transitoria por el llamante).
 */
export async function watchdogClaim(
  env: RunnerContainerEnv,
  message: AttemptMessage,
  deliveryId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<"EXECUTE" | "SKIP" | "AUTH_ERROR" | null> {
  const workerId = runnerWorkerId(env.RUNNER_ENVIRONMENT);
  const response = await fetchImpl(
    `${env.PUBLIC_API_URL}/api/runner/attempts/claim`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RUNNER_CF_API_TOKEN}`,
        "CF-Access-Client-Id": env.RUNNER_CF_ACCESS_CLIENT_ID,
        "CF-Access-Client-Secret": env.RUNNER_CF_ACCESS_CLIENT_SECRET,
        "X-Zenguy-Worker-Id": workerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ deliveryId, message, workerId }),
    },
  );
  if (response.status === 401 || response.status === 403) {
    return "AUTH_ERROR";
  }
  if (!response.ok) return null;
  const parsed = (await response.json().catch(() => null)) as {
    data?: { disposition?: string };
  } | null;
  const disposition = parsed?.data?.disposition;
  if (disposition === "EXECUTE" || disposition === "SKIP") return disposition;
  return null;
}
