import {
  apiDelete,
  apiGet,
  apiGetText,
  apiPatch,
  apiPost,
  apiPut,
} from "../lib/api";
import type {
  CustomDomainCheck,
  StatusPage,
  StatusPageDetail,
  StatusPageInput,
  StatusPageItem,
  StatusPageItemInput,
} from "./types";

function statusPagesPath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/status-pages`;
}

export function statusPagePath(workspaceId: string, pageId: string): string {
  return `${statusPagesPath(workspaceId)}/${encodeURIComponent(pageId)}`;
}

export function listStatusPages(workspaceId: string): Promise<StatusPage[]> {
  return apiGet(statusPagesPath(workspaceId));
}

export function createStatusPage(
  workspaceId: string,
  input: { title: string; slug: string },
): Promise<StatusPage> {
  return apiPost(statusPagesPath(workspaceId), input);
}

export function getStatusPage(
  workspaceId: string,
  pageId: string,
): Promise<StatusPageDetail> {
  return apiGet(statusPagePath(workspaceId, pageId));
}

export function updateStatusPage(
  workspaceId: string,
  pageId: string,
  input: StatusPageInput,
): Promise<StatusPage> {
  return apiPatch(statusPagePath(workspaceId, pageId), input);
}

export function publishStatusPage(
  workspaceId: string,
  pageId: string,
): Promise<StatusPage> {
  return apiPost(`${statusPagePath(workspaceId, pageId)}/publish`);
}

export function unpublishStatusPage(
  workspaceId: string,
  pageId: string,
): Promise<StatusPage> {
  return apiPost(`${statusPagePath(workspaceId, pageId)}/unpublish`);
}

export function deleteStatusPage(
  workspaceId: string,
  pageId: string,
): Promise<void> {
  return apiDelete(statusPagePath(workspaceId, pageId)).then(() => undefined);
}

export function addStatusPageItem(
  workspaceId: string,
  pageId: string,
  input: StatusPageItemInput,
): Promise<StatusPageItem> {
  return apiPost(`${statusPagePath(workspaceId, pageId)}/items`, input);
}

export function updateStatusPageItem(
  workspaceId: string,
  pageId: string,
  itemId: string,
  input: { displayName?: string; groupName?: string | null },
): Promise<StatusPageItem> {
  return apiPatch(
    `${statusPagePath(workspaceId, pageId)}/items/${encodeURIComponent(itemId)}`,
    input,
  );
}

export function removeStatusPageItem(
  workspaceId: string,
  pageId: string,
  itemId: string,
): Promise<void> {
  return apiDelete(
    `${statusPagePath(workspaceId, pageId)}/items/${encodeURIComponent(itemId)}`,
  ).then(() => undefined);
}

export function reorderStatusPageItems(
  workspaceId: string,
  pageId: string,
  itemIds: string[],
): Promise<void> {
  return apiPut(`${statusPagePath(workspaceId, pageId)}/items/order`, {
    itemIds,
  }).then(() => undefined);
}

export function fetchStatusPagePreview(
  workspaceId: string,
  pageId: string,
): Promise<string> {
  return apiGetText(`${statusPagePath(workspaceId, pageId)}/preview`);
}

export function setCustomDomain(
  workspaceId: string,
  pageId: string,
  hostname: string,
): Promise<StatusPage> {
  return apiPut(`${statusPagePath(workspaceId, pageId)}/custom-domain`, {
    hostname,
  });
}

export function checkCustomDomain(
  workspaceId: string,
  pageId: string,
): Promise<CustomDomainCheck> {
  return apiPost(`${statusPagePath(workspaceId, pageId)}/custom-domain/check`);
}

export function removeCustomDomain(
  workspaceId: string,
  pageId: string,
): Promise<void> {
  return apiDelete(`${statusPagePath(workspaceId, pageId)}/custom-domain`).then(
    () => undefined,
  );
}
