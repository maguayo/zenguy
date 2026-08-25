/**
 * Stub de `cloudflare:workers` para vitest en Node. Solo cubre lo que
 * importa `@cloudflare/containers`; el comportamiento real del Durable
 * Object se valida en staging, no en la suite unitaria.
 */
export class DurableObject<Env = unknown> {
  constructor(
    public ctx: unknown,
    public env: Env,
  ) {}
}

export class WorkerEntrypoint<Env = unknown> {
  constructor(
    public ctx: unknown,
    public env: Env,
  ) {}
}
