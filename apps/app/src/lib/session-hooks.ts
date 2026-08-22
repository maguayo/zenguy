type BeforeSignOut = () => Promise<void>;

const beforeSignOutHooks = new Set<BeforeSignOut>();

/**
 * Work that must run while the session is still valid, right before sign-out
 * (for example unregistering this device for push). Failures never block the
 * sign-out itself.
 */
export function onBeforeSignOut(hook: BeforeSignOut): () => void {
  beforeSignOutHooks.add(hook);
  return () => beforeSignOutHooks.delete(hook);
}

export async function runBeforeSignOut(): Promise<void> {
  await Promise.all(
    [...beforeSignOutHooks].map((hook) =>
      Promise.race([hook(), new Promise<void>((resolve) => setTimeout(resolve, 5_000))]).catch(
        () => undefined,
      ),
    ),
  );
}
