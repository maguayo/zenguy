import { z } from "zod";
import { attemptMessageSchema } from "../queues";
import type { RunnerKind } from "./types";
import { irreversibleActionRequestSchema } from "./rules";

export const MAX_RUNNER_SCREENSHOT_BASE64_LENGTH = 3_000_000;

export const runnerDeliveryIdSchema = z.string().min(1).max(256);

export const runnerWorkerIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9._-]{1,64}$/u,
    "Worker id must be 1-64 chars of [A-Za-z0-9._-]",
  );

export const runnerAttemptReferenceSchema = z
  .object({
    runId: z.string().min(1),
    attemptId: z.string().min(1),
    attemptIndex: z.number().int().min(0).max(3),
    executionGeneration: z.number().int().nonnegative(),
    deliveryId: runnerDeliveryIdSchema,
  })
  .strict();

export const runnerClaimSchema = z
  .object({
    deliveryId: runnerDeliveryIdSchema,
    message: attemptMessageSchema,
    workerId: runnerWorkerIdSchema,
  })
  .strict();

export const runnerStaleClaimSchema = z
  .object({
    deliveryId: runnerDeliveryIdSchema,
    workerId: runnerWorkerIdSchema,
  })
  .strict();

export const runnerStartSchema = z
  .object({ reference: runnerAttemptReferenceSchema })
  .strict();

export const runnerAuthorizeActionSchema = z
  .object({
    reference: runnerAttemptReferenceSchema,
    action: irreversibleActionRequestSchema,
  })
  .strict();

const base64JpegSchema = z
  .string()
  .max(MAX_RUNNER_SCREENSHOT_BASE64_LENGTH)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/u, "Screenshot must be base64 encoded");

export const runnerStepSchema = z
  .object({
    reference: runnerAttemptReferenceSchema,
    step: z
      .object({
        sequence: z.number().int().min(1).max(45),
        actionType: z.string().min(1).max(80),
        description: z.string().min(1).max(4_000),
        url: z.string().max(4_096).nullable(),
        result: z.enum(["OK", "ERROR"]),
        screenshotJpegBase64: base64JpegSchema.nullable().optional(),
      })
      .strict(),
  })
  .strict();

const consoleEntrySchema = z
  .object({
    level: z.enum(["error", "warning"]),
    message: z.string().max(500),
    url: z.string().max(4_096).nullable(),
    timestamp: z.string().max(64),
  })
  .strict();

const networkEntrySchema = z
  .object({
    method: z.string().max(16),
    host: z.string().max(512),
    path: z.string().max(2_048),
    statusCode: z.number().int().min(100).max(599).nullable(),
    errorType: z.string().max(500).nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const runnerOutcomeSchema = z
  .object({
    status: z.enum(["PASSED", "FAILED", "TIMEOUT", "SYSTEM_ERROR"]),
    summary: z.string().max(2_000).optional(),
    expectedResult: z.string().max(2_000).optional(),
    actualResult: z.string().max(2_000).optional(),
    failureReason: z.string().max(2_000).optional(),
    systemErrorCode: z.string().min(1).max(80).optional(),
    tokenUsage: z.number().int().nonnegative().max(10_000_000).optional(),
    inputTokens: z.number().int().nonnegative().max(10_000_000).optional(),
    outputTokens: z.number().int().nonnegative().max(10_000_000).optional(),
    modelName: z.string().min(1).max(200),
    runnerVersion: z.string().min(1).max(200),
    runnerKind: z.enum(["primary", "fallback", "cf"]).optional(),
    visitedUrls: z.array(z.string().max(4_096)).max(100),
    consoleErrors: z.array(consoleEntrySchema).max(50),
    networkErrors: z.array(networkEntrySchema).max(50),
  })
  .strict()
  .superRefine((outcome, context) => {
    if (
      outcome.status !== "PASSED" &&
      (outcome.failureReason === undefined || outcome.failureReason.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["failureReason"],
        message: "A non-passing outcome requires a failure reason",
      });
    }
    if (
      outcome.status === "SYSTEM_ERROR" &&
      outcome.systemErrorCode === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["systemErrorCode"],
        message: "A system error requires a system error code",
      });
    }
  });

/**
 * Runners that predate `runnerKind` still identify themselves through the
 * version string prefix (see runner/browser_worker.py).
 */
export function runnerKindFromVersion(
  runnerVersion: string,
): RunnerKind | null {
  if (runnerVersion.startsWith("zenguy-fallback-runner/")) return "fallback";
  if (runnerVersion.startsWith("zenguy-local-runner/")) return "primary";
  if (runnerVersion.startsWith("zenguy-cf-runner/")) return "cf";
  return null;
}

export const runnerCompleteSchema = z
  .object({
    reference: runnerAttemptReferenceSchema,
    outcome: runnerOutcomeSchema,
  })
  .strict();

export const runnerHeartbeatSchema = z
  .object({
    workerId: runnerWorkerIdSchema,
    mode: z.enum(["local", "fallback", "cf"]),
    version: z.string().min(1).max(200),
    startedAt: z.number().int().nonnegative(),
  })
  .strict();

export type RunnerAttemptReference = z.infer<
  typeof runnerAttemptReferenceSchema
>;
export type RunnerClaimInput = z.infer<typeof runnerClaimSchema>;
export type RunnerStepInput = z.infer<typeof runnerStepSchema>;
export type RunnerOutcomeInput = z.infer<typeof runnerOutcomeSchema>;
export type RunnerHeartbeatInput = z.infer<typeof runnerHeartbeatSchema>;
