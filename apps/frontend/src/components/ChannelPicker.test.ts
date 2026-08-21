import { describe, expect, it } from "vitest";

import type { Channel } from "../api/types";
import { defaultChannelIds, toggleChannelId } from "./ChannelPicker";

const channel = (overrides: Partial<Channel>): Channel => ({
  configPreview: { emails: ["a@b.co"] },
  createdAt: "2026-08-19T10:00:00.000Z",
  enabled: true,
  id: "ch_1",
  isDefault: false,
  lastDeliveryStatus: null,
  name: "Channel",
  paused: null,
  price: null,
  type: "EMAIL",
  verifiedAt: null,
  ...overrides,
});

describe("channel picker", () => {
  it("adds and removes channel ids without mutating the selection", () => {
    const original = ["channel_1"];
    expect(toggleChannelId(original, "channel_2")).toEqual(["channel_1", "channel_2"]);
    expect(toggleChannelId(original, "channel_1")).toEqual([]);
    expect(original).toEqual(["channel_1"]);
  });

  it("preselects enabled default channels only", () => {
    expect(
      defaultChannelIds([
        channel({ id: "ch_default", isDefault: true }),
        channel({ id: "ch_disabled", enabled: false, isDefault: true }),
        channel({ id: "ch_plain" }),
      ]),
    ).toEqual(["ch_default"]);
  });
});
