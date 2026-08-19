import { describe, expect, it } from "vitest";

import { addKeyValue, changeKeyValue, removeKeyValue } from "./KeyValueEditor";

describe("key/value editor", () => {
  it("adds, edits, and removes immutable rows", () => {
    const original = [{ key: "Accept", value: "application/json" }];
    const added = addKeyValue(original);
    expect(added).toEqual([...original, { key: "", value: "" }]);
    expect(changeKeyValue(added, 1, "key", "Authorization")[1]?.key).toBe(
      "Authorization",
    );
    expect(removeKeyValue(added, 0)).toEqual([{ key: "", value: "" }]);
    expect(original).toEqual([{ key: "Accept", value: "application/json" }]);
  });
});
