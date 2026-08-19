import { attemptMessageSchema, notifyMessageSchema } from "./queues";

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

describe("attemptMessageSchema", () => {
  it("accepts only a bounded attempt queue message", () => {
    expect(
      attemptMessageSchema.parse({
        kind: "attempt",
        runId: "run_1",
        attemptId: "att_1",
        attemptIndex: 0,
        executionGeneration: 1_700_000_000_000,
      }),
    ).toEqual({
      kind: "attempt",
      runId: "run_1",
      attemptId: "att_1",
      attemptIndex: 0,
      executionGeneration: 1_700_000_000_000,
    });
    expect(
      attemptMessageSchema.safeParse({
        kind: "attempt",
        runId: "run_1",
        attemptId: "att_1",
        attemptIndex: 4,
        executionGeneration: 1_700_000_000_000,
      }).success,
    ).toBe(false);
  });
});
