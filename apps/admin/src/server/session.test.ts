import { clearSessionCookie, readCookie, sessionCookie, signSession, verifySession } from "./session";

const SECRET = "s".repeat(32);

describe("admin session", () => {
  it("round-trips a signed payload", async () => {
    const token = await signSession({ email: "marcos@aguayo.es", exp: 2_000 }, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    await expect(verifySession(token, SECRET, 1_000)).resolves.toEqual({
      email: "marcos@aguayo.es",
    });
  });

  it("rejects expired, tampered, foreign-key and malformed tokens", async () => {
    const token = await signSession({ email: "marcos@aguayo.es", exp: 2_000 }, SECRET);
    const [payload, signature] = token.split(".") as [string, string];
    await expect(verifySession(token, SECRET, 2_000)).resolves.toBeNull();
    await expect(verifySession(`${payload}x.${signature}`, SECRET, 1_000)).resolves.toBeNull();
    await expect(verifySession(token, "t".repeat(32), 1_000)).resolves.toBeNull();
    await expect(verifySession("garbage", SECRET, 1_000)).resolves.toBeNull();
    await expect(verifySession("", SECRET, 1_000)).resolves.toBeNull();
  });

  it("builds host-only secure cookies", () => {
    expect(sessionCookie("abc", 604_800)).toBe(
      "zenguy_admin_session=abc; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(clearSessionCookie()).toBe(
      "zenguy_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(readCookie("a=1; zenguy_admin_session=tok.en; b=2", "zenguy_admin_session")).toBe(
      "tok.en",
    );
    expect(readCookie(undefined, "zenguy_admin_session")).toBeNull();
  });
});
