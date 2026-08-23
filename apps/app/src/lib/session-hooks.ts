type BeforeSignOut = () => Promise<void>;

const beforeSignOutHooks = new Set<BeforeSignOut>();

export interface BeforeSignOutOptions {
  /** Reject the transition when any cleanup fails or times out. */
  required?: boolean;
  timeoutMs?: number;
}

/**
 * Work that must run while the session is still valid, right before sign-out
 * (for example unregistering this device for push). Ordinary logout is
 * best-effort because the server disables every device for that user; a direct
 * A→B adoption uses `required` and therefore rejects on failure or timeout.
 */
export function onBeforeSignOut(hook: BeforeSignOut): () => void {
  beforeSignOutHooks.add(hook);
  return () => beforeSignOutHooks.delete(hook);
}

export async function runBeforeSignOut({
  required = false,
  timeoutMs = 5_000,
}: BeforeSignOutOptions = {}): Promise<void> {
  const results = await Promise.allSettled(
    [...beforeSignOutHooks].map(async (hook) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(hook),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Principal cleanup timed out")),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    }),
  );
  if (!required) return;
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, "Required principal cleanup failed");
  }
}
