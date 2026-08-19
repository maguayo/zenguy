import { z } from "zod";

export const agentActionSchema = z
  .object({
    thought: z.string().min(1),
    action: z.enum([
      "navigate",
      "click",
      "type",
      "select",
      "press_key",
      "scroll",
      "go_back",
      "wait",
      "finish",
    ]),
    url: z.string().optional(),
    index: z.number().int().nonnegative().optional(),
    text: z.string().optional(),
    value: z.string().optional(),
    key: z.string().optional(),
    direction: z.enum(["up", "down"]).optional(),
    seconds: z.number().nonnegative().max(10).optional(),
    outcome: z.enum(["PASSED", "FAILED"]).optional(),
    summary: z.string().optional(),
    expected_result: z.string().optional(),
    actual_result: z.string().optional(),
    failure_reason: z.string().optional(),
  })
  .strict();

export type AgentAction = z.infer<typeof agentActionSchema>;

export interface LlmClient {
  decideAction(input: {
    system: string;
    userText: string;
    screenshotJpegBase64: string | null;
  }): Promise<{ action: AgentAction; tokensUsed: number }>;
}

function missing(action: AgentAction, field: keyof AgentAction): string | null {
  const value = action[field];
  return value === undefined || (typeof value === "string" && value.length === 0)
    ? `${action.action} requires ${field}`
    : null;
}

function firstError(...errors: Array<string | null>): string | null {
  return errors.find((error): error is string => error !== null) ?? null;
}

export function validateAgentAction(action: AgentAction): string | null {
  switch (action.action) {
    case "navigate":
      return missing(action, "url");
    case "click":
      return missing(action, "index");
    case "type":
      return firstError(missing(action, "index"), missing(action, "text"));
    case "select":
      return firstError(missing(action, "index"), missing(action, "value"));
    case "press_key":
      return missing(action, "key");
    case "scroll":
      return missing(action, "direction");
    case "wait":
      return missing(action, "seconds");
    case "finish":
      return firstError(
        missing(action, "outcome"),
        missing(action, "summary"),
        missing(action, "expected_result"),
        missing(action, "actual_result"),
        action.outcome === "FAILED" ? missing(action, "failure_reason") : null,
      );
    case "go_back":
      return null;
  }
}
