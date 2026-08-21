import { describe, expect, it } from "@jest/globals";

import {
  addKeyValue,
  changeKeyValue,
  keyValueListError,
  keyValueRowErrors,
  removeKeyValue,
} from "./key-value";

describe("key/value editor", () => {
  it("adds, edits, and removes immutable rows", () => {
    const original = [{ key: "Accept", value: "application/json" }];
    const added = addKeyValue(original);
    expect(added).toEqual([...original, { key: "", value: "" }]);
    expect(changeKeyValue(added, 1, "key", "Authorization")[1]?.key).toBe(
      "Authorization",
    );
    expect(changeKeyValue(added, 0, "value", "text/plain")[0]).toEqual({
      key: "Accept",
      value: "text/plain",
    });
    expect(removeKeyValue(added, 0)).toEqual([{ key: "", value: "" }]);
    expect(original).toEqual([{ key: "Accept", value: "application/json" }]);
  });

  it("splits react-hook-form errors into per-row and list-level messages", () => {
    const perRow = [
      undefined,
      { key: { message: "Header name is required.", type: "too_small" } },
      { value: { message: "Too long", type: "too_big" } },
      {},
    ];
    expect(keyValueRowErrors(perRow)).toEqual([
      undefined,
      { key: "Header name is required.", value: undefined },
      { key: undefined, value: "Too long" },
      undefined,
    ]);
    expect(keyValueListError(perRow)).toBeUndefined();

    const listLevel = { message: "Too many headers", type: "too_big" };
    expect(keyValueRowErrors(listLevel)).toBeUndefined();
    expect(keyValueListError(listLevel)).toBe("Too many headers");

    expect(keyValueRowErrors(undefined)).toBeUndefined();
    expect(keyValueListError(undefined)).toBeUndefined();
  });
});
