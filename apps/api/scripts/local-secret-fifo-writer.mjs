import {
  constants,
  lstatSync,
  readFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

const MAX_PAYLOAD_BYTES = 512 * 1024;
const REOPEN_DELAY_MS = 10;
const descriptorPath = "/dev/fd/3";
const fifoPath = process.argv[2];
const supervisorPid = Number(process.argv[3]);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (
  fifoPath === undefined ||
  !isAbsolute(fifoPath) ||
  !Number.isSafeInteger(supervisorPid) ||
  supervisorPid <= 1
) {
  fail("The secret FIFO writer requires one absolute FIFO path and supervisor PID");
}

const directoryStat = lstatSync(dirname(fifoPath));
const fifoStat = lstatSync(fifoPath);
if (
  !directoryStat.isDirectory() ||
  directoryStat.isSymbolicLink() ||
  (directoryStat.mode & 0o077) !== 0 ||
  !fifoStat.isFIFO() ||
  fifoStat.isSymbolicLink() ||
  (fifoStat.mode & 0o077) !== 0 ||
  (typeof process.getuid === "function" &&
    (directoryStat.uid !== process.getuid() || fifoStat.uid !== process.getuid()))
) {
  fail("The secret FIFO and its directory must be private and owned by this user");
}

const payload = readFileSync(descriptorPath);
if (payload.byteLength === 0 || payload.byteLength > MAX_PAYLOAD_BYTES) {
  payload.fill(0);
  fail("The secret FIFO payload is empty or too large");
}

// `open()` on a FIFO waits in libuv rather than blocking this event loop. If
// the supervisor is killed abruptly, terminate the helper promptly instead of
// leaving an orphan that retains the payload while waiting for another reader.
const supervisorWatchdog = setInterval(() => {
  let alive = process.ppid === supervisorPid;
  if (alive) {
    try {
      process.kill(supervisorPid, 0);
    } catch {
      alive = false;
    }
  }
  if (!alive) {
    payload.fill(0);
    process.exit(1);
  }
}, 100);

// Wrangler may load its env file during initial config resolution and again
// when configuring the dev runtime. Serve the same in-memory payload to every
// open; each writer close gives readFileSync the EOF it needs. The supervisor
// kills this helper as soon as Wrangler exits.
for (;;) {
  let handle;
  try {
    handle = await open(
      fifoPath,
      constants.O_WRONLY |
        constants.O_NONBLOCK |
        (constants.O_NOFOLLOW ?? 0),
    );
    const openedStat = await handle.stat();
    if (
      !openedStat.isFIFO() ||
      openedStat.dev !== fifoStat.dev ||
      openedStat.ino !== fifoStat.ino ||
      (openedStat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" &&
        openedStat.uid !== process.getuid())
    ) {
      payload.fill(0);
      fail("The secret FIFO changed while Wrangler was running");
    }
    let offset = 0;
    while (offset < payload.byteLength) {
      try {
        const { bytesWritten } = await handle.write(
          payload,
          offset,
          Math.min(16 * 1024, payload.byteLength - offset),
          null,
        );
        if (bytesWritten === 0) {
          await new Promise((resolve) => setTimeout(resolve, REOPEN_DELAY_MS));
        } else {
          offset += bytesWritten;
        }
      } catch (error) {
        if (error?.code !== "EAGAIN" && error?.code !== "EWOULDBLOCK") throw error;
        await new Promise((resolve) => setTimeout(resolve, REOPEN_DELAY_MS));
      }
    }
  } catch (error) {
    // A non-blocking writer sees ENXIO until Wrangler opens the read side. This
    // keeps the event loop responsive so the supervisor watchdog can wipe the
    // in-memory payload and terminate an orphaned helper.
    if (
      error?.code !== "ENXIO" &&
      error?.code !== "EPIPE" &&
      error?.code !== "EINTR"
    ) {
      payload.fill(0);
      throw error;
    }
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
  // Give the current reader an observable zero-writer interval so it receives
  // EOF before a later Wrangler config pass opens the FIFO again. Without the
  // interval, a fast reopen can concatenate multiple copies into one read.
  await new Promise((resolve) => setTimeout(resolve, REOPEN_DELAY_MS));
}
