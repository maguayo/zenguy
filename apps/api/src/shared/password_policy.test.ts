import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "./constants";
import {
  COMPROMISED_PASSWORD_CORPUS,
  COMPROMISED_PASSWORD_CORPUS_SHA256,
  COMPROMISED_PASSWORD_CORPUS_VERSION,
} from "./compromised_password_corpus";
import { sha256Hex } from "./crypto";
import { isCompromisedPassword, newPasswordIssues } from "./password_policy";

describe("new password policy", () => {
  it("requires fifteen Unicode code points and allows long passphrases", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(15);
    expect(MAX_PASSWORD_LENGTH).toBe(100);
    expect(newPasswordIssues("short")).toContain(
      "Password must be at least 15 characters",
    );
    expect(newPasswordIssues("😀".repeat(14))).toContain(
      "Password must be at least 15 characters",
    );
    expect(newPasswordIssues("😀".repeat(15))).toEqual([]);
    expect(newPasswordIssues("correct horse battery staple")).toEqual([]);
  });

  it("caps new passwords by Unicode code point rather than UTF-16 units", () => {
    expect(newPasswordIssues("😀".repeat(100))).toEqual([]);
    expect(newPasswordIssues("😀".repeat(101))).toContain(
      "Password must be 100 characters or fewer",
    );
  });

  it("uses the pinned offline breach corpus and service-specific variants", async () => {
    expect(COMPROMISED_PASSWORD_CORPUS_VERSION).toBe(
      "ncsc-top-100k@1a7bb912-min12-nfkc-lower-v1",
    );
    expect(COMPROMISED_PASSWORD_CORPUS).toHaveLength(1_197);
    await expect(
      sha256Hex(COMPROMISED_PASSWORD_CORPUS.join("\n")),
    ).resolves.toBe(COMPROMISED_PASSWORD_CORPUS_SHA256);
    expect(isCompromisedPassword("PASSWORD123456789")).toBe(true);
    expect(isCompromisedPassword("ｑｗｅｒｔｙｕｉｏｐ１２３４５６")).toBe(true);
    expect(isCompromisedPassword("Password123!")).toBe(true);
    expect(isCompromisedPassword("zenguyzenguy")).toBe(true);
    expect(newPasswordIssues("passwordpassword")).toContain(
      "Choose a password that is not commonly compromised",
    );
  });
});
