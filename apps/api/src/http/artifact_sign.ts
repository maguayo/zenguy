import type { AppConfig } from "../shared/config";
import { ARTIFACT_SIG_TTL_SECONDS } from "../shared/constants";
import { hmacSign, hmacVerify } from "../shared/crypto";

type ArtifactSigningConfig = Pick<AppConfig, "artifactUrlSecret">;

export async function signArtifactUrl(
  config: ArtifactSigningConfig,
  artifactId: string,
  now: number,
): Promise<string> {
  const exp = Math.floor(now / 1_000) + ARTIFACT_SIG_TTL_SECONDS;
  const sig = await hmacSign(config.artifactUrlSecret, `${artifactId}.${exp}`);
  const query = new URLSearchParams({ id: artifactId, exp: String(exp), sig });
  return `/api/artifact-content?${query.toString()}`;
}

export async function verifyArtifactSig(
  config: ArtifactSigningConfig,
  artifactId: string,
  exp: number,
  sig: string,
  now: number,
): Promise<boolean> {
  if (
    artifactId.length === 0 ||
    sig.length === 0 ||
    !Number.isSafeInteger(exp) ||
    exp <= Math.floor(now / 1_000)
  ) {
    return false;
  }
  return hmacVerify(config.artifactUrlSecret, `${artifactId}.${exp}`, sig);
}
