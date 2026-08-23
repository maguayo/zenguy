import { afterEach, describe, expect, it } from "@jest/globals";

import {
  clearPendingRegistrationEmail,
  getPendingRegistrationEmail,
  setPendingRegistrationEmail,
} from "./registration-pending";

describe("pending registration email", () => {
  afterEach(clearPendingRegistrationEmail);

  it("keeps only a normalized process-local resend address", () => {
    expect(getPendingRegistrationEmail()).toBeNull();
    setPendingRegistrationEmail(" Alice@Example.COM ");
    expect(getPendingRegistrationEmail()).toBe("alice@example.com");
    clearPendingRegistrationEmail();
    expect(getPendingRegistrationEmail()).toBeNull();
  });
});
