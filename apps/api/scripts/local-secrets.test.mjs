import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { lstatSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  DEVELOPMENT_SECRET_NAMES,
  KEYCHAIN_SERVICE,
  LOCAL_SENSITIVE_FILES,
  assertPrivateLocalSecretFile,
  auditLocalSensitiveFiles,
  buildSafeChildEnvironment,
  childInvocation,
  createPrivateSecretFifo,
  keychainItemExists,
  readKeychainItem,
  serializeSecretEnv,
  setKeychainItem,
  validateSecretSet,
} from "./local-secrets.mjs";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

function validSeedValues() {
  return new Map([
    ["ENCRYPTION_KEY", encryptionKey],
    ["ENCRYPTION_KEY_ID", "local-test-v1"],
  ]);
}

function validDevelopmentValues() {
  return new Map([
    ["JWT_SECRET", "j".repeat(32)],
    ["ENCRYPTION_KEY", encryptionKey],
    ["ENCRYPTION_KEY_ID", "local-test-v1"],
    ["ARTIFACT_URL_SECRET", "a".repeat(32)],
    ["RUNNER_API_TOKEN", "r".repeat(32)],
    ["RUNNER_FALLBACK_API_TOKEN", "f".repeat(32)],
    ["RUNNER_CAPABILITY_SECRET", "c".repeat(32)],
    ["TWILIO_ACCOUNT_SID", "AC-test"],
    ["TWILIO_AUTH_TOKEN", "twilio-token"],
    ["TWILIO_FROM_SMS", "+34600000001"],
    ["TWILIO_FROM_CALL", "+34600000002"],
  ]);
}

test("the Keychain namespace and accepted names are fixed", () => {
  assert.equal(KEYCHAIN_SERVICE, "com.zenguy.api.local-development.v1");
  assert.equal(new Set(DEVELOPMENT_SECRET_NAMES).size, DEVELOPMENT_SECRET_NAMES.length);
  assert.ok(DEVELOPMENT_SECRET_NAMES.includes("ENCRYPTION_PREVIOUS_KEYS"));
  assert.ok(DEVELOPMENT_SECRET_NAMES.includes("PADDLE_WEBHOOK_SECRET"));
});

test("audits local secret files using metadata only and rejects unsafe nodes", () => {
  const regular = {
    uid: 501,
    mode: 0o100600,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  assert.equal(
    assertPrivateLocalSecretFile("synthetic", "/not-opened", () => regular, 501),
    true,
  );
  assert.equal(
    assertPrivateLocalSecretFile(
      "missing",
      "/not-opened",
      () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
      501,
    ),
    false,
  );
  assert.throws(
    () =>
      assertPrivateLocalSecretFile(
        "symlink",
        "/not-opened",
        () => ({ ...regular, isSymbolicLink: () => true }),
        501,
      ),
    /never a symlink/u,
  );
  assert.throws(
    () =>
      assertPrivateLocalSecretFile(
        "directory",
        "/not-opened",
        () => ({ ...regular, isFile: () => false }),
        501,
      ),
    /regular file/u,
  );
  assert.throws(
    () =>
      assertPrivateLocalSecretFile(
        "wrong-owner",
        "/not-opened",
        () => ({ ...regular, uid: 0 }),
        501,
      ),
    /current user/u,
  );
  assert.throws(
    () =>
      assertPrivateLocalSecretFile(
        "broad-mode",
        "/not-opened",
        () => ({ ...regular, mode: 0o100640 }),
        501,
      ),
    /mode 0600/u,
  );
  assert.ok(
    LOCAL_SENSITIVE_FILES.some(([label]) => label === "apps/api/.dev.vars"),
  );
});

test("the aggregate local audit returns names, never contents", () => {
  const first = ["first", "/private/first"];
  const absent = ["absent", "/private/absent"];
  const opened = [];
  const statFile = (path) => {
    opened.push(path);
    if (path === absent[1]) {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    }
    return {
      uid: 501,
      mode: 0o100600,
      isFile: () => true,
      isSymbolicLink: () => false,
    };
  };

  assert.deepEqual(
    auditLocalSensitiveFiles([first, absent], statFile, 501),
    ["first"],
  );
  assert.deepEqual(opened, ["/private/first", "/private/absent"]);
});

test("serializes secrets for Wrangler without shell or dotenv expansion", () => {
  const values = validSeedValues();
  values.set("TWILIO_AUTH_TOKEN", "local-$USER-\\literal");
  const serialized = serializeSecretEnv(values);
  assert.match(serialized, /ENCRYPTION_KEY='[A-Za-z0-9+/]+=+'/u);
  assert.ok(serialized.includes("TWILIO_AUTH_TOKEN='local-\\$USER-\\literal'"));
  assert.ok(!serialized.includes("/Users/"));
});

test("rejects placeholders, duplicate independent secrets, and NUL bytes", () => {
  const placeholder = validDevelopmentValues();
  placeholder.set("JWT_SECRET", "replace-with-public-placeholder");
  assert.throws(() => validateSecretSet(placeholder), /public placeholder/u);

  const duplicate = validDevelopmentValues();
  duplicate.set("RUNNER_FALLBACK_API_TOKEN", duplicate.get("RUNNER_API_TOKEN"));
  assert.throws(() => validateSecretSet(duplicate), /must be independent/u);

  const nul = validDevelopmentValues();
  nul.set("TWILIO_AUTH_TOKEN", "bad\0value");
  assert.throws(() => validateSecretSet(nul), /NUL byte/u);

  const multiline = validDevelopmentValues();
  multiline.set("TWILIO_AUTH_TOKEN", "first\nsecond");
  assert.throws(() => validateSecretSet(multiline), /line break/u);
});

test("rejects incomplete provider and previous-key groups", () => {
  const paddle = validDevelopmentValues();
  paddle.set("PADDLE_API_KEY", "paddle-api");
  assert.throws(() => validateSecretSet(paddle), /Incomplete Paddle/u);

  const previous = validDevelopmentValues();
  previous.set(
    "ENCRYPTION_PREVIOUS_KEYS",
    JSON.stringify({ "local-test-v1": Buffer.alloc(32, 6).toString("base64") }),
  );
  assert.throws(() => validateSecretSet(previous), /must not repeat/u);
});

test("uses only private transports and rejects caller-controlled resources", () => {
  const dev = childInvocation(
    "dev",
    ["--port", "8790"],
    "/private/tmp/zenguy-test/bindings.env",
  );
  assert.equal(dev.command, process.execPath);
  assert.match(dev.arguments[0], /wrangler\/bin\/wrangler\.js$/u);
  assert.deepEqual(dev.arguments.slice(1), [
    "dev",
    "--env-file",
    "/private/tmp/zenguy-test/bindings.env",
    "--ip",
    "127.0.0.1",
    "--inspector-ip",
    "127.0.0.1",
    "--port",
    "8790",
  ]);
  const seed = childInvocation("seed", ["--dry-run"]);
  assert.deepEqual(seed.arguments.slice(1, 3), ["--vars-file", "/dev/fd/3"]);
  assert.throws(() => childInvocation("dev"), /private FIFO/u);
  for (const forbidden of [
    ["--env-file", "leak"],
    ["--vars-file", "leak"],
    ["--remote"],
    ["--env=production"],
    ["-eproduction"],
    ["--config=other.jsonc"],
    ["-cother.jsonc"],
    ["--cwd", "/tmp"],
    ["--persist-to", "legacy"],
    ["--tunnel"],
    ["--tunnel-name", "public"],
    ["--ip", "0.0.0.0"],
    ["--inspector-ip", "0.0.0.0"],
    ["--inspector-port", "9230"],
    ["other-entrypoint.ts"],
  ]) {
    assert.throws(
      () => childInvocation("dev", forbidden, "/private/tmp/fifo"),
      /accepts only --port/u,
    );
  }
  assert.throws(
    () => childInvocation("dev", ["--port", "0"], "/private/tmp/fifo"),
    /TCP port/u,
  );
  assert.throws(
    () => childInvocation(
      "dev",
      ["--port=8790", "--port=8791"],
      "/private/tmp/fifo",
    ),
    /one unique/u,
  );
  assert.deepEqual(
    childInvocation("dev", ["--port=8790"], "/private/tmp/fifo").arguments.slice(-1),
    ["--port=8790"],
  );
  assert.throws(() => childInvocation("seed", ["--remote"]), /disabled/u);
  assert.throws(() => childInvocation("seed", ["--vars-file"]), /controlled/u);
  assert.throws(() => childInvocation("seed", ["--vars-file=leak"]), /controlled/u);
});

test("child processes receive an allowlisted environment", () => {
  const environment = buildSafeChildEnvironment({
    HOME: "/Users/local-test",
    LANG: "en_US.UTF-8",
    NODE_OPTIONS: "--require=/tmp/untrusted.js",
    CLOUDFLARE_API_TOKEN: "must-not-propagate",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
    JWT_SECRET: "must-not-propagate",
  });
  assert.deepEqual(environment, {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: "/Users/local-test",
    LANG: "en_US.UTF-8",
  });
});

test("the private FIFO serves repeat reads without persisting payload bytes", { timeout: 15_000 }, async () => {
  const transport = createPrivateSecretFifo();
  const fifoStat = lstatSync(transport.path);
  assert.equal(fifoStat.isFIFO(), true);
  assert.equal(fifoStat.mode & 0o077, 0);

  const writer = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./local-secret-fifo-writer.mjs", import.meta.url)),
      transport.path,
      String(process.pid),
    ],
    { stdio: ["ignore", "ignore", "inherit", "pipe"] },
  );
  const closePromise = once(writer, "close");
  let descriptorError = null;
  writer.stdio[3].on("error", (error) => {
    if (error?.code !== "ECONNRESET" || error?.syscall !== "read") {
      descriptorError = error;
    }
  });
  const payload = "JWT_SECRET='synthetic-test-only'\n";
  writer.stdio[3].end(Buffer.from(payload, "utf8"));

  const readWithTimeout = async () => {
    let timeout;
    try {
      return await Promise.race([
        readFile(transport.path, "utf8"),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("FIFO read timed out")),
            5_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    assert.equal(await readWithTimeout(), payload);
    assert.equal(await readWithTimeout(), payload);
    assert.equal(lstatSync(transport.path).size, 0);
  } finally {
    writer.kill("SIGKILL");
    await closePromise;
    rmSync(transport.directory, { recursive: true, force: true });
  }
  assert.ifError(descriptorError);
});

test("the FIFO writer exits if its supervisor disappears while no reader exists", { timeout: 5_000 }, async () => {
  const transport = createPrivateSecretFifo();
  const writer = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./local-secret-fifo-writer.mjs", import.meta.url)),
      transport.path,
      "99999999",
    ],
    { stdio: ["ignore", "ignore", "inherit", "pipe"] },
  );
  const closePromise = once(writer, "close");
  let descriptorError = null;
  writer.stdio[3].on("error", (error) => {
    if (error?.code !== "ECONNRESET" || error?.syscall !== "read") {
      descriptorError = error;
    }
  });
  writer.stdio[3].end(Buffer.from("JWT_SECRET='synthetic-test-only'\n", "utf8"));

  let timeout;
  try {
    const [code] = await Promise.race([
      closePromise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("orphan FIFO writer did not exit")),
          2_000,
        );
      }),
    ]);
    assert.notEqual(code, 0);
  } finally {
    clearTimeout(timeout);
    if (writer.exitCode === null && writer.signalCode === null) {
      writer.kill("SIGKILL");
    }
    await closePromise;
    rmSync(transport.directory, { recursive: true, force: true });
  }
  assert.ifError(descriptorError);
});

test("Keychain probes use the fixed service and never request a value", () => {
  const calls = [];
  const exists = keychainItemExists("JWT_SECRET", (...arguments_) => {
    calls.push(arguments_);
    return { status: 0 };
  });
  assert.equal(exists, true);
  assert.equal(calls[0][0], "/usr/bin/security");
  assert.deepEqual(calls[0][1], [
    "find-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    "JWT_SECRET",
  ]);
  assert.deepEqual(calls[0][2], { stdio: "ignore" });
});

test("Keychain reads strip only the client's trailing newline", () => {
  const value = readKeychainItem("JWT_SECRET", () => ({
    status: 0,
    stdout: Buffer.from("  exact secret  \n", "utf8"),
  }));
  assert.equal(value, "  exact secret  ");
  assert.equal(readKeychainItem("JWT_SECRET", () => ({ status: 44 })), null);
});

test("Keychain writes prompt without placing a secret or broad ACL in argv", () => {
  const calls = [];
  setKeychainItem("JWT_SECRET", false, (...arguments_) => {
    calls.push(arguments_);
    return {
      status: arguments_[1][0] === "find-generic-password" ? 44 : 0,
    };
  });
  assert.equal(calls.length, 2);
  const addArguments = calls[1][1];
  assert.equal(calls[1][0], "/usr/bin/security");
  assert.equal(addArguments[0], "add-generic-password");
  assert.equal(addArguments.at(-1), "-w");
  assert.equal(addArguments.includes("-A"), false);
  assert.deepEqual(calls[1][2], { stdio: "inherit" });
});
