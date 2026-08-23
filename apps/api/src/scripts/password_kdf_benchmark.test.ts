/// <reference types="node" />

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  PASSWORD_HASH_SCHEME,
  PASSWORD_HASH_VERSION,
  PASSWORD_KDF_TARGET_MAX_MS,
  PBKDF2_ITERATIONS,
} from "../shared/constants";

const SCRIPT = fileURLToPath(
  new URL("../../scripts/benchmark-password-kdf.mjs", import.meta.url),
);

describe("password KDF benchmark", () => {
  it(
    "measures the exact current format and enforces the latency ceiling",
    () => {
      const result = spawnSync(process.execPath, [SCRIPT, "--samples=3"], {
        encoding: "utf8",
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      const report = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(report).toMatchObject({
        scheme: PASSWORD_HASH_SCHEME,
        version: PASSWORD_HASH_VERSION,
        iterations: PBKDF2_ITERATIONS,
        samples: 3,
        targetMaxMs: PASSWORD_KDF_TARGET_MAX_MS,
        passed: true,
      });
      expect(report.p50Ms).toEqual(expect.any(Number));
      expect(report.p95Ms).toEqual(expect.any(Number));
    },
    10_000,
  );

  it("rejects sample counts that could hide variance or waste CI time", () => {
    const result = spawnSync(process.execPath, [SCRIPT, "--samples=2"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "--samples must be an integer between 3 and 50",
    );
    expect(result.stdout).toBe("");
  });
});
