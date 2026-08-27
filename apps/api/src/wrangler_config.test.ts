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
  secrets: { required: string[] };
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
  services: { binding: string; service: string; entrypoint: string }[];
  queues: QueueConfig;
  vars: Record<string, string>;
  containers?: {
    class_name: string;
    image: string;
    image_build_context: string;
    instance_type: string;
    max_instances: number;
  }[];
  durable_objects?: { bindings: { name: string; class_name: string }[] };
}

interface WranglerConfig {
  compatibility_flags: string[];
  workers_dev: boolean;
  preview_urls: boolean;
  secrets: { required: string[] };
  send_email: EnvironmentConfig["send_email"];
  d1_databases: EnvironmentConfig["d1_databases"];
  kv_namespaces: EnvironmentConfig["kv_namespaces"];
  r2_buckets: EnvironmentConfig["r2_buckets"];
  services: EnvironmentConfig["services"];
  queues: QueueConfig;
  triggers?: unknown;
  migrations?: { tag: string; new_sqlite_classes: string[] }[];
  env: {
    staging: EnvironmentConfig;
    production: EnvironmentConfig;
  };
}

interface KmsWranglerConfig {
  name: string;
  main: string;
  workers_dev: boolean;
  preview_urls: boolean;
  routes?: unknown;
  route?: unknown;
  triggers?: unknown;
  env: Record<
    "staging" | "production",
    { vars: { ENVIRONMENT: string; KEY_WRAPPING_KEY_SET: string } }
  >;
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
  services: EnvironmentConfig["services"];
  queues: Pick<QueueConfig, "producers"> & { consumers?: unknown };
  vars: Record<string, string>;
  routes?: unknown;
  route?: unknown;
  triggers?: unknown;
}

interface PackageConfig {
  scripts: Record<string, string>;
}

interface RequiredSecretInventory {
  inventoryVersion: number;
  groups: { core: string[]; releaseFeatures: string[] };
  environments: Record<
    "staging" | "production",
    { requiredGroups: string[]; additionalRequired: string[] }
  >;
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

const readKmsConfig = (): KmsWranglerConfig =>
  JSON.parse(
    readFileSync(new URL("../wrangler.kms.jsonc", import.meta.url), "utf8"),
  ) as KmsWranglerConfig;

const readPackageConfig = (): PackageConfig =>
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as PackageConfig;

const readRequiredSecretInventory = (): RequiredSecretInventory =>
  JSON.parse(
    readFileSync(
      new URL("../../../security/required-worker-secrets.json", import.meta.url),
      "utf8",
    ),
  ) as RequiredSecretInventory;

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
      max_retries: 5,
      dead_letter_queue: `${queue.replace(/-dlq$/u, "")}-quarantine`,
    });
  }
}

describe("wrangler environments", () => {
  const coreRequiredSecrets = [
    "JWT_SECRET",
    "ENCRYPTION_KEY",
    "ARTIFACT_URL_SECRET",
    "RUNNER_API_TOKEN",
    "RUNNER_FALLBACK_API_TOKEN",
    "RUNNER_CAPABILITY_SECRET",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_SMS",
    "TWILIO_FROM_CALL",
  ];
  const releaseFeatureSecrets = [
    "TWILIO_FROM_WHATSAPP",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRODUCT_ID",
    "STRIPE_PRICE_ID",
    "STRIPE_OVERAGE_PRICE_ID",
    "STRIPE_ALERT_CREDIT_PRODUCT_ID",
    "STRIPE_ALERT_CREDIT_PRICE_ID",
    "EXPO_PUSH_ACCESS_TOKEN",
  ];

  it("keeps the required queue topology isolated in local, staging, and production", () => {
    const config = readConfig();

    expectQueueTopology(config.queues, "zenguy-local");
    expectQueueTopology(config.env.staging.queues, "zenguy-staging");
    expectQueueTopology(config.env.production.queues, "zenguy");

    const stagingQueueNames = new Set(
      config.env.staging.queues.consumers.map(({ queue }) => queue),
    );
    for (const { queue } of config.env.production.queues.consumers) {
      expect(stagingQueueNames.has(queue)).toBe(false);
    }
  });

  it("keeps unscoped deploys unreachable and disconnected from production resources", () => {
    const config = readConfig();

    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config).not.toHaveProperty("triggers");
    expect(config.compatibility_flags).toContain("global_fetch_strictly_public");
    expect(config.d1_databases[0]).toMatchObject({
      database_name: "zenguy-local-db",
      database_id: "00000000-0000-0000-0000-000000000001",
    });
    expect(config.kv_namespaces[0]?.id).toBe("00000000000000000000000000000001");
    expect(config.r2_buckets[0]?.bucket_name).toBe("zenguy-local-artifacts");
    expect(config.send_email[0]).not.toHaveProperty("remote");
  });

  it("pins Access issuers and mirrors the canonical required-secret inventory", () => {
    const config = readConfig();

    expect(config.env.staging.vars.CF_ACCESS_TEAM_DOMAIN).toBe(
      "https://bugfer.cloudflareaccess.com",
    );
    expect(config.env.staging.vars).not.toHaveProperty("CF_ACCESS_AUD");
    expect(config.env.production.vars.CF_ACCESS_TEAM_DOMAIN).toBe(
      "https://bugfer.cloudflareaccess.com",
    );
    expect(config.env.production.vars).not.toHaveProperty("CF_ACCESS_AUD");
    const inventory = readRequiredSecretInventory();
    expect(inventory.inventoryVersion).toBe(1);
    expect(inventory.groups.core).toEqual(coreRequiredSecrets);
    expect(inventory.groups.releaseFeatures).toEqual(releaseFeatureSecrets);
    expect(inventory.environments.staging).toEqual({
      requiredGroups: ["core", "releaseFeatures"],
      additionalRequired: [
        "CF_ACCESS_AUD",
        "RUNNER_CF_API_TOKEN",
        "OPENAI_API_KEY_CF",
        "RUNNER_CF_ACCESS_CLIENT_ID",
        "RUNNER_CF_ACCESS_CLIENT_SECRET",
      ],
    });
    expect(inventory.environments.production).toEqual({
      requiredGroups: ["core", "releaseFeatures"],
      additionalRequired: [
        "CF_RUNNER_ACCESS_AUD",
        "RUNNER_CF_API_TOKEN",
        "OPENAI_API_KEY_CF",
        "RUNNER_CF_ACCESS_CLIENT_ID",
        "RUNNER_CF_ACCESS_CLIENT_SECRET",
        "RUNNER_CF_ACCESS_COMMON_NAME",
      ],
    });
    expect(config.secrets.required).toEqual([
      ...coreRequiredSecrets,
      ...releaseFeatureSecrets,
    ]);
    expect(config.env.staging.secrets.required).toEqual([
      ...coreRequiredSecrets,
      ...releaseFeatureSecrets,
      "CF_ACCESS_AUD",
      "RUNNER_CF_API_TOKEN",
      "OPENAI_API_KEY_CF",
      "RUNNER_CF_ACCESS_CLIENT_ID",
      "RUNNER_CF_ACCESS_CLIENT_SECRET",
    ]);
    expect(config.env.production.secrets.required).toEqual([
      ...coreRequiredSecrets,
      ...releaseFeatureSecrets,
      "CF_RUNNER_ACCESS_AUD",
      "RUNNER_CF_API_TOKEN",
      "OPENAI_API_KEY_CF",
      "RUNNER_CF_ACCESS_CLIENT_ID",
      "RUNNER_CF_ACCESS_CLIENT_SECRET",
      "RUNNER_CF_ACCESS_COMMON_NAME",
    ]);
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
      CF_ACCESS_TEAM_DOMAIN: "https://bugfer.cloudflareaccess.com",
      ENCRYPTION_KEY_ID: "primary",
      KEY_WRAPPING_KEY_ID: "primary",
      LLM_MODEL: "qwen/qwen3.8-27b",
      STRIPE_ENVIRONMENT: "test",
      EMAIL_FROM: "Zenguy <notifications@zenguy.com>",
      COMPLIMENTARY_ISSUER_EMAILS: "marcos@aguayo.es",
      RUNNER_DISPATCH: "container",
      RUNNER_ENVIRONMENT: "staging",
      PUBLIC_API_URL: "https://staging-app.zenguy.com",
    });
    expect(production.vars).toEqual({
      ENVIRONMENT: "production",
      APP_URL: "https://app.zenguy.com",
      CF_ACCESS_TEAM_DOMAIN: "https://bugfer.cloudflareaccess.com",
      ENCRYPTION_KEY_ID: "primary",
      KEY_WRAPPING_KEY_ID: "primary",
      LLM_MODEL: "qwen/qwen3.8-27b",
      STRIPE_ENVIRONMENT: "live",
      EMAIL_FROM: "Zenguy <notifications@zenguy.com>",
      COMPLIMENTARY_ISSUER_EMAILS: "marcos@aguayo.es",
      RUNNER_DISPATCH: "container",
      RUNNER_ENVIRONMENT: "production",
      PUBLIC_API_URL: "https://app.zenguy.com",
      RUNNER_UNRESTRICTED_ACTIONS: "true",
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
    expect(staging.services).toEqual([
      {
        binding: "KEY_WRAPPING",
        service: "zenguy-kms-staging",
        entrypoint: "KeyWrappingService",
      },
    ]);
    expect(production.services).toEqual([
      {
        binding: "KEY_WRAPPING",
        service: "zenguy-kms-production",
        entrypoint: "KeyWrappingService",
      },
    ]);

    // Runner en Cloudflare Containers: F2 (CLOUDFLARE_RUNNER.md) — staging y
    // producción despachan por RunnerContainer con la misma imagen.
    for (const environment of [staging, production]) {
      expect(environment.containers).toEqual([
        {
          class_name: "RunnerContainer",
          image: "../../runner/deploy/Dockerfile",
          image_build_context: "../../runner",
          instance_type: "standard-4",
          max_instances: 5,
        },
      ]);
      expect(environment.durable_objects).toEqual({
        bindings: [{ name: "RUNNER_CONTAINER", class_name: "RunnerContainer" }],
      });
      expect(environment.vars.RUNNER_DISPATCH).toBe("container");
    }
    expect(config.migrations).toEqual([
      { tag: "v1", new_sqlite_classes: ["RunnerContainer"] },
    ]);

    expect(config.send_email).toEqual([
      {
        name: "EMAIL",
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
    expect(bootstrap.compatibility_flags).toContain("global_fetch_strictly_public");
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
        "services",
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
    expect(bootstrap.services).toEqual(production.services);
    expect(bootstrap.queues.producers).toEqual(production.queues.producers);
    expect(bootstrap.vars).toEqual(production.vars);

    for (const secret of [
      "JWT_SECRET",
      "ENCRYPTION_KEY",
      "ARTIFACT_URL_SECRET",
      "RUNNER_API_TOKEN",
      "RUNNER_FALLBACK_API_TOKEN",
      "RUNNER_CAPABILITY_SECRET",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_SMS",
      "TWILIO_FROM_WHATSAPP",
      "TWILIO_FROM_CALL",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRODUCT_ID",
      "STRIPE_PRICE_ID",
      "STRIPE_OVERAGE_PRICE_ID",
      "STRIPE_ALERT_CREDIT_PRODUCT_ID",
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
      "node scripts/deploy.mjs production",
    );
    expect(scripts.deploy).toBe("node scripts/deploy.mjs");
    expect(scripts["deploy:staging"]).toBe("node scripts/deploy.mjs staging");
    expect(scripts["deploy:kms:staging"]).toBe(
      "node scripts/deploy-kms.mjs staging",
    );
    expect(scripts["deploy:kms:production"]).toBe(
      "node scripts/deploy-kms.mjs production",
    );
  });
});

describe("private key-wrapping Worker", () => {
  it("has no public event source and pins only key IDs/binding names", () => {
    const kms = readKmsConfig();

    expect(kms.name).toBe("zenguy-kms");
    expect(kms.main).toBe("src/key_wrapping_worker.ts");
    expect(kms.workers_dev).toBe(false);
    expect(kms.preview_urls).toBe(false);
    expect(kms).not.toHaveProperty("routes");
    expect(kms).not.toHaveProperty("route");
    expect(kms).not.toHaveProperty("triggers");

    for (const environment of ["staging", "production"] as const) {
      const configured = kms.env[environment];
      expect(configured.vars.ENVIRONMENT).toBe(environment);
      expect(JSON.parse(configured.vars.KEY_WRAPPING_KEY_SET)).toEqual({
        configVersion: 1,
        activeKeyId: "primary",
        writeKeyIds: ["primary"],
        keys: [{ id: "primary", binding: "KMS_KEY_PRIMARY" }],
      });
      expect(configured.vars).not.toHaveProperty("KMS_KEY_PRIMARY");
      expect(configured).not.toHaveProperty("routes");
      expect(configured).not.toHaveProperty("triggers");
    }
  });
});
