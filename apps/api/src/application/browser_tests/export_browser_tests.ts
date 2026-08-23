import type { BrowserTestRepo } from "../../domain/browser_tests/repo";
import {
  MAX_TRANSFER_TESTS,
  type BrowserTestTransferEntry,
} from "../../domain/browser_tests/transfer";
import { conflict } from "../../shared/errors";
import type { Cursor } from "../../shared/pagination";

/** Keep each D1 page and each channel-id batch bounded independently. */
export const BROWSER_TEST_EXPORT_PAGE_SIZE = 100;

export class ExportBrowserTests {
  constructor(private readonly tests: BrowserTestRepo) {}

  async execute(input: {
    workspaceId: string;
  }): Promise<BrowserTestTransferEntry[]> {
    const entries: BrowserTestTransferEntry[] = [];
    let cursor: Cursor | undefined;

    while (entries.length < MAX_TRANSFER_TESTS) {
      const remaining = MAX_TRANSFER_TESTS - entries.length;
      const pageSize = Math.min(BROWSER_TEST_EXPORT_PAGE_SIZE, remaining);
      // The extra row is a bounded sentinel: it distinguishes an exact final
      // page from legacy/corrupt data above the hard collection ceiling.
      const rows = await this.tests.listPage(
        input.workspaceId,
        cursor,
        pageSize + 1,
      );
      const page = rows.slice(0, pageSize);
      const channelIds = await this.tests.getChannelIdsForTests(
        input.workspaceId,
        page.map((test) => test.id),
      );
      entries.push(
        ...page.map((test) => ({
          id: test.id,
          name: test.name,
          allowedDomains: [...(test.allowedDomains ?? [])],
          writableDomains: [...(test.writableDomains ?? [])],
          testDataAttested: test.testDataAttested ?? false,
          irreversibleActionScopes: structuredClone(
            test.irreversibleActionScopes ?? [],
          ),
          startUrl: test.startUrl,
          instructions: test.instructions,
          device: test.device,
          intervalHours: test.intervalHours,
          maxRetries: test.maxRetries,
          notifyOnRecovery: test.notifyOnRecovery,
          channelIds: [...(channelIds.get(test.id) ?? [])],
        })),
      );

      if (rows.length <= pageSize) return entries;
      if (entries.length >= MAX_TRANSFER_TESTS) {
        throw conflict(
          `Export supports at most ${MAX_TRANSFER_TESTS} browser tests`,
        );
      }
      const last = page.at(-1);
      if (last === undefined) {
        throw new Error("Browser-test export cursor could not advance");
      }
      cursor = { createdAt: last.createdAt, id: last.id };
    }

    return entries;
  }
}
