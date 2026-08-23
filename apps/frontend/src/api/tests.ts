import {
  apiDelete,
  apiGet,
  apiGetBlob,
  apiGetPage,
  apiPatch,
  apiPost,
  apiPostText,
  type ApiPage,
} from "../lib/api";
import type {
  Attempt,
  BrowserTest,
  BrowserTestInput,
  Run,
  RunListItem,
  RunStatus,
} from "./types";

function workspacePath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}`;
}

const TEST_PAGE_SIZE = 100;
const MAX_TEST_PAGES = 2;

export function testsPath(workspaceId: string, cursor?: string): string {
  const search = new URLSearchParams({ limit: String(TEST_PAGE_SIZE) });
  if (cursor !== undefined) search.set("cursor", cursor);
  return `${workspacePath(workspaceId)}/browser-tests?${search}`;
}

export async function listTests(workspaceId: string): Promise<BrowserTest[]> {
  const tests: BrowserTest[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_TEST_PAGES; pageNumber += 1) {
    const page = await apiGetPage<BrowserTest>(testsPath(workspaceId, cursor));
    tests.push(...page.items);
    if (page.nextCursor === null || page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  }
  return tests;
}

export function getTest(workspaceId: string, testId: string): Promise<BrowserTest> {
  return apiGet(
    `${workspacePath(workspaceId)}/browser-tests/${encodeURIComponent(testId)}`,
  );
}

export function createTest(
  workspaceId: string,
  input: BrowserTestInput,
): Promise<BrowserTest> {
  return apiPost(`${workspacePath(workspaceId)}/browser-tests`, input);
}

export function updateTest(
  workspaceId: string,
  testId: string,
  input: Partial<BrowserTestInput>,
): Promise<BrowserTest> {
  return apiPatch(
    `${workspacePath(workspaceId)}/browser-tests/${encodeURIComponent(testId)}`,
    input,
  );
}

export function deleteTest(workspaceId: string, testId: string): Promise<void> {
  return apiDelete(
    `${workspacePath(workspaceId)}/browser-tests/${encodeURIComponent(testId)}`,
  );
}

export type ExportFormat = "yaml" | "json";

export interface ImportTestsSummary {
  created: number;
  updated: number;
  tests: BrowserTest[];
}

export function exportTestsPath(
  workspaceId: string,
  format: ExportFormat,
): string {
  return `${workspacePath(workspaceId)}/browser-tests/export?format=${format}`;
}

export function exportTests(
  workspaceId: string,
  format: ExportFormat,
): Promise<{ blob: Blob; filename: string }> {
  return apiGetBlob(exportTestsPath(workspaceId, format));
}

export function importTests(
  workspaceId: string,
  fileText: string,
): Promise<ImportTestsSummary> {
  return apiPostText(
    `${workspacePath(workspaceId)}/browser-tests/import`,
    fileText,
  );
}

export function validateDraft(
  workspaceId: string,
  input: BrowserTestInput,
  approveIrreversibleActions = false,
): Promise<{ runId: string }> {
  return apiPost(`${workspacePath(workspaceId)}/browser-tests/validate`, {
    config: input,
    ...(approveIrreversibleActions ? { approveIrreversibleActions: true } : {}),
  });
}

export function runNow(
  workspaceId: string,
  testId: string,
  approveIrreversibleActions = false,
): Promise<{ runId: string }> {
  return apiPost(
    `${workspacePath(workspaceId)}/browser-tests/${encodeURIComponent(testId)}/run-now`,
    approveIrreversibleActions ? { approveIrreversibleActions: true } : {},
  );
}

export function runsPath(
  workspaceId: string,
  testId: string,
  options: { cursor?: string | null; status?: RunStatus | null } = {},
): string {
  const search = new URLSearchParams({ limit: "100" });
  if (options.cursor) search.set("cursor", options.cursor);
  if (options.status) search.set("status", options.status);
  return `${workspacePath(workspaceId)}/browser-tests/${encodeURIComponent(testId)}/runs?${search}`;
}

export function listRuns(
  workspaceId: string,
  testId: string,
  options: { cursor?: string | null; status?: RunStatus | null } = {},
): Promise<ApiPage<RunListItem>> {
  return apiGetPage(runsPath(workspaceId, testId, options));
}

export function getRun(workspaceId: string, runId: string): Promise<Run> {
  return apiGet(`${workspacePath(workspaceId)}/runs/${encodeURIComponent(runId)}`);
}

export function getAttempt(workspaceId: string, attemptId: string): Promise<Attempt> {
  return apiGet(`${workspacePath(workspaceId)}/attempts/${encodeURIComponent(attemptId)}`);
}

export function downloadReport(
  workspaceId: string,
  runId: string,
): Promise<{ blob: Blob; filename: string }> {
  return apiGetBlob(`${workspacePath(workspaceId)}/runs/${encodeURIComponent(runId)}/report`);
}
