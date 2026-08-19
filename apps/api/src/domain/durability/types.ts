export type DurableQueueKind = "RUN" | "CHECK" | "NOTIFY";

export interface QueueOutboxEntry {
  id: string;
  dedupeKey: string;
  queueKind: DurableQueueKind;
  payloadJson: string;
  availableAt: number;
  publishingAt: number | null;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type DurableJobKind =
  | "ATTEMPT_CONTINUATION"
  | "RUN_FINALIZATION"
  | "CHECK_CONTINUATION";

export interface DurableJob {
  id: string;
  kind: DurableJobKind;
  aggregateKey: string;
  payloadJson: string;
  status: "PENDING" | "COMPLETED";
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}
