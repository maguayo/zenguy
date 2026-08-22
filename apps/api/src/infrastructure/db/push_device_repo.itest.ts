import { D1AlertRepo } from "./alert_repo";
import { D1MemberRepo } from "./member_repo";
import { D1PushDeviceRepo } from "./push_device_repo";
import { D1UserRepo } from "./user_repo";
import { D1WorkspaceRepo } from "./workspace_repo";
import { defaultAlertSettings } from "../../domain/alerts/types";
import type { PushDevice } from "../../domain/push/types";
import { freshDb, testEnv } from "../../test/helpers";

function device(id: string, userId: string, token: string, enabled = true): PushDevice {
  return {
    id,
    userId,
    token,
    platform: "ios",
    deviceName: `${id} phone`,
    appVersion: "0.1.0",
    enabled,
    disabledReason: null,
    lastSeenAt: 10,
    createdAt: 10,
    updatedAt: 10,
  };
}

const T = (suffix: string) => `ExponentPushToken[${suffix.padStart(22, "0")}]`;

describe("D1PushDeviceRepo", () => {
  let repo: D1PushDeviceRepo;

  beforeEach(async () => {
    await freshDb();
    repo = new D1PushDeviceRepo(testEnv().DB);
  });

  it("stores devices with unique tokens and scopes reads to the owner", async () => {
    await repo.insert(device("pd_a", "usr_a", T("a")));
    await expect(repo.insert(device("pd_dup", "usr_b", T("a")))).rejects.toThrow();
    await expect(repo.findByToken(T("a"))).resolves.toMatchObject({ id: "pd_a" });
    await expect(repo.findById("usr_a", "pd_a")).resolves.toMatchObject({ id: "pd_a" });
    await expect(repo.findById("usr_b", "pd_a")).resolves.toBeNull();

    await repo.reassign(
      "pd_a",
      { userId: "usr_b", platform: "ios", deviceName: "shared", appVersion: "0.2.0", lastSeenAt: 20 },
      21,
    );
    await expect(repo.findById("usr_b", "pd_a")).resolves.toMatchObject({
      userId: "usr_b",
      deviceName: "shared",
      appVersion: "0.2.0",
      enabled: true,
      lastSeenAt: 20,
      updatedAt: 21,
    });

    await repo.setEnabled("pd_a", false, "USER_DISABLED", 30);
    await expect(repo.findById("usr_b", "pd_a")).resolves.toMatchObject({
      enabled: false,
      disabledReason: "USER_DISABLED",
    });
    await repo.setEnabled("pd_a", true, null, 31);
    await expect(repo.findById("usr_b", "pd_a")).resolves.toMatchObject({
      enabled: true,
      disabledReason: null,
    });

    await expect(repo.delete("usr_a", "pd_a")).resolves.toBe(false);
    await expect(repo.delete("usr_b", "pd_a")).resolves.toBe(true);
    await expect(repo.findByToken(T("a"))).resolves.toBeNull();
  });

  it("resolves member tokens and reach per workspace and retires tokens", async () => {
    const bindings = testEnv();
    const users = new D1UserRepo(bindings.DB);
    const workspaces = new D1WorkspaceRepo(bindings.DB);
    const members = new D1MemberRepo(bindings.DB);
    for (const id of ["usr_a", "usr_b", "usr_c"]) {
      await users.insert({
        id,
        name: id,
        email: `${id}@push.test`,
        passwordHash: "hash",
        emailVerifiedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    }
    await workspaces.insert({
      id: "ws_push",
      name: "Push",
      slug: "push",
      timezone: "UTC",
      ownerUserId: "usr_a",
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    });
    let sequence = 0;
    for (const userId of ["usr_a", "usr_b"]) {
      sequence += 1;
      await members.insert({
        id: `mem_push_${sequence}`,
        workspaceId: "ws_push",
        userId,
        role: sequence === 1 ? "OWNER" : "MEMBER",
        invitedBy: null,
        joinedAt: sequence,
      });
    }
    await repo.insert(device("pd_a1", "usr_a", T("a1")));
    await repo.insert(device("pd_a2", "usr_a", T("a2")));
    await repo.insert(device("pd_b", "usr_b", T("b")));
    await repo.insert(device("pd_b_off", "usr_b", T("boff"), false));
    await repo.insert(device("pd_c", "usr_c", T("c")));

    await expect(repo.listEnabledTokensForWorkspace("ws_push")).resolves.toEqual([
      { token: T("a1"), userId: "usr_a" },
      { token: T("a2"), userId: "usr_a" },
      { token: T("b"), userId: "usr_b" },
    ]);
    await expect(repo.reachForWorkspace("ws_push")).resolves.toEqual({ devices: 3, members: 2 });
    await expect(repo.reachForWorkspace("ws_other")).resolves.toEqual({ devices: 0, members: 0 });

    await expect(repo.listWorkspacesNeedingPushChannel(10)).resolves.toEqual(["ws_push"]);
    await new D1AlertRepo(bindings.DB).insertSettings({
      ...defaultAlertSettings("ws_push", 1),
      defaultPushChannelCreatedAt: 1,
    });
    await expect(repo.listWorkspacesNeedingPushChannel(10)).resolves.toEqual([]);

    await repo.disableTokens([T("a1"), T("missing")], "DeviceNotRegistered", 50);
    await expect(repo.findById("usr_a", "pd_a1")).resolves.toMatchObject({
      enabled: false,
      disabledReason: "DeviceNotRegistered",
      updatedAt: 50,
    });
    await expect(repo.reachForWorkspace("ws_push")).resolves.toEqual({ devices: 2, members: 2 });
    await expect(repo.listForUser("usr_a")).resolves.toHaveLength(2);
  });
});
