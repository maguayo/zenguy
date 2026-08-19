import { getJsonPath } from "./jsonpath";

const VALUE = {
  service: {
    regions: [
      { name: "eu", checks: [{ status: "ok" }] },
      { name: "us", checks: [{ status: "degraded" }] },
    ],
  },
};

describe("getJsonPath", () => {
  it.each([
    ["$.service.regions[0].checks[0].status", "ok"],
    ["service.regions[1].name", "us"],
    ["$service.regions[0].name", "eu"],
    ["$", VALUE],
  ])("reads %s", (path, expected) => {
    expect(getJsonPath(VALUE, path)).toEqual({ found: true, value: expected });
  });

  it.each([
    "$.service.missing",
    "$.service.regions[9].name",
    "$.service.regions[-1]",
    "$.service.regions[*]",
    "$.service..regions",
    "$.service.regions.length",
  ])("reports missing or unsupported path %s", (path) => {
    expect(getJsonPath(VALUE, path)).toEqual({
      found: false,
      value: undefined,
    });
  });
});
