import { z } from "zod";

export const notificationMessageSchema = z
  .object({
    eventType: z.enum(["FAILURE", "RECOVERY", "TEST"]),
    title: z.string(),
    lines: z.array(z.string()),
    link: z.url(),
    speakText: z.string(),
    shortText: z.string(),
    color: z.enum(["red", "green", "gray"]),
  })
  .strict();

export const notifyMessageSchema = z
  .object({
    kind: z.literal("notify"),
    deliveryId: z.string().min(1),
    workspaceId: z.string().min(1),
    channelId: z.string().min(1),
    message: notificationMessageSchema,
    redriveCount: z.number().int().nonnegative().max(5).optional(),
  })
  .strict();

export type NotifyMessage = z.infer<typeof notifyMessageSchema>;

export const attemptMessageSchema = z
  .object({
    kind: z.literal("attempt"),
    runId: z.string().min(1),
    attemptId: z.string().min(1),
    attemptIndex: z.number().int().min(0).max(3),
    // `queuedAt` is changed atomically whenever an infrastructure retry is
    // scheduled. Carrying it in the message gives every execution a durable
    // generation token, so a delayed delivery from the previous generation
    // cannot claim or finish the reset attempt.
    executionGeneration: z.number().int().nonnegative(),
    redriveCount: z.number().int().nonnegative().max(5).optional(),
  })
  .strict();

export type AttemptMessage = z.infer<typeof attemptMessageSchema>;

export const checkMessageSchema = z
  .object({
    kind: z.literal("check"),
    monitorId: z.string().min(1),
    workspaceId: z.string().min(1),
    cycleId: z.string().min(1),
    attemptIndex: z.number().int().min(0).max(3),
    redriveCount: z.number().int().nonnegative().max(5).optional(),
  })
  .strict();

export type CheckMessage = z.infer<typeof checkMessageSchema>;
