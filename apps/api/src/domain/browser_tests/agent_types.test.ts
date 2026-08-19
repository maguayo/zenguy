import {
  agentActionSchema,
  validateAgentAction,
  type AgentAction,
} from "./agent_types";

function action(
  fields: Partial<AgentAction> & Pick<AgentAction, "action">,
): AgentAction {
  return { thought: "Take the next step.", ...fields };
}

describe("agentActionSchema", () => {
  it("accepts the complete action vocabulary and typed optional fields", () => {
    const actions: AgentAction[] = [
      action({ action: "navigate", url: "https://example.com" }),
      action({ action: "click", index: 2 }),
      action({ action: "type", index: 3, text: "hello" }),
      action({ action: "select", index: 4, value: "large" }),
      action({ action: "press_key", key: "Enter" }),
      action({ action: "scroll", direction: "down" }),
      action({ action: "go_back" }),
      action({ action: "wait", seconds: 10 }),
      action({
        action: "finish",
        outcome: "PASSED",
        summary: "The expected page appeared.",
        expected_result: "The page appears.",
        actual_result: "The page appeared.",
      }),
    ];

    for (const value of actions) {
      expect(agentActionSchema.safeParse(value).success).toBe(true);
      expect(validateAgentAction(value)).toBeNull();
    }
  });

  it("rejects invalid base types, unknown fields, and waits over ten seconds", () => {
    expect(
      agentActionSchema.safeParse({ thought: "Wait.", action: "wait", seconds: 11 })
        .success,
    ).toBe(false);
    expect(
      agentActionSchema.safeParse({ thought: 1, action: "click", index: 0 })
        .success,
    ).toBe(false);
    expect(
      agentActionSchema.safeParse({
        thought: "Click.",
        action: "click",
        index: 0,
        invented: true,
      }).success,
    ).toBe(false);
  });
});

describe("validateAgentAction", () => {
  it.each([
    [action({ action: "navigate" }), "navigate requires url"],
    [action({ action: "click" }), "click requires index"],
    [action({ action: "type", index: 1 }), "type requires text"],
    [action({ action: "select", value: "one" }), "select requires index"],
    [action({ action: "press_key" }), "press_key requires key"],
    [action({ action: "scroll" }), "scroll requires direction"],
    [action({ action: "wait" }), "wait requires seconds"],
  ])("reports a missing per-action parameter", (value, error) => {
    expect(validateAgentAction(value)).toBe(error);
  });

  it("requires all finish fields and a failure reason only for failures", () => {
    expect(validateAgentAction(action({ action: "finish" }))).toBe(
      "finish requires outcome",
    );
    expect(
      validateAgentAction(
        action({
          action: "finish",
          outcome: "FAILED",
          summary: "Checkout failed.",
          expected_result: "Checkout completes.",
          actual_result: "An error appeared.",
        }),
      ),
    ).toBe("finish requires failure_reason");
    expect(
      validateAgentAction(
        action({
          action: "finish",
          outcome: "FAILED",
          summary: "Checkout failed.",
          expected_result: "Checkout completes.",
          actual_result: "An error appeared.",
          failure_reason: "The site showed an error.",
        }),
      ),
    ).toBeNull();
  });
});
