import { FixedClock } from "../../shared/clock";
import { sha256Hex } from "../../shared/crypto";
import { FakeApiKeyRepo, FakeWorkspaceRepo } from "../../test/fakes/repos";
import { storedApiKey, WORKSPACE } from "../../test/fixtures/api_keys";
import { AuthenticateApiKey } from "./authenticate_api_key";

const PLAINTEXT = "zgk_unit-test-key-material";

function build() {
  const apiKeys = new FakeApiKeyRepo();
  const workspaces = new FakeWorkspaceRepo();
  const clock = new FixedClock(1_700_000_000_000);
  const useCase = new AuthenticateApiKey(apiKeys, workspaces, clock);
  return { apiKeys, workspaces, clock, useCase };
}

async function seed(
  fixture: ReturnType<typeof build>,
  overrides: Parameters<typeof storedApiKey>[0] = {},
) {
  await fixture.workspaces.insert(WORKSPACE);
  await fixture.apiKeys.insert(
    storedApiKey({ keyHash: await sha256Hex(PLAINTEXT), ...overrides }),
  );
}

describe("AuthenticateApiKey", () => {
  it("resolves the workspace without writing usage before the request limiter", async () => {
    const fixture = build();
    await seed(fixture);

    const result = await fixture.useCase.execute({ key: PLAINTEXT });

    expect(result.workspace.id).toBe(WORKSPACE.id);
    expect(result.apiKey.id).toBe("ak_stored_1");
    expect(fixture.apiKeys.apiKeys.get("ak_stored_1")?.lastUsedAt).toBeNull();
  });

  it("rejects expired keys and keys without an explicit read scope", async () => {
    const expired = build();
    await seed(expired, { expiresAt: expired.clock.now() });
    await expect(expired.useCase.execute({ key: PLAINTEXT })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Invalid API key",
    });

    const unscoped = build();
    await seed(unscoped, { scopes: [] });
    await expect(unscoped.useCase.execute({ key: PLAINTEXT })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Invalid API key",
    });
  });

  it("rejects unknown, malformed, and revoked keys with the same error", async () => {
    const fixture = build();
    await seed(fixture, { revokedAt: 500 });

    for (const key of [
      "zgk_unknown-key",
      "not-an-api-key",
      "",
      PLAINTEXT, // revoked above
    ]) {
      await expect(fixture.useCase.execute({ key })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: "Invalid API key",
      });
    }
    expect(fixture.apiKeys.apiKeys.get("ak_stored_1")?.lastUsedAt).toBeNull();
  });

  it("rejects keys of a deleted or missing workspace", async () => {
    const fixture = build();
    await fixture.workspaces.insert({ ...WORKSPACE, deletedAt: 999 });
    await fixture.apiKeys.insert(
      storedApiKey({ keyHash: await sha256Hex(PLAINTEXT) }),
    );
    await expect(
      fixture.useCase.execute({ key: PLAINTEXT }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const orphan = build();
    await orphan.apiKeys.insert(
      storedApiKey({ keyHash: await sha256Hex(PLAINTEXT) }),
    );
    await expect(
      orphan.useCase.execute({ key: PLAINTEXT }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
