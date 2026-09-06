import { OpenAiInstructionImprover } from "./instruction_improver";
import { improveInstructionsSchema } from "../../application/browser_tests/improve_instructions";

const input = { startUrl: "https://shop.example/es-es/", device: "DESKTOP" as const,
  instructions: "Usa {{PASSWORD}}. Compara subtotales en EUR con tolerancia 0,01. No pagues." };
const completed = (instructions: string) => ({ status: "completed", output: [
  { type: "reasoning", summary: [] },
  { type: "message", content: [{ type: "output_text", text: JSON.stringify({ instructions }) }] },
] });

describe("instruction improvement", () => {
  it("uses structured output without executing the draft or storing provider responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(completed(input.instructions)));
    expect(await new OpenAiInstructionImprover("test-key", fetcher).improve(input)).toEqual({ instructions: input.instructions });
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(request!.body));
    expect(body).toMatchObject({ store: false, reasoning: { effort: "high" }, input: JSON.stringify(input) });
    expect(body.tools).toBeUndefined();
    expect(body.text.format.strict).toBe(true);
    expect(body.instructions).toContain("Never weaken assertions");
    expect(body.instructions).toContain("Do not invent a tolerance");
  });

  it.each([
    completed("Uses a password but drops the reference"),
    completed("{{PASSWORD}} {{INVENTED_SECRET}}"),
    completed(" "),
    completed("x".repeat(10_001)),
    { ...completed(input.instructions), status: "incomplete" },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] },
  ])("rejects unsafe, incomplete or invalid output", async (response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    await expect(new OpenAiInstructionImprover("test-key", fetcher).improve(input))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("bounds response sizes and hides provider errors", async () => {
    for (const response of [new Response("private provider error", { status: 429 }),
      new Response("x".repeat(128 * 1024 + 1))]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(new OpenAiInstructionImprover("test-key", fetcher).improve(input))
        .rejects.toMatchObject({ message: "Could not improve instructions. Please try again." });
    }
  });

  it("fails without a configured key and validates bounded drafts", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new OpenAiInstructionImprover(undefined, fetcher).improve(input))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(fetcher).not.toHaveBeenCalled();
    for (const draft of [{ ...input, instructions: " " }, { ...input, instructions: "x".repeat(10_001) },
      { ...input, startUrl: "file:///etc/passwd" }, { ...input, apiKey: "secret" }]) {
      expect(improveInstructionsSchema.safeParse(draft).success).toBe(false);
    }
  });
});
