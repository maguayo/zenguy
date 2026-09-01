#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const expectedWidth = 1320;
const expectedHeight = 2868;
const screenshotDefinitions = [
  ["01-overview.png", "01-overview.jpg", "Know what is working"],
  ["02-test-run-evidence.png", "02-test-run-evidence.jpg", "See every browser-test step"],
  ["03-uptime.png", "03-uptime.jpg", "Track uptime at a glance"],
  ["04-incident.png", "04-incident.jpg", "Understand incidents quickly"],
  ["05-notifications.png", "05-notifications.jpg", "Alerts where your team needs them"],
];

function usage(exitCode = 2) {
  console.error(
    "usage: prepare-app-store-screenshots.mjs <maestro-output-dir> <store-output-dir> " +
      "--version <version> --build <number> --commit <40-char-sha> " +
      "--eas-build <uuid> --eas-submission <uuid>",
  );
  process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const rawDirectoryArgument = args.shift();
const outputDirectoryArgument = args.shift();
if (
  rawDirectoryArgument === undefined ||
  outputDirectoryArgument === undefined ||
  rawDirectoryArgument.startsWith("--") ||
  outputDirectoryArgument.startsWith("--")
) {
  usage();
}

const options = new Map();
while (args.length > 0) {
  const flag = args.shift();
  const value = args.shift();
  if (
    value === undefined ||
    !["--version", "--build", "--commit", "--eas-build", "--eas-submission"].includes(
      flag ?? "",
    ) ||
    options.has(flag)
  ) {
    usage();
  }
  options.set(flag, value);
}

const packageJson = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8"));
const version = options.get("--version");
const build = options.get("--build");
const commit = options.get("--commit")?.toLowerCase();
const easBuildId = options.get("--eas-build")?.toLowerCase();
const easSubmissionId = options.get("--eas-submission")?.toLowerCase();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

if (version !== packageJson.version) {
  throw new Error(`screenshot version must match package version ${packageJson.version}`);
}
if (build === undefined || !/^[1-9]\d*$/u.test(build)) {
  throw new Error("screenshot build must be a positive integer");
}
if (commit === undefined || !/^[0-9a-f]{40}$/u.test(commit)) {
  throw new Error("screenshot commit must be a full 40-character Git SHA");
}
if (easBuildId === undefined || !uuidPattern.test(easBuildId)) {
  throw new Error("EAS build ID must be a UUID");
}
if (easSubmissionId === undefined || !uuidPattern.test(easSubmissionId)) {
  throw new Error("EAS submission ID must be a UUID");
}
if (process.platform !== "darwin" || !existsSync("/usr/bin/sips")) {
  throw new Error("App Store screenshot preparation requires macOS /usr/bin/sips");
}

const rawDirectory = realpathSync(resolve(rawDirectoryArgument));
if (!lstatSync(rawDirectory).isDirectory()) {
  throw new Error(`Maestro output is not a directory: ${rawDirectory}`);
}
const outputDirectory = resolve(outputDirectoryArgument);
if (existsSync(outputDirectory)) {
  if (!lstatSync(outputDirectory).isDirectory()) {
    throw new Error(`output path is not a directory: ${outputDirectory}`);
  }
  if (readdirSync(outputDirectory).length > 0) {
    throw new Error(`output directory must be empty: ${outputDirectory}`);
  }
} else {
  mkdirSync(outputDirectory, { recursive: true });
}

function namedFiles(root, filename) {
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...namedFiles(path, filename));
    else if (entry.isFile() && entry.name === filename) found.push(path);
  }
  return found;
}

function sipsProperties(path) {
  const result = spawnSync(
    "/usr/bin/sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "space", "-g", "hasAlpha", path],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`sips inspection failed for ${path}: ${result.stderr.trim()}`);
  }
  return Object.fromEntries(
    result.stdout
      .split("\n")
      .map((line) => /^\s{2}([A-Za-z]+): (.+)$/u.exec(line))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]]),
  );
}

const files = [];
for (const [rawName, outputName, caption] of screenshotDefinitions) {
  const matches = namedFiles(rawDirectory, rawName);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${rawName} in Maestro output; found ${matches.length}`);
  }
  const inputPath = realpathSync(matches[0]);
  if (relative(rawDirectory, inputPath).startsWith("..") || !lstatSync(inputPath).isFile()) {
    throw new Error(`unsafe screenshot input: ${inputPath}`);
  }
  const rawProperties = sipsProperties(inputPath);
  if (
    rawProperties.pixelWidth !== String(expectedWidth) ||
    rawProperties.pixelHeight !== String(expectedHeight)
  ) {
    throw new Error(
      `${rawName} must be ${expectedWidth} × ${expectedHeight}; got ` +
        `${rawProperties.pixelWidth ?? "?"} × ${rawProperties.pixelHeight ?? "?"}`,
    );
  }

  const outputPath = join(outputDirectory, outputName);
  const conversion = spawnSync(
    "/usr/bin/sips",
    [
      "--setProperty",
      "format",
      "jpeg",
      "--setProperty",
      "formatOptions",
      "100",
      inputPath,
      "--out",
      outputPath,
    ],
    { encoding: "utf8" },
  );
  if (conversion.status !== 0) {
    throw new Error(`sips conversion failed for ${rawName}: ${conversion.stderr.trim()}`);
  }
  const properties = sipsProperties(outputPath);
  if (
    properties.pixelWidth !== String(expectedWidth) ||
    properties.pixelHeight !== String(expectedHeight) ||
    properties.space !== "RGB" ||
    properties.hasAlpha !== "no"
  ) {
    throw new Error(`${outputName} failed RGB/no-alpha/dimension QA`);
  }
  const content = readFileSync(outputPath);
  if (content.length < 50_000 || content.length > 10_000_000) {
    throw new Error(`${outputName} has an implausible App Store screenshot size`);
  }
  files.push({
    caption,
    filename: outputName,
    format: "JPEG",
    hasAlpha: false,
    height: expectedHeight,
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: statSync(outputPath).size,
    source: rawName,
    width: expectedWidth,
  });
}

if (new Set(files.map((file) => file.sha256)).size !== files.length) {
  throw new Error("App Store screenshots must be five distinct images");
}

const manifest = {
  app: "Zenguy",
  build,
  commit,
  easBuildId,
  easSubmissionId,
  files,
  generatedAt: new Date().toISOString(),
  locale: "en-US",
  schemaVersion: 1,
  version,
};
const manifestPath = join(outputDirectory, "app-store-screenshots.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(
  `Prepared ${files.length} App Store screenshots for Zenguy ${version} (${build}) in ${outputDirectory}.`,
);
