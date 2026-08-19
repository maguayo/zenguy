import type { User } from "../../domain/users/types";
import { FixedClock } from "../../shared/clock";
import { SUBSCRIPTION_GRANT_TTL_DAYS } from "../../shared/constants";
import { FakeIds } from "../../test/fakes/ids";
import { FakeSubscriptionGrantRepo } from "../../test/fakes/repos";
import { IssueSubscriptionGrant } from "./issue_subscription_grant";

const NOW = Date.parse("2026-08-19T12:00:00Z");
const ISSUER: User = {
  id: "usr_issuer",
  name: "Marcos",
  email: "marcos@aguayo.es",
  passwordHash: "hash",
  emailVerifiedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

function issueUseCase(emails = ["marcos@aguayo.es"]) {
  const grants = new FakeSubscriptionGrantRepo();
  const usecase = new IssueSubscriptionGrant(
    grants,
    { execute: async () => undefined },
    new FixedClock(NOW),
    new FakeIds(),
    {
      appUrl: "https://app.zenguy.com",
      complimentaryIssuerEmails: emails,
    },
  );
  return { grants, usecase };
}

describe("IssueSubscriptionGrant", () => {
  it("issues a one-time redeem URL for an allowed issuer", async () => {
    const { grants, usecase } = issueUseCase();

    const issued = await usecase.execute({
      actor: ISSUER,
      note: "Influencer launch",
    });

    expect(issued.token.length).toBeGreaterThan(20);
    expect(issued.redeemUrl).toBe(
      `https://app.zenguy.com/grants/${issued.token}`,
    );
    expect(issued.note).toBe("Influencer launch");
    expect(issued.expiresAt).toBe(
      NOW + SUBSCRIPTION_GRANT_TTL_DAYS * 24 * 60 * 60 * 1_000,
    );
    expect(grants.grants.size).toBe(1);
    const stored = [...grants.grants.values()][0];
    expect(stored?.tokenHash).not.toBe(issued.token);
    expect(stored?.redeemedAt).toBeNull();
  });

  it("rejects anyone who is not a complimentary issuer", async () => {
    const { usecase } = issueUseCase(["ops@zenguy.com"]);

    await expect(usecase.execute({ actor: ISSUER })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
