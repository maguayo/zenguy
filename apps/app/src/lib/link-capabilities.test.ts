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
    captureLinkCapability("grant", "grant", 2_000);
    forgetLinkCapability("invitation");
    expect(linkCapability("invitation", 2_001)).toBeNull();
    expect(linkCapability("grant", 2_001)).toBe("grant");
    forgetLinkCapability("grant");
  });

  it("rejects malformed input and clears an older value of that type", () => {
    captureLinkCapability("grant", "old", 3_000);
    expect(captureLinkCapability("grant", "../new", 3_001)).toBeNull();
    expect(linkCapability("grant", 3_002)).toBeNull();
  });
});
