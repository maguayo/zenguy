import {
  apiDelete,
  apiGet,
  apiGetBlob,
  apiGetPage,
  apiPatch,
  apiPost,
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

export function listTests(workspaceId: string): Promise<BrowserTest[]> {
  return apiGet(`${workspacePath(workspaceId)}/browser-tests`);
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

export function validateDraft(
  workspaceId: string,
  input: BrowserTestInput,
): Promise<{ runId: string }> {
  return apiPost(`${workspacePath(workspaceId)}/browser-tests/validate`, input);
}

export function runNow(workspaceId: string, testId: string): Promise<{ runId: string }> {
  return apiPost(
    `${workspacePath(workspaceId)}/browser-tests/${encodeURIComponent(testId)}/run-now`,
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
