let accessToken: string | null = null;
let expiresAt: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const expiringListeners = new Set<() => void>();

function cancelTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function schedule(expiresInSeconds: number) {
  cancelTimer();
  const delay = Math.max(0, expiresInSeconds - 60) * 1_000;
  timer = setTimeout(() => {
    timer = null;
    for (const listener of expiringListeners) listener();
  }, delay);
}

export function setToken(token: string, expiresInSeconds: number): void {
  accessToken = token;
  expiresAt = Date.now() + expiresInSeconds * 1_000;
  schedule(expiresInSeconds);
}

export function getToken(): { accessToken: string | null; expiresAt: number | null } {
  return { accessToken, expiresAt };
}

export function clearToken(): void {
  accessToken = null;
  expiresAt = null;
  cancelTimer();
}

export function onExpiringSoon(callback: () => void): () => void {
  expiringListeners.add(callback);
  return () => expiringListeners.delete(callback);
}
