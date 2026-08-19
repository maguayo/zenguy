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
