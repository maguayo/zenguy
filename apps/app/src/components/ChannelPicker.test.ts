import { describe, expect, it } from "@jest/globals";

import { toggleChannelId } from "./ChannelPicker";

describe("toggleChannelId", () => {
  it("adds and removes ids without duplicates", () => {
    expect(toggleChannelId([], "a")).toEqual(["a"]);
    expect(toggleChannelId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleChannelId(["a", "b"], "a")).toEqual(["b"]);
  });
});
