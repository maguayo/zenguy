import type { PaddleBillingConfig } from "../api/types";

export interface PaddleEvent {
  name: string;
}

export interface PaddleCheckoutOptions {
  customData: { workspace_id: string };
  customer: { email: string };
  items: [{ priceId: string; quantity: 1 }];
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

let paddlePromise: Promise<Paddle> | null = null;
let initializedPaddle: Paddle | null = null;
let initializedToken: string | null = null;
let checkoutCompletedCallback: (() => void) | null = null;

export function checkoutOptions({
  email,
  priceId,
  workspaceId,
}: {
  email: string;
  priceId: string;
  workspaceId: string;
}): PaddleCheckoutOptions {
  return {
    customData: { workspace_id: workspaceId },
    customer: { email },
    items: [{ priceId, quantity: 1 }],
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
    const finish = () => {
      if (window.Paddle) resolve(window.Paddle);
      else reject(new Error("Paddle loaded without exposing its SDK."));
    };
    const fail = () => reject(new Error("Paddle couldn't be loaded. Try again."));
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-zenguy-paddle="true"]',
    );
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", fail, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.dataset.zenguyPaddle = "true";
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
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
  email,
  onCompleted,
  priceId,
  workspaceId,
}: {
  email: string;
  onCompleted: () => void;
  priceId: string;
  workspaceId: string;
}): void {
  if (!initializedPaddle) throw new Error("Paddle has not been initialized.");
  checkoutCompletedCallback = onCompleted;
  try {
    initializedPaddle.Checkout.open(checkoutOptions({ email, priceId, workspaceId }));
  } catch (error) {
    checkoutCompletedCallback = null;
    throw error;
  }
}
