import { runnerOutcomeSchema } from "./runner_protocol";

const base = {
  status: "PASSED",
  modelName: "gpt-5-mini",
  runnerVersion: "zenguy-fallback-runner/2.0.0",
  visitedUrls: [],
  consoleErrors: [],
  networkErrors: [],
};

describe("runner outcome protocol", () => {
  it("accepts the token breakdown and the runner kind", () => {
    const parsed = runnerOutcomeSchema.safeParse({
      ...base,
      tokenUsage: 120,
      inputTokens: 100,
      outputTokens: 20,
      runnerKind: "fallback",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      runnerKind: "fallback",
    });
  });

  it("keeps accepting runners that only report the total", () => {
    expect(runnerOutcomeSchema.safeParse({ ...base, tokenUsage: 5 }).success).toBe(
      true,
    );
  });

  it.each([
    { label: "an unknown runner kind", patch: { runnerKind: "mac" } },
    { label: "negative input tokens", patch: { inputTokens: -1 } },
    { label: "fractional output tokens", patch: { outputTokens: 1.5 } },
  ])("rejects $label", ({ patch }) => {
    expect(runnerOutcomeSchema.safeParse({ ...base, ...patch }).success).toBe(
      false,
    );
  });
});
