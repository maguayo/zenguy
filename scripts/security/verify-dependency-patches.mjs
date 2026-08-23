import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function crc32(input) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function symlinkZip(name, target) {
  const fileName = Buffer.from(name);
  const content = Buffer.from(target);
  const checksum = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(fileName.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE((0o120777 << 16) >>> 0, 38);

  const centralOffset = local.length + fileName.length + content.length;
  const centralSize = central.length + fileName.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, fileName, content, central, fileName, end]);
}

const apiRequire = createRequire(join(root, "apps/api/package.json"));
const cloudflarePuppeteer = apiRequire.resolve("@cloudflare/puppeteer");
const browsersEntry = createRequire(cloudflarePuppeteer).resolve("@puppeteer/browsers");
const extractZip = createRequire(browsersEntry)("extract-zip");
const scratch = await mkdtemp(join(tmpdir(), "zenguy-extract-zip-"));
try {
  const archive = join(scratch, "escape.zip");
  const destination = join(scratch, "destination");
  await writeFile(archive, symlinkZip("escape", "../../outside"));
  await assert.rejects(
    extractZip(archive, { dir: destination }),
    /Out of bound symlink/u,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}

const appRequire = createRequire(join(root, "apps/app/package.json"));
const imageSize = appRequire("image-size");
const malformedIcns = Buffer.alloc(16);
malformedIcns.write("icns", 0, "ascii");
malformedIcns.writeUInt32BE(16, 4);
malformedIcns.write("icp4", 8, "ascii");
assert.throws(() => imageSize(malformedIcns), /Invalid ICNS entry length/u);

const imageUtilsPath = join(dirname(appRequire.resolve("image-size/package.json")), "dist/types/utils.js");
const imageUtilsSource = await readFile(imageUtilsPath, "utf8");
assert.match(imageUtilsSource, /boxSize < 8/u);

console.log("Local extract-zip and image-size advisory patches are active and verified.");
