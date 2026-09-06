import { z } from "zod";
import {
  IMPROVE_INSTRUCTIONS_PROMPT,
  type ImproveInstructionsInput,
  type InstructionImprover,
} from "../../application/browser_tests/improve_instructions";
import { unavailable } from "../../shared/errors";
import { cancelResponseBody, readLimitedJsonResponse } from "../../shared/limited_response";

const resultSchema = z.object({ instructions: z.string().trim().min(1).max(10_000) }).strict();
const responseSchema = z.object({
  status: z.literal("completed"),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })),
});

export class OpenAiInstructionImprover implements InstructionImprover {
  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async improve(input: ImproveInstructionsInput): Promise<{ instructions: string }> {
    if (!this.apiKey) throw unavailable("Instruction improvement is not configured.");
    try {
      const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          store: false,
          reasoning: { effort: "high" },
          max_output_tokens: 8_192,
          instructions: IMPROVE_INSTRUCTIONS_PROMPT,
          input: JSON.stringify(input),
          text: { format: {
            type: "json_schema", name: "improved_test", strict: true,
            schema: { type: "object", additionalProperties: false,
              required: ["instructions"], properties: { instructions: { type: "string" } } },
          } },
        }),
      });
      if (!response.ok) {
        await cancelResponseBody(response);
        throw new Error("Provider unavailable");
      }
      const parsed = responseSchema.parse(await readLimitedJsonResponse(response, 128 * 1_024));
      const text = parsed.output.filter((item) => item.type === "message")
        .flatMap((item) => item.content ?? [])
        .filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("");
      const result = resultSchema.parse(JSON.parse(text));
      // A rewrite must never silently remove or introduce secret references.
      const placeholders = (value: string) => [...new Set(value.match(/\{\{[^{}]+\}\}/gu) ?? [])].sort();
      if (JSON.stringify(placeholders(input.instructions)) !== JSON.stringify(placeholders(result.instructions))) {
        throw new Error("Secret references changed");
      }
      return result;
    } catch {
      // Never expose provider bodies or submitted instructions through error logs.
      throw unavailable("Could not improve instructions. Please try again.");
    }
  }
}
