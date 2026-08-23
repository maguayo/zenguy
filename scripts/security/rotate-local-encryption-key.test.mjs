import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { RETIRED_LOCAL_ROTATION_MESSAGE } from "./rotate-local-encryption-key.mjs";

const SCRIPT = fileURLToPath(
  new URL("./rotate-local-encryption-key.mjs", import.meta.url),
);

test("the retired plaintext rotation path fails closed without touching its target", () => {
  const directory = mkdtempSync(join(tmpdir(), "zenguy-retired-key-rotation-"));
  const path = join(directory, ".dev.vars");
  const synthetic = "ENCRYPTION_KEY=synthetic-test-only\n";
  writeFileSync(path, synthetic, { mode: 0o600 });
  try {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--vars-file", path],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `${RETIRED_LOCAL_ROTATION_MESSAGE}\n`);
    assert.equal(readFileSync(path, "utf8"), synthetic);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the compatibility message routes operators to Keychain and v4", () => {
  assert.match(RETIRED_LOCAL_ROTATION_MESSAGE, /Keychain/u);
  assert.match(RETIRED_LOCAL_ROTATION_MESSAGE, /per-workspace v4 rotation/u);
  assert.match(RETIRED_LOCAL_ROTATION_MESSAGE, /never reads or writes/u);
});
