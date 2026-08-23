import type { BrowserTest } from "../../domain/browser_tests/types";
import { MAX_TRANSFER_TESTS } from "../../domain/browser_tests/transfer";
import { FakeBrowserTestRepo } from "../../test/fakes/browser_test_repos";
import {
  BROWSER_TEST_EXPORT_PAGE_SIZE,
  ExportBrowserTests,
} from "./export_browser_tests";

const WORKSPACE_ID = "ws_export_tests";

function browserTest(index: number): BrowserTest {
  const suffix = String(index).padStart(3, "0");
  return {
    id: `bt_export_${suffix}`,
    workspaceId: WORKSPACE_ID,
    name: `Export ${suffix}`,
    allowedDomains: ["example.com"],
    writableDomains: [],
    startUrl: `https://example.com/${suffix}`,
    instructions: "Check the page",
    device: "DESKTOP",
    intervalHours: 24,
    maxRetries: 0,
    notifyOnRecovery: false,
    nextRunAt: 2,
    createdBy: null,
    updatedBy: null,
    // Equal timestamps exercise the id component of the keyset cursor.
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  };
}

async function repoWithTests(count: number): Promise<FakeBrowserTestRepo> {
  const repo = new FakeBrowserTestRepo();
  for (let index = 0; index < count; index += 1) {
    const test = browserTest(index);
    await repo.insert(test);
    await repo.setChannels(test.id, [`ch_${String(index).padStart(3, "0")}`]);
  }
  return repo;
}

describe("ExportBrowserTests", () => {
  it("collects all 200 allowed tests in two bounded keyset pages", async () => {
    const repo = await repoWithTests(MAX_TRANSFER_TESTS);
    const listPage = vi.spyOn(repo, "listPage");
    const channelBatch = vi.spyOn(repo, "getChannelIdsForTests");

    const entries = await new ExportBrowserTests(repo).execute({
      workspaceId: WORKSPACE_ID,
    });

    expect(entries).toHaveLength(MAX_TRANSFER_TESTS);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(
      MAX_TRANSFER_TESTS,
    );
    expect(entries[0]).toMatchObject({
      id: "bt_export_199",
      channelIds: ["ch_199"],
    });
    expect(entries.at(-1)).toMatchObject({
      id: "bt_export_000",
      channelIds: ["ch_000"],
    });
    expect(listPage).toHaveBeenCalledTimes(2);
    expect(listPage.mock.calls.map((call) => call[2])).toEqual([
      BROWSER_TEST_EXPORT_PAGE_SIZE + 1,
      BROWSER_TEST_EXPORT_PAGE_SIZE + 1,
    ]);
    expect(channelBatch).toHaveBeenCalledTimes(2);
    expect(channelBatch.mock.calls.every((call) => call[1].length === 100)).toBe(
      true,
    );
  });

  it("fails closed when legacy data exceeds the collection ceiling", async () => {
    const repo = await repoWithTests(MAX_TRANSFER_TESTS + 1);

    await expect(
      new ExportBrowserTests(repo).execute({ workspaceId: WORKSPACE_ID }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: `Export supports at most ${MAX_TRANSFER_TESTS} browser tests`,
    });
  });
});
