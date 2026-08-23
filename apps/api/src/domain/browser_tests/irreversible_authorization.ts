import { hmacSign, hmacVerify, sha256Hex } from "../../shared/crypto";
import type {
  ActionAuthorizationState,
  IrreversibleActionRequest,
  IrreversibleActionScope,
  IrreversibleRunAuthorization,
  RunSnapshot,
} from "./types";

function actionIdentity(scope: IrreversibleActionScope): string {
  if (scope.kind === "HTTP") {
    return JSON.stringify({
      kind: scope.kind,
      method: scope.method,
      origin: scope.origin,
      path: scope.path,
    });
  }
  return JSON.stringify({
    kind: scope.kind,
    action: scope.action,
    origin: scope.origin,
    path: scope.path,
    target: scope.target,
  });
}

export function validActionAuthorizationState(
  snapshot: RunSnapshot,
  state: ActionAuthorizationState[],
): boolean {
  const scopes = snapshot.irreversibleAuthorization?.scopes;
  if (
    scopes === undefined ||
    scopes.length === 0 ||
    scopes.length !== state.length
  ) {
    return false;
  }
  const identities = new Set<string>();
  for (let index = 0; index < scopes.length; index += 1) {
    const scope = scopes[index];
    const entry = state[index];
    if (scope === undefined || entry === undefined) return false;
    const identity = actionIdentity(scope);
    if (identities.has(identity)) return false;
    identities.add(identity);
    if (
      JSON.stringify(entry.scope) !== JSON.stringify(scope) ||
      !Number.isInteger(entry.remainingUses) ||
      entry.remainingUses < 0 ||
      entry.remainingUses > scope.maxUses
    ) {
      return false;
    }
  }
  return true;
}

function unsignedSnapshot(snapshot: RunSnapshot) {
  return {
    name: snapshot.name,
    allowedDomains: [...(snapshot.allowedDomains ?? [])],
    writableDomains: [...(snapshot.writableDomains ?? [])],
    startUrl: snapshot.startUrl,
    instructions: snapshot.instructions,
    device: snapshot.device,
    intervalHours: snapshot.intervalHours,
    maxRetries: snapshot.maxRetries,
    notifyOnRecovery: snapshot.notifyOnRecovery,
    channelIds: [...snapshot.channelIds],
    viewport: { ...snapshot.viewport },
    modelName: snapshot.modelName,
    runnerVersion: snapshot.runnerVersion,
  };
}

function authorizationPayload(
  snapshot: RunSnapshot,
  authorization: Omit<IrreversibleRunAuthorization, "signature">,
): string {
  return JSON.stringify({
    version: authorization.version,
    runId: authorization.runId,
    workspaceId: authorization.workspaceId,
    originalInstructionsSha256: authorization.originalInstructionsSha256,
    testDataAttested: authorization.testDataAttested,
    approvedByUserId: authorization.approvedByUserId,
    approvedAt: authorization.approvedAt,
    scopes: authorization.scopes,
    snapshot: unsignedSnapshot(snapshot),
  });
}

export async function authorizeIrreversibleRun(input: {
  snapshot: RunSnapshot;
  runId: string;
  workspaceId: string;
  approvedByUserId: string;
  approvedAt: number;
  scopes: IrreversibleActionScope[];
  signingSecret: string;
}): Promise<IrreversibleRunAuthorization> {
  const unsigned: Omit<IrreversibleRunAuthorization, "signature"> = {
    version: 2,
    runId: input.runId,
    workspaceId: input.workspaceId,
    originalInstructionsSha256: await sha256Hex(input.snapshot.instructions),
    testDataAttested: true,
    approvedByUserId: input.approvedByUserId,
    approvedAt: input.approvedAt,
    scopes: structuredClone(input.scopes),
  };
  return {
    ...unsigned,
    signature: await hmacSign(
      input.signingSecret,
      authorizationPayload(input.snapshot, unsigned),
    ),
  };
}

export async function verifyIrreversibleRunAuthorization(
  snapshot: RunSnapshot,
  signingSecret: string,
): Promise<boolean> {
  try {
    const authorization = snapshot.irreversibleAuthorization;
    if (
      authorization === undefined ||
      authorization.version !== 2 ||
      authorization.testDataAttested !== true ||
      !Array.isArray(authorization.scopes) ||
      authorization.scopes.length === 0 ||
      typeof authorization.signature !== "string" ||
      authorization.originalInstructionsSha256 !==
        (await sha256Hex(snapshot.instructions))
    ) {
      return false;
    }
    const { signature, ...unsigned } = authorization;
    return await hmacVerify(
      signingSecret,
      authorizationPayload(snapshot, unsigned),
      signature,
    );
  } catch {
    return false;
  }
}

export function actionMatchesScope(
  action: IrreversibleActionRequest,
  scope: IrreversibleActionScope,
): boolean {
  if (action.kind !== scope.kind) return false;
  if (action.origin !== scope.origin || action.path !== scope.path) return false;
  if (action.kind === "HTTP" && scope.kind === "HTTP") {
    return action.method === scope.method;
  }
  return (
    action.kind === "DOM" &&
    scope.kind === "DOM" &&
    action.action === scope.action &&
    action.target.attribute === scope.target.attribute &&
    action.target.value === scope.target.value &&
    action.target.tag === scope.target.tag &&
    action.target.type === scope.target.type &&
    action.target.form.method === scope.target.form.method &&
    action.target.form.origin === scope.target.form.origin &&
    action.target.form.path === scope.target.form.path
  );
}
