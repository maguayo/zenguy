import { describe, expect, it } from "vitest";

import { ACTIVITY_EVENTS_PATH, beaconRequest } from "./beacon";
import type { ClientEvent } from "./route-events";

const visit: ClientEvent = {
  type: "web.page_viewed",
  workspaceId: "ws_1",
  properties: { page: "/w/:wsId/overview" },
};

describe("beaconRequest", () => {
  it("posts the batch to the events endpoint with the bearer token, keepalive and cookies", () => {
    const { url, init } = beaconRequest([visit], "token-123", "https://api.zenguy.com");
    expect(url).toBe(`https://api.zenguy.com${ACTIVITY_EVENTS_PATH}`);
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({ events: [visit] });
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("omits the Authorization header without a token and keeps relative URLs for same-origin", () => {
    const { url, init } = beaconRequest([visit], null, "");
    expect(url).toBe(ACTIVITY_EVENTS_PATH);
    expect((init.headers as Headers).has("Authorization")).toBe(false);
  });
});
