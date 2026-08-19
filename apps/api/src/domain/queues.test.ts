import { notifyMessageSchema } from "./queues";

const VALID = {
  kind: "notify",
  deliveryId: "del_1",
  workspaceId: "ws_1",
  channelId: "ch_1",
  message: {
    eventType: "FAILURE",
    title: "Failure",
    lines: ["A failure occurred"],
    link: "https://app.zenguy.test/w/ws_1/incidents/inc_1",
    speakText: "Zenguy alert.",
    shortText: "Zenguy: FAILED.",
    color: "red",
  },
} as const;

describe("notifyMessageSchema", () => {
  it("parses the exact notify queue contract", () => {
    expect(notifyMessageSchema.parse(VALID)).toEqual(VALID);
  });

  it("rejects invalid and extra fields", () => {
    expect(
      notifyMessageSchema.safeParse({
        ...VALID,
        extra: "not allowed",
        message: { ...VALID.message, link: "not-a-url" },
      }).success,
    ).toBe(false);
  });
});
