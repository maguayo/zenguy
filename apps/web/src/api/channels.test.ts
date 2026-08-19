import { afterEach, describe, expect, it, vi } from "vitest";

import type { Channel, Delivery } from "./types";
import {
  channelPath,
  createChannel,
  deleteChannel,
  deliveriesPath,
  listChannels,
  listDeliveries,
  testChannel,
  updateChannel,
} from "./channels";

const channel: Channel = {
  configPreview: { emails: ["alerts@example.com"] },
  createdAt: "2026-08-19T10:00:00.000Z",
  enabled: true,
  id: "channel_1",
  lastDeliveryStatus: "SENT",
  name: "Engineering inbox",
  type: "EMAIL",
  verifiedAt: "2026-08-19T10:01:00.000Z",
};

const delivery: Delivery = {
  attemptCount: 1,
  createdAt: "2026-08-19T10:02:00.000Z",
  errorSanitized: null,
  eventType: "TEST",
  id: "delivery_1",
  incidentId: null,
  providerMessageId: "message_1",
  sentAt: "2026-08-19T10:02:01.000Z",
  status: "SENT",
};

function response(data: unknown, nextCursor?: string | null): Response {
  return new Response(JSON.stringify({ data, nextCursor }), {
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("channels API", () => {
  it("encodes channel and paginated delivery paths", () => {
    expect(channelPath("ws/one", "channel two")).toBe(
      "/api/workspaces/ws%2Fone/channels/channel%20two",
    );
    expect(
      deliveriesPath("ws_1", "channel_1", { cursor: "next+/=", limit: 25 }),
    ).toBe(
      "/api/workspaces/ws_1/channels/channel_1/deliveries?limit=25&cursor=next%2B%2F%3D",
    );
  });

  it("exposes every channel and delivery operation", async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, options?: RequestInit) => {
      const path = String(request);
      if (options?.method === "DELETE") return new Response(null, { status: 204 });
      if (path.endsWith("/test")) return response({ delivery });
      if (path.includes("/deliveries?")) return response([delivery], "next_cursor");
      if (path.endsWith("/channels") && (!options?.method || options.method === "GET")) {
        return response([channel]);
      }
      return response(channel);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listChannels("ws_1")).resolves.toEqual([channel]);
    await expect(
      createChannel("ws_1", {
        config: { emails: ["alerts@example.com"] },
        name: "Engineering inbox",
        type: "EMAIL",
      }),
    ).resolves.toEqual(channel);
    await expect(
      updateChannel("ws_1", "channel_1", { enabled: false }),
    ).resolves.toEqual(channel);
    await expect(deleteChannel("ws_1", "channel_1")).resolves.toBeUndefined();
    await expect(testChannel("ws_1", "channel_1")).resolves.toEqual(delivery);
    await expect(
      listDeliveries("ws_1", "channel_1", { limit: 1 }),
    ).resolves.toEqual({ items: [delivery], nextCursor: "next_cursor" });

    expect(fetchMock.mock.calls.map(([, options]) => options?.method ?? "GET")).toEqual([
      "GET",
      "POST",
      "PATCH",
      "DELETE",
      "POST",
      "GET",
    ]);
  });
});
