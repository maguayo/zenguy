import { env } from "cloudflare:test";
import { D1RunnerWorkerRepo } from "./runner_worker_repo";

describe("D1RunnerWorkerRepo", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM runner_workers").run();
  });

  it("inserts on the first heartbeat and keeps first_seen_at on later ones", async () => {
    const repo = new D1RunnerWorkerRepo(env.DB);
    await repo.recordHeartbeat(
      {
        workerId: "mac-marcos",
        mode: "local",
        version: "zenguy-local-runner/2.0.0",
        startedAt: 900,
      },
      1_000,
    );
    await repo.recordHeartbeat(
      {
        workerId: "mac-marcos",
        mode: "local",
        version: "zenguy-local-runner/2.0.1",
        startedAt: 950,
      },
      6_000,
    );

    await expect(repo.findById("mac-marcos")).resolves.toEqual({
      id: "mac-marcos",
      mode: "local",
      version: "zenguy-local-runner/2.0.1",
      startedAt: 950,
      firstSeenAt: 1_000,
      lastSeenAt: 6_000,
    });
  });

  it("returns null for unknown workers", async () => {
    await expect(
      new D1RunnerWorkerRepo(env.DB).findById("nope"),
    ).resolves.toBeNull();
  });
});
