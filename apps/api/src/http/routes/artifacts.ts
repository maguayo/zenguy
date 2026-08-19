import { Hono } from "hono";
import type { ArtifactRepo } from "../../domain/browser_tests/repo";
import type { ArtifactStorage } from "../../infrastructure/storage/artifacts";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import { AppError } from "../../shared/errors";
import { verifyArtifactSig } from "../artifact_sign";
import type { AppEnv } from "../env";

export interface ArtifactRoutesDependencies {
  artifacts: ArtifactRepo;
  storage: Pick<ArtifactStorage, "get">;
  clock: Clock;
  config: Pick<AppConfig, "artifactUrlSecret">;
}

function artifactNotFound(): AppError {
  return new AppError("NOT_FOUND", "Artifact not found");
}

export function artifactRoutes(
  dependencies: ArtifactRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/artifact-content", async (context) => {
    const id = context.req.query("id") ?? "";
    const exp = Number(context.req.query("exp"));
    const sig = context.req.query("sig") ?? "";
    const now = dependencies.clock.now();
    if (
      !(await verifyArtifactSig(dependencies.config, id, exp, sig, now))
    ) {
      throw artifactNotFound();
    }
    const artifact = await dependencies.artifacts.findById(id);
    if (artifact === null || artifact.expiresAt <= now) {
      throw artifactNotFound();
    }
    const object = await dependencies.storage.get(artifact.storageKey);
    if (object === null) throw artifactNotFound();
    return new Response(object.body, {
      headers: {
        "Content-Type": artifact.mimeType,
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": "inline",
      },
    });
  });

  return app;
}
