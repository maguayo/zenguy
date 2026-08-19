import { readFileSync } from "node:fs";

interface QueueConsumerConfig {
  queue: string;
  max_batch_size: number;
  max_concurrency?: number;
  max_retries: number;
  dead_letter_queue?: string;
}

describe("wrangler queue consumers", () => {
  it("keeps the required batch, concurrency, retry, and DLQ topology", () => {
    const config = JSON.parse(
      readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    ) as { queues: { consumers: QueueConsumerConfig[] } };
    const byName = new Map(
      config.queues.consumers.map((consumer) => [consumer.queue, consumer]),
    );

    expect(byName.get("zenguy-runs")).toMatchObject({
      max_batch_size: 1,
      max_concurrency: 4,
      max_retries: 3,
      dead_letter_queue: "zenguy-runs-dlq",
    });
    expect(byName.get("zenguy-checks")).toMatchObject({
      max_batch_size: 5,
      max_concurrency: 10,
      max_retries: 3,
      dead_letter_queue: "zenguy-checks-dlq",
    });
    expect(byName.get("zenguy-notify")).toMatchObject({
      max_batch_size: 5,
      max_concurrency: 5,
      max_retries: 3,
      dead_letter_queue: "zenguy-notify-dlq",
    });
    for (const queue of [
      "zenguy-runs-dlq",
      "zenguy-checks-dlq",
      "zenguy-notify-dlq",
    ]) {
      expect(byName.get(queue)).toMatchObject({
        max_batch_size: 10,
        max_retries: 0,
      });
    }
  });
});
