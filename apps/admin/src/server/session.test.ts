import {
  clearSessionCookie,
  isWellFormedSessionToken,
  newSessionToken,
  readCookie,
  sessionCookie,
  sessionTokenHash,
} from "./session";

describe("admin session", () => {
  it("creates high-entropy opaque tokens and stable hashes", async () => {
    const first = newSessionToken();
    const second = newSessionToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).not.toBe(first);
    expect(isWellFormedSessionToken(first)).toBe(true);
    expect(isWellFormedSessionToken("bad.token")).toBe(false);
    expect(await sessionTokenHash(first, "access-user-1")).toMatch(/^[a-f0-9]{64}$/u);
    expect(await sessionTokenHash(first, "access-user-1")).toBe(
      await sessionTokenHash(first, "access-user-1"),
    );
    expect(await sessionTokenHash(first, "access-user-2")).not.toBe(
      await sessionTokenHash(first, "access-user-1"),
    );
    await expect(sessionTokenHash(first, "")).rejects.toThrow("subject is invalid");
  });

  it("builds host-only secure cookies", () => {
    expect(sessionCookie("abc", 1_800)).toBe(
      "__Host-zenguy_admin_session=abc; Max-Age=1800; Path=/; HttpOnly; Secure; SameSite=Strict",
    );
    expect(clearSessionCookie()).toBe(
      "__Host-zenguy_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict",
    );
    expect(
      readCookie("a=1; __Host-zenguy_admin_session=opaque; b=2", "__Host-zenguy_admin_session"),
    ).toBe("opaque");
    expect(readCookie(undefined, "__Host-zenguy_admin_session")).toBeNull();
  });
});
