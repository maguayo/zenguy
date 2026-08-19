import type {
  DurableJob,
  DurableJobKind,
  DurableQueueKind,
  QueueOutboxEntry,
} from "../../domain/durability/types";
import type { IdGenerator } from "../../shared/ids";

export function createOutboxEntry(input: {
  dedupeKey: string;
  queueKind: DurableQueueKind;
  payload: unknown;
  availableAt: number;
  now: number;
  ids: IdGenerator;
}): QueueOutboxEntry {
  return {
    id: input.ids.newId("out"),
    dedupeKey: input.dedupeKey,
    queueKind: input.queueKind,
    payloadJson: JSON.stringify(input.payload),
    availableAt: input.availableAt,
    publishingAt: null,
    publishedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function createDurableJob(input: {
  kind: DurableJobKind;
  aggregateKey: string;
  payload: unknown;
  now: number;
  ids: IdGenerator;
}): DurableJob {
  return {
    id: input.ids.newId("job"),
    kind: input.kind,
    aggregateKey: input.aggregateKey,
    payloadJson: JSON.stringify(input.payload),
    status: "PENDING",
    createdAt: input.now,
    updatedAt: input.now,
    completedAt: null,
  };
}
