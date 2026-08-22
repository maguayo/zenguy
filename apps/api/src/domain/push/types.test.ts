import { isExpoPushToken, pushTokenSuffix, redactPushTokens } from "./types";

describe("push tokens", () => {
  it("accepts Expo push tokens only", () => {
    expect(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc-DEF_123456]")).toBe(true);
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[short]")).toBe(false);
    expect(isExpoPushToken("apns:abcdef0123456789")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[has space 12345]")).toBe(false);
  });

  it("exposes only a short suffix and redacts tokens from text", () => {
    expect(pushTokenSuffix("ExponentPushToken[abcdefghijklmnop]")).toBe("klmnop");
    expect(
      redactPushTokens(
        '"ExponentPushToken[abcdefghijklmnop]" is not a registered push notification recipient',
      ),
    ).toBe('"[redacted-token]" is not a registered push notification recipient');
  });
});
