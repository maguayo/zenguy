import type { PushDevice } from "./types";

export interface PushReach {
  /** Enabled devices across the workspace's members. */
  devices: number;
  /** Members owning at least one enabled device. */
  members: number;
}

export interface PushDeviceRepo {
  findByToken(token: string): Promise<PushDevice | null>;
  findById(userId: string, id: string): Promise<PushDevice | null>;
  insert(device: PushDevice): Promise<void>;
  /** Re-registers an existing token: new owner, metadata, enabled again. */
  reassign(
    id: string,
    changes: Pick<
      PushDevice,
      "userId" | "platform" | "deviceName" | "appVersion" | "lastSeenAt"
    >,
    at: number,
  ): Promise<void>;
  listForUser(userId: string): Promise<PushDevice[]>;
  setEnabled(
    id: string,
    enabled: boolean,
    reason: string | null,
    at: number,
  ): Promise<void>;
  delete(userId: string, id: string): Promise<boolean>;
  listEnabledTokensForWorkspace(
    workspaceId: string,
  ): Promise<{ token: string; userId: string }[]>;
  reachForWorkspace(workspaceId: string): Promise<PushReach>;
  disableTokens(tokens: string[], reason: string, at: number): Promise<void>;
  /** Workspaces with an enabled member device but no default push channel yet. */
  listWorkspacesNeedingPushChannel(limit: number): Promise<string[]>;
}
