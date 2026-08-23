import type { BrowserTest, TestRun } from "../../domain/browser_tests/types";
import type { User } from "../../domain/users/types";
import {
  FakeBrowserTestRepo,
  FakeRunRepo,
} from "../../test/fakes/browser_test_repos";
import { FakeUserRepo } from "../../test/fakes/repos";
import { ListBrowserTests } from "./list_browser_tests";

const USER: User = {
  id: "usr_list_tests",
  name: "List owner",
  email: "list@example.com",
  passwordHash: "hash",
  emailVerifiedAt: 1,
  authVersion: 1,
  createdAt: 1,
  updatedAt: 1,
};

function browserTest(id: string, createdAt: number): BrowserTest {
  return {
    id,
    workspaceId: "ws_list_tests",
    name: id,
    startUrl: "https://example.com",
    instructions: "Check it",
    device: "DESKTOP",
    intervalHours: 24,
    maxRetries: 0,
    notifyOnRecovery: false,
    nextRunAt: createdAt + 1_000,
    createdBy: USER.id,
    updatedBy: USER.id,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

function finishedRun(id: string, testId: string, createdAt: number): TestRun {
  return {
    id,
    workspaceId: "ws_list_tests",
    browserTestId: testId,
    source: "MANUAL",
    status: "PASSED",
    snapshot: {
      name: testId,
      startUrl: "https://example.com",
      instructions: "Check it",
      device: "DESKTOP",
      intervalHours: 24,
      maxRetries: 0,
      notifyOnRecovery: false,
      channelIds: [],
      viewport: { width: 1440, height: 900 },
      modelName: "test-model",
      runnerVersion: "test-runner",
    },
    scheduledFor: null,
    queuedAt: createdAt,
    startedAt: createdAt,
    finishedAt: createdAt + 10,
    durationMs: 10,
    attemptCount: 1,
    infraAttempts: 0,
    passedAfterRetry: false,
    billable: true,
    usageEventId: null,
    triggeredByUserId: USER.id,
    incidentId: null,
    createdAt,
  };
}

describe("ListBrowserTests", () => {
  it("uses a stable keyset cursor and fixed-size batch lookups", async () => {
    const tests = new FakeBrowserTestRepo();
    const runs = new FakeRunRepo();
    const users = new FakeUserRepo();
    await users.insert(USER);
    for (const test of [
      browserTest("bt_a", 10),
      browserTest("bt_c", 20),
      browserTest("bt_b", 20),
    ]) {
      await tests.insert(test);
      await tests.setChannels(test.id, [`ch_${test.id}`]);
      await runs.insert(finishedRun(`run_${test.id}`, test.id, test.createdAt));
    }
    const channelBatch = vi.spyOn(tests, "getChannelIdsForTests");
    const channelSingle = vi.spyOn(tests, "getChannelIds");
    const userBatch = vi.spyOn(users, "findByIds");
    const userSingle = vi.spyOn(users, "findById");
    const service = new ListBrowserTests(tests, runs, users);

    const first = await service.execute({
      workspaceId: "ws_list_tests",
      limit: 2,
    });
    expect(first.tests.map((test) => test.id)).toEqual(["bt_c", "bt_b"]);
    expect(first.tests[0]).toMatchObject({
      channelIds: ["ch_bt_c"],
      createdBy: { userId: USER.id, name: USER.name },
      lastRun: { id: "run_bt_c" },
    });
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await service.execute({
      workspaceId: "ws_list_tests",
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });
    expect(second.tests.map((test) => test.id)).toEqual(["bt_a"]);
    expect(second.nextCursor).toBeNull();
    expect(channelBatch).toHaveBeenCalledTimes(2);
    expect(userBatch).toHaveBeenCalledTimes(2);
    expect(channelSingle).not.toHaveBeenCalled();
    expect(userSingle).not.toHaveBeenCalled();
  });

  it("rejects invalid limits and malformed cursors before querying", async () => {
    const tests = new FakeBrowserTestRepo();
    const service = new ListBrowserTests(
      tests,
      new FakeRunRepo(),
      new FakeUserRepo(),
    );
    const listPage = vi.spyOn(tests, "listPage");

    await expect(
      service.execute({ workspaceId: "ws_list_tests", limit: 101 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.execute({ workspaceId: "ws_list_tests", cursor: "%%%" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(listPage).not.toHaveBeenCalled();
  });
});
