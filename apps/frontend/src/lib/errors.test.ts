import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  apiErrorMessage,
  isUnavailableItem,
  itemQueryErrorMessage,
  unavailableItemMessage,
} from "./errors";

describe("error presentation", () => {
  it("uses the retained-data message for missing or gone deep-link resources", () => {
    const missing = new ApiError("Not found", { code: "NOT_FOUND", status: 404 });
    const gone = new ApiError("Gone", { code: "GONE", status: 410 });
    expect(isUnavailableItem(missing)).toBe(true);
    expect(isUnavailableItem(gone)).toBe(true);
    expect(itemQueryErrorMessage(missing)).toBe(unavailableItemMessage);
    expect(itemQueryErrorMessage(gone)).toBe(unavailableItemMessage);
  });

  it("leaves retryable failures on the default error-state copy", () => {
    const internal = new ApiError("Provider failed", { code: "INTERNAL", status: 500 });
    expect(isUnavailableItem(internal)).toBe(false);
    expect(itemQueryErrorMessage(internal)).toBeUndefined();
    expect(apiErrorMessage(internal)).toBe("Provider failed");
    expect(apiErrorMessage(null)).toBe("Something went wrong");
  });
});
