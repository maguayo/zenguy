import { describe, expect, it } from "vitest";

import { shouldTrack } from "./ActivityTracker";

const verified = { emailVerified: true };
const unverified = { emailVerified: false };

describe("shouldTrack", () => {
  it("tracks only signed-in sessions with a verified email", () => {
    expect(shouldTrack("signedIn", verified)).toBe(true);
    expect(shouldTrack("signedIn", unverified)).toBe(false);
    expect(shouldTrack("signedIn", null)).toBe(false);
    expect(shouldTrack("signedOut", verified)).toBe(false);
    expect(shouldTrack("loading", verified)).toBe(false);
  });
});
