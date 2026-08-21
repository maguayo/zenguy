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
  routes: { pattern: string; zone_name?: string; custom_domain?: boolean }[];
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

interface BootstrapConfig {
  $schema: string;
  name: string;
  main: string;
  compatibility_date: string;
  compatibility_flags: string[];
  workers_dev: boolean;
  preview_urls: boolean;
  observability: { enabled: boolean };
  limits: { cpu_ms: number };
  send_email: EnvironmentConfig["send_email"];
  d1_databases: EnvironmentConfig["d1_databases"];
  kv_namespaces: EnvironmentConfig["kv_namespaces"];
  r2_buckets: EnvironmentConfig["r2_buckets"];
  queues: Pick<QueueConfig, "producers"> & { consumers?: unknown };
  vars: Record<string, string>;
  routes?: unknown;
  route?: unknown;
  triggers?: unknown;
}

interface PackageConfig {
  scripts: Record<string, string>;
}

const readConfig = (): WranglerConfig =>
  JSON.parse(
    readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  ) as WranglerConfig;

const readBootstrapConfig = (): BootstrapConfig =>
  JSON.parse(
    readFileSync(
      new URL("../wrangler.production-bootstrap.jsonc", import.meta.url),
      "utf8",
    ),
  ) as BootstrapConfig;

const readPackageConfig = (): PackageConfig =>
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageConfig;

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
      `${prefix}-checks`,
      `${prefix}-notify`,
      `${prefix}-runs-dlq`,
      `${prefix}-checks-dlq`,
      `${prefix}-notify-dlq`,
    ].sort(),
  );
  expect(byName.has(`${prefix}-runs`)).toBe(false);
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
      { pattern: "api-staging.zenguy.com", custom_domain: true },
      {
        pattern: "staging-app.zenguy.com/api/*",
        zone_name: "zenguy.com",
      },
    ]);
    expect(production.routes).toEqual([
      { pattern: "api.zenguy.com", custom_domain: true },
      { pattern: "app.zenguy.com/api/*", zone_name: "zenguy.com" },
    ]);

    expect(staging.vars).toEqual({
      ENVIRONMENT: "staging",
      APP_URL: "https://staging-app.zenguy.com",
      LLM_MODEL: "qwen/qwen3.8-27b",
      PADDLE_ENVIRONMENT: "sandbox",
      EMAIL_FROM: "Zenguy <notifications@zenguy.com>",
      COMPLIMENTARY_ISSUER_EMAILS: "marcos@aguayo.es",
    });
    expect(production.vars).toEqual({
      ENVIRONMENT: "production",
      APP_URL: "https://app.zenguy.com",
      LLM_MODEL: "qwen/qwen3.8-27b",
      PADDLE_ENVIRONMENT: "production",
      EMAIL_FROM: "Zenguy <notifications@zenguy.com>",
      COMPLIMENTARY_ISSUER_EMAILS: "marcos@aguayo.es",
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

describe("production bootstrap", () => {
  it("creates only an unreachable Worker version with no event sources", () => {
    const bootstrap = readBootstrapConfig();

    expect(bootstrap.name).toBe("zenguy-api-production");
    expect(bootstrap.workers_dev).toBe(false);
    expect(bootstrap.preview_urls).toBe(false);
    expect(bootstrap).not.toHaveProperty("route");
    expect(bootstrap).not.toHaveProperty("routes");
    expect(bootstrap).not.toHaveProperty("triggers");
    expect(bootstrap.queues).toEqual({
      producers: [
        { binding: "RUN_QUEUE", queue: "zenguy-runs" },
        { binding: "CHECK_QUEUE", queue: "zenguy-checks" },
        { binding: "NOTIFY_QUEUE", queue: "zenguy-notify" },
      ],
    });
    expect(Object.keys(bootstrap).sort()).toEqual(
      [
        "$schema",
        "name",
        "main",
        "compatibility_date",
        "compatibility_flags",
        "workers_dev",
        "preview_urls",
        "observability",
        "limits",
        "send_email",
        "d1_databases",
        "kv_namespaces",
        "r2_buckets",
        "queues",
        "vars",
      ].sort(),
    );
  });

  it("reuses only production bindings and non-secret variables", () => {
    const production = readConfig().env.production;
    const bootstrap = readBootstrapConfig();

    expect(bootstrap.send_email).toEqual(production.send_email);
    expect(bootstrap.d1_databases).toEqual(production.d1_databases);
    expect(bootstrap.kv_namespaces).toEqual(production.kv_namespaces);
    expect(bootstrap.r2_buckets).toEqual(production.r2_buckets);
    expect(bootstrap.queues.producers).toEqual(production.queues.producers);
    expect(bootstrap.vars).toEqual(production.vars);

    for (const secret of [
      "JWT_SECRET",
      "ENCRYPTION_KEY",
      "ARTIFACT_URL_SECRET",
      "RUNNER_API_TOKEN",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_SMS",
      "TWILIO_FROM_WHATSAPP",
      "TWILIO_FROM_CALL",
      "PADDLE_API_KEY",
      "PADDLE_WEBHOOK_SECRET",
      "PADDLE_CLIENT_TOKEN",
      "PADDLE_PRICE_ID",
      "PADDLE_OVERAGE_PRICE_ID",
    ]) {
      expect(bootstrap.vars).not.toHaveProperty(secret);
    }
  });

  it("exposes an explicit bootstrap command without changing normal production deploys", () => {
    const scripts = readPackageConfig().scripts;

    expect(scripts["deploy:production:bootstrap"]).toBe(
      "wrangler deploy --config wrangler.production-bootstrap.jsonc",
    );
    expect(scripts["deploy:production"]).toBe(
      "wrangler deploy --env production",
    );
  });
});
