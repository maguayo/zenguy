import { z } from "zod";
import {
  DEVICE_PROFILES,
  RUNNER_VERSION,
} from "../../shared/constants";
import { assertSafeExternalUrl } from "../../shared/ssrf";
import type { RunSnapshot } from "./types";

function safeExternalUrl(value: string): boolean {
  try {
    assertSafeExternalUrl(value);
    return true;
  } catch {
    return false;
  }
}

export const browserTestConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startUrl: z
      .string()
      .refine(safeExternalUrl, { message: "URL is not allowed" }),
    instructions: z.string().min(1).max(10_000),
    device: z.enum(["DESKTOP", "MOBILE"]),
    intervalHours: z.number().int().min(1).max(24),
    maxRetries: z.number().int().min(0).max(3),
    notifyOnRecovery: z.boolean(),
    channelIds: z.array(z.string()).max(10),
  })
  .strict();

export type BrowserTestConfig = z.infer<typeof browserTestConfigSchema>;

export function buildSnapshot(
  config: BrowserTestConfig,
  cfgLlmModel: string,
): RunSnapshot {
  const profile = DEVICE_PROFILES[config.device];
  return {
    name: config.name,
    startUrl: config.startUrl,
    instructions: config.instructions,
    device: config.device,
    intervalHours: config.intervalHours,
    maxRetries: config.maxRetries,
    notifyOnRecovery: config.notifyOnRecovery,
    channelIds: [...config.channelIds],
    viewport: { width: profile.width, height: profile.height },
    modelName: cfgLlmModel,
    runnerVersion: RUNNER_VERSION,
  };
}

export function computeNextRunAt(
  now: number,
  intervalHours: number,
): number {
  return now + intervalHours * 3_600_000;
}
