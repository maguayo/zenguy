import { readFileSync } from "node:fs";

interface QueueConsumerConfig {
  queue: string;
  max_batch_size: number;
  max_concurrency?: number;
  max_retries: number;
  dead_letter_queue?: string;
}

interface WranglerConfig {
  browser: { binding: string };
  d1_databases: { binding: string; database_id: string }[];
  kv_namespaces: { binding: string; id: string }[];
  r2_buckets: { binding: string; bucket_name: string }[];
  queues: {
    producers: { binding: string; queue: string }[];
    consumers: QueueConsumerConfig[];
  };
  env: {
    production: {
      browser: { binding: string };
      d1_databases: { binding: string; database_id: string }[];
      kv_namespaces: { binding: string; id: string }[];
      r2_buckets: { binding: string; bucket_name: string }[];
      queues: {
        producers: { binding: string; queue: string }[];
        consumers: QueueConsumerConfig[];
      };
      vars: Record<string, string>;
    };
  };
}

const readConfig = (): WranglerConfig =>
  JSON.parse(
    readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  ) as WranglerConfig;

describe("wrangler queue consumers", () => {
  it("keeps the required batch, concurrency, retry, and DLQ topology", () => {
    const config = readConfig();
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

  it("defines a complete production environment with low-cost OpenAI settings", () => {
    const config = readConfig();
    const production = config.env.production;

    expect(production.vars).toEqual({
      ENVIRONMENT: "production",
      APP_URL: "https://app.zenguy.com",
      LLM_MODEL: "gpt-5-mini",
      LLM_USE_VISION: "true",
      PADDLE_ENVIRONMENT: "production",
      EMAIL_FROM: "Zenguy <notifications@zenguy.com>",
    });
    expect(production.browser).toEqual(config.browser);
    expect(production.d1_databases).toEqual(config.d1_databases);
    expect(production.kv_namespaces).toEqual(config.kv_namespaces);
    expect(production.r2_buckets).toEqual(config.r2_buckets);
    expect(production.d1_databases[0]?.database_id).not.toContain("TODO");
    expect(production.kv_namespaces[0]?.id).not.toContain("TODO");
    expect(production.queues).toEqual(config.queues);
  });
});
