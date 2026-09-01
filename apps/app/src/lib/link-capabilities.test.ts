import { describe, expect, it } from "@jest/globals";

import {
  captureLinkCapability,
  forgetLinkCapability,
  linkCapability,
} from "./link-capabilities";

describe("link capabilities", () => {
  it("keeps validated bearers in memory for a bounded continuation", () => {
    expect(captureLinkCapability("invitation", "  valid_token-1  ", 1_000)).toBe(
      "valid_token-1",
    );
    expect(linkCapability("invitation", 1_001)).toBe("valid_token-1");
    expect(linkCapability("invitation", 1_801_000)).toBeNull();
  });

  it("isolates capability types and supports explicit disposal", () => {
    captureLinkCapability("invitation", "invite", 2_000);
    captureLinkCapability("password-reset", "reset", 2_000);
    forgetLinkCapability("invitation");
    expect(linkCapability("invitation", 2_001)).toBeNull();
    expect(linkCapability("password-reset", 2_001)).toBe("reset");
    forgetLinkCapability("password-reset");
  });

  it("rejects malformed input and clears an older value of that type", () => {
    captureLinkCapability("password-reset", "old", 3_000);
    expect(captureLinkCapability("password-reset", "../new", 3_001)).toBeNull();
    expect(linkCapability("password-reset", 3_002)).toBeNull();
  });
});
