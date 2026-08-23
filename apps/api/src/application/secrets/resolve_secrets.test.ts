import type { WorkspaceSecret } from "../../domain/secrets/types";
import { substitutePlaceholders } from "../../domain/secrets/rules";
import { createEncryptionKeyring, encryptSecret } from "../../shared/crypto";
import { FakeSecretRepo } from "../../test/fakes/repos";
import { buildRedactor, ResolveSecrets } from "./resolve_secrets";

const KEY = new Uint8Array(32).fill(11);
const KEYS = createEncryptionKeyring({ id: "test-resolve", key: KEY });

async function stored(
  id: string,
  workspaceId: string,
  key: string,
  value: string,
  allowedDomains: string[],
): Promise<WorkspaceSecret> {
  return {
    id,
    workspaceId,
    key,
    encryptedValue: await encryptSecret(value, KEYS, {
      type: "workspace_secret",
      workspaceId,
      recordId: id,
    }),
    encryptionVersion: 4,
    allowedDomains,
    description: null,
    createdBy: "usr_owner",
    createdAt: 1,
    updatedAt: 1,
  };
}

async function setup() {
  const repo = new FakeSecretRepo();
  await repo.insert(
    await stored(
      "sec_user",
      "ws_primary",
      "USERNAME",
      "alice@example.com",
      ["example.com"],
    ),
  );
  await repo.insert(
    await stored(
      "sec_password",
      "ws_primary",
      "PASSWORD",
      "p@ss-$&-word",
      ["*.example.com"],
    ),
  );
  await repo.insert(
    await stored(
      "sec_other_workspace",
      "ws_other",
      "PASSWORD",
      "other-workspace-value",
      ["example.com"],
    ),
  );
  const resolver = new ResolveSecrets(repo, KEYS);
  return {
    repo,
    resolved: await resolver.execute({
      workspaceId: "ws_primary",
      referencedKeys: ["PASSWORD", "USERNAME", "PASSWORD", "MISSING_KEY"],
    }),
  };
}

describe("ResolveSecrets", () => {
  it("decrypts only existing keys in the requested workspace", async () => {
    const { resolved } = await setup();

    expect([...resolved]).toEqual([
      [
        "PASSWORD",
        { value: "p@ss-$&-word", allowedDomains: ["*.example.com"] },
      ],
      [
        "USERNAME",
        { value: "alice@example.com", allowedDomains: ["example.com"] },
      ],
    ]);
    expect(resolved.has("MISSING_KEY")).toBe(false);
    expect(JSON.stringify([...resolved])).not.toContain(
      "other-workspace-value",
    );
  });
});

describe("substitutePlaceholders", () => {
  it("substitutes multiple and repeated placeholders without replacement expansion", async () => {
    const { resolved } = await setup();

    expect(
      substitutePlaceholders(
        "Login {{USERNAME}} / {{PASSWORD}} / {{PASSWORD}}",
        resolved,
        "example.com",
      ),
    ).toEqual({
      ok: true,
      text: "Login alice@example.com / p@ss-$&-word / p@ss-$&-word",
    });
  });

  it("returns a value-free error for an unknown key", async () => {
    const { resolved } = await setup();

    const result = substitutePlaceholders(
      "Use {{MISSING_KEY}}",
      resolved,
      "example.com",
    );

    expect(result).toEqual({
      ok: false,
      reason: "Unknown secret {{MISSING_KEY}}",
    });
    expect(JSON.stringify(result)).not.toContain("alice@example.com");
    expect(JSON.stringify(result)).not.toContain("p@ss-$&-word");
  });

  it("returns a value-free error on a disallowed domain", async () => {
    const { resolved } = await setup();

    const result = substitutePlaceholders(
      "Use {{PASSWORD}}",
      resolved,
      "evil.test",
    );

    expect(result).toEqual({
      ok: false,
      reason: "Secret {{PASSWORD}} is not allowed on domain evil.test",
    });
    expect(JSON.stringify(result)).not.toContain("p@ss-$&-word");
  });

  it("allows wildcard secrets on deep subdomains", async () => {
    const { resolved } = await setup();

    expect(
      substitutePlaceholders(
        "Use {{PASSWORD}}",
        resolved,
        "checkout.eu.example.com",
      ),
    ).toEqual({ ok: true, text: "Use p@ss-$&-word" });
  });
});

describe("buildRedactor", () => {
  it("removes every resolved value from strings and encoded forms", async () => {
    const { resolved } = await setup();
    const redactor = buildRedactor(resolved);

    const output = redactor.redact(
      "user=alice@example.com password=p@ss-$&-word encoded=p%40ss-%24%26-word",
    );

    expect(output).toBe(
      "user={{USERNAME}} password={{PASSWORD}} encoded={{PASSWORD}}",
    );
    expect(output).not.toContain("alice@example.com");
    expect(output).not.toContain("p@ss-$&-word");
  });
});
