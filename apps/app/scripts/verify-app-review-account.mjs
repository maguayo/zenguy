#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const apiOrigin = "https://api.zenguy.com";
const requestTimeoutMs = 15_000;
const maximumResponseBytes = 2_000_000;
const completedRunStatuses = new Set(["PASSED", "FAILED", "TIMEOUT", "SYSTEM_ERROR"]);
const localFixtureEmails = new Set([
  "owner@example.com",
  "ana@zenguy.dev",
  "luis@zenguy.dev",
  "marta@zenguy.dev",
  "diego@zenguy.dev",
]);
const localFixturePasswords = new Set([
  "Local-demo-password-2026!",
  "Password123!",
]);

export class AppReviewAccountVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AppReviewAccountVerificationError";
  }
}

function assertReview(condition, message) {
  if (!condition) throw new AppReviewAccountVerificationError(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireArray(value, label) {
  assertReview(Array.isArray(value), `${label}: expected an array`);
  return value;
}

function safeDemoUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    return (
      url.protocol === "https:" &&
      (hostname === "example.com" ||
        hostname.endsWith(".example.com") ||
        hostname === "zenguy.com" ||
        hostname.endsWith(".zenguy.com"))
    );
  } catch {
    return false;
  }
}

function safeArtifactUrl(value) {
  try {
    const url = new URL(value, apiOrigin);
    const expectedArtifactQuery = ["exp", "id", "sig"];
    const queryKeys = [...url.searchParams.keys()].sort();
    const expiration = Number(url.searchParams.get("exp"));
    return (
      url.origin === apiOrigin &&
      url.pathname === "/api/artifact-content" &&
      JSON.stringify(queryKeys) === JSON.stringify(expectedArtifactQuery) &&
      /^[A-Za-z0-9_-]{1,200}$/u.test(url.searchParams.get("id") ?? "") &&
      Number.isSafeInteger(expiration) &&
      expiration > Math.floor(Date.now() / 1_000) &&
      /^[A-Za-z0-9_-]{43}$/u.test(url.searchParams.get("sig") ?? "")
    );
  } catch {
    return false;
  }
}

async function verifyScreenshotEvidence(fetchFn, evidence, timeoutMs) {
  assertReview(
    evidence.length >= 1 && evidence.every((artifact) => safeArtifactUrl(artifact?.url)),
    "review workspace: Blog listing lacks safe signed screenshot evidence",
  );
  const url = new URL(evidence[0].url, apiOrigin);
  let response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: "image/*" },
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AppReviewAccountVerificationError(
      "review workspace: signed screenshot evidence could not be loaded",
    );
  }
  const availableImage =
    response.status === 200 &&
    (response.headers.get("content-type") ?? "").toLowerCase().startsWith("image/");
  try {
    await response.body?.cancel();
  } catch {
    // Headers are sufficient. Never retain or print production evidence bytes.
  }
  assertReview(
    availableImage,
    "review workspace: signed screenshot evidence is unavailable or not an image",
  );
}

function safeApiPath(pathname) {
  return pathname
    .replace(/^\/api\/workspaces\/[^/]+/u, "/api/workspaces/:workspaceId")
    .replace(/\/browser-tests\/[^/]+/u, "/browser-tests/:testId")
    .replace(/\/runs\/[^/]+/u, "/runs/:runId")
    .replace(/\/attempts\/[^/]+/u, "/attempts/:attemptId")
    .replace(/\/uptime-monitors\/[^/]+/u, "/uptime-monitors/:monitorId")
    .replace(/\/incidents\/[^/]+/u, "/incidents/:incidentId")
    .replace(/\/channels\/[^/]+/u, "/channels/:channelId");
}

function validateCredentials(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  assertReview(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedEmail),
    "review credentials: email is missing or invalid",
  );
  assertReview(password.length >= 16, "review credentials: password is missing or too short");
  assertReview(
    !localFixtureEmails.has(normalizedEmail) &&
      !normalizedEmail.endsWith("@example.com") &&
      !normalizedEmail.endsWith(".invalid"),
    "review credentials: committed local fixture identities are forbidden in production",
  );
  assertReview(
    !localFixturePasswords.has(password),
    "review credentials: committed local fixture passwords are forbidden in production",
  );
  return normalizedEmail;
}

async function apiRequest(fetchFn, path, options = {}) {
  const method = options.method ?? "GET";
  assertReview(path.startsWith("/api/"), "review verifier: API path escaped its boundary");
  const url = new URL(path, apiOrigin);
  assertReview(url.origin === apiOrigin, "review verifier: API origin changed");
  const safePath = safeApiPath(url.pathname);
  const headers = new Headers({
    Accept: "application/json",
    "X-Zenguy-Client": "native",
  });
  if (options.accessToken !== undefined) {
    headers.set("Authorization", `Bearer ${options.accessToken}`);
  }
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  let response;
  try {
    response = await fetchFn(url, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? requestTimeoutMs),
    });
  } catch {
    throw new AppReviewAccountVerificationError(
      `${method} ${safePath}: production request failed`,
    );
  }
  const expectedStatus = options.expectedStatus ?? 200;
  if (response.status !== expectedStatus) {
    let code = "UNKNOWN";
    try {
      const envelope = await response.json();
      if (typeof envelope?.error?.code === "string") code = envelope.error.code;
    } catch {
      // The status and safe error code are sufficient; never copy provider bodies.
    }
    throw new AppReviewAccountVerificationError(
      `${method} ${safePath}: HTTP ${response.status} (${code})`,
    );
  }
  if (expectedStatus === 204) return { data: undefined, nextCursor: null };
  const contentType = response.headers.get("content-type") ?? "";
  assertReview(
    contentType.toLowerCase().startsWith("application/json"),
    `${method} ${safePath}: expected application/json`,
  );
  const text = await response.text();
  assertReview(
    Buffer.byteLength(text) <= maximumResponseBytes,
    `${method} ${safePath}: response exceeded the safe size bound`,
  );
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new AppReviewAccountVerificationError(
      `${method} ${safePath}: invalid JSON response`,
    );
  }
  assertReview(
    isRecord(envelope) && Object.hasOwn(envelope, "data"),
    `${method} ${safePath}: missing API data envelope`,
  );
  return {
    data: envelope.data,
    nextCursor: typeof envelope.nextCursor === "string" ? envelope.nextCursor : null,
  };
}

function validateSession(value, expectedEmail) {
  assertReview(isRecord(value), "review login: missing session");
  assertReview(
    typeof value.accessToken === "string" && value.accessToken.length >= 20,
    "review login: invalid access token contract",
  );
  assertReview(
    typeof value.refreshToken === "string" && value.refreshToken.length >= 20,
    "review login: invalid refresh token contract",
  );
  assertReview(isRecord(value.user), "review login: missing user");
  assertReview(value.user.emailVerified === true, "review login: account email is not verified");
  assertReview(
    String(value.user.email).toLowerCase() === expectedEmail,
    "review login: authenticated principal does not match the injected account",
  );
  return value;
}

function isReviewMailbox(value, reviewEmail) {
  const candidate = String(value).toLowerCase();
  if (candidate === reviewEmail) return true;
  const separator = reviewEmail.lastIndexOf("@");
  const candidateSeparator = candidate.lastIndexOf("@");
  if (
    separator <= 0 ||
    candidateSeparator <= 0 ||
    candidate.indexOf("@") !== candidateSeparator
  ) {
    return false;
  }
  const local = reviewEmail.slice(0, separator);
  const domain = reviewEmail.slice(separator + 1);
  const candidateLocal = candidate.slice(0, candidateSeparator);
  const candidateDomain = candidate.slice(candidateSeparator + 1);
  return (
    candidateDomain === domain &&
    candidateLocal.startsWith(`${local}+`) &&
    candidateLocal.length > local.length + 1
  );
}

async function login(fetchFn, email, password, timeoutMs) {
  const response = await apiRequest(fetchFn, "/api/auth/login", {
    body: { email, password },
    method: "POST",
    timeoutMs,
  });
  return validateSession(response.data, email);
}

async function logout(fetchFn, session, timeoutMs) {
  await apiRequest(fetchFn, "/api/auth/logout", {
    body: { refreshToken: session.refreshToken },
    method: "POST",
    expectedStatus: 204,
    timeoutMs,
  });
}

function validateMemberDestinations(members, channels, reviewEmail) {
  assertReview(members.length >= 1, "review workspace: Members must contain at least the reviewer");
  for (const member of members) {
    const email = String(member?.email ?? "").toLowerCase();
    assertReview(
      isReviewMailbox(email, reviewEmail),
      "review workspace: Members contains a non-approved identity",
    );
    assertReview(
      typeof member?.name === "string" && member.name.trim() !== "",
      "review workspace: Members contains an unnamed identity",
    );
  }

  assertReview(channels.length >= 1, "review workspace: at least one notification channel is required");
  assertReview(
    channels.some((channel) => channel?.enabled === true),
    "review workspace: at least one enabled notification channel is required",
  );
  for (const channel of channels) {
    assertReview(
      channel?.type === "EMAIL" || channel?.type === "PUSH",
      "review workspace: only EMAIL/PUSH demo channels are allowed",
    );
    if (channel.type === "EMAIL") {
      const emails = channel?.configPreview?.emails;
      assertReview(
        Array.isArray(emails) && emails.length >= 1,
        "review workspace: invalid email channel preview",
      );
      for (const value of emails) {
        const email = String(value).toLowerCase();
        assertReview(
          isReviewMailbox(email, reviewEmail),
          "review workspace: notification channel contains a non-approved destination",
        );
      }
    } else {
      assertReview(
        channel?.configPreview?.recipients === "WORKSPACE_MEMBERS",
        "review workspace: push channel must target only workspace members",
      );
    }
  }
}

async function verifyWorkspace(fetchFn, session, workspace, reviewEmail, timeoutMs) {
  const workspaceId = encodeURIComponent(workspace.id);
  const base = `/api/workspaces/${workspaceId}`;
  const authenticated = { accessToken: session.accessToken, timeoutMs };
  const [overviewResponse, testsResponse, monitorsResponse, incidentsResponse, channelsResponse, membersResponse, consentResponse] =
    await Promise.all([
      apiRequest(fetchFn, `${base}/overview`, authenticated),
      apiRequest(fetchFn, `${base}/browser-tests?limit=100`, authenticated),
      apiRequest(fetchFn, `${base}/uptime-monitors?limit=100`, authenticated),
      apiRequest(fetchFn, `${base}/incidents?limit=100`, authenticated),
      apiRequest(fetchFn, `${base}/channels?limit=100`, authenticated),
      apiRequest(fetchFn, `${base}/members`, authenticated),
      apiRequest(fetchFn, `${base}/remote-ai-consent`, authenticated),
    ]);

  const overview = overviewResponse.data;
  const tests = requireArray(testsResponse.data, "review workspace: Tests");
  const monitors = requireArray(monitorsResponse.data, "review workspace: Uptime");
  const incidents = requireArray(incidentsResponse.data, "review workspace: Incidents");
  const channels = requireArray(channelsResponse.data, "review workspace: Notifications");
  const members = requireArray(membersResponse.data, "review workspace: Members");
  const consent = consentResponse.data;

  assertReview(
    isRecord(overview) &&
      overview?.browserTests?.total >= 2 &&
      overview?.uptime?.up + overview?.uptime?.down + overview?.uptime?.unknown >= 1 &&
      Array.isArray(overview.activity) &&
      overview.activity.length >= 1,
    "review workspace: Overview lacks useful test, uptime or activity data",
  );

  const blogTests = tests.filter((test) => test?.name === "Blog listing");
  const incidentTests = tests.filter((test) => test?.name === "Search filters");
  assertReview(blogTests.length === 1, "review workspace: expected exactly one Blog listing test");
  assertReview(
    incidentTests.length === 1,
    "review workspace: expected exactly one Search filters test",
  );
  assertReview(
    safeDemoUrl(blogTests[0].startUrl) && safeDemoUrl(incidentTests[0].startUrl),
    "review workspace: browser tests must target only controlled or reserved demo domains",
  );

  const runsResponse = await apiRequest(
    fetchFn,
    `${base}/browser-tests/${encodeURIComponent(blogTests[0].id)}/runs?limit=10`,
    authenticated,
  );
  const runs = requireArray(runsResponse.data, "review workspace: Blog listing runs");
  const newestRun = runs[0];
  assertReview(
    isRecord(newestRun) &&
      completedRunStatuses.has(newestRun.status) &&
      newestRun.attemptCount >= 1,
    "review workspace: newest Blog listing run must be completed with an attempt",
  );
  const runResponse = await apiRequest(
    fetchFn,
    `${base}/runs/${encodeURIComponent(newestRun.id)}`,
    authenticated,
  );
  const run = runResponse.data;
  const attempts = requireArray(run?.attempts, "review workspace: Blog listing attempts");
  assertReview(
    run?.testId === blogTests[0].id && completedRunStatuses.has(run?.status),
    "review workspace: Blog listing run detail does not match the completed run",
  );
  const attemptDetails = await Promise.all(
    attempts.map((attempt) =>
      apiRequest(
        fetchFn,
        `${base}/attempts/${encodeURIComponent(attempt.id)}`,
        authenticated,
      ).then((response) => response.data),
    ),
  );
  const evidence = attemptDetails.flatMap((attempt) => [
    ...(Array.isArray(attempt?.screenshots) ? attempt.screenshots : []),
    ...(Array.isArray(attempt?.steps)
      ? attempt.steps.map((step) => step?.screenshot).filter(Boolean)
      : []),
  ]);
  await verifyScreenshotEvidence(fetchFn, evidence, timeoutMs);

  const statusMonitors = monitors.filter((monitor) => monitor?.name === "Status API");
  assertReview(statusMonitors.length === 1, "review workspace: expected exactly one Status API monitor");
  assertReview(
    safeDemoUrl(statusMonitors[0].url),
    "review workspace: Status API must target a controlled or reserved demo domain",
  );
  const monitorId = encodeURIComponent(statusMonitors[0].id);
  const [statsResponse, checksResponse] = await Promise.all([
    apiRequest(fetchFn, `${base}/uptime-monitors/${monitorId}/stats`, authenticated),
    apiRequest(fetchFn, `${base}/uptime-monitors/${monitorId}/checks?limit=25`, authenticated),
  ]);
  assertReview(
    typeof statsResponse.data?.avgResponseTimeMs24h === "number" &&
      Array.isArray(statsResponse.data?.series) &&
      statsResponse.data.series.length >= 3,
    "review workspace: Status API lacks response-time history",
  );
  assertReview(
    requireArray(checksResponse.data, "review workspace: Status API checks").length >= 1,
    "review workspace: Status API lacks recent checks",
  );

  const matchingIncidents = incidents.filter(
    (incident) =>
      incident?.resourceName === "Search filters" &&
      incident?.resourceId === incidentTests[0].id &&
      incident?.resourceType === "BROWSER_TEST",
  );
  assertReview(
    matchingIncidents.length === 1,
    "review workspace: expected exactly one Search filters browser-test incident",
  );
  const incidentResponse = await apiRequest(
    fetchFn,
    `${base}/incidents/${encodeURIComponent(matchingIncidents[0].id)}`,
    authenticated,
  );
  assertReview(
    Array.isArray(incidentResponse.data?.events) && incidentResponse.data.events.length >= 2,
    "review workspace: Search filters incident lacks a useful timeline",
  );

  validateMemberDestinations(members, channels, reviewEmail);
  assertReview(
    consent?.provider === "OpenAI" &&
      consent?.policyVersion === "2026-09-01-v1" &&
      consent?.active === false &&
      consent?.acceptedAt === null &&
      consent?.revokedAt === null,
    "review workspace: optional OpenAI consent must remain pristine and off",
  );

  return {
    channels: channels.length,
    incidents: incidents.length,
    members: members.length,
    monitors: monitors.length,
    tests: tests.length,
  };
}

export async function verifyAppReviewAccount({
  email,
  password,
  fetchFn = globalThis.fetch,
  timeoutMs = requestTimeoutMs,
}) {
  assertReview(typeof fetchFn === "function", "review verifier: fetch is unavailable");
  assertReview(typeof email === "string", "review credentials: email is missing or invalid");
  assertReview(typeof password === "string", "review credentials: password is missing or too short");
  const reviewEmail = validateCredentials(email, password);
  const sessions = [];
  let result;
  let verificationError;

  try {
    const primary = await login(fetchFn, reviewEmail, password, timeoutMs);
    sessions.push(primary);
    const secondary = await login(fetchFn, reviewEmail, password, timeoutMs);
    sessions.push(secondary);
    assertReview(
      primary.accessToken !== secondary.accessToken &&
        primary.refreshToken !== secondary.refreshToken,
      "review login: concurrent sessions did not receive independent tokens",
    );

    const [primaryMe, secondaryMe] = await Promise.all([
      apiRequest(fetchFn, "/api/auth/me", {
        accessToken: primary.accessToken,
        timeoutMs,
      }),
      apiRequest(fetchFn, "/api/auth/me", {
        accessToken: secondary.accessToken,
        timeoutMs,
      }),
    ]);
    for (const principal of [primaryMe.data?.user, secondaryMe.data?.user]) {
      assertReview(
        principal?.id === primary.user.id &&
          String(principal?.email).toLowerCase() === reviewEmail &&
          principal?.emailVerified === true,
        "review login: one concurrent session no longer resolves the same verified account",
      );
    }

    const workspacesResponse = await apiRequest(fetchFn, "/api/workspaces", {
      accessToken: primary.accessToken,
      timeoutMs,
    });
    const workspaces = requireArray(workspacesResponse.data, "review account: workspaces");
    assertReview(
      workspaces.length === 1,
      "review account: exactly one workspace is required for deterministic review",
    );
    const workspace = workspaces[0];
    assertReview(
      workspace?.subscriptionStatus === "ACTIVE",
      "review account: workspace access must be active",
    );
    assertReview(
      workspace?.role === "OWNER" || workspace?.role === "ADMIN",
      "review account: Owner/Admin role is required to inspect AI data sharing",
    );
    assertReview(
      typeof workspace?.name === "string" &&
        workspace.name.trim() !== "" &&
        !/@/u.test(workspace.name),
      "review account: workspace must have a non-personal display name",
    );
    result = await verifyWorkspace(
      fetchFn,
      primary,
      workspace,
      reviewEmail,
      timeoutMs,
    );
  } catch (error) {
    verificationError =
      error instanceof AppReviewAccountVerificationError
        ? error
        : new AppReviewAccountVerificationError("review account verification failed safely");
  }

  const cleanup = await Promise.allSettled(
    sessions.map((session) => logout(fetchFn, session, timeoutMs)),
  );
  if (verificationError !== undefined) throw verificationError;
  assertReview(
    cleanup.every((entry) => entry.status === "fulfilled"),
    "review login: one temporary verification session could not be revoked",
  );
  return result;
}

async function main() {
  const email = process.env.MAESTRO_REVIEW_EMAIL;
  const password = process.env.MAESTRO_REVIEW_PASSWORD;
  delete process.env.MAESTRO_REVIEW_EMAIL;
  delete process.env.MAESTRO_REVIEW_PASSWORD;
  try {
    const result = await verifyAppReviewAccount({ email, password });
    console.log(
      "App Review account verified: two concurrent sessions, one active Owner/Admin " +
        `workspace, ${result.tests} tests, ${result.monitors} monitors, ` +
        `${result.incidents} incidents, ${result.channels} channels and ` +
        `${result.members} members; screenshot evidence and pristine AI consent are ready.`,
    );
  } catch (error) {
    console.error(
      `FAIL: ${
        error instanceof AppReviewAccountVerificationError
          ? error.message
          : "review account verification failed safely"
      }`,
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) await main();
