import type {
  ActionAuthorizationState,
  IrreversibleActionScope,
  RunSnapshot,
} from "./types";
import {
  actionMatchesScope,
  authorizeIrreversibleRun,
  validActionAuthorizationState,
  verifyIrreversibleRunAuthorization,
} from "./irreversible_authorization";

const SECRET = "irreversible-authorization-test-secret".padEnd(32, "-");
const HTTP_SCOPE: IrreversibleActionScope = {
  kind: "HTTP",
  method: "POST",
  origin: "https://staging.example.com",
  path: "/orders",
  maxUses: 1,
};
const DOM_SCOPE: IrreversibleActionScope = {
  kind: "DOM",
  action: "CLICK",
  origin: "https://staging.example.com",
  path: "/checkout",
  target: {
    attribute: "data-testid",
    value: "place-order",
    tag: "BUTTON",
    type: "submit",
    form: {
      method: "POST",
      origin: "https://staging.example.com",
      path: "/orders",
    },
  },
  maxUses: 1,
};

function snapshot(): RunSnapshot {
  return {
    name: "Checkout",
    allowedDomains: [],
    writableDomains: ["staging.example.com"],
    startUrl: "https://staging.example.com/checkout",
    instructions: "Place one test order and verify its confirmation",
    device: "DESKTOP",
    intervalHours: 6,
    maxRetries: 1,
    notifyOnRecovery: true,
    channelIds: [],
    viewport: { width: 1440, height: 900 },
    modelName: "gpt-5-mini",
    runnerVersion: "runner-test",
  };
}

async function authorizedSnapshot(): Promise<RunSnapshot> {
  const value = snapshot();
  value.irreversibleAuthorization = await authorizeIrreversibleRun({
    snapshot: value,
    runId: "run_1",
    workspaceId: "ws_1",
    approvedByUserId: "usr_1",
    approvedAt: 1_000,
    scopes: [DOM_SCOPE, HTTP_SCOPE],
    signingSecret: SECRET,
  });
  return value;
}

describe("irreversible run authorization", () => {
  it("cryptographically binds original instructions and the complete snapshot", async () => {
    const value = await authorizedSnapshot();
    await expect(
      verifyIrreversibleRunAuthorization(value, SECRET),
    ).resolves.toBe(true);

    const changedInstructions = structuredClone(value);
    changedInstructions.instructions = "Delete every account";
    await expect(
      verifyIrreversibleRunAuthorization(changedInstructions, SECRET),
    ).resolves.toBe(false);

    const changedScope = structuredClone(value);
    changedScope.irreversibleAuthorization!.scopes[1] = {
      ...HTTP_SCOPE,
      path: "/admin/delete",
    };
    await expect(
      verifyIrreversibleRunAuthorization(changedScope, SECRET),
    ).resolves.toBe(false);
  });

  it("keeps DOM and HTTP authority independent", () => {
    expect(
      actionMatchesScope(
        {
          kind: "DOM",
          action: "CLICK",
          origin: DOM_SCOPE.origin,
          path: DOM_SCOPE.path,
          target: DOM_SCOPE.target,
        },
        HTTP_SCOPE,
      ),
    ).toBe(false);
    expect(
      actionMatchesScope(
        {
          kind: "HTTP",
          method: "POST",
          origin: HTTP_SCOPE.origin,
          path: HTTP_SCOPE.path,
        },
        HTTP_SCOPE,
      ),
    ).toBe(true);
    expect(
      actionMatchesScope(
        {
          kind: "DOM",
          action: "CLICK",
          origin: DOM_SCOPE.origin,
          path: DOM_SCOPE.path,
          target: {
            ...DOM_SCOPE.target,
            form: { ...DOM_SCOPE.target.form, path: "/attacker-order" },
          },
        },
        DOM_SCOPE,
      ),
    ).toBe(false);
  });

  it("fails closed for duplicate, inflated, reordered, or malformed ledgers", async () => {
    const value = await authorizedSnapshot();
    const valid: ActionAuthorizationState[] = [DOM_SCOPE, HTTP_SCOPE].map(
      (scope) => ({ scope, remainingUses: scope.maxUses }),
    );
    expect(validActionAuthorizationState(value, valid)).toBe(true);
    expect(
      validActionAuthorizationState(value, [valid[0]!, valid[0]!]),
    ).toBe(false);
    expect(
      validActionAuthorizationState(value, [
        valid[0]!,
        { scope: HTTP_SCOPE, remainingUses: HTTP_SCOPE.maxUses + 1 },
      ]),
    ).toBe(false);
    expect(
      validActionAuthorizationState(value, [valid[1]!, valid[0]!]),
    ).toBe(false);
    expect(
      validActionAuthorizationState(value, [
        valid[0]!,
        { scope: { ...HTTP_SCOPE, path: "/other" }, remainingUses: 1 },
      ]),
    ).toBe(false);
  });
});
