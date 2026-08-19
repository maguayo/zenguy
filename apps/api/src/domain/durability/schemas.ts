import { z } from "zod";
import {
  attemptMessageSchema,
  checkMessageSchema,
  notifyMessageSchema,
} from "../queues";
import type {
  DurableJob,
  DurableJobKind,
  DurableQueueKind,
} from "./types";

const attemptContinuationSchema = z
  .object({
    runId: z.string().min(1),
    attemptId: z.string().min(1),
  })
  .strict();

const runFinalizationSchema = z
  .object({
    runId: z.string().min(1),
    reverseUsage: z.boolean(),
    handleFinalized: z.boolean().optional(),
  })
  .strict();

const checkContinuationSchema = z
  .object({
    workspaceId: z.string().min(1),
    monitorId: z.string().min(1),
    cycleId: z.string().min(1),
    attemptIndex: z.number().int().min(0).max(3),
    checkId: z.string().min(1),
    failureSummary: z.string().nullable(),
  })
  .strict();

const jobSchemas = {
  ATTEMPT_CONTINUATION: attemptContinuationSchema,
  RUN_FINALIZATION: runFinalizationSchema,
  CHECK_CONTINUATION: checkContinuationSchema,
} satisfies Record<DurableJobKind, z.ZodType>;

const outboxSchemas = {
  RUN: attemptMessageSchema,
  CHECK: checkMessageSchema,
  NOTIFY: notifyMessageSchema,
} satisfies Record<DurableQueueKind, z.ZodType>;

export type DurablePayloadValidation =
  | { success: true; value: Record<string, unknown> }
  | { success: false; reason: string };

function parsePayload(
  payloadJson: string,
  schema: z.ZodType,
): DurablePayloadValidation {
  let decoded: unknown;
  try {
    decoded = JSON.parse(payloadJson) as unknown;
  } catch {
    return { success: false, reason: "payload is not valid JSON" };
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    return { success: false, reason: "payload does not match its schema" };
  }
  return {
    success: true,
    value: parsed.data as Record<string, unknown>,
  };
}

export function validateDurableJobPayload(
  job: Pick<DurableJob, "kind" | "payloadJson">,
): DurablePayloadValidation {
  return parsePayload(job.payloadJson, jobSchemas[job.kind]);
}

export function validateOutboxPayload(input: {
  queueKind: DurableQueueKind;
  payloadJson: string;
}): DurablePayloadValidation {
  return parsePayload(input.payloadJson, outboxSchemas[input.queueKind]);
}
