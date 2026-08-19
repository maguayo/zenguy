import { readFileSync } from "node:fs";

interface QueueConsumerConfig {
  queue: string;
  max_batch_size: number;
  max_concurrency?: number;
  max_retries: number;
  dead_letter_queue?: string;
}

interface QueueConfig {
  producers: { binding: string; queue: string }[];
  consumers: QueueConsumerConfig[];
}

interface EnvironmentConfig {
  routes: { pattern: string; zone_name: string }[];
  browser: { binding: string };
  send_email: {
    name: string;
    remote?: boolean;
    allowed_sender_addresses: string[];
  }[];
  d1_databases: {
    binding: string;
    database_name: string;
    database_id: string;
    migrations_dir: string;
  }[];
  kv_namespaces: { binding: string; id: string }[];
  r2_buckets: { binding: string; bucket_name: string }[];
  queues: QueueConfig;
  vars: Record<string, string>;
}

interface WranglerConfig {
  browser: { binding: string };
  send_email: EnvironmentConfig["send_email"];
  d1_databases: EnvironmentConfig["d1_databases"];
  kv_namespaces: EnvironmentConfig["kv_namespaces"];
  r2_buckets: EnvironmentConfig["r2_buckets"];
  queues: QueueConfig;
  env: {
    staging: EnvironmentConfig;
    production: EnvironmentConfig;
  };
}

const readConfig = (): WranglerConfig =>
  JSON.parse(
    readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  ) as WranglerConfig;

function expectQueueTopology(queues: QueueConfig, prefix: string): void {
  expect(queues.producers).toEqual([
    { binding: "RUN_QUEUE", queue: `${prefix}-runs` },
    { binding: "CHECK_QUEUE", queue: `${prefix}-checks` },
    { binding: "NOTIFY_QUEUE", queue: `${prefix}-notify` },
  ]);

  const byName = new Map(
    queues.consumers.map((consumer) => [consumer.queue, consumer]),
  );
  expect([...byName.keys()].sort()).toEqual(
    [
      `${prefix}-runs`,
      `${prefix}-checks`,
      `${prefix}-notify`,
      `${prefix}-runs-dlq`,
      `${prefix}-checks-dlq`,
      `${prefix}-notify-dlq`,
    ].sort(),
  );
  expect(byName.get(`${prefix}-runs`)).toMatchObject({
    max_batch_size: 1,
    max_concurrency: 4,
    max_retries: 3,
    dead_letter_queue: `${prefix}-runs-dlq`,
  });
  expect(byName.get(`${prefix}-checks`)).toMatchObject({
    max_batch_size: 5,
    max_concurrency: 10,
    max_retries: 3,
    dead_letter_queue: `${prefix}-checks-dlq`,
  });
  expect(byName.get(`${prefix}-notify`)).toMatchObject({
    max_batch_size: 5,
    max_concurrency: 5,
    max_retries: 3,
    dead_letter_queue: `${prefix}-notify-dlq`,
  });
  for (const queue of [
    `${prefix}-runs-dlq`,
    `${prefix}-checks-dlq`,
    `${prefix}-notify-dlq`,
  ]) {
    expect(byName.get(queue)).toMatchObject({
      max_batch_size: 10,
      max_retries: 0,
    });
  }
}

describe("wrangler environments", () => {
  it("keeps the required queue topology isolated in local, staging, and production", () => {
    const config = readConfig();

    expectQueueTopology(config.queues, "zenguy");
    expectQueueTopology(config.env.staging.queues, "zenguy-staging");
    expectQueueTopology(config.env.production.queues, "zenguy");

    const stagingQueueNames = new Set(
      config.env.staging.queues.consumers.map(({ queue }) => queue),
    );
    for (const { queue } of config.env.production.queues.consumers) {
      expect(stagingQueueNames.has(queue)).toBe(false);
    }
  });

  it("defines exact staging and production routes, resources, and service settings", () => {
    const config = readConfig();
    const staging = config.env.staging;
    const production = config.env.production;

    expect(staging.routes).toEqual([
      {
        pattern: "staging-app.zenguy.com/api/*",
        zone_name: "zenguy.com",
      },
    ]);
    expect(production.routes).toEqual([
      { pattern: "app.zenguy.com/api/*", zone_name: "zenguy.com" },
    ]);

    expect(staging.vars).toEqual({
      ENVIRONMENT: "staging",
      APP_URL: "https://staging-app.zenguy.com",
      LLM_MODEL: "gpt-5-mini",
      LLM_USE_VISION: "true",
      PADDLE_ENVIRONMENT: "sandbox",
      EMAIL_FROM: "Zenguy <notifications@zenguy.com>",
    });
    expect(production.vars).toEqual({
      ENVIRONMENT: "production",
      APP_URL: "https://app.zenguy.com",
      LLM_MODEL: "gpt-5-mini",
      LLM_USE_VISION: "true",
      PADDLE_ENVIRONMENT: "production",
      EMAIL_FROM: "Zenguy <notifications@zenguy.com>",
    });

    expect(staging.d1_databases).toEqual([
      {
        binding: "DB",
        database_name: "zenguy-staging-db",
        database_id: "e8668681-c8ae-467b-b3ed-1fd234c96900",
        migrations_dir: "migrations",
      },
    ]);
    expect(production.d1_databases).toEqual([
      {
        binding: "DB",
        database_name: "zenguy-db",
        database_id: "82cdd9c1-591f-45c4-a115-17fcdc18950b",
        migrations_dir: "migrations",
      },
    ]);
    expect(staging.kv_namespaces).toEqual([
      { binding: "KV", id: "70f95ccb29a041a489bc4326b242be01" },
    ]);
    expect(production.kv_namespaces).toEqual([
      { binding: "KV", id: "ac526acc3190422292f9f7d76ef93456" },
    ]);
    expect(staging.r2_buckets).toEqual([
      { binding: "ARTIFACTS", bucket_name: "zenguy-staging-artifacts" },
    ]);
    expect(production.r2_buckets).toEqual([
      { binding: "ARTIFACTS", bucket_name: "zenguy-artifacts" },
    ]);

    expect(staging.browser).toEqual({ binding: "BROWSER" });
    expect(production.browser).toEqual({ binding: "BROWSER" });
    expect(config.send_email).toEqual([
      {
        name: "EMAIL",
        remote: true,
        allowed_sender_addresses: ["notifications@zenguy.com"],
      },
    ]);
    for (const environment of [staging, production]) {
      expect(environment.send_email).toEqual([
        {
          name: "EMAIL",
          allowed_sender_addresses: ["notifications@zenguy.com"],
        },
      ]);
    }
  });
});
