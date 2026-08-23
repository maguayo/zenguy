import { parseChannelConfig } from "./input";

describe("parseChannelConfig", () => {
  it.each(["SMS", "WHATSAPP", "CALL"] as const)(
    "requires explicit recipient consent for %s",
    (type) => {
      expect(() =>
        parseChannelConfig(type, { phoneNumber: "+34600123456" }),
      ).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
      expect(
        parseChannelConfig(type, {
          phoneNumber: "+34600123456",
          consent: true,
        }),
      ).toMatchObject({ phoneNumber: "+34600123456", consent: true });
    },
  );
});
