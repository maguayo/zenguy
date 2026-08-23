import type { PaddleBillingConfig } from "../api/types";

export interface PaddleEvent {
  name: string;
}

export interface PaddleCheckoutOptions {
  customData: Record<string, string>;
  customer: { email: string };
  items: [{ priceId: string; quantity: number }];
  settings: { displayMode: "overlay" };
}

export interface Paddle {
  Checkout: {
    open: (options: PaddleCheckoutOptions) => void;
  };
  Environment: {
    set: (environment: "sandbox") => void;
  };
  Initialize: (options: {
    eventCallback: (event: PaddleEvent) => void;
    token: string;
  }) => void;
}

declare global {
  interface Window {
    Paddle?: Paddle;
  }
}

export const PADDLE_SCRIPT_URL = "https://cdn.paddle.com/paddle/v2/paddle.js";
const PADDLE_SCRIPT_TIMEOUT_MS = 15_000;

let paddlePromise: Promise<Paddle> | null = null;
let initializedPaddle: Paddle | null = null;
let initializedToken: string | null = null;
let checkoutCompletedCallback: (() => void) | null = null;

export function securePaddleScript(script: HTMLScriptElement): void {
  script.async = true;
  script.dataset.zenguyPaddle = "true";
  script.referrerPolicy = "no-referrer";
  // Paddle requires its always-current SDK to be loaded directly from its CDN
  // and does not publish an immutable URL/hash. The versioned CSP restricts
  // script execution to this exact path instead of trusting the whole origin.
  script.src = PADDLE_SCRIPT_URL;
}

export function checkoutOptions({
  customData,
  email,
  priceId,
  quantity = 1,
}: {
  customData: Record<string, string>;
  email: string;
  priceId: string;
  quantity?: number;
}): PaddleCheckoutOptions {
  return {
    customData: { ...customData },
    customer: { email },
    items: [{ priceId, quantity }],
    settings: { displayMode: "overlay" },
  };
}

export function configurePaddle(
  paddle: Paddle,
  config: PaddleBillingConfig,
): void {
  if (config.environment === "sandbox") paddle.Environment.set("sandbox");
  paddle.Initialize({
    eventCallback: (event) => {
      if (event.name !== "checkout.completed") return;
      const callback = checkoutCompletedCallback;
      checkoutCompletedCallback = null;
      callback?.();
    },
    token: config.clientToken,
  });
}

export function loadPaddle(): Promise<Paddle> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Paddle can only load in a browser."));
  }
  if (window.Paddle) return Promise.resolve(window.Paddle);
  if (paddlePromise) return paddlePromise;

  paddlePromise = new Promise<Paddle>((resolve, reject) => {
    let timeoutId: number | undefined;
    let script: HTMLScriptElement;

    const cleanup = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      script.removeEventListener("load", finish);
      script.removeEventListener("error", onError);
    };
    const finish = () => {
      cleanup();
      if (window.Paddle) {
        resolve(window.Paddle);
        return;
      }
      script.remove();
      reject(new Error("Paddle loaded without exposing its SDK."));
    };
    const fail = (message: string) => {
      cleanup();
      script.remove();
      reject(new Error(message));
    };
    const onError = () => fail("Paddle couldn't be loaded. Try again.");
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-zenguy-paddle="true"]',
    );
    if (existing) {
      script = existing;
      if (script.src !== PADDLE_SCRIPT_URL) {
        fail("Refused an unexpected Paddle script URL.");
        return;
      }
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", onError, { once: true });
      timeoutId = window.setTimeout(
        () => fail("Paddle took too long to load. Try again."),
        PADDLE_SCRIPT_TIMEOUT_MS,
      );
      return;
    }

    script = document.createElement("script");
    securePaddleScript(script);
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", onError, { once: true });
    timeoutId = window.setTimeout(
      () => fail("Paddle took too long to load. Try again."),
      PADDLE_SCRIPT_TIMEOUT_MS,
    );
    document.head.append(script);
  }).catch((error: unknown) => {
    paddlePromise = null;
    throw error;
  });

  return paddlePromise;
}

export async function initPaddle(config: PaddleBillingConfig): Promise<Paddle> {
  const paddle = await loadPaddle();
  if (initializedPaddle !== paddle || initializedToken !== config.clientToken) {
    configurePaddle(paddle, config);
    initializedPaddle = paddle;
    initializedToken = config.clientToken;
  }
  return paddle;
}

export function openCheckout({
  customData,
  email,
  onCompleted,
  priceId,
  quantity,
}: {
  customData: Record<string, string>;
  email: string;
  onCompleted: () => void;
  priceId: string;
  quantity?: number;
}): void {
  if (!initializedPaddle) throw new Error("Paddle has not been initialized.");
  checkoutCompletedCallback = onCompleted;
  try {
    initializedPaddle.Checkout.open(
      checkoutOptions({ customData, email, priceId, quantity }),
    );
  } catch (error) {
    checkoutCompletedCallback = null;
    throw error;
  }
}
