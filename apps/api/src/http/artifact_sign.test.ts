import { ARTIFACT_SIG_TTL_SECONDS } from "../shared/constants";
import { signArtifactUrl, verifyArtifactSig } from "./artifact_sign";

const CONFIG = { artifactUrlSecret: "artifact-signing-secret".padEnd(32, "-") };
const NOW = 1_700_000_000_000;

describe("artifact URL signing", () => {
  it("round-trips a signed artifact URL", async () => {
    const signed = await signArtifactUrl(CONFIG, "art_123", NOW);
    const url = new URL(signed, "https://app.zenguy.test");
    const exp = Number(url.searchParams.get("exp"));

    expect(url.pathname).toBe("/api/artifact-content");
    expect(url.searchParams.get("id")).toBe("art_123");
    expect(exp).toBe(Math.floor(NOW / 1_000) + ARTIFACT_SIG_TTL_SECONDS);
    await expect(
      verifyArtifactSig(
        CONFIG,
        "art_123",
        exp,
        url.searchParams.get("sig") ?? "",
        NOW,
      ),
    ).resolves.toBe(true);
  });

  it("rejects expiry, tampering, and malformed expiration", async () => {
    const signed = await signArtifactUrl(CONFIG, "art_123", NOW);
    const url = new URL(signed, "https://app.zenguy.test");
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig") ?? "";

    await expect(
      verifyArtifactSig(
        CONFIG,
        "art_123",
        exp,
        sig,
        NOW + ARTIFACT_SIG_TTL_SECONDS * 1_000,
      ),
    ).resolves.toBe(false);
    await expect(
      verifyArtifactSig(CONFIG, "art_tampered", exp, sig, NOW),
    ).resolves.toBe(false);
    await expect(
      verifyArtifactSig(CONFIG, "art_123", Number.NaN, sig, NOW),
    ).resolves.toBe(false);
  });
});
