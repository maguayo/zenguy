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
  })
  .strict();

export type NotifyMessage = z.infer<typeof notifyMessageSchema>;

export const attemptMessageSchema = z
  .object({
    kind: z.literal("attempt"),
    runId: z.string().min(1),
    attemptId: z.string().min(1),
    attemptIndex: z.number().int().min(0).max(3),
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
  })
  .strict();

export type CheckMessage = z.infer<typeof checkMessageSchema>;
