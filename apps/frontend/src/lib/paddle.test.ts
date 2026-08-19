import { describe, expect, it, vi } from "vitest";

import type { Paddle } from "./paddle";
import { checkoutOptions, configurePaddle } from "./paddle";

describe("Paddle integration", () => {
  it("builds the exact overlay checkout payload expected by the webhook", () => {
    expect(
      checkoutOptions({
        email: "owner@example.com",
        priceId: "pri_test",
        workspaceId: "ws_123",
      }),
    ).toEqual({
      customData: { workspace_id: "ws_123" },
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
});
