import { describe, expect, it } from "vitest";

import { toggleChannelId } from "./ChannelPicker";

describe("channel picker", () => {
  it("adds and removes channel ids without mutating the selection", () => {
    const original = ["channel_1"];
    expect(toggleChannelId(original, "channel_2")).toEqual(["channel_1", "channel_2"]);
    expect(toggleChannelId(original, "channel_1")).toEqual([]);
    expect(original).toEqual(["channel_1"]);
  });
});
