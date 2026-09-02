import assert from "node:assert/strict";
import test from "node:test";

import { expectedAasa, htmlPrerequisites } from "./app-store-public-contract.mjs";
import {
  parseRemoteVerificationOptions,
  verifyPublishedAppStorePrerequisites,
  waitForPublishedAppStorePrerequisites,
} from "./verify-app-store-remotes.mjs";

const aasaUrl = "https://app.zenguy.com/.well-known/apple-app-site-association";
const healthUrl = "https://api.zenguy.com/api/health";
const versionUrl = "https://api.zenguy.com/api/app/version";

function canonicalHtml(definition) {
  return (
    `<html><head><link rel="canonical" href="${definition.url}"></head>` +
    `<body>${definition.invariants.join(" ")}</body></html>`
  );
}

function responseFor(
  url,
  {
    runnerDispatch = "container",
    storeUrl = null,
    supportUnavailable = false,
  } = {},
) {
  const definition = htmlPrerequisites.find((item) => item.url === url);
  if (definition !== undefined) {
    if (supportUnavailable && url === "https://zenguy.com/support/") {
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(canonicalHtml(definition), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (url === aasaUrl) {
    return Response.json(expectedAasa);
  }
  if (url === healthUrl) {
    return Response.json({
      data: { environment: "production", ok: true, runnerDispatch },
    });
  }
  if (url === versionUrl) {
    return Response.json({ data: { minVersion: "0.2.2", storeUrl } });
  }
  throw new Error(`unexpected URL ${url}`);
}

test("accepts the complete reviewed public contract", async () => {
  const failures = await verifyPublishedAppStorePrerequisites({
    fetchFn: async (url) => responseFor(url),
    localAasa: expectedAasa,
  });

  assert.deepEqual(failures, []);
});

test("retries transient Pages propagation and succeeds without hiding the first failure", async () => {
  let supportRequests = 0;
  const delays = [];
  const retries = [];
  const result = await waitForPublishedAppStorePrerequisites({
    attempts: 2,
    delayMs: 25,
    fetchFn: async (url) => {
      if (url === "https://zenguy.com/support/") supportRequests += 1;
      return responseFor(url, { supportUnavailable: supportRequests === 1 });
    },
    localAasa: expectedAasa,
    sleepFn: async (delayMs) => delays.push(delayMs),
    onRetry: (retry) => retries.push(retry),
  });

  assert.deepEqual(result, { attemptsUsed: 2, failures: [] });
  assert.deepEqual(delays, [25]);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].failures.some((failure) => failure.includes("got 404")), true);
});

test("returns the final deployment failures after exhausting the bounded wait", async () => {
  let sleeps = 0;
  const result = await waitForPublishedAppStorePrerequisites({
    attempts: 3,
    delayMs: 10,
    fetchFn: async (url) => responseFor(url, { supportUnavailable: true }),
    localAasa: expectedAasa,
    sleepFn: async () => {
      sleeps += 1;
    },
  });

  assert.equal(result.attemptsUsed, 3);
  assert.equal(sleeps, 2);
  assert.equal(result.failures.some((failure) => failure.includes("got 404")), true);
});

test("rejects a production API serving the wrong runner dispatch mode", async () => {
  const failures = await verifyPublishedAppStorePrerequisites({
    fetchFn: async (url) => responseFor(url, { runnerDispatch: "queue" }),
    localAasa: expectedAasa,
  });

  assert.equal(
    failures.includes(`${healthUrl}: runnerDispatch must be container`),
    true,
  );
});

test("rejects an update link for another App Store listing", async () => {
  const failures = await verifyPublishedAppStorePrerequisites({
    fetchFn: async (url) =>
      responseFor(url, {
        storeUrl: "https://apps.apple.com/app/id123456789",
      }),
    localAasa: expectedAasa,
  });

  assert.equal(
    failures.includes(
      `${versionUrl}: storeUrl must be null or the canonical Zenguy App Store URL`,
    ),
    true,
  );
});

test("parses only bounded retry options", () => {
  assert.deepEqual(
    parseRemoteVerificationOptions(["--attempts", "20", "--delay-ms", "15000"]),
    { attempts: 20, delayMs: 15_000 },
  );
  assert.throws(
    () => parseRemoteVerificationOptions(["--attempts", "2"]),
    /--delay-ms must be greater than zero/u,
  );
  assert.throws(
    () => parseRemoteVerificationOptions(["--attempts", "41", "--delay-ms", "1"]),
    /--attempts must be an integer/u,
  );
  assert.throws(
    () => parseRemoteVerificationOptions(["--forever"]),
    /unknown argument/u,
  );
});
