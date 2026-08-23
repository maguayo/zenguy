#!/usr/bin/env node

import { webcrypto } from "node:crypto";
import { performance } from "node:perf_hooks";
import process from "node:process";
import {
  PASSWORD_HASH_SCHEME,
  PASSWORD_HASH_VERSION,
  PASSWORD_KDF_TARGET_MAX_MS,
  PBKDF2_ITERATIONS,
} from "../src/shared/constants.ts";

const DEFAULT_SAMPLES = 7;
const MAX_SAMPLES = 50;
const encoder = new TextEncoder();

function sampleCount(argv) {
  const argument = argv.find((value) => value.startsWith("--samples="));
  if (argument === undefined) return DEFAULT_SAMPLES;
  const value = Number(argument.slice("--samples=".length));
  if (!Number.isSafeInteger(value) || value < 3 || value > MAX_SAMPLES) {
    throw new Error(`--samples must be an integer between 3 and ${MAX_SAMPLES}`);
  }
  return value;
}

function percentile(sorted, percentileValue) {
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1),
  );
  return sorted[index];
}

async function derive(material, salt) {
  const startedAt = performance.now();
  const bits = await webcrypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    256,
  );
  return {
    bytes: new Uint8Array(bits).byteLength,
    milliseconds: performance.now() - startedAt,
  };
}

async function main() {
  const samples = sampleCount(process.argv.slice(2));
  const material = await webcrypto.subtle.importKey(
    "raw",
    encoder.encode("zenguy synthetic KDF benchmark input"),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const salt = new Uint8Array(16);

  // Warm Web Crypto before collecting samples; this is a KDF calibration,
  // not a cold-start benchmark.
  await derive(material, salt);
  const durations = [];
  for (let index = 0; index < samples; index += 1) {
    const result = await derive(material, salt);
    if (result.bytes !== 32) throw new Error("Unexpected PBKDF2 output length");
    durations.push(result.milliseconds);
  }
  const sorted = durations.toSorted((left, right) => left - right);
  const p50Ms = percentile(sorted, 0.5);
  const p95Ms = percentile(sorted, 0.95);
  const report = {
    scheme: PASSWORD_HASH_SCHEME,
    version: PASSWORD_HASH_VERSION,
    iterations: PBKDF2_ITERATIONS,
    samples,
    p50Ms: Number(p50Ms.toFixed(2)),
    p95Ms: Number(p95Ms.toFixed(2)),
    targetMaxMs: PASSWORD_KDF_TARGET_MAX_MS,
    runtime: `node ${process.version} ${process.platform}/${process.arch}`,
    passed: p95Ms <= PASSWORD_KDF_TARGET_MAX_MS,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
