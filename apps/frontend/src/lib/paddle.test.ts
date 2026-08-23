import { describe, expect, it, vi } from "vitest";

import type { Paddle } from "./paddle";
import {
  checkoutOptions,
  configurePaddle,
  PADDLE_SCRIPT_URL,
  securePaddleScript,
} from "./paddle";

describe("Paddle integration", () => {
  it("builds the exact overlay checkout payload expected by the webhook", () => {
    expect(
      checkoutOptions({
        email: "owner@example.com",
        priceId: "pri_test",
        customData: {
          checkout_intent_id: "pci_123",
          checkout_intent_sig: "signed",
        },
      }),
    ).toEqual({
      customData: {
        checkout_intent_id: "pci_123",
        checkout_intent_sig: "signed",
      },
      customer: { email: "owner@example.com" },
      items: [{ priceId: "pri_test", quantity: 1 }],
      settings: { displayMode: "overlay" },
    });
  });

  it("selects sandbox before initializing with the client token", () => {
    const set = vi.fn();
    const initialize = vi.fn();
    const paddle = {
      Checkout: { open: vi.fn() },
      Environment: { set },
      Initialize: initialize,
    } satisfies Paddle;

    configurePaddle(paddle, {
      clientToken: "test_client_token",
      environment: "sandbox",
      mode: "paddle",
      priceId: "pri_test",
    });

    expect(set).toHaveBeenCalledWith("sandbox");
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCallback: expect.any(Function),
        token: "test_client_token",
      }),
    );
    expect(set.mock.invocationCallOrder[0]).toBeLessThan(
      initialize.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("configures the loader with the sole CSP-approved Paddle URL", () => {
    const script = {
      async: false,
      dataset: {},
      referrerPolicy: "",
      src: "",
    } as unknown as HTMLScriptElement;

    securePaddleScript(script);

    expect(script).toMatchObject({
      async: true,
      dataset: { zenguyPaddle: "true" },
      referrerPolicy: "no-referrer",
      src: PADDLE_SCRIPT_URL,
    });
    expect(PADDLE_SCRIPT_URL).toBe("https://cdn.paddle.com/paddle/v2/paddle.js");
  });
});
