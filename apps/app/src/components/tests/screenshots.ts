import type { ArtifactRef, Attempt } from "@/api/types";

export interface ScreenshotItem extends ArtifactRef {
  caption: string;
}

export function nextScreenshotIndex(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, current + direction));
}

export function clampScreenshotIndex(index: number, count: number): number {
  return Math.min(Math.max(0, index), Math.max(0, count - 1));
}

/** Every screenshot of the attempt, captioned with the step that took it. */
export function screenshotItems(attempt: Pick<Attempt, "screenshots" | "steps">): ScreenshotItem[] {
  return attempt.screenshots.map((screenshot, index) => {
    const step = attempt.steps.find((candidate) => candidate.screenshot?.id === screenshot.id);
    return { ...screenshot, caption: step?.description ?? `Screenshot ${index + 1}` };
  });
}
