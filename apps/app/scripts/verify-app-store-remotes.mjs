#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  htmlPrerequisites,
  maxPublicDocumentBytes,
  ordered,
  validateAasaDocument,
  validateHtmlPrerequisite,
} from "./app-store-public-contract.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultRequestTimeoutMs = 15_000;

function readReviewedAasa() {
  return JSON.parse(
    readFileSync(
      join(
        appRoot,
        "..",
        "frontend",
        "public",
        ".well-known",
        "apple-app-site-association",
      ),
      "utf8",
    ),
  );
}

export async function verifyPublishedAppStorePrerequisites({
  fetchFn = fetch,
  localAasa = readReviewedAasa(),
  requestTimeoutMs = defaultRequestTimeoutMs,
} = {}) {
  const failures = [];
  const fail = (message) => failures.push(message);

  async function get(url, expectedContentType) {
    let response;
    try {
      response = await fetchFn(url, {
        cache: "no-store",
        headers: { accept: expectedContentType },
        redirect: "manual",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      fail(
        `${url}: request failed (${error instanceof Error ? error.message : "unknown error"})`,
      );
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status !== 200) {
      fail(`${url}: expected HTTP 200 without redirect, got ${response.status}`);
      return null;
    }
    if (!contentType.toLowerCase().startsWith(expectedContentType)) {
      fail(`${url}: expected ${expectedContentType}, got ${contentType || "no Content-Type"}`);
      return null;
    }
    const body = await response.text();
    if (Buffer.byteLength(body) > maxPublicDocumentBytes) {
      fail(`${url}: response exceeds the bounded release-preflight size`);
      return null;
    }
    return body;
  }

  async function verifyHtml(definition) {
    const body = await get(definition.url, "text/html");
    if (body === null) return;
    for (const failure of validateHtmlPrerequisite(definition, body)) {
      fail(`${definition.url}: ${failure}`);
    }
  }

  async function verifyAasa() {
    const url = "https://app.zenguy.com/.well-known/apple-app-site-association";
    const body = await get(url, "application/json");
    if (body === null) return;
    if (Buffer.byteLength(body) >= 128 * 1024) {
      fail(`${url}: AASA exceeds Apple's 128 KiB limit`);
    }
    let remote;
    try {
      remote = JSON.parse(body);
    } catch {
      fail(`${url}: response is not valid JSON`);
      return;
    }
    for (const failure of validateAasaDocument(localAasa)) {
      fail(`${url}: reviewed source ${failure}`);
    }
    for (const failure of validateAasaDocument(remote)) {
      fail(`${url}: deployed document ${failure}`);
    }
    if (JSON.stringify(ordered(remote)) !== JSON.stringify(ordered(localAasa))) {
      fail(`${url}: deployed AASA does not exactly match the reviewed source`);
    }
  }

  async function verifyApi() {
    const healthUrl = "https://api.zenguy.com/api/health";
    const versionUrl = "https://api.zenguy.com/api/app/version";
    const [healthBody, versionBody] = await Promise.all([
      get(healthUrl, "application/json"),
      get(versionUrl, "application/json"),
    ]);
    if (healthBody !== null) {
      try {
        const health = JSON.parse(healthBody);
        if (health?.data?.ok !== true) fail(`${healthUrl}: health envelope is not OK`);
        if (health?.data?.environment !== "production") {
          fail(`${healthUrl}: environment must identify production`);
        }
        if (health?.data?.runnerDispatch !== "queue") {
          fail(`${healthUrl}: runnerDispatch must be queue`);
        }
      } catch {
        fail(`${healthUrl}: response is not valid JSON`);
      }
    }
    if (versionBody !== null) {
      try {
        const version = JSON.parse(versionBody)?.data;
        if (!/^\d+\.\d+\.\d+$/u.test(version?.minVersion ?? "")) {
          fail(`${versionUrl}: minVersion is not semantic x.y.z`);
        }
        if (version?.storeUrl !== null) {
          if (
            !/^https:\/\/apps\.apple\.com\/(?:[^?#]+\/)?id6804201911$/u.test(
              version?.storeUrl ?? "",
            )
          ) {
            fail(
              `${versionUrl}: storeUrl must be null or the canonical Zenguy App Store URL`,
            );
          }
        }
      } catch {
        fail(`${versionUrl}: response is not valid JSON or contains an invalid storeUrl`);
      }
    }
  }

  await Promise.all([
    ...htmlPrerequisites.map(verifyHtml),
    verifyAasa(),
    verifyApi(),
  ]);

  return failures;
}

export async function waitForPublishedAppStorePrerequisites({
  attempts = 1,
  delayMs = 0,
  sleepFn = sleep,
  onRetry = () => {},
  ...verificationOptions
} = {}) {
  let failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    failures = await verifyPublishedAppStorePrerequisites(verificationOptions);
    if (failures.length === 0) return { attemptsUsed: attempt, failures };
    if (attempt < attempts) {
      onRetry({ attempt, attempts, delayMs, failures: [...failures] });
      await sleepFn(delayMs);
    }
  }
  return { attemptsUsed: attempts, failures };
}

function parseBoundedInteger(value, name, minimum, maximum) {
  if (!/^\d+$/u.test(value ?? "")) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function parseRemoteVerificationOptions(argv) {
  const options = { attempts: 1, delayMs: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--attempts") {
      options.attempts = parseBoundedInteger(argv[index + 1], argument, 1, 40);
      index += 1;
    } else if (argument === "--delay-ms") {
      options.delayMs = parseBoundedInteger(argv[index + 1], argument, 0, 60_000);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (options.attempts > 1 && options.delayMs === 0) {
    throw new Error("--delay-ms must be greater than zero when retries are enabled");
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseRemoteVerificationOptions(process.argv.slice(2));
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : "invalid arguments"}`);
    process.exitCode = 2;
    return;
  }

  const result = await waitForPublishedAppStorePrerequisites({
    ...options,
    onRetry({ attempt, attempts, delayMs, failures }) {
      console.log(
        `Published prerequisites are not ready after attempt ${attempt}/${attempts} ` +
          `(${failures.length} failure(s)); retrying in ${delayMs} ms.`,
      );
    },
  });
  if (result.failures.length > 0) {
    for (const failure of result.failures) console.error(`FAIL: ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(
      "Published App Store prerequisites verified " +
        `(support, privacy, AASA and production API; ${result.attemptsUsed} attempt(s)).`,
    );
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
