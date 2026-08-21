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

let paddlePromise: Promise<Paddle> | null = null;
let initializedPaddle: Paddle | null = null;
let initializedToken: string | null = null;
let checkoutCompletedCallback: (() => void) | null = null;

export function checkoutOptions({
  customData,
  email,
  priceId,
  quantity = 1,
  workspaceId,
}: {
  customData?: Record<string, string>;
  email: string;
  priceId: string;
  quantity?: number;
  workspaceId: string;
}): PaddleCheckoutOptions {
  return {
    customData: { workspace_id: workspaceId, ...customData },
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
  customData,
  email,
  onCompleted,
  priceId,
  quantity,
  workspaceId,
}: {
  customData?: Record<string, string>;
  email: string;
  onCompleted: () => void;
  priceId: string;
  quantity?: number;
  workspaceId: string;
}): void {
  if (!initializedPaddle) throw new Error("Paddle has not been initialized.");
  checkoutCompletedCallback = onCompleted;
  try {
    initializedPaddle.Checkout.open(
      checkoutOptions({ customData, email, priceId, quantity, workspaceId }),
    );
  } catch (error) {
    checkoutCompletedCallback = null;
    throw error;
  }
}
